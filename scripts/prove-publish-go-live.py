#!/usr/bin/env python3
"""Proof for company-publish-staged-v1: a publish builds in a staging folder and `site-cs.py go-live`
moves the result into the download folder: every file arrives, version.json and version.sig come last,
delta packs the new version.json no longer lists are removed, and what the publish does not make (the
DMG people download) is left alone. Ends with PUBLISH_GO_LIVE_PROVE_OK=1."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def fail(msg):
    print("PUBLISH_GO_LIVE_PROVE_FAIL " + msg)
    sys.exit(1)


with tempfile.TemporaryDirectory() as tmp:
    t = Path(tmp)
    (t / "site.yml").write_text("host: proof.local\nshare: s\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: c\n")
    stage, live = t / "stage", t / "live"
    for d in (stage / "delta", live / "delta"):
        d.mkdir(parents=True)
    new = {"CompanyDesk-win.zip": "new win", "CompanyDesk-mac.zip": "new mac", "TDHarness-Setup.exe": "new setup",
           "index.html": "new page", "delta/win-aaa-bbb.zip": "new delta", "version.sig": "new sig"}
    doc = {"schema": "DSHPACK1", "win": {"mark": "bbb", "deltas": {"aaa": {"file": "delta/win-aaa-bbb.zip"}}}, "mac": {"mark": "ccc"}}
    for rel, text in new.items():
        (stage / rel).write_text(text)
    (stage / "version.json").write_text(json.dumps(doc))
    for rel in ("CompanyDesk-win.zip", "CompanyDesk-mac.zip", "version.json", "version.sig", "index.html"):
        (live / rel).write_text("old")
    (live / "delta/win-old-aaa.zip").write_text("old delta")
    (live / "TDHarness.dmg").write_text("dmg")
    r = subprocess.run([sys.executable, str(ROOT / "server" / "site-cs.py"), "--site", str(t / "site.yml"), "go-live",
                        "--src", str(stage), "--out", str(live)], capture_output=True, text=True)
    if r.returncode:
        fail("go-live " + (r.stderr or r.stdout)[-300:])
    order = [l.split(" ", 1)[1] for l in r.stdout.splitlines() if l.startswith("LIVE ")]
    if order[-2:] != ["version.json", "version.sig"]:
        fail("version.json/version.sig are not last: %s" % order)
    for rel, text in new.items():
        if (live / rel).read_text() != text:
            fail("not live: " + rel)
    if json.loads((live / "version.json").read_text()) != doc:
        fail("version.json not live")
    if (live / "delta/win-old-aaa.zip").exists():
        fail("a delta pack the new version.json does not list was kept")
    if (live / "TDHarness.dmg").read_text() != "dmg":
        fail("go-live touched a file the publish does not make")
    if any(p.is_file() for p in stage.rglob("*")):
        fail("files left in the staging folder")
    if "GO_LIVE_FILES=7" not in r.stdout:
        fail("count: " + r.stdout[-200:])
print("PUBLISH_GO_LIVE_PROVE_OK=1")
