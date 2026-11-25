#!/bin/bash
set -euo pipefail
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "$0")" && pwd)"
# company-shell-path-v1: the agent's shell finds this desk's own node and opencli by name.
export PATH="$ROOT/bin:$ROOT/node/bin:$PATH"
NODEBIN="$ROOT/node/bin/node"
[[ -x "$NODEBIN" ]] || { echo "bundled-node-missing" >&2; exit 2; }
# company-mac-offlan-resolve-v1: macOS finds {{TDH_HOST}} (a .local name) only on the office LAN. Every node of
# this desk (update check, login, desk, kernel, hooks) loads mac-resolve.js first: away from the office it takes the
# server's tailnet address from Tailscale instead. Before, nothing left the Mac and the login said "wrong password".
if [ -f "$ROOT/mac-resolve.js" ]; then
  export NODE_OPTIONS="--require \"$ROOT/mac-resolve.js\"${NODE_OPTIONS:+ $NODE_OPTIONS}"
fi
BOOT_STATUS="$HOME/.dsh-company-rc8/desk-boot.status"
boot_status() {
  mkdir -p "$HOME/.dsh-company-rc8"
  printf '%s\n' "$1" > "$BOOT_STATUS"
}
boot_status starting
# company-mac-no-translocate-v1
# Quarantined apps run from a read-only AppTranslocation copy. Writing
# desk-bridge.json or bundled presets then EROFS. Drag to /Applications.
case "$ROOT" in
  */AppTranslocation/*)
    mkdir -p "$HOME/.dsh-company-rc8/desk-home"
    printf '%s\n' "Error: 请把 TDHarness 拖到「应用程序」后再打开。不要从下载文件夹或磁盘映像里直接开。" > "$HOME/.dsh-company-rc8/desk-home/web-runtime.err"
    boot_status fail
    [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ] || osascript -e 'display dialog "请把 TDHarness 拖到「应用程序」后再打开。不要从下载文件夹或磁盘映像里直接开。" buttons {"OK"} default button "OK" with title "TDHarness"' >/dev/null 2>&1 || true
    echo "BLOCKED=app-translocation" >&2
    exit 2
    ;;
esac
# company-mac-shell-refresh-v1: the app's own shell (microphone declaration and all) follows the pack; the next open
# runs the new one. Never stops the open.
if [ -f "$ROOT/mac-shell-refresh.sh" ]; then
  bash "$ROOT/mac-shell-refresh.sh" --root "$ROOT" || true
fi
if [ -x "$ROOT/sync-desk-home.sh" ]; then
  bash "$ROOT/sync-desk-home.sh" --root "$ROOT"
fi
export DSH_HOME="${HOME}/.dsh-company-rc8/desk-home"
OV="$DSH_HOME/profiles/web/overlay.yml"
[[ -f "$OV" ]] || { echo "desk-home-overlay-missing" >&2; exit 2; }
if grep -q '__DESK_HOME__' "$OV" 2>/dev/null; then
  OV="$OV" DH="$DSH_HOME" "$NODEBIN" -e 'const fs=require("fs"); fs.writeFileSync(process.env.OV, fs.readFileSync(process.env.OV,"utf8").split("__DESK_HOME__").join(process.env.DH));'
fi
# Stale Error: lines here become the login-timeout dialog. Truncate every launch, but keep
# the last run's stderr as .prev first: a desk that died mid-turn left its reason here and the
# relaunch wiped it (company-desk-err-keep-v1).
if [[ -s "$DSH_HOME/web-runtime.err" ]]; then mv -f "$DSH_HOME/web-runtime.err" "$DSH_HOME/web-runtime.err.prev" || true; fi
: > "$DSH_HOME/web-runtime.err"
# Stays workspace-write, and this is MEASURED, not assumed (2026-08-26).
#
# The Windows client has to derive its mode from the workspace location, because
# there a confined shell cannot reach a network path at all (WRITE_RESTRICTED
# token vs the SMB redirector). macOS does not have that problem: seatbelt allows
# writes by PATH, not by identity, reads are not restricted at all
# ((allow default)), and the ACL write grants belong to the windows-acl rung
# alone, so nothing tries to materialize an ACE on the workspace.
#
# Measured against a real SMB mount with the shipped provider
# (scripts/p-mac-desk/mac-sandbox-smb-probe.js): stat/list/read/write on an
# smbfs workspace all OK under workspace-write, while writing outside the
# workspace was still EPERM in both the SMB and the local control case. So the
# Mac keeps real confinement AND reaches the share -- strictly better than the
# Windows situation. Do not "fix" this by copying the Windows exception.
#
# This variable is only the deployment default (sandbox-policy.mode). The value
# that actually governs each session is the permission plugin's defaultPreset in
# the shared overlay, which stays baked at workspace-write: unlike the Windows
# launcher, nothing here rewrites it, and that is deliberate.
export DSH_PERMISSION_MODE=workspace-write
export DEEPSEEK_BASE_URL=http://{{TDH_HOST}}:8450/v1
# Hot-planting start.command without site-render.py leaves this token in
# the door. web_search / web_fetch then fail to parse the URL.
case "$DEEPSEEK_BASE_URL" in
  *__SITE_*) echo "BLOCKED=unrendered-site-token" >&2; exit 2 ;;
esac
# Close/logout deletes gw.token: a leftover token file never skips the sign-in. What does is the remembered device
# (company-login-remember-v1, remember.token: 30 days from a sign-in, checked by the server, forgotten on 退出登录).
unset DEEPSEEK_API_KEY
TOKFILE="${HOME}/.dsh-company-rc8/gw.token"
LOGIN_URL="https://{{TDH_HOST}}:8443/company/login"
# company-no-tailnet-prompt-v1 (the user, 2026-11-25: 「任何客户端都不要弹出这个窗口，默认连接新买的服务器」): no more
# 「加入公司的加密网络（Tailscale）」 dialog (mac-join-off-lan.sh). Away from the office the desk reaches the server
# through the company's own tunnel (mac-tunnel.sh below, its service up from boot); a Mac still on Tailscale keeps
# using it until then, without being asked.
# company-login-screen-update-v1
# Update ON the login path, BEFORE roster password. Do not wait for LOGIN_OK.
NODEBIN="$ROOT/node/bin/node"
if [ -f "$ROOT/pack-update-check.js" ] && [ -f "$ROOT/BUILD.json" ]; then
  UPD_OUT="$("$NODEBIN" "$ROOT/pack-update-check.js" --root "$ROOT" \
    --url "https://{{TDH_HOST}}:8443/client/version.json" || true)"
  printf '%s\n' "$UPD_OUT"
  case "$UPD_OUT" in
    *UPDATE_AVAILABLE=1*)
      SERVED_MARK="$(printf '%s\n' "$UPD_OUT" | awk -F= '/^SERVED_MARK=/{print $2; exit}')"
      boot_status updating
      # company-login-page-v1 (the user, 2026-11-24: 「更新什么的这些弹窗能省则省，更新也做到 UI 里」): a shell that shows
      # the page updates without asking; the progress is on its waiting page. Older shells keep the question.
      if [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ]; then
        CHOICE="现在更新"
      else
        CHOICE="$(osascript -e 'button returned of (display dialog "公司已发新版。点「现在更新」一键更新，不用打开下载页。" buttons {"退出","稍后再说","现在更新"} default button "现在更新" with title "TDHarness")' || true)"
      fi
      case "$CHOICE" in
        退出)
          boot_status quit
          exit 2
          ;;
        现在更新)
          [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ] || osascript -e 'display dialog "正在下载并安装新版，进度显示在 TDHarness 窗口里。" buttons {"好"} giving up after 3 with title "TDHarness"' >/dev/null 2>&1 || true
          if lsof -nP -iTCP:17803 -sTCP:LISTEN >/dev/null 2>&1; then
            kill $(lsof -nP -t -iTCP:17803 -sTCP:LISTEN) 2>/dev/null || true
            sleep 1
          fi
          LOCK="$HOME/.dsh-company-rc8/tree-restore.lock"
          if [[ -d "$LOCK" ]]; then
            old="$(cat "$LOCK/pid" 2>/dev/null || true)"
            if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
              echo "TREE_RESTORE_WAIT=$old"
              for _w in $(seq 1 480); do
                kill -0 "$old" 2>/dev/null || break
                sleep 1
              done
            fi
          fi
          if ! bash "$ROOT/tree-restore.sh" --root "$ROOT"; then
            UPD_AGAIN="$("$NODEBIN" "$ROOT/pack-update-check.js" --root "$ROOT" \
              --url "https://{{TDH_HOST}}:8443/client/version.json" || true)"
            case "$UPD_AGAIN" in
              *UPDATE_AVAILABLE=1*)
                boot_status fail
                echo "TREE_RESTORE_FAIL=1"
                mkdir -p "$HOME/.dsh-company-rc8/desk-home"
                printf '%s\n' "Error: 更新没有完成，程序没有换掉。请重新打开再试一次；一直这样请找管理员。" > "$HOME/.dsh-company-rc8/desk-home/web-runtime.err"
                [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ] || osascript -e 'display dialog "更新失败。程序没有换掉。看 ~/Library/Logs/TDHarness.log" buttons {"OK"} with title "TDHarness"' >/dev/null 2>&1 || true
                exit 2
                ;;
            esac
            echo "TREE_RESTORE_REUSED=1"
          fi
          [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ] || osascript -e 'display dialog "更新完成。请重新登录。" buttons {"好"} giving up after 3 with title "TDHarness"' >/dev/null 2>&1 || true
          exec /bin/bash "$ROOT/start.command"
          ;;
        *)
          if [[ "$SERVED_MARK" =~ ^[0-9a-f]{32}$ ]]; then
            "$NODEBIN" "$ROOT/pack-update-check.js" --defer "$SERVED_MARK" || true
          fi
          echo "UPDATE_LATER=1"
          boot_status starting
          ;;
      esac
      ;;
  esac
fi
if [ -z "${DEEPSEEK_API_KEY:-}" ] || [ "$DEEPSEEK_API_KEY" = "company-gateway" ]; then
  # Browser GET of this URL is 404 not-found. Win AppHost POSTs JSON; Mac had no form.
  mkdir -p "$(dirname "$TOKFILE")"
  LOGIN_OK=0
  LOGIN_WHY=""
  # company-login-sms-v1 / company-login-remember-v1: mac-company-login.js does the asking (LOGIN_MODE and its
  # LOGIN_* in the environment); its exit code says what happened, a HINT= line what the server said.
  login_run() {
    LOGIN_RC=0
    LOGIN_OUT="$(LOGIN_URL="$LOGIN_URL" TOKFILE="$TOKFILE" "$NODEBIN" "$ROOT/mac-company-login.js" 2>/dev/null)" || LOGIN_RC=$?
    LOGIN_HINT="$(printf '%s\n' "$LOGIN_OUT" | sed -n 's/^HINT=//p' | tail -1 | tr -d '"\\')"
  }
  login_why() {
    case "$LOGIN_RC" in
      3) LOGIN_WHY="连不上公司服务器。在公司请连公司的 Wi-Fi；不在公司请先打开右上角的 Tailscale，确认已连上，再试一次。" ;;
      4) LOGIN_WHY="$1" ;;
      5) LOGIN_WHY="${LOGIN_HINT:-登录失败次数太多，请 15 分钟后再试，或找管理员。}" ;;
      7) LOGIN_WHY="公司还没开通手机验证码，请用账号和密码登录。" ;;
      *) LOGIN_WHY="${LOGIN_HINT:-服务器没有正常回应，请稍后再试；一直这样请找管理员。}" ;;
    esac
    osascript -e "display dialog \"$LOGIN_WHY\" buttons {\"OK\"} default button \"OK\" with title \"TDHarness\"" >/dev/null 2>&1 || true
  }
  # A Mac that signed in within 30 days goes straight in (退出登录 ends that).
  if [ -f "$HOME/.dsh-company-rc8/remember.token" ]; then
    export LOGIN_MODE=resume
    login_run
    if [ "$LOGIN_RC" = 0 ]; then
      LOGIN_OK=1
    elif [ "$LOGIN_RC" = 3 ]; then
      if [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ]; then
        export LOGIN_NOTE="连不上公司服务器。在公司请连公司的 Wi-Fi；不在公司请先打开右上角的 Tailscale，确认已连上，再试一次。"
      else
        login_why ""
      fi
    fi
  fi
  # company-login-page-v1 (the user, 2026-11-24: 「登录窗口好丑」): a shell that can show it signs in on a page in
  # its own window (mac-login-page.js serves login.html; mac-company-login.js still does every step). Exit 0 signed
  # in, 2 the window closed; anything else (an older pack, no node) falls back to the dialogs below.
  if [ "$LOGIN_OK" != 1 ] && [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ] && [ -f "$ROOT/mac-login-page.js" ] && [ -f "$ROOT/login.html" ]; then
    PAGE_RC=0
    LOGIN_URL="$LOGIN_URL" TOKFILE="$TOKFILE" "$NODEBIN" "$ROOT/mac-login-page.js" || PAGE_RC=$?
    unset LOGIN_NOTE
    if [ "$PAGE_RC" = 0 ]; then
      LOGIN_OK=1
      boot_status starting
    elif [ "$PAGE_RC" = 2 ]; then
      printf '%s\n' "Error: 没有登录，已取消。" > "$DSH_HOME/web-runtime.err"
      boot_status quit
      echo "BLOCKED=gw-token-required" >&2
      exit 2
    else
      boot_status starting
    fi
  fi
  ONLY_PASSWORD=0
  for _try in 1 2 3; do
  [ "$LOGIN_OK" = 1 ] && break
  if [ "$ONLY_PASSWORD" = 1 ]; then
    METHOD="账号密码"
  else
    METHOD="$(osascript -e 'button returned of (display dialog "登录 TDHarness" buttons {"取消", "账号密码", "手机验证码"} default button "手机验证码" with title "TDHarness")' || true)"
  fi
  if [ -z "$METHOD" ] || [ "$METHOD" = "取消" ]; then
    printf '%s\n' "Error: 没有登录，已取消。" > "$DSH_HOME/web-runtime.err"
    boot_status quit
    echo "BLOCKED=gw-token-required" >&2
    exit 2
  fi
  if [ "$METHOD" = "手机验证码" ]; then
    LAST_PHONE="$( { head -1 "$HOME/.dsh-company-rc8/last.phone" 2>/dev/null || true; } | tr -cd '0-9+')"
    PHONE="$(osascript -e "text returned of (display dialog \"手机号（花名册里登记的手机号）\" default answer \"$LAST_PHONE\" with title \"TDHarness\")" || true)"
    PHONE="$(printf '%s' "$PHONE" | tr -cd '0-9+')"
    [ -z "$PHONE" ] && continue
    export LOGIN_MODE=sms-code LOGIN_PHONE="$PHONE"
    login_run
    if [ "$LOGIN_RC" = 7 ]; then
      login_why ""
      ONLY_PASSWORD=1
      continue
    fi
    if [ "$LOGIN_RC" != 0 ] && ! printf '%s' "$LOGIN_HINT" | grep -q '已发送'; then
      login_why "手机号不对，请填 11 位手机号。"
      continue
    fi
    CODE="$(osascript -e "text returned of (display dialog \"验证码已发到 $PHONE，5 分钟内有效。收不到请确认这个号码已登记在公司花名册里。\" default answer \"\" with title \"TDHarness\")" || true)"
    CODE="$(printf '%s' "$CODE" | tr -cd '0-9')"
    [ -z "$CODE" ] && continue
    export LOGIN_MODE=sms LOGIN_CODE="$CODE"
    login_run
    unset LOGIN_CODE
    if [ "$LOGIN_RC" = 0 ]; then
      LOGIN_OK=1
      break
    fi
    login_why "${LOGIN_HINT:-验证码不对或已过期，请重新获取。}"
    continue
  fi
  # company-remember-login-v1: offer the last account that signed in on this Mac, not the seed admin.
  # Under set -euo pipefail a missing file (the first sign-in on this Mac) must not end the script: it did,
  # before the account dialog, and the window waited for the desk forever (2026-11-19).
  LAST_USER="$( { head -1 "$HOME/.dsh-company-rc8/last.login" 2>/dev/null || true; } | tr -cd 'A-Za-z0-9._@-')"
  USER="$(osascript -e "text returned of (display dialog \"账号（公司花名册里的账号，不是邮箱）\" default answer \"$LAST_USER\" with title \"TDHarness\")" || true)"
  PASS="$(osascript -e 'text returned of (display dialog "密码" default answer "" with hidden answer with title "TDHarness")' || true)"
  if [ -z "$USER" ] || [ -z "$PASS" ]; then
    continue
  fi
  # company-mac-offlan-resolve-v1: say why it failed (mac-company-login.js exit code), not always "wrong password".
  export LOGIN_MODE=password LOGIN_USER="$USER" LOGIN_PASS="$PASS"
  login_run
  unset LOGIN_PASS
  if [ "$LOGIN_RC" = 0 ]; then
    LOGIN_OK=1
    break
  fi
  login_why "账号或密码不对，再试一次。"
  done
  unset USER PASS LOGIN_USER LOGIN_PASS LOGIN_MODE LOGIN_PHONE LOGIN_CODE
  if [ "$LOGIN_OK" != 1 ]; then
    printf '%s\n' "Error: 登录失败。${LOGIN_WHY:-花名册账号或密码不对。}" > "$DSH_HOME/web-runtime.err"
    boot_status fail
    echo "BLOCKED=gw-token-required" >&2
    exit 2
  fi
  DEEPSEEK_API_KEY="$(tr -d '\r\n' < "$TOKFILE")"
  export DEEPSEEK_API_KEY
fi
export NO_PROXY=localhost,127.0.0.1,{{TDH_HOST}}
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
mkdir -p "$HOME/Library/Fonts" "$DSH_HOME/work"
FONT_SRC="$ROOT/fonts/NotoSansCJKsc-Regular.otf"
[[ -f "$FONT_SRC" ]] || { echo "bundled-font-missing" >&2; exit 2; }
cp "$FONT_SRC" "$HOME/Library/Fonts/NotoSansCJKsc-Regular.otf"
# company-login-page-v1: the slow steps say themselves on the shell's waiting page (share, lease, agent).
# company-wg-desk-v1 (mac-tunnel.sh): the company tunnel, installed once and enrolled with this sign-in's token.
if [ -f "$ROOT/mac-tunnel.sh" ]; then
  boot_status share
  BOOT_STATUS="$BOOT_STATUS" bash "$ROOT/mac-tunnel.sh" "$ROOT" "$NODEBIN" "https://{{TDH_HOST}}:8443" || true
fi
# company-desk-server-mode-v1: a person switched to the desk on the company server (the sign-in said server_desk;
# mac-company-login.js keeps it in server.desk) gets no memory disk, no seat and no kernel on this Mac. Only
# desk-hub-relay.js listens on 17803: the window loads http://127.0.0.1:17803/ as always and the relay passes it on to
# https://{{TDH_HOST}}:8443/desk-hub/ with the sign-in token. The relay is a node of this desk, so mac-resolve.js (in
# NODE_OPTIONS) picks the address each time it dials (the office LAN, the tunnel, Tailscale): a laptop leaving the
# office keeps its desk, which a fixed --connect would not. TDH_SERVER_DESK=0 keeps the local desk; =1 asks for the
# server's desk whatever the sign-in said (a test against a people service not updated yet; the hub still checks).
SERVER_DESK=0
if [ "${TDH_SERVER_DESK:-}" != 0 ] && [ -f "$ROOT/desk-hub-relay.js" ]; then
  if [ "${TDH_SERVER_DESK:-}" = 1 ] || [ "$( { tr -d '\r\n' < "$HOME/.dsh-company-rc8/server.desk"; } 2>/dev/null || true)" = 1 ]; then
    SERVER_DESK=1
  fi
fi
if [ "$SERVER_DESK" = 1 ]; then
  echo "SERVER_DESK=1"
  # The share stays for Finder; the desk on the server does not need it here, so it does not stop the start.
  boot_status share
  if [ -x "$ROOT/mac-mount-company.sh" ]; then bash "$ROOT/mac-mount-company.sh" || echo "MOUNT_FAIL=server-desk"; fi
  boot_status agent
  PORT="${TDH_DESK_PORT:-17803}"
  for pid in $(/usr/sbin/lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do kill "$pid" 2>/dev/null || true; done
  for _ in $(seq 1 8); do /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
  # The window opens the last "dsh web:" line of web-runtime.out; a local desk's old line must not be it.
  if [[ -s "$DSH_HOME/web-runtime.out" ]]; then mv -f "$DSH_HOME/web-runtime.out" "$DSH_HOME/web-runtime.out.prev" || true; fi
  : > "$DSH_HOME/web-runtime.out"
  RELAY_CA=()
  [ -f "$ROOT/company-ca.crt" ] && RELAY_CA=(--ca "$ROOT/company-ca.crt")
  HUB_SITE="https://{{TDH_HOST}}:8443"
  [ -n "${TDH_DESK_HUB_SITE:-}" ] && HUB_SITE="$TDH_DESK_HUB_SITE"
  nohup "$NODEBIN" "$ROOT/desk-hub-relay.js" --site "$HUB_SITE" --port "$PORT" \
    --token-file "$TOKFILE" "${RELAY_CA[@]+"${RELAY_CA[@]}"}" >> "$DSH_HOME/desk-hub-relay.log" 2>&1 &
  RELAY_PID=$!
  echo "$RELAY_PID" > "$HOME/.dsh-company-rc8/desk-hub-relay.pid"
  echo "RELAY_PID=$RELAY_PID"
  for _ in $(seq 1 60); do
    /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
    kill -0 "$RELAY_PID" 2>/dev/null || break
    sleep 0.25
  done
  # The hub's own answer first (not switched, signed out, the server not reached), then the first page, which starts
  # the person's kernel on the server when it is not running (up to 3 minutes there); the window waits meanwhile.
  hub_get() {
    NODE_OPTIONS= "$NODEBIN" -e '
const http = require("http");
const [p, port, ms] = process.argv.slice(1);
const out = (c, h) => process.stdout.write(c + "\t" + String(h || "").replace(/[\r\n\t"\\]/g, " ").slice(0, 160) + "\n");
const r = http.get({ host: "127.0.0.1", port: Number(port), path: p, timeout: Number(ms) }, (res) => {
  let b = "";
  res.setEncoding("utf8");
  res.on("data", (d) => { if (b.length < 8192) b += d; });
  res.on("end", () => { let h = ""; try { h = JSON.parse(b).hint || ""; } catch { h = res.statusCode === 502 ? b : ""; } out(res.statusCode, h); });
});
r.on("timeout", () => r.destroy(new Error("timeout")));
r.on("error", () => out(0, ""));
' "$1" "$PORT" "$2" 2>/dev/null || printf '0\t\n'
  }
  hub_fail() {
    printf '%s\n' "Error: $1" > "$DSH_HOME/web-runtime.err"
    kill "$RELAY_PID" 2>/dev/null || true
    boot_status fail
    echo "BLOCKED=server-desk" >&2
    exit 2
  }
  hub_check() {
    local code="${1%%$'\t'*}" hint="${1#*$'\t'}"
    echo "SERVER_DESK_HUB=$2 $code"
    case "$code" in
      2??|3??) return 0 ;;
      0) hub_fail "本机中转没有响应（desk-hub-relay），请重新打开 TDHarness。" ;;
      502) hub_fail "${hint:-连不上公司服务器}" ;;
      *) hub_fail "${hint:-服务器上的工作台没有正常回应}（$code）" ;;
    esac
  }
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || hub_fail "本机中转没有启动（desk-hub-relay），请重新打开 TDHarness。"
  hub_check "$(hub_get /_hub/status 20000)" status
  hub_check "$(hub_get / 240000)" warm
  boot_status ready
  exit 0
fi
boot_status share
if [ -x "$ROOT/mac-mount-company.sh" ]; then
  if ! bash "$ROOT/mac-mount-company.sh"; then
    boot_status fail
    echo "BLOCKED=company-mount" >&2
    exit 2
  fi
fi
WORK="$DSH_HOME/work"
WP="$HOME/.dsh-company-rc8/work.personal"
if [ -f "$WP" ]; then
  CAND="$(tr -d '\r\n' < "$WP")"
  if [ -n "$CAND" ] && [ -d "$CAND" ]; then
    WORK="$CAND"
  fi
fi
SKILL_CACHE="$HOME/.dsh-company-rc8/skills"
SHARE_SKILLS="$HOME/company/_skills"
PRESET_YML=""
for cand in \
  "$ROOT/prefix/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml" \
  "$ROOT/prefix/lib/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml" \
  "$ROOT/prefix/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml" \
  "$ROOT/prefix/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml"
do
  if [ -f "$cand" ]; then
    PRESET_YML="$cand"
    break
  fi
done
# company-desk-skills-v1 (desk-store.js skills): the company's skills over HTTPS, one tar and only when they changed,
# into a copy beside the cache; the share (SMB, 35 s for 12 files away from the office) only when that fails.
if [ -f "$ROOT/desk-store.js" ]; then
  SKILL_SHARE_COPY="$HOME/.dsh-company-rc8/skills-share"
  if "$ROOT/node/bin/node" "$ROOT/desk-store.js" skills --out "$SKILL_SHARE_COPY" --site "https://{{TDH_HOST}}:8443"; then
    SHARE_SKILLS="$SKILL_SHARE_COPY"
  else
    echo "SKILLS_FETCH=share"
  fi
fi
if [ -f "$ROOT/sync-skills.js" ]; then
  "$ROOT/node/bin/node" "$ROOT/sync-skills.js" --cache "$SKILL_CACHE" \
    --share "$SHARE_SKILLS" --seed "$ROOT/skills" \
    --overlay "$OV" --preset "$PRESET_YML" || true
fi
NODEBIN="$ROOT/node/bin/node"
# Official DeepSeek search stays off. Same pin as Win start.ps1 / AppHost.
"$NODEBIN" -e '
const fs = require("fs");
const p = process.argv[1];
const door = process.argv[2];
let t = fs.readFileSync(p, "utf8");
for (const id of ["web-search-deepseek", "web", "tool-web", "company-web-search"]) {
  t = t.replace(new RegExp("(^|\\n)- id: " + id + "\\n(?:  .*\\n)*", "m"), "$1");
}
const block = "- id: web-search-deepseek\n  disabled: true\n- id: web\n  config:\n    searchProvider: company\n    fetchProvider: company\n- id: tool-web\n  config:\n    fetch: true\n    searchTimeoutMs: 60000\n    fetchTimeoutMs: 90000\n- id: company-web-search\n  config:\n    baseURL: " + door + "\n";
const i = t.indexOf("- id: ");
if (i < 0) throw new Error("overlay-no-rows");
t = t.slice(0, i) + block + t.slice(i);
if (t.includes("api." + "deepseek.com")) throw new Error("overlay-named-upstream");
if (t.includes("/anthropic")) throw new Error("overlay-still-official-search-door");
fs.writeFileSync(p, t);
' "$OV" "http://{{TDH_HOST}}:8450"
"$NODEBIN" -e '
const fs = require("fs");
const p = process.argv[1];
let t = fs.readFileSync(p, "utf8");
// company-click-one-hand-v1
t = t.replace(/(^|\n)- id: bridge-browser\n(?:  .*\n)*/m, "$1");
t = t.replace(/(^|\n)- id: company-open-browser\n(?:  .*\n)*/m, "$1");
t = t.replace(/(^|\n)- id: ego-browser\n(?:  .*\n)*/m, "$1");
const block = "- id: bridge-browser\n  disabled: true\n  config:\n    sessionWorkspacePath: \"\"\n    deferSessionCreate: true\n- id: ego-browser\n  name: ego-browser\n  disabled: true\n- id: company-open-browser\n  disabled: true\n";
const i = t.indexOf("- id: ");
if (i < 0) throw new Error("overlay-no-rows");
fs.writeFileSync(p, t.slice(0, i) + block + t.slice(i));
' "$OV"
# company-desktop-cua-v1: desktop control is Cua Driver, which runs only from
# /Applications/CuaDriver.app (the driver fixes that path, and macOS ties Accessibility and Screen
# Recording to that app). The pack ships the app in cua-driver/; put it there when it is missing
# or older. A newer one the person installed is left alone. No write access to /Applications:
# the desktop tool reports it and the company-desktop skill says what to do.
CUA_SRC="$ROOT/cua-driver/CuaDriver.app"
CUA_APP="/Applications/CuaDriver.app"
if [ -d "$CUA_SRC" ]; then
  CUA_WANT="$(/usr/bin/defaults read "$CUA_SRC/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
  CUA_HAVE="$(/usr/bin/defaults read "$CUA_APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
  CUA_OLDER="$("$NODEBIN" -e '
const [w, h] = process.argv.slice(1).map((v) => String(v || "").split(".").map((n) => parseInt(n, 10) || 0));
if (!w.some(Boolean)) { process.stdout.write("0"); process.exit(0); }
for (let i = 0; i < 3; i++) { if ((h[i] || 0) !== (w[i] || 0)) { process.stdout.write((h[i] || 0) < (w[i] || 0) ? "1" : "0"); process.exit(0); } }
process.stdout.write("0");
' "$CUA_WANT" "$CUA_HAVE" 2>/dev/null || echo 0)"
  if [ "$CUA_OLDER" = "1" ]; then
    [ -x "$CUA_APP/Contents/MacOS/cua-driver" ] && "$CUA_APP/Contents/MacOS/cua-driver" stop >/dev/null 2>&1 || true
    CUA_TMP="/Applications/.CuaDriver.app.tdh-$$"
    rm -rf "$CUA_TMP" 2>/dev/null || true
    if /usr/bin/ditto "$CUA_SRC" "$CUA_TMP" 2>/dev/null && rm -rf "$CUA_APP" 2>/dev/null && mv "$CUA_TMP" "$CUA_APP" 2>/dev/null; then
      echo "CUA_DRIVER_INSTALLED=$CUA_WANT"
    else
      rm -rf "$CUA_TMP" 2>/dev/null || true
      echo "CUA_DRIVER_INSTALL=failed"
    fi
  fi
  if [ -x "$CUA_APP/Contents/MacOS/cua-driver" ] && [ ! -f "$HOME/.cua-driver/.tdh-telemetry-off" ]; then
    if CUA_DRIVER_RS_TELEMETRY_ENABLED=0 "$CUA_APP/Contents/MacOS/cua-driver" telemetry disable >/dev/null 2>&1; then
      mkdir -p "$HOME/.cua-driver" && touch "$HOME/.cua-driver/.tdh-telemetry-off"
    fi
  fi
fi
BIN="$ROOT/prefix/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
[[ -f "$BIN" ]] || BIN="$ROOT/prefix/node_modules/@deepseek-ai/dsh/lib/bin.js"
PORT=17803
if [ -d "$ROOT/browser-extension" ]; then
  BRIDGE_DIR="$HOME/.dsh-company-rc8/browser-extension"
  mkdir -p "$BRIDGE_DIR"
  if [ ! -f "$BRIDGE_DIR/manifest.json" ]; then
    ditto "$ROOT/browser-extension" "$BRIDGE_DIR" 2>/dev/null || cp -R "$ROOT/browser-extension/." "$BRIDGE_DIR/"
  fi
  printf '%s\n' "{\"http\":\"http://127.0.0.1:${PORT}\"}" > "$BRIDGE_DIR/desk-bridge.json"
  export COMPANY_BRIDGE_EXT="$BRIDGE_DIR"
  printf '%s\n' "$BRIDGE_DIR" > "$HOME/.dsh-company-rc8/bridge-ext.path"
  echo "BROWSER_BRIDGE=http://127.0.0.1:${PORT}"
fi
# GUI WKWebView child can get EPERM on smbfs getcwd. Probe node cwd; fall back local.
DESK_CWD="$DSH_HOME"
if [ -d "$WORK" ] && "$NODEBIN" -e 'process.chdir(process.argv[1]); process.stdout.write("ok")' "$WORK" >/dev/null 2>&1; then
  DESK_CWD="$WORK"
else
  echo "DESK_CWD_FALLBACK=$DSH_HOME"
fi
echo "DESK_CWD=$DESK_CWD"
LEASE_JS="$ROOT/desk-lease.js"
LEASE_SITE="https://{{TDH_HOST}}:8443"
PIN_ORG=""
[[ -f "$HOME/.dsh-company-rc8/work.org" ]] && PIN_ORG="$(tr -d '\r\n' < "$HOME/.dsh-company-rc8/work.org")"
# company-desk-store-v1 (desk-store.js): the chats in a disk in this Mac's memory while the desk runs, taken whole from
# the server at the seat and sent back within a second or two of each change; nothing of them on this Mac's disk.
# TDH_DESK_STORE=0 keeps the old way (the kernel reads them on the share). No memory disk: the old way too.
STORE_ARGS=()
STORE_DIR="$HOME/.dsh-company-rc8/desk-mem"
if [ "${TDH_DESK_STORE:-1}" = 1 ] && [ -f "$ROOT/mac-ramdisk.sh" ] && [ -f "$ROOT/desk-store.js" ]; then
  if /bin/bash "$ROOT/mac-ramdisk.sh" up "$STORE_DIR" 512; then STORE_ARGS=(--store-dir "$STORE_DIR"); else echo "STORE_OFF=ramdisk"; fi
fi
if [ -f "$LEASE_JS" ]; then
  boot_status lease
  [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ] || osascript -e 'display dialog "正在交接会话。" buttons {"OK"} giving up after 1 with title "TDHarness"' >/dev/null 2>&1 || true
  # company-lease-retry-v1 (2026-11-25, 田总's Mac: the start right after an update ran into the previous start, which
  # was still letting go of its desk, its memory disk and its sending; 「拿不到座位，或公司盘太慢」 once, fine on the next
  # sign-in): one more try, after that one has had a few seconds to finish, before saying so.
  lease_acquire() { "$NODEBIN" "$LEASE_JS" acquire --personal "$WORK" --org "$PIN_ORG" --home "$DSH_HOME" --site "$LEASE_SITE" "${STORE_ARGS[@]+"${STORE_ARGS[@]}"}"; }
  LEASE_OK=1
  if ! lease_acquire; then
    echo "LEASE_ACQUIRE_RETRY=1"
    for _ in $(seq 1 20); do
      /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 1
    done
    sleep 3
    lease_acquire || LEASE_OK=0
  fi
  if [ "$LEASE_OK" != 1 ]; then
    boot_status fail
    printf '%s\n' "Error: 拿不到座位，或公司盘太慢。没有开桌。" > "$DSH_HOME/web-runtime.err"
    [ "${TDH_SHELL_LOGIN_PAGE:-}" = 1 ] || osascript -e 'display dialog "拿不到座位，或公司盘太慢。没有开桌。" buttons {"OK"} with title "TDHarness"' >/dev/null 2>&1 || true
    echo "BLOCKED=desk-lease" >&2
    exit 2
  fi
  # The seat took the chats into the memory disk: send its changes from now on (the lease watch keeps this alive).
  if [ -f "$HOME/.dsh-company-rc8/desk-store.on" ] && [ -f "$ROOT/desk-store.js" ]; then
    nohup "$NODEBIN" "$ROOT/desk-store.js" sync --dir "$(tr -d '\r\n' < "$HOME/.dsh-company-rc8/desk-store.on")" --site "$LEASE_SITE" >> "$DSH_HOME/desk-store.log" 2>&1 &
    echo "STORE_SYNC_PID=$!"
  elif [ ${#STORE_ARGS[@]} -gt 0 ]; then
    /bin/bash "$ROOT/mac-ramdisk.sh" down "$STORE_DIR" >/dev/null 2>&1 || true
  fi
fi
# Leftover 17803 keeps the overlay from the last boot. After a wipe of
# local sessions that looks like "history gone". Always spawn fresh.
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do
    kill "$pid" 2>/dev/null || true
  done
  for i in $(seq 1 8); do
    lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
fi
boot_status agent
# company-desk-fresh-url-v1 (the user, 2026-11-24: 「登陆进去以后没拿到我的会话啊」): the window opens the last
# "dsh web: …?token=" line of web-runtime.out. The desk opens its port minutes before it prints that line when the
# share is slow (through a relay), and the file keeps the last run's lines, so the window took the last run's token:
# a desk that never connects, no sessions. This run's lines only, and ready only once this run's address is out.
if [[ -s "$DSH_HOME/web-runtime.out" ]]; then mv -f "$DSH_HOME/web-runtime.out" "$DSH_HOME/web-runtime.out.prev" || true; fi
: > "$DSH_HOME/web-runtime.out"
DESK_CWD="$DESK_CWD" DESK_OUT="$DSH_HOME/web-runtime.out" DESK_ERR="$DSH_HOME/web-runtime.err" \
  "$NODEBIN" "$ROOT/mac-desk-spawn.js" "$BIN" --profile web --patch "$OV" \
    --host 127.0.0.1 --port "$PORT" --no-open \
    --trusted-host 127.0.0.1 --trusted-host localhost
for i in $(seq 1 40); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 1
done
# The address: up to 15 minutes (a cold start over the relay took 8); the window keeps its waiting page meanwhile.
for i in $(seq 1 900); do
  grep -q "^dsh web: http://127.0.0.1:$PORT/" "$DSH_HOME/web-runtime.out" 2>/dev/null && break
  lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break
  [[ "$(cat "$BOOT_STATUS" 2>/dev/null)" == "quit" ]] && exit 2
  sleep 1
done
PIN_PERSONAL=""
PIN_ORG=""
[[ -f "$HOME/.dsh-company-rc8/work.personal" ]] && PIN_PERSONAL="$(tr -d '\r\n' < "$HOME/.dsh-company-rc8/work.personal")"
[[ -f "$HOME/.dsh-company-rc8/work.org" ]] && PIN_ORG="$(tr -d '\r\n' < "$HOME/.dsh-company-rc8/work.org")"
if [[ -n "$PIN_PERSONAL" && -f "$ROOT/mac-pin-workspaces.js" ]] \
  && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  PIN_PERSONAL="$PIN_PERSONAL" PIN_ORG="$PIN_ORG" PIN_PORT="$PORT" \
    "$NODEBIN" "$ROOT/mac-pin-workspaces.js" || true
fi
if [ -f "$LEASE_JS" ]; then
  nohup "$NODEBIN" "$LEASE_JS" watch --personal "$WORK" --org "$PIN_ORG" --home "$DSH_HOME" --site "$LEASE_SITE" \
    >>"$DSH_HOME/lease-watch.log" 2>&1 &
  echo $! > "$HOME/.dsh-company-rc8/lease-watch.pid"
fi
# Tree check is log-only. Do not pop on a dirty local tree (hot plant).
# Update already ran before the desk started.
if [ -f "$ROOT/tree-check.js" ] && [ -f "$ROOT/BUILD.json" ]; then
  TREE_OUT="$("$NODEBIN" "$ROOT/tree-check.js" --root "$ROOT" || true)"
  printf '%s\n' "$TREE_OUT"
fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  boot_status ready
else
  boot_status fail
  echo "DESK_NOT_UP=1" >&2
  exit 2
fi
# Window is the WKWebView TDHarness binary, same class as Win WebView2. Do not open a browser.


# DSHWM1:a2ace91e2760ff6dc5a941e0dde9531c
