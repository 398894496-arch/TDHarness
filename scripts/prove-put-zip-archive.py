#!/usr/bin/env python3
"""Proof for site-cs.py put-zip-archive (company-desktop-cua-v1): a vendor's release archive goes
into a pack under a prefix as shipped. The top folder is dropped, only the listed paths come in,
Unix mode bits survive (a Mac binary keeps its x bit even when the pack is built on Windows),
what the pack had under the prefix before is gone, and a listed path the archive lacks fails.
Stand-in archives only. Ends with PUT_ZIP_ARCHIVE_PROVE_OK=1."""
import io
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_CS = ROOT / "server" / "site-cs.py"


def fail(why):
    print("PUT_ZIP_ARCHIVE_PROVE_FAIL " + why)
    sys.exit(1)


def run(*args):
    return subprocess.run([sys.executable, str(SITE_CS), "--site", str(site)] + list(args), capture_output=True, text=True)


with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    site = d / "site.yml"
    site.write_text("host: tdh.test\nshare: s\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: c\n")
    pack = d / "pack.zip"
    with zipfile.ZipFile(pack, "w") as z:
        z.writestr("CompanyDesk/start.command", "#!/bin/bash\n")
        z.writestr("CompanyDesk/cua-driver/old-version.txt", "stale")
    tgz = d / "vendor-1.0-darwin.tar.gz"
    with tarfile.open(tgz, "w:gz") as t:
        for name, data, mode in [("vendor-1.0/App.app/Contents/MacOS/tool", b"\x7fELFbin", 0o755),
                                 ("vendor-1.0/App.app/Contents/Info.plist", b"<plist/>", 0o644),
                                 ("vendor-1.0/LICENSE", b"MIT", 0o644),
                                 ("vendor-1.0/extra-sdk.dylib", b"skip me", 0o755)]:
            ti = tarfile.TarInfo(name)
            ti.size, ti.mode = len(data), mode
            t.addfile(ti, io.BytesIO(data))
    r = run("put-zip-archive", "--src", str(pack), "--archive", str(tgz), "--name", "CompanyDesk/cua-driver/", "--keep", "App.app/,LICENSE")
    if r.returncode != 0 or "PUT_ARCHIVE=3" not in r.stdout:
        fail("tar.gz put: " + r.stdout + r.stderr)
    with zipfile.ZipFile(pack) as z:
        names = set(z.namelist())
        if "CompanyDesk/start.command" not in names:
            fail("the rest of the pack was lost")
        if "CompanyDesk/cua-driver/old-version.txt" in names:
            fail("a stale file under the prefix survived")
        if "CompanyDesk/cua-driver/extra-sdk.dylib" in names:
            fail("a path not listed came in")
        info = z.getinfo("CompanyDesk/cua-driver/App.app/Contents/MacOS/tool")
        if (info.external_attr >> 16) & 0o777 != 0o755 or info.create_system != 3:
            fail("the binary lost its mode bits")
        if (z.getinfo("CompanyDesk/cua-driver/LICENSE").external_attr >> 16) & 0o777 != 0o644:
            fail("a plain file got the wrong mode")
        if z.read("CompanyDesk/cua-driver/App.app/Contents/MacOS/tool") != b"\x7fELFbin":
            fail("content changed")
    wz = d / "vendor-1.0-windows.zip"
    with zipfile.ZipFile(wz, "w") as z:
        z.writestr("vendor-1.0/tool.exe", "MZ")
        z.writestr("vendor-1.0/helper.exe", "MZ")
        z.writestr("vendor-1.0/sdk.dll", "MZ")
    r = run("put-zip-archive", "--src", str(pack), "--archive", str(wz), "--name", "CompanyDesk/cua-driver/", "--keep", "tool.exe,helper.exe")
    if r.returncode != 0 or "PUT_ARCHIVE=2" not in r.stdout:
        fail("zip put: " + r.stdout + r.stderr)
    with zipfile.ZipFile(pack) as z:
        got = sorted(n for n in z.namelist() if n.startswith("CompanyDesk/cua-driver/"))
        if got != ["CompanyDesk/cua-driver/helper.exe", "CompanyDesk/cua-driver/tool.exe"]:
            fail("zip put left " + ",".join(got))
    r = run("put-zip-archive", "--src", str(pack), "--archive", str(wz), "--name", "CompanyDesk/cua-driver/", "--keep", "tool.exe,missing.exe")
    if r.returncode == 0 or "put-zip-archive-missing:missing.exe" not in (r.stdout + r.stderr):
        fail("a listed path the archive lacks did not fail")
print("PUT_ZIP_ARCHIVE_PROVE_OK=1")
