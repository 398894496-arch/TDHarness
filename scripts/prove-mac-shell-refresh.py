#!/usr/bin/env python3
"""Proof for company-mac-shell-refresh-v1 and the Mac shell's microphone (company-chat-voice-v1, company-chat-call-v1).

Anywhere:
- desk/mac-app/Info.plist declares the microphone (NSMicrophoneUsageDescription): without it WebKit hides
  navigator.mediaDevices from every page of the app, and the chat could neither record nor call (2026-11-24);
- the shell (desk/mac-app/TDHarness) is a universal Mach-O; its source grants the microphone to the chat page on this
  Mac's own relay only (http, 127.0.0.1 or localhost, 17811-17814) and leaves anything else to WebKit's question;
- site-cs.py puts the shell into the Mac pack as mac-shell.bin and mac-shell.plist (never into the Windows pack), and
  start.command runs mac-shell-refresh.sh before anything else of the desk.
On macOS (lipo, plutil, PlistBuddy), mac-shell-refresh.sh against stand-in apps:
- the same shell: nothing changes; another shell: the app's binary and Info.plist become the pack's, executable;
- nothing is replaced outside a .app, without the pack's shell, with a binary that is not universal, a plist that does
  not read, names another executable or another app, or in an app this person may not write;
- it never fails the open (exit 0 in every case).
Prints MAC_SHELL_REFRESH_PROVE_OK=1.
"""
from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "desk" / "mac-app"
SCRIPT = ROOT / "desk" / "pack" / "mac" / "mac-shell-refresh.sh"


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("MAC_SHELL_REFRESH_PROVE_FAIL " + what)
    print("ok  " + what)


def main() -> None:
    pl = plistlib.loads((APP / "Info.plist").read_bytes())
    check(bool(pl.get("NSMicrophoneUsageDescription")) and pl.get("CFBundleExecutable") == "TDHarness"
          and int(pl.get("LSMinimumSystemVersion", "0").split(".")[0]) >= 12, "Info.plist declares the microphone (macOS 12 and later)")
    binary = (APP / "TDHarness").read_bytes()
    check(binary[:4] == b"\xca\xfe\xba\xbe" and b"{{TDH_HOST}}" not in binary, "the shell is a universal Mach-O, with nothing for the site to rewrite")
    src = (APP / "src" / "CompanyDesk.release.swift").read_text(encoding="utf-8")
    check("requestMediaCapturePermissionFor origin: WKSecurityOrigin" in src and "web!.uiDelegate = self" in src
          and '(17811...17814).contains(origin.port)' in src and 'origin.protocol == "http"' in src
          and "type == .microphone ? .grant : .prompt" in src, "the shell grants the microphone to the chat page on this Mac's relay only")
    check("cfg.mediaTypesRequiringUserActionForPlayback = []" in src, "a call's sound plays without a click")

    import importlib.util
    spec = importlib.util.spec_from_file_location("site_cs", ROOT / "server" / "site-cs.py")
    cs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cs)
    mac = cs.pack_sources(ROOT / "desk" / "pack", "mac")
    win = cs.pack_sources(ROOT / "desk" / "pack", "win")
    check(mac.get("CompanyDesk/mac-shell.bin") == APP / "TDHarness" and mac.get("CompanyDesk/mac-shell.plist") == APP / "Info.plist"
          and mac.get("CompanyDesk/mac-shell-refresh.sh") == SCRIPT, "the Mac pack carries the shell and the script")
    check(not any(k.startswith("CompanyDesk/mac-shell") for k in win), "the Windows pack does not")
    start = (ROOT / "desk" / "pack" / "mac" / "start.command").read_text(encoding="utf-8")
    i = start.find('bash "$ROOT/mac-shell-refresh.sh" --root "$ROOT" || true')
    check(0 < i < start.find("sync-desk-home.sh\" --root"), "start.command runs it on every open, before the desk, never failing")

    if sys.platform != "darwin":
        print("(mac-shell-refresh.sh itself is proved on macOS: lipo, plutil, PlistBuddy)")
        print("MAC_SHELL_REFRESH_PROVE_OK=1")
        return
    tmp = Path(tempfile.mkdtemp(prefix="tdh-shell-"))
    old_bin = subprocess.run(["git", "-C", str(ROOT), "show", "HEAD~0:desk/mac-app/TDHarness"], capture_output=True).stdout
    old_plist = plistlib.dumps({k: v for k, v in pl.items() if k != "NSMicrophoneUsageDescription"})

    def app(name: str, bin_bytes: bytes, plist_bytes: bytes, new_bin: bytes | None = None, new_plist: bytes | None = None) -> Path:
        c = tmp / name / "TDHarness.app" / "Contents"
        (c / "MacOS").mkdir(parents=True)
        (c / "Resources").mkdir()
        (c / "MacOS" / "TDHarness").write_bytes(bin_bytes)
        os.chmod(c / "MacOS" / "TDHarness", 0o755)
        (c / "Info.plist").write_bytes(plist_bytes)
        if new_bin is not None:
            (c / "Resources" / "mac-shell.bin").write_bytes(new_bin)
        if new_plist is not None:
            (c / "Resources" / "mac-shell.plist").write_bytes(new_plist)
        return c

    env = dict(os.environ, HOME=str(tmp / "home"))
    (tmp / "home" / "Library" / "Logs").mkdir(parents=True)

    def run(root: Path) -> str:
        r = subprocess.run(["bash", str(SCRIPT), "--root", str(root)], capture_output=True, text=True, env=env)
        check(r.returncode == 0, "never fails the open (%s)" % root.parent.parent.parent.name)
        return r.stdout.strip()

    new_plist = (APP / "Info.plist").read_bytes()
    c = app("same", binary, new_plist, binary, new_plist)
    check(run(c / "Resources") == "SHELL_REFRESH=same", "the same shell: nothing changes")
    c = app("old", old_bin or binary[:-1] + b"x", old_plist, binary, new_plist)
    check(run(c / "Resources") == "SHELL_REFRESH=replaced", "another shell: replaced")
    check((c / "MacOS" / "TDHarness").read_bytes() == binary and (c / "Info.plist").read_bytes() == new_plist
          and os.access(c / "MacOS" / "TDHarness", os.X_OK) and not list(c.rglob(".*.new")), "the app's binary and Info.plist are the pack's, executable, nothing left beside")
    check(run(c / "Resources") == "SHELL_REFRESH=same", "and the next open: the same")
    check(run(tmp) == "SHELL_REFRESH=skip-not-in-app", "not inside a .app: nothing")
    c = app("nopack", old_bin or b"x", old_plist)
    check(run(c / "Resources") == "SHELL_REFRESH=skip-no-shell", "a pack without the shell: nothing")
    thin = tmp / "thin-arm64.bin"
    subprocess.run(["lipo", "-thin", "arm64", "-output", str(thin), str(APP / "TDHarness")], check=True)
    c = app("thin", old_bin or b"x", old_plist, thin.read_bytes(), new_plist)
    check(run(c / "Resources") == "SHELL_REFRESH=skip-bad-binary" and (c / "Info.plist").read_bytes() == old_plist, "a binary that is not universal: nothing replaced")
    c = app("badplist", old_bin or b"x", old_plist, binary, b"<plist><dict>")
    check(run(c / "Resources") == "SHELL_REFRESH=skip-bad-plist", "a plist that does not read: nothing")
    other = plistlib.dumps(dict(pl, CFBundleExecutable="Other"))
    c = app("otherexe", old_bin or b"x", old_plist, binary, other)
    check(run(c / "Resources") == "SHELL_REFRESH=skip-bad-plist", "a plist naming another executable: nothing")
    c = app("otherapp", old_bin or b"x", old_plist, binary, plistlib.dumps(dict(pl, CFBundleIdentifier="com.example.other")))
    check(run(c / "Resources") == "SHELL_REFRESH=skip-other-app", "a plist of another app: nothing")
    c = app("ro", old_bin or b"x", old_plist, binary, new_plist)
    os.chmod(c / "MacOS", 0o555)
    try:
        check(run(c / "Resources") == "SHELL_REFRESH=skip-not-writable" and (c / "Info.plist").read_bytes() == old_plist,
              "an app this person may not write: nothing")
    finally:
        os.chmod(c / "MacOS", 0o755)
    log = (tmp / "home" / "Library" / "Logs" / "TDHarness.log").read_text(encoding="utf-8")
    check("mac-shell-refresh replaced" in log, "what it did is in TDHarness.log")
    shutil.rmtree(tmp, ignore_errors=True)
    print("MAC_SHELL_REFRESH_PROVE_OK=1")


if __name__ == "__main__":
    main()
