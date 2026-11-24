#!/bin/bash
# company-mac-shell-refresh-v1: the Mac app's own shell (Contents/MacOS/TDHarness and Contents/Info.plist) follows
# the pack. An update only ever lands in Contents/Resources (this desk's tree), so a Mac that installed TDHarness
# once kept the shell of that day for good: no microphone declaration, so the chat could neither record nor call
# (2026-11-24). The pack now carries the shell as mac-shell.bin and mac-shell.plist (site-cs.py overlay-zip, from
# desk/mac-app); start.command runs this on every open, and when they differ from the app's own, puts them in place.
# The window open now keeps the old shell; the next open is the new one. Checked before anything is replaced: the
# app is a .app this person may write, the binary is a universal Mach-O, the plist reads and names the same app.
# Prints SHELL_REFRESH=same|replaced|skip-<why>; never fails the open.
set -uo pipefail
ROOT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    *) shift ;;
  esac
done
say() { echo "SHELL_REFRESH=$1"; printf '%s mac-shell-refresh %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >> "$HOME/Library/Logs/TDHarness.log" 2>/dev/null || true; exit 0; }
[[ -n "$ROOT" && -d "$ROOT" ]] || say skip-root
case "$ROOT" in
  */*.app/Contents/Resources) ;;
  *) say skip-not-in-app ;;
esac
CONTENTS="${ROOT%/Resources}"
APP="${CONTENTS%/Contents}"
NEW_BIN="$ROOT/mac-shell.bin"
NEW_PLIST="$ROOT/mac-shell.plist"
CUR_BIN="$CONTENTS/MacOS/TDHarness"
CUR_PLIST="$CONTENTS/Info.plist"
[[ -f "$NEW_BIN" && -f "$NEW_PLIST" ]] || say skip-no-shell
[[ -f "$CUR_BIN" && -f "$CUR_PLIST" ]] || say skip-no-app-shell
if cmp -s "$NEW_BIN" "$CUR_BIN" && cmp -s "$NEW_PLIST" "$CUR_PLIST"; then say same; fi
[[ -w "$CONTENTS/MacOS" && -w "$CONTENTS" ]] || say skip-not-writable
archs="$(/usr/bin/lipo -archs "$NEW_BIN" 2>/dev/null || true)"
[[ " $archs " == *" arm64 "* && " $archs " == *" x86_64 "* ]] || say skip-bad-binary
/usr/bin/plutil -lint -s "$NEW_PLIST" >/dev/null 2>&1 || say skip-bad-plist
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$NEW_PLIST" 2>/dev/null)" == "TDHarness" ]] || say skip-bad-plist
want_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CUR_PLIST" 2>/dev/null)"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$NEW_PLIST" 2>/dev/null)" == "$want_id" ]] || say skip-other-app
# Side by side first, then each moved over its old one (the running shell keeps its own copy until it quits).
cp -f "$NEW_BIN" "$CONTENTS/MacOS/.TDHarness.new" && chmod 755 "$CONTENTS/MacOS/.TDHarness.new" || { rm -f "$CONTENTS/MacOS/.TDHarness.new"; say skip-copy; }
cp -f "$NEW_PLIST" "$CONTENTS/.Info.plist.new" || { rm -f "$CONTENTS/MacOS/.TDHarness.new" "$CONTENTS/.Info.plist.new"; say skip-copy; }
/usr/bin/xattr -c "$CONTENTS/MacOS/.TDHarness.new" "$CONTENTS/.Info.plist.new" 2>/dev/null || true
mv -f "$CONTENTS/MacOS/.TDHarness.new" "$CUR_BIN" && mv -f "$CONTENTS/.Info.plist.new" "$CUR_PLIST" || say skip-move
# macOS reads the app's Info.plist again (the microphone's question needs the new one).
touch "$APP" 2>/dev/null || true
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[[ -x "$LSREG" ]] && "$LSREG" -f "$APP" >/dev/null 2>&1 || true
say replaced
