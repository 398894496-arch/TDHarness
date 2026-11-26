#!/bin/bash
# company-wg-desk-v1: the company tunnel on this Mac, from start.command after sign-in (it needs the person's token).
#
# The user, 2026-11-25: 「任何客户端都不要弹出这个窗口，默认连接新买的服务器」. In place of Tailscale (and of
# mac-join-off-lan.sh's dialog), every Mac gets the company's own tunnel to the Qingdao hub:
#   1. not installed, or the pack carries another tdh-tunnel: the hub from the company server (TLS checked), then
#      mac-tunnel-install.sh as root. That is the one time macOS asks for the Mac's password (no network interface
#      without it); the waiting page says why. Declined: asked again only the next day.
#   2. this device's key (made by the service) sent with the token; its address written for the service.
#   3. wait (up to 20 s) for the server through the tunnel.
# Prints TUNNEL=up|down|declined|off. Never stops the desk from opening: the old ways (the office LAN, Tailscale)
# still work while the tunnel is not there.
set -u
ROOT="${1:?root}"
NODEBIN="${2:?node}"
SITE="${3:?site}"
RC="$HOME/.dsh-company-rc8"
DIR="/Library/Application Support/TDHarness/tunnel"
BIN="$ROOT/vendor/tdh-tunnel"
DECLINED="$RC/tunnel.declined"
[[ "${TDH_TUNNEL:-1}" == 1 && -f "$BIN" && -f "$ROOT/desk-store.js" && -f "$ROOT/mac-tunnel-install.sh" ]] || { echo "TUNNEL=off"; exit 0; }

installed_ok() {
  [[ -x "$DIR/tdh-tunnel" && -f "$DIR/hub.json" ]] || return 1
  [[ "$(/usr/bin/shasum -a 256 "$DIR/tdh-tunnel" | awk '{print $1}')" == "$(/usr/bin/shasum -a 256 "$BIN" | awk '{print $1}')" ]]
}

if ! installed_ok; then
  if [[ -f "$DECLINED" ]] && (( $(date +%s) - $(stat -f %m "$DECLINED") < 86400 )); then echo "TUNNEL=declined"; exit 0; fi
  HUB_OUT="$("$NODEBIN" "$ROOT/desk-store.js" tunnel-hub --site "$SITE" 2>/dev/null || true)"
  HUB_KEY="$(printf '%s\n' "$HUB_OUT" | sed -n 's/^TUNNEL_HUB_PUBKEY=//p')"
  HUB_EP="$(printf '%s\n' "$HUB_OUT" | sed -n 's/^TUNNEL_HUB_ENDPOINT=//p')"
  [[ -n "$HUB_KEY" && -n "$HUB_EP" ]] || { echo "TUNNEL=down"; echo "TUNNEL_WHY=hub-unknown"; exit 0; }
  [[ -n "${BOOT_STATUS:-}" ]] && printf "%s\n" "share" > "$BOOT_STATUS"
  # Paths and keys are checked by mac-tunnel-install.sh again as root; quoted here for AppleScript's shell.
  q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
  CMD="/bin/bash $(q "$ROOT/mac-tunnel-install.sh") $(q "$BIN") $(q "$HUB_KEY") $(q "$HUB_EP")"
  PROMPT="TDHarness 要安装公司专用网络（只需这一次），以后在任何地方打开都能直接连上公司。"
  if ! /usr/bin/osascript -e "do shell script \"$(printf '%s' "$CMD" | sed 's/\\/\\\\/g; s/"/\\"/g')\" with prompt \"$PROMPT\" with administrator privileges" >/dev/null 2>&1; then
    touch "$DECLINED"; echo "TUNNEL=declined"; exit 0
  fi
  rm -f "$DECLINED"
  for i in $(seq 1 20); do [[ -s "$DIR/public.key" ]] && break; sleep 0.5; done
fi

ENROLL_OUT="$("$NODEBIN" "$ROOT/desk-store.js" tunnel-enroll --dir "$DIR" --site "$SITE")" || { echo "TUNNEL=down"; echo "TUNNEL_WHY=enroll"; exit 0; }
printf '%s\n' "$ENROLL_OUT"
# A share mounted before this tunnel came (Tailscale, a hand-made tunnel) keeps its old connection: the route to the
# server now goes through this tunnel and that connection's packets are dropped, so every share step hangs until it
# times out (52 s on the first test Mac). On the first enrolment, let it go; mac-mount-company.sh mounts it again,
# through the tunnel. (No desk is running at this point of start.command.)
if printf '%s\n' "$ENROLL_OUT" | grep -q '^TUNNEL_ENROLL=new' && /sbin/mount | grep -q " on $HOME/company (smbfs"; then
  /sbin/umount "$HOME/company" 2>/dev/null || /usr/sbin/diskutil unmount force "$HOME/company" >/dev/null 2>&1 || true
  echo "TUNNEL_SHARE_REMOUNT=1"
fi
# The service takes the address within 5 s, the hub the key within 5 s more.
for i in $(seq 1 40); do
  if /sbin/route -n get -inet 10.66.0.2 2>/dev/null | grep -q "interface: utun" && /sbin/ping -c 1 -t 1 -q 10.66.0.2 >/dev/null 2>&1; then
    echo "TUNNEL=up"; exit 0
  fi
  sleep 0.5
done
echo "TUNNEL=down"; echo "TUNNEL_WHY=no-answer"
