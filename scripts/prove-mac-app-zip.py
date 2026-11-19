#!/usr/bin/env python3
"""Proof for site-cs.py mac-app-zip (company-mac-app-v1): the Mac download is a folder a person
drags from. TDHarness/TDHarness.app/Contents holds Info.plist (the shell named as its executable),
MacOS/TDHarness (universal Mach-O, executable) and Resources = the pack's CompanyDesk/ tree with its
modes and links; beside the app, a link to /Applications and a note. Ends with MAC_APP_ZIP_PROVE_OK=1."""
import io
import plistlib
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "desk" / "mac-app"


def fail(why):
    print("MAC_APP_ZIP_PROVE_FAIL " + why)
    sys.exit(1)


bin_head = (APP / "TDHarness").read_bytes()[:4]
if bin_head != b"\xca\xfe\xba\xbe":
    fail("desk/mac-app/TDHarness is not a universal Mach-O")
with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    site = d / "site.yml"
    site.write_text("host: tdh.test\nshare: s\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: c\n")
    pack = d / "CompanyDesk-mac.zip"
    with zipfile.ZipFile(pack, "w") as z:
        def add(name, data, mode, link=False):
            zi = zipfile.ZipInfo(name)
            zi.create_system = 3
            zi.external_attr = ((stat.S_IFLNK if link else stat.S_IFREG) | mode) << 16
            z.writestr(zi, data)
        z.writestr("CompanyDesk/", b"")
        add("CompanyDesk/start.command", b"#!/bin/bash\n", 0o755)
        add("CompanyDesk/BUILD.json", b"{}", 0o644)
        add("CompanyDesk/prefix/bin/dsh", b"../lib/bin.js", 0o755, link=True)
    out = d / "TDHarness-mac.zip"
    r = subprocess.run([sys.executable, str(ROOT / "server" / "site-cs.py"), "--site", str(site), "mac-app-zip",
                        "--src", str(pack), "--file", str(APP), "--out", str(out)], capture_output=True, text=True)
    if r.returncode != 0 or "MAC_APP_FILES=3" not in r.stdout:
        fail("mac-app-zip: " + r.stdout + r.stderr)
    with zipfile.ZipFile(out) as z:
        names = set(z.namelist())
        c = "TDHarness/TDHarness.app/Contents/"
        for need in (c + "Info.plist", c + "MacOS/TDHarness", c + "Resources/AppIcon.icns", c + "Resources/start.command",
                     c + "Resources/BUILD.json", c + "Resources/prefix/bin/dsh", "TDHarness/应用程序", "TDHarness/安装说明.txt"):
            if need not in names:
                fail("missing " + need)
        if any(n.startswith("TDHarness/TDHarness.app/Contents/Resources/CompanyDesk") for n in names):
            fail("the pack's top folder was kept inside Resources")
        mode = lambda n: (z.getinfo(n).external_attr >> 16)
        if not stat.S_ISREG(mode(c + "MacOS/TDHarness")) or mode(c + "MacOS/TDHarness") & 0o111 == 0:
            fail("the shell is not executable")
        if mode(c + "Resources/start.command") & 0o777 != 0o755:
            fail("start.command lost its mode")
        if not stat.S_ISLNK(mode(c + "Resources/prefix/bin/dsh")) or z.read(c + "Resources/prefix/bin/dsh") != b"../lib/bin.js":
            fail("a link in the pack did not stay a link")
        if not stat.S_ISLNK(mode("TDHarness/应用程序")) or z.read("TDHarness/应用程序") != b"/Applications":
            fail("no link to /Applications")
        info = plistlib.loads(z.read(c + "Info.plist"))
        if info.get("CFBundleExecutable") != "TDHarness" or info.get("CFBundlePackageType") != "APPL" or info.get("CFBundleIconFile") != "AppIcon":
            fail("Info.plist does not name the shell and icon: %r" % info)
print("MAC_APP_ZIP_PROVE_OK=1")
