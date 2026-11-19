#!/bin/bash
# company-mac-tailnet-join-v1: put this Mac on the company tailnet (Tailscale), the way TDHarness.exe
# does on Windows (server/TailnetJoin.cs), so the desk also works away from the office.
# start.command runs it before the login. The site's files are in vendor/ (publish step 2b, from
# server/tailnet-site.ps1):
#   company-tailnet.txt   ip=<the server's tailnet address>, node=<its device name>
#   employee.auth         the employee join key (a Tailscale auth key)
#   Tailscale-macos.pkg   Tailscale's own installer (installed only if Apple says it is Tailscale's)
# Without them it does nothing. A Mac that already sees the server on its tailnet is never touched.
# A Mac signed in to some other tailnet keeps that one: the company one is added as a second
# account (`tailscale login`), never `up --reset`. In the office, a "later" is not asked again for 7
# days; away from the office it is asked on every start, since nothing works without it.
# Prints TS_JOIN=<what happened>; always exits 0 (the login goes on either way).
#
# For tests: TDH_TS_APP (Tailscale.app), TDH_TS_OSA (osascript), TDH_TS_INSTALL (installs a pkg),
# TDH_TS_WAIT (seconds to wait for Tailscale to start), TDH_TS_HOME (where the "later" mark lives).
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")" && pwd)}"
V="$ROOT/vendor"
APP="${TDH_TS_APP:-/Applications/Tailscale.app}"
TS="$APP/Contents/MacOS/Tailscale"
OSA="${TDH_TS_OSA:-osascript}"
WAIT="${TDH_TS_WAIT:-300}"
MARKDIR="${TDH_TS_HOME:-$HOME/.dsh-company-rc8}"
DECLINED="$MARKDIR/ts-join.declined"
SITE="{{TDH_HOST}}"
LOG="$MARKDIR/ts-join.log"
mkdir -p "$MARKDIR"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }
done_with() { echo "TS_JOIN=$1"; log "result $1"; exit 0; }

IP="$(sed -n 's/^ip=\(100\.[0-9.]*\)[[:space:]]*$/\1/p' "$V/company-tailnet.txt" 2>/dev/null | head -1)"
[[ -n "$IP" && -s "$V/employee.auth" ]] || done_with skip-no-site-tailnet

status_json() { [[ -x "$TS" ]] && "$TS" status --json 2>/dev/null; }
backend() { status_json | sed -n 's/^[[:space:]]*"BackendState":[[:space:]]*"\([A-Za-z]*\)".*/\1/p' | head -1; }
on_company() {
  local j; j="$(status_json)" || return 1
  [[ "$j" == *'"BackendState": "Running"'* || "$j" == *'"BackendState":"Running"'* ]] || return 1
  [[ "$j" == *"\"$IP\""* ]]
}
on_lan() { [[ "$SITE" != \{\{* ]] && nc -z -G 3 "$SITE" 8443 >/dev/null 2>&1; }
say() { "$OSA" -e "display dialog \"$1\" buttons {\"好\"} default button \"好\" with title \"TDHarness\"" >/dev/null 2>&1 || true; }

on_company && done_with on-company

LAN=0; on_lan && LAN=1
if [[ $LAN == 1 && -f "$DECLINED" ]]; then
  age=$(( $(date +%s) - $(stat -f %m "$DECLINED" 2>/dev/null || echo 0) ))
  (( age < 7 * 86400 )) && done_with skip-declined-recently
fi

if [[ $LAN == 1 ]]; then
  ask="为了在家里也能用 TDH，这台 Mac 要加入公司的加密网络（Tailscale），只需要一次。"
else
  ask="现在不在公司网络里。要在这里用 TDH，这台 Mac 需要加入公司的加密网络（Tailscale），只需要一次。"
fi
[[ -x "$TS" ]] || ask="$ask\n\n接下来会请你输入这台 Mac 的开机密码，用来安装 Tailscale。"
ask="$ask\n\n之后 Tailscale 可能会请你「允许」添加 VPN 配置，请点「允许」。"
choice="$("$OSA" -e "button returned of (display dialog \"$ask\" buttons {\"以后再说\", \"继续\"} default button \"继续\" with title \"TDHarness\")" 2>/dev/null || true)"
if [[ "$choice" != "继续" ]]; then
  touch "$DECLINED"
  [[ $LAN == 1 ]] || say "没有加入公司网络。下次打开 TDHarness 会再问一次。"
  done_with declined
fi

if [[ ! -x "$TS" ]]; then
  PKG="$V/Tailscale-macos.pkg"
  [[ -f "$PKG" ]] || { say "这台 Mac 没装 Tailscale，安装包里也没带。请联系管理员。"; done_with fail-no-pkg; }
  if [[ -z "${TDH_TS_INSTALL:-}" ]]; then
    sig="$(pkgutil --check-signature "$PKG" 2>&1 || true)"
    if [[ "$sig" != *"Developer ID Installer: Tailscale Inc. (W5364U7YZB)"* || "$sig" != *"trusted by the Apple notary service"* ]]; then
      log "pkg signature: $sig"
      say "Tailscale 安装包的签名不对，没有安装。请把这句话截图发给管理员。"
      done_with fail-pkg-signature
    fi
    "$OSA" -e "do shell script \"/usr/sbin/installer -pkg \" & quoted form of \"$PKG\" & \" -target /\" with administrator privileges" >> "$LOG" 2>&1
  else
    "$TDH_TS_INSTALL" "$PKG" >> "$LOG" 2>&1
  fi
  [[ -x "$TS" ]] || { touch "$DECLINED"; say "Tailscale 没装上（可能是密码没输或点了取消）。下次打开 TDHarness 会再问一次。"; done_with fail-install; }
fi

# The app runs the network part; the command line only talks to it once it is up.
[[ -n "${TDH_TS_APP:-}" ]] || open -g -a "$APP" >/dev/null 2>&1 || true
state=""
for (( i = 0; i < WAIT; i++ )); do
  state="$(backend)"
  [[ -n "$state" && "$state" != NoState ]] && break
  sleep 1
done
[[ -n "$state" && "$state" != NoState ]] || { say "Tailscale 还没启动好。请在菜单栏打开 Tailscale，按提示点「允许」，然后重新打开 TDHarness。"; done_with fail-not-started; }

name="$(scutil --get ComputerName 2>/dev/null || hostname -s)"
name="$(printf '%s' "$name" | tr 'A-Z' 'a-z' | LC_ALL=C sed 's/[^a-z0-9-][^a-z0-9-]*/-/g; s/^-*//; s/-*$//' | cut -c1-40 | sed 's/-*$//')"
[[ -n "$name" ]] || name=tdh-desk
key="$(mktemp "${TMPDIR:-/tmp}/tdh-ts.XXXXXX")"
chmod 600 "$key"
tr -d '\r\n' < "$V/employee.auth" > "$key"
# NeedsLogin: a fresh install, `up`. Signed in elsewhere: add the company tailnet as another account.
verb=up; [[ "$state" == NeedsLogin ]] || verb=login
log "join $verb state=$state host=$name"
"$TS" "$verb" --auth-key="file:$key" --accept-dns=true --accept-routes=false --hostname="$name" --timeout=90s >> "$LOG" 2>&1
rc=$?
rm -f "$key"
for (( i = 0; i < 30; i++ )); do on_company && break; sleep 1; done
if on_company; then
  rm -f "$DECLINED"
  done_with "joined-$verb"
fi
touch "$DECLINED"
say "没能加入公司网络（$rc）。请把这句话截图发给管理员；日志在 ~/.dsh-company-rc8/ts-join.log。"
done_with "fail-$verb-$rc"
