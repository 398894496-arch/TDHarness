#!/bin/bash
# Overlay the product tree from a client zip. Leaves sessions and login alone.
# Keep @@TREE_SCOPE in sync with tree-restore.ps1 and pack-update-check.js PARTS.
# Progress goes to ~/.dsh-company-rc8/desk-boot.progress ("<phase> <done> <total>")
# and stdout (TREE_PROGRESS=...); the Mac window shows it while updating.
set -euo pipefail
ROOT=""
ZIP=""
ZIPURL="${TREE_ZIP_URL:-https://{{TDH_HOST}}:8443/client/CompanyDesk-mac.zip?v=login1}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --zip) ZIP="$2"; shift 2 ;;
    --url) ZIPURL="$2"; shift 2 ;;
    *) echo "usage: tree-restore.sh --root DIR [--zip FILE|--url URL]" >&2; exit 2 ;;
  esac
done
[[ -n "$ROOT" && -d "$ROOT" ]] || { echo "restore-root-missing" >&2; exit 2; }

# @@TREE_SCOPE
is_product() {
  case "$1" in
    prefix|prefix/*|node|node/*|plugins|plugins/*|home/profiles/web/node_modules|home/profiles/web/node_modules/*) return 0 ;;
    skills|skills/*|opencli|opencli/*|peekaboo|peekaboo/*|cua-driver|cua-driver/*|vendor|vendor/*|bin|bin/*) return 0 ;;
    TDHarness.exe|TDHarness|start.ps1|start.command|CompanyDesk.vbs|WebView2Loader.dll|tree-check.js|tree-restore.ps1|tree-restore.sh|pack-update-check.js|sync-skills.js|sync-desk-home.sh|sync-desk-home.ps1|prove-cosmokit.js|desk-lease.js|krouter-hook.js|krouter-hooks.json|mac-mount-company.sh|mac-join-off-lan.sh|mac-pin-settings.js|mac-company-login.js|mac-smb-mount.js|mac-resolve.js|BUILD.json|home/profiles/web/package.json|home/profiles/web/overlay.yml|presets|presets/*) return 0 ;;
    *) return 1 ;;
  esac
}

# One restore at a time. A dead pid is a stale lock.
acquire_lock() {
  local d="$1"
  mkdir -p "$(dirname "$d")" 2>/dev/null || return 1
  if [[ -d "$d" ]]; then
    old="$(cat "$d/pid" 2>/dev/null || true)"
    if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
      return 1
    fi
    rm -rf "$d"
  fi
  mkdir "$d" 2>/dev/null || return 1
  echo $$ > "$d/pid"
  return 0
}
lock_dir=""
if acquire_lock "${HOME:-/tmp}/.dsh-company-rc8/tree-restore.lock"; then
  lock_dir="${HOME:-/tmp}/.dsh-company-rc8/tree-restore.lock"
elif acquire_lock /tmp/dsh-tree-restore.lock; then
  lock_dir=/tmp/dsh-tree-restore.lock
else
  echo "TREE_RESTORE_BUSY=1" >&2
  exit 2
fi

owned=0
tmp=""
PROGRESS_FILE="${HOME:-/tmp}/.dsh-company-rc8/desk-boot.progress"
progress() {
  mkdir -p "$(dirname "$PROGRESS_FILE")" 2>/dev/null || true
  printf '%s %s %s\n' "$1" "$2" "$3" > "$PROGRESS_FILE.tmp" 2>/dev/null && mv -f "$PROGRESS_FILE.tmp" "$PROGRESS_FILE" 2>/dev/null || true
  echo "TREE_PROGRESS=$1 $2 $3"
}
cleanup() {
  rm -rf "$tmp"
  [[ $owned -eq 1 ]] && rm -f "$ZIP"
  rm -rf "$lock_dir"
  rm -f "$PROGRESS_FILE" "$PROGRESS_FILE.tmp"
}
trap cleanup EXIT

if [[ -z "$ZIP" ]]; then
  if [[ "$ZIPURL" == *__SITE_* ]]; then
    echo "TREE_DOWNLOAD_UNRENDERED=1" >&2
    exit 2
  fi
  # company-compat-v1: 400 MB down and 1 GB unpacked must both fit; say so instead of failing half way.
  tmp_kb="$( { df -Pk /tmp 2>/dev/null || true; } | awk 'NR==2 { print $4 }')"
  root_kb="$( { df -Pk "$ROOT" 2>/dev/null || true; } | awk 'NR==2 { print $4 }')"
  for kb in "$tmp_kb" "$root_kb"; do
    if [[ "$kb" =~ ^[0-9]+$ ]] && (( kb < 1572864 )); then
      echo "TREE_RESTORE_DISK_FULL=1 free_kb=$kb need_kb=1572864" >&2
      exit 2
    fi
  done
  ZIP="$(mktemp /tmp/dsh-tree.XXXXXX)"
  owned=1
  echo "TREE_DOWNLOAD=$ZIPURL"
  # company-mac-offlan-resolve-v1: curl does not find {{TDH_HOST}} away from the office (macOS: .local is the LAN's
  # multicast DNS only); hand it the address the desk's own lookup found (the tailnet one away from the office).
  SITE_ADDR=""
  if [ -f "$ROOT/mac-resolve.js" ] && [ -x "$ROOT/node/bin/node" ]; then
    SITE_ADDR="$(NODE_OPTIONS= "$ROOT/node/bin/node" "$ROOT/mac-resolve.js" --addr 2>/dev/null || true)"
    [[ "$SITE_ADDR" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || SITE_ADDR=""
  fi
  site_curl() {
    if [ -n "$SITE_ADDR" ]; then curl --resolve "{{TDH_HOST}}:8443:$SITE_ADDR" "$@"; else curl "$@"; fi
  }
  total="$(site_curl -fsSkI --noproxy '*' "$ZIPURL" 2>/dev/null | awk 'tolower($1)=="content-length:"{gsub("\r","",$2); print $2}' | tail -1)"
  [[ "$total" =~ ^[0-9]+$ ]] || total=0
  progress download 0 "$total"
  site_curl -fsSk --noproxy '*' -o "$ZIP" "$ZIPURL" &
  cpid=$!
  while kill -0 "$cpid" 2>/dev/null; do
    sleep 0.5
    progress download "$(stat -f%z "$ZIP" 2>/dev/null || echo 0)" "$total"
  done
  wait "$cpid"
  progress download "$(stat -f%z "$ZIP" 2>/dev/null || echo 0)" "$total"
fi
[[ -f "$ZIP" ]] || { echo "restore-zip-missing" >&2; exit 2; }

tmp="$(mktemp -d /tmp/dsh-tree-unpack-XXXXXX)"
entries="$(unzip -Z1 "$ZIP" 2>/dev/null | wc -l | tr -d ' ')"
[[ "$entries" =~ ^[0-9]+$ ]] || entries=0
progress install 0 "$entries"
n=0
unzip -o "$ZIP" -d "$tmp" | while IFS= read -r _line; do
  n=$((n + 1))
  if (( n % 500 == 0 )); then progress install "$n" "$entries"; fi
done
[[ "${PIPESTATUS[0]}" -eq 0 ]] || { echo "restore-unzip-failed" >&2; exit 2; }
progress install "$entries" "$entries"
src="$tmp"
if [[ -d "$tmp/CompanyDesk" ]]; then src="$tmp/CompanyDesk"; fi

# Stamp first so a re-exec of start.command sees the new mark and does not loop.
if [[ -f "$src/BUILD.json" ]]; then
  cp -a "$src/BUILD.json" "$ROOT/BUILD.json"
  echo "TREE_RESTORE_STAMP=1"
fi

copy_tree() {
  local from="$1" to="$2"
  [[ -d "$from" ]] || return 0
  mkdir -p "$to"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --delete-excluded --exclude '._*' --exclude '__MACOSX' "$from"/ "$to"/
  else
    (cd "$from" && find . \( -type f -o -type l \) ! -name '._*' ! -path '*/__MACOSX/*' -print0) |
      while IFS= read -r -d '' f; do
        dest="$to/${f#./}"
        mkdir -p "$(dirname "$dest")"
        cp -a "$from/$f" "$dest"
      done
  fi
}

copy_tree "$src/prefix" "$ROOT/prefix"
copy_tree "$src/node" "$ROOT/node"
copy_tree "$src/plugins" "$ROOT/plugins"
copy_tree "$src/presets" "$ROOT/presets"
copy_tree "$src/skills" "$ROOT/skills"
copy_tree "$src/opencli" "$ROOT/opencli"
copy_tree "$src/peekaboo" "$ROOT/peekaboo"
copy_tree "$src/cua-driver" "$ROOT/cua-driver"
# company-tailnet-vendor-v1: the site's tailnet files (join key, server address, Tailscale installer)
copy_tree "$src/vendor" "$ROOT/vendor"
copy_tree "$src/bin" "$ROOT/bin"
if [[ -d "$src/home/profiles/web/node_modules" ]]; then
  mkdir -p "$ROOT/home/profiles/web"
  copy_tree "$src/home/profiles/web/node_modules" "$ROOT/home/profiles/web/node_modules"
fi

wrote=0
for f in TDHarness.exe TDHarness start.ps1 start.command CompanyDesk.vbs WebView2Loader.dll \
         tree-check.js tree-restore.ps1 tree-restore.sh pack-update-check.js \
         sync-skills.js sync-desk-home.sh sync-desk-home.ps1 prove-cosmokit.js desk-lease.js krouter-hook.js krouter-hooks.json mac-mount-company.sh mac-join-off-lan.sh \
         mac-pin-settings.js mac-company-login.js mac-smb-mount.js mac-resolve.js BUILD.json \
         home/profiles/web/package.json home/profiles/web/overlay.yml; do
  [[ -e "$src/$f" || -L "$src/$f" ]] || continue
  dest="$ROOT/$f"
  mkdir -p "$(dirname "$dest")"
  cp -a "$src/$f" "$dest"
  wrote=$((wrote + 1))
done

for d in prefix node plugins presets skills opencli peekaboo cua-driver vendor bin home/profiles/web/node_modules; do
  if [[ -d "$ROOT/$d" ]]; then
    wrote=$((wrote + 1))
  fi
done

echo "TREE_RESTORE_WROTE=$wrote"
if [[ "$wrote" -lt 1 ]]; then
  echo "restore-wrote-nothing" >&2
  exit 2
fi
echo "TREE_RESTORE_OK=1"
