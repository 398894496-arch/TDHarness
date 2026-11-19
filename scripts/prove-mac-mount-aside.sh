#!/usr/bin/env bash
# Prove mac-mount-company.sh moves an unmounted, non-empty mount point aside before mounting,
# so what the desk wrote there while the share was down is kept (not hidden under the mount),
# and leaves an empty one alone. Stubs node, the mount helper and `mount`; mounts nothing.
# Ends with MAC_MOUNT_ASIDE_OK=1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/pack/node/bin" "$T/bin"
cp "$ROOT/desk/pack/mac/mac-mount-company.sh" "$T/pack/"
ln -s "$(command -v node)" "$T/pack/node/bin/node"
printf 'process.exit(0)\n' > "$T/pack/mac-smb-mount.js"           # "mounts" nothing
printf '#!/bin/sh\nexit 0\n' > "$T/bin/mount"; chmod +x "$T/bin/mount"   # nothing is mounted
printf 'x' > "$T/pass"
fail() { echo "MAC_MOUNT_ASIDE_FAIL $1"; exit 1; }
run() {
  PATH="$T/bin:$PATH" COMPANY_SMB_MNT="$T/company" COMPANY_SMB_LAN=127.0.0.1 COMPANY_SMB_TS=127.0.0.1 \
    COMPANY_SMB_PASS="$T/pass" HOME="$T/home" bash "$T/pack/mac-mount-company.sh" 2>&1 || true
}
mkdir -p "$T/home" "$T/company/_office/.dsh-desk/sessions/s1"
echo "chat" > "$T/company/_office/.dsh-desk/sessions/s1/session.jsonl"
out="$(run)"
aside="$(printf '%s\n' "$out" | sed -n 's/^MNT_ASIDE=//p')"
[ -n "$aside" ] || fail "no MNT_ASIDE: $out"
[ "$(cat "$aside/_office/.dsh-desk/sessions/s1/session.jsonl")" = "chat" ] || fail "content not kept"
[ -d "$T/company" ] && [ -z "$(ls -A "$T/company")" ] || fail "mount point not empty again"
out2="$(run)"
printf '%s\n' "$out2" | grep -q '^MNT_ASIDE=' && fail "empty mount point moved: $out2"
echo "MAC_MOUNT_ASIDE_OK=1"
