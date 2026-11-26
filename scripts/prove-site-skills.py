#!/usr/bin/env python3
"""Proof for company-site-skills-in-pack-v1 (server/site-cs.py put-site-skills, server/publish-site-update.ps1).

2026-11-22: 田总's Mac could not read the share at boot (macOS kept asking about network volumes), so its skill list
had only the pack's own skills and the agent said company-mail was "技能未知或已不可用". A publish now puts the
site's skills (the share's _skills) into the pack, and a desk booting without the share still has them.
  1  each skill folder of the share replaces the pack's folder of that name whole (a file removed upstream goes),
     the pack's other skills stay, folders without SKILL.md and dot files stay out, entries are Unix 0644
  2  reseal-zip lists them in BUILD.json, so tree-check and the delta treat them as the desk's own files
  3  sync-skills.js on the unpacked pack with no share: the site's skills are in the desk's cache
  4  no share folder on the server: the pack is left as it was
  5  publish-site-update.ps1 runs it after overlay-zip and before the site patches and reseal
Prints SITE_SKILLS_PROVE_OK=1.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_CS = ROOT / "server" / "site-cs.py"
SYNC = ROOT / "desk" / "pack" / "common" / "sync-skills.js"


def check(ok, what):
    if not ok:
        print("SITE_SKILLS_PROVE_FAIL=" + what)
        sys.exit(1)
    print("ok  " + what)


def run(*argv):
    r = subprocess.run(list(argv), capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print(r.stdout + r.stderr)
        check(False, "command failed: " + " ".join(str(a) for a in argv[:4]))
    return r.stdout


def site_cs(site, *argv):
    return run(sys.executable, str(SITE_CS), "--site", str(site), *argv)


def write(p: Path, text: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


t = Path(tempfile.mkdtemp(prefix="site-skills-"))
try:
    site = t / "site.yml"
    write(site, "host: skills-check.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n")
    pack = t / "CompanyDesk-mac.zip"
    with zipfile.ZipFile(pack, "w") as z:
        z.writestr("CompanyDesk/BUILD.json", json.dumps({"mark": "aaaa1111", "files": {}}))
        z.writestr("CompanyDesk/start.command", "#!/bin/sh\n")
        z.writestr("CompanyDesk/skills/company-mail/SKILL.md", "---\nname: company-mail\n---\nfrom the repository\n")
        # A site skill a previous publish put in: an older SKILL.md and a file the share no longer has.
        z.writestr("CompanyDesk/skills/mfg-quote/SKILL.md", "---\nname: mfg-quote\n---\nold\n")
        z.writestr("CompanyDesk/skills/mfg-quote/stale.md", "gone upstream\n")

    share = t / "company" / "_skills"
    write(share / "mfg-quote" / "SKILL.md", "---\nname: mfg-quote\n---\n询价→报价\n")
    write(share / "mfg-quote" / "ref" / "steps.md", "steps\n")
    write(share / "mfg-quote" / ".DS_Store", "x")
    write(share / "company-erpnext" / "SKILL.md", "---\nname: company-erpnext\n---\nERP\n")
    write(share / "company-chat-history" / "SKILL.md", "---\nname: company-chat-history\n---\n聊天\n")
    write(share / "notes" / "readme.txt", "no SKILL.md here\n")
    write(share / "._mfg-quote" / "SKILL.md", "resource fork\n")
    write(share / ".replace-bundled", "")

    # 1
    out = site_cs(site, "put-site-skills", "--src", str(pack), "--file", str(share))
    check("SITE_SKILLS=3 company-chat-history,company-erpnext,mfg-quote" in out, "the share's three skills, nothing else: " + out.strip())
    with zipfile.ZipFile(pack) as z:
        names = {i.filename: i for i in z.infolist()}
        check(z.read("CompanyDesk/skills/mfg-quote/SKILL.md").decode("utf-8").endswith("询价→报价\n"), "mfg-quote is the share's")
        check("CompanyDesk/skills/mfg-quote/ref/steps.md" in names, "a skill's subfolders come too")
        check("CompanyDesk/skills/mfg-quote/stale.md" not in names, "a file removed on the share leaves the pack")
        check("CompanyDesk/skills/mfg-quote/.DS_Store" not in names, "dot files stay out")
        check(not any("/notes/" in n or "/._" in n or "replace-bundled" in n for n in names), "no folder without SKILL.md, no ._ folder")
        check(z.read("CompanyDesk/skills/company-mail/SKILL.md").decode().endswith("from the repository\n"), "the pack's own skills stay")
        check("CompanyDesk/start.command" in names, "the rest of the pack stays")
        i = names["CompanyDesk/skills/company-erpnext/SKILL.md"]
        check(i.create_system == 3 and (i.external_attr >> 16) == 0o100644, "Unix 0644 entries (a Mac keeps the mode)")
    again = site_cs(site, "put-site-skills", "--src", str(pack), "--file", str(share))
    with zipfile.ZipFile(pack) as z:
        check(sum(1 for n in z.namelist() if n == "CompanyDesk/skills/mfg-quote/SKILL.md") == 1, "a second run adds no duplicate (" + again.strip() + ")")

    # 2
    site_cs(site, "reseal-zip", "--src", str(pack))
    with zipfile.ZipFile(pack) as z:
        files = json.loads(z.read("CompanyDesk/BUILD.json"))["files"]
    check(all(k in files for k in ("skills/mfg-quote/SKILL.md", "skills/mfg-quote/ref/steps.md", "skills/company-erpnext/SKILL.md")),
          "BUILD.json lists the site's skills")

    # 3
    desk = t / "desk"
    with zipfile.ZipFile(pack) as z:
        z.extractall(desk)
    cache = t / "cache"
    out = run("node", str(SYNC), "--cache", str(cache), "--share", str(t / "home" / "company" / "_skills"),
              "--seed", str(desk / "CompanyDesk" / "skills"))
    check("SKILLS_SITE=0" in out, "the desk has no share")
    got = sorted(p.parent.name for p in cache.glob("*/SKILL.md"))
    check(got == ["company-chat-history", "company-erpnext", "company-mail", "mfg-quote"], "without the share the cache still has them: " + ",".join(got))

    # 4
    before = pack.read_bytes()
    out = site_cs(site, "put-site-skills", "--src", str(pack), "--file", str(t / "nowhere"))
    check("SITE_SKILLS=0" in out and pack.read_bytes() == before, "no share folder: the pack is untouched")

    # 5
    ps = (ROOT / "server" / "publish-site-update.ps1").read_text(encoding="utf-8")
    a, b, c = ps.find("overlay-zip --src $zip"), ps.find("put-site-skills --src $zip --file $SiteSkills"), ps.find("apply_site_patches.py'), '--zip'")
    d = ps.find("reseal-zip --src $zip")
    check(0 < a < b < c < d, "publish: overlay-zip, then put-site-skills, then site patches, then reseal")
    check("D:\\dsh\\company\\_skills" in ps and ps.isascii(), "the share's _skills on the server; the script stays ASCII")
finally:
    shutil.rmtree(t, ignore_errors=True)
print("SITE_SKILLS_PROVE_OK=1")
