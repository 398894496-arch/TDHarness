#!/bin/bash
# company-desk-store-v1 (desk-store.js): a disk in this Mac's memory for the person's chats while the desk runs.
# Nothing of it reaches the Mac's own disk; it is gone when detached or when the Mac restarts. No password: hdiutil
# hands a memory device to the user who asked, newfs_hfs and mount run on it as that user. Hidden from Finder (nobrowse).
#
#   mac-ramdisk.sh up   DIR [MB]   mount one at DIR (or say the one already there); prints RAMDISK_DIR= / RAMDISK_DEV=
#   mac-ramdisk.sh down DIR        unmount and give the memory back
set -u
cmd="${1:-}"
dir="${2:-}"
mb="${3:-512}"
[[ -n "$cmd" && -n "$dir" ]] || { echo "usage: mac-ramdisk.sh up|down DIR [MB]" >&2; exit 2; }

dev_at() { /sbin/mount | awk -v d=" on $1 (" 'index($0, d) && /\(hfs/ { print $1; exit }'; }

case "$cmd" in
  up)
    mkdir -p "$dir"
    have="$(dev_at "$dir")"
    if [[ -n "$have" ]]; then echo "RAMDISK_DIR=$dir"; echo "RAMDISK_DEV=$have"; echo "RAMDISK_REUSED=1"; exit 0; fi
    [[ "$mb" =~ ^[0-9]+$ ]] && (( mb >= 64 && mb <= 8192 )) || mb=512
    dev="$(/usr/bin/hdiutil attach -nomount "ram://$(( mb * 2048 ))" 2>/dev/null | awk 'NR==1 { print $1 }')"
    [[ "$dev" == /dev/disk* ]] || { echo "RAMDISK_FAIL=attach" >&2; exit 3; }
    if ! /sbin/newfs_hfs -v TDHDesk "$dev" >/dev/null 2>&1; then
      /usr/bin/hdiutil detach "$dev" >/dev/null 2>&1; echo "RAMDISK_FAIL=newfs" >&2; exit 3
    fi
    if ! /sbin/mount -t hfs -o nobrowse,nodev,nosuid "$dev" "$dir" 2>/dev/null; then
      /usr/bin/hdiutil detach "$dev" >/dev/null 2>&1; echo "RAMDISK_FAIL=mount" >&2; exit 3
    fi
    chmod 700 "$dir"
    echo "RAMDISK_DIR=$dir"; echo "RAMDISK_DEV=$dev"
    ;;
  down)
    have="$(dev_at "$dir")"
    [[ -n "$have" ]] || { echo "RAMDISK_DOWN=none"; exit 0; }
    /sbin/umount "$dir" 2>/dev/null || /usr/sbin/diskutil unmount force "$dir" >/dev/null 2>&1
    /usr/bin/hdiutil detach "$have" >/dev/null 2>&1 || /usr/bin/hdiutil detach -force "$have" >/dev/null 2>&1
    echo "RAMDISK_DOWN=$have"
    ;;
  *) echo "usage: mac-ramdisk.sh up|down DIR [MB]" >&2; exit 2 ;;
esac
