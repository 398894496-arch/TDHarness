#!/bin/bash
# company-wg-desk-v1: put this Mac's end of the company tunnel in place (run as root, once; mac-tunnel.sh asks for it).
#
#   mac-tunnel-install.sh BIN HUB_PUBKEY HUB_ENDPOINT
#
# BIN (tdh-tunnel from the pack) is copied into a folder only root may change, so the root service never runs a file
# the desk's own user could swap; the hub it dials is written there too (hub.json). The desk writes only its address,
# into enroll/ (group staff). launchd keeps it running from boot: com.tdharness.tunnel.
set -eu
BIN_SRC="${1:-}"; HUB_KEY="${2:-}"; HUB_EP="${3:-}"
[[ -f "$BIN_SRC" ]] || { echo "TUNNEL_INSTALL_FAIL=bin" >&2; exit 2; }
[[ "$HUB_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo "TUNNEL_INSTALL_FAIL=hub-key" >&2; exit 2; }
[[ "$HUB_EP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}:[0-9]{1,5}$ ]] || { echo "TUNNEL_INSTALL_FAIL=hub-endpoint" >&2; exit 2; }
[[ "$(id -u)" == 0 ]] || { echo "TUNNEL_INSTALL_FAIL=not-root" >&2; exit 2; }

DIR="/Library/Application Support/TDHarness/tunnel"
LABEL="com.tdharness.tunnel"
PLIST="/Library/LaunchDaemons/$LABEL.plist"

install -d -m 755 -o root -g wheel "/Library/Application Support/TDHarness"
install -d -m 755 -o root -g wheel "$DIR"
install -d -m 775 -o root -g staff "$DIR/enroll"
install -m 755 -o root -g wheel "$BIN_SRC" "$DIR/tdh-tunnel.new"
mv -f "$DIR/tdh-tunnel.new" "$DIR/tdh-tunnel"
printf '{"pubkey":"%s","endpoint":"%s"}\n' "$HUB_KEY" "$HUB_EP" > "$DIR/hub.json.new"
chown root:wheel "$DIR/hub.json.new"; chmod 644 "$DIR/hub.json.new"; mv -f "$DIR/hub.json.new" "$DIR/hub.json"

cat > "$PLIST.new" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$DIR/tdh-tunnel</string><string>run</string><string>--dir</string><string>$DIR</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>/var/log/tdh-tunnel.log</string>
  <key>StandardErrorPath</key><string>/var/log/tdh-tunnel.log</string>
</dict>
</plist>
EOF
chown root:wheel "$PLIST.new"; chmod 644 "$PLIST.new"; mv -f "$PLIST.new" "$PLIST"

# A tunnel brought up by hand (wg-quick) is left alone: until this one has its address the desk may still need it to
# enroll, and tdh-tunnel takes the route to 10.66.0.0/24 over when it comes up (delete, then add on its interface).
launchctl bootout "system/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap system "$PLIST"
launchctl kickstart -k "system/$LABEL" >/dev/null 2>&1 || true
echo "TUNNEL_INSTALLED=1"
