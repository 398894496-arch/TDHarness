#!/usr/bin/env bash
# company-delta-top-files-v1 proof (Mac side of tree-restore; no LFS pack needed).
# 2026-11-22: mac-resolve.js came in a release whose old tree-restore.sh did not know the name, so no Mac
# got it; every later delta assumed the desk had it, and every Mac away from the office could not find the
# server. mac-pin-workspaces.js and mcp-one.cjs were not on the desk's list of its own files at all, so they
# stayed old. The update scripts here are the repo's, with the same site patches publish puts on them.
#   A  delta cut by the OLD pack-delta.py      -> mac-resolve.js still missing (the bug, reproduced)
#   B  delta cut by this pack-delta.py         -> mac-resolve.js back, mcp-one.cjs current, TREE_OK=1
#   C  no delta for this mark (full pack)      -> the same, through the full restore
#   D  delta altered after signing             -> PACK_VERIFY_FAIL, full pack, the same result
# Needs node, python3, zip, unzip, curl. Prints DELTA_TOP_FILES_OK=1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
HP=""
trap '[[ -n "$HP" ]] && kill "$HP" 2>/dev/null; rm -rf "$T"' EXIT
fail() { [[ -f "$T/out.txt" ]] && cat "$T/out.txt"; echo "DELTA_TOP_FILES_FAIL=$1"; exit 1; }
PORT=$((20000 + RANDOM % 20000))
URL="http://127.0.0.1:$PORT/CompanyDesk-mac.zip?v=1"
printf 'host: delta-check.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n' > "$T/site.yml"
node "$ROOT/server/pack-sign.js" keygen --dir "$T/sign" >/dev/null

# The desk's update scripts: the repo's, patched the way apply_site_patches.py does (scripts, resume, delta).
mkdir -p "$T/x"
python3 - "$ROOT" "$T/x" <<'PY'
import importlib.util, sys
from pathlib import Path
root, out = Path(sys.argv[1]), Path(sys.argv[2])
def load(name):
    s = importlib.util.spec_from_file_location(name, root / "server/site-patches" / (name + ".py"))
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
mods = [load("patch_client_scripts"), load("patch_resume_download"), load("patch_delta_update")]
data = (root / "desk/pack/mac/tree-restore.sh").read_bytes().replace(b"{{TDH_HOST}}", b"delta-check.local")
for m in mods:
    data, how = m.patch_bytes("tree-restore.sh", data)
    if how != "patched": raise SystemExit("patch %s: %s" % (m.__name__, how))
(out / "tree-restore.sh").write_bytes(data)
(out / "tree-check.js").write_bytes((root / "desk/pack/mac/tree-check.js").read_bytes())
(out / "pack-verify.js").write_bytes((root / "server/site-patches/pack-verify.js").read_bytes())
PY
grep -q '@@delta-update' "$T/x/tree-restore.sh" || fail not-patched
cp "$T/sign/pack-sign.pub" "$T/x/"

DS="prefix/lib/node_modules/@deepseek-ai/x"
tree() { # dir mark a-content
  local b="$T/$1/CompanyDesk"
  mkdir -p "$b/$DS" "$b/node/bin"
  cp "$T/x/"* "$b/"
  ln -s "$(command -v node)" "$b/node/bin/node"
  echo "$3" > "$b/$DS/a.txt"
  cp "$T/big.bin" "$b/$DS/big.bin"  # the same in both: a real pack is 400 MB, the delta stays under MAX_RATIO
  echo "resolve-v1" > "$b/mac-resolve.js"
  echo "$4" > "$b/mcp-one.cjs"
  printf '{"mark":"%s"}\n' "$2" > "$b/BUILD.json"
}
pack() { rm -f "$T/dist/CompanyDesk-mac.zip"; (cd "$T/$1" && zip -qry "$T/dist/CompanyDesk-mac.zip" CompanyDesk); python3 "$ROOT/server/site-cs.py" --site "$T/site.yml" reseal-zip --src "$T/dist/CompanyDesk-mac.zip" >/dev/null; }
mkdir -p "$T/dist"
head -c 400000 /dev/urandom > "$T/big.bin"
tree v1 aaaa1111 a1 mcp-v1
tree v2 bbbb2222 a2-new mcp-v2   # mac-resolve.js the same in both packs
pack v1
echo '{"mac":{"file":"CompanyDesk-mac.zip"}}' > "$T/dist/version.json"
python3 "$ROOT/server/pack-delta.py" remember --dist "$T/dist" --history "$T/history" >/dev/null
mkdir -p "$T/inst" && unzip -q "$T/dist/CompanyDesk-mac.zip" -d "$T/inst"
# The desk as it was: never got mac-resolve.js; mcp-one.cjs is one it never counted as its own.
rm -f "$T/inst/CompanyDesk/mac-resolve.js"
echo "mcp-v0" > "$T/inst/CompanyDesk/mcp-one.cjs"
cp "$T/dist/version.json" "$T/version.v1.json"
pack v2

build() { # pack-delta.py to cut the delta with
  cp "$T/version.v1.json" "$T/dist/version.json"
  python3 "$1" build --dist "$T/dist" --history "$T/history" | grep -q '^DELTA mac aaaa1111->bbbb2222' || fail no-delta-built
  node "$ROOT/server/pack-sign.js" sign --dist "$T/dist" --dir "$T/sign" | grep -q '^PACK_SIGN_OK=1' || fail sign
}
python3 -m http.server "$PORT" --bind 127.0.0.1 -d "$T/dist" >/dev/null 2>&1 & HP=$!; disown "$HP" 2>/dev/null || true
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$PORT/version.json" >/dev/null 2>&1 && break; sleep 0.1; done

R="$T/root"
fresh() { rm -rf "$R"; cp -a "$T/inst/CompanyDesk" "$R"; }
restore() { HOME="$T/home" bash "$R/tree-restore.sh" --root "$R" --url "$URL" > "$T/out.txt" 2>&1 || fail "$1-restore"; }
expect() { # case want-line [unwanted-line]
  grep -q "^$2" "$T/out.txt" || fail "$1-missing-$2"
  if [[ -n "${3:-}" ]] && grep -q "^$3" "$T/out.txt"; then fail "$1-unexpected-$3"; fi
  node "$R/tree-check.js" --root "$R" > "$T/tc.txt" || true; grep -q "^TREE_OK=1" "$T/tc.txt" || { cat "$T/tc.txt"; fail "$1-tree"; }
  [[ "$(cat "$R/$DS/a.txt")" == a2-new ]] || fail "$1-content"
  [[ "$(cat "$R/mac-resolve.js" 2>/dev/null)" == resolve-v1 ]] || fail "$1-mac-resolve-missing"
  [[ "$(cat "$R/mcp-one.cjs")" == mcp-v2 ]] || fail "$1-mcp-one-stale"
  echo "DELTA_TOP_FILES_$1=ok"
}

# A: the old cut leaves the desk without the file (shows what was wrong).
# The pack-delta.py from before this change (skipped where the history is not there, e.g. a shallow clone).
fix="$(git -C "$ROOT" log --format=%H -S company-delta-top-files-v1 -- server/pack-delta.py 2>/dev/null | tail -1 || true)"
git -C "$ROOT" show "${fix:+$fix^}${fix:-HEAD}:server/pack-delta.py" > "$T/pack-delta-old.py" 2>/dev/null || : > "$T/pack-delta-old.py"
if [[ -s "$T/pack-delta-old.py" ]] && ! grep -q company-delta-top-files-v1 "$T/pack-delta-old.py"; then
  build "$T/pack-delta-old.py"
  fresh; restore A
  grep -q '^TREE_RESTORE_DELTA_OK=1' "$T/out.txt" || fail A-no-delta
  [[ ! -e "$R/mac-resolve.js" ]] || fail A-old-cut-had-the-file
  echo "DELTA_TOP_FILES_A=ok (old cut: mac-resolve.js stays missing)"
fi

# B: this cut.
build "$ROOT/server/pack-delta.py"
[[ "$(unzip -l "$T/dist/delta/"*.zip)" == *CompanyDesk/mac-resolve.js* ]] || fail B-not-in-delta
fresh; restore B; expect B TREE_RESTORE_DELTA_OK=1 PACK_VERIFY_SHA256=

# C: no delta for this mark: the full pack.
fresh; python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["mark"]="zzzz"; json.dump(d, open(p, "w"))' "$R/BUILD.json"
restore C; expect C PACK_VERIFY_SHA256= TREE_DELTA=

# D: a delta changed after signing is refused; the full pack still gets everything.
D="$(ls "$T/dist/delta/"*.zip)"; echo junk >> "$D"
fresh; restore D; expect D PACK_VERIFY_FAIL=delta-sha256-mismatch TREE_RESTORE_DELTA_OK=1
echo "DELTA_TOP_FILES_OK=1"
