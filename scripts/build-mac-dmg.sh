#!/usr/bin/env bash
# The Mac installer people expect (company-mac-dmg-v1): TDHarness.dmg, which opens as a window with
# TDHarness.app and the Applications folder side by side, to drag one onto the other.
# A .dmg can only be made on a Mac (hdiutil), and publishing runs on the Windows server, so this runs
# on any Mac from a published pack and the result goes into the server's download folder:
#
#   scripts/build-mac-dmg.sh <CompanyDesk-mac.zip> <out.dmg>
#
# The app inside is the same as in TDHarness-mac.zip (site-cs.py mac-app-zip: desk/mac-app around
# the pack). It need not be rebuilt on every publish: an installed desk takes newer packs itself on
# its first start. Rebuild it when desk/mac-app changes. Prints MAC_DMG_OK=1.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PACK="${1:?usage: build-mac-dmg.sh <CompanyDesk-mac.zip> <out.dmg>}"
OUT="${2:?usage: build-mac-dmg.sh <CompanyDesk-mac.zip> <out.dmg>}"
command -v hdiutil >/dev/null || { echo "MAC_DMG_FAIL needs macOS (hdiutil)" >&2; exit 2; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
printf 'host: dmg.local\nshare: s\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: c\n' > "$WORK/site.yml"
python3 "$HERE/server/site-cs.py" --site "$WORK/site.yml" mac-app-zip --src "$PACK" --file "$HERE/desk/mac-app" --out "$WORK/app.zip"
mkdir "$WORK/stage"
ditto -x -k "$WORK/app.zip" "$WORK/stage"
SRC="$WORK/stage/TDHarness"
[ -x "$SRC/TDHarness.app/Contents/MacOS/TDHarness" ] || { echo "MAC_DMG_FAIL app missing" >&2; exit 1; }
[ -f "$SRC/TDHarness.app/Contents/Resources/start.command" ] || { echo "MAC_DMG_FAIL pack missing" >&2; exit 1; }
# In a disk image the Finder shows the link by its own name; "Applications" is what Mac users expect.
rm -f "$SRC/应用程序"
ln -s /Applications "$SRC/Applications"
rm -f "$OUT"
hdiutil create -volname "TDHarness" -srcfolder "$SRC" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$OUT" >/dev/null
hdiutil verify "$OUT" >/dev/null
echo "MAC_DMG=$OUT $(du -h "$OUT" | cut -f1)"
echo "MAC_DMG_OK=1"
