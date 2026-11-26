#!/usr/bin/env bash
# Build the role-less Mac thin client. No Node, no dsh, no .command.
# Universal: an arm64-only binary dies on Intel Macs with no useful error,
# so build both slices and refuse to ship unless both are present.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${CLIENT_OUT:-$HERE/build/CompanyDesk.app}"
# Keep in step with LSMinimumSystemVersion in mac/Info.plist.
MIN_MACOS="13.0"
ARCHS="arm64 x86_64"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

slices=""
for arch in $ARCHS; do
  swiftc -O -target "${arch}-apple-macosx${MIN_MACOS}" \
    -framework Cocoa -framework WebKit \
    -o "$TMP/CompanyDesk-$arch" \
    "$HERE/mac/CompanyDesk.swift"
  echo "SLICE_${arch}=1"
  slices="$slices $TMP/CompanyDesk-$arch"
done

lipo -create -output "$OUT/Contents/MacOS/CompanyDesk" $slices
chmod 755 "$OUT/Contents/MacOS/CompanyDesk"

cp "$HERE/mac/Info.plist" "$OUT/Contents/Info.plist"
cp "$HERE/CompanyDesk.url.yml" "$OUT/Contents/Resources/CompanyDesk.url.yml"

# Fail closed: lipo happily produces a single-slice file if a build was skipped.
have="$(lipo -archs "$OUT/Contents/MacOS/CompanyDesk")"
echo "APP_ARCHS=$have"
for arch in $ARCHS; do
  case " $have " in
    *" $arch "*) ;;
    *) echo "MISSING_SLICE=$arch" >&2; exit 1 ;;
  esac
done

echo "APP=$OUT"
echo "CLIENT_NO_TTY=1"
echo "CLIENT_NO_ROLE=1"
echo "MAC_APP_UNIVERSAL=1"
echo "MAC_APP_OK=1"
