#!/usr/bin/env python3
"""company-chat-tinode-v1: this site's Tinode (the company chat), set up from the release's own files.

  tinode-setup.py --tinode D:/dsh/tinode --runtime D:/dsh/runtime --uploads D:/dsh/tinode-uploads --vendor <repo>/server/chat/vendor

tinode.conf is written from the release's sample (kept as tinode.conf.sample) with these changes, each of which must
match the sample exactly once (a newer release that moved one stops here instead of starting wrong):
  - it listens on this machine only (Caddy puts it under https://<site>:8443/chat/ and /v0/);
  - logins go to the TDH people service (REST authenticator, "basic" renamed onto it): roster password or the
    desk's login token, accounts made on first login; nobody signs up on their own;
  - its own token key and uid key, made once and kept in runtime/tinode-secrets.json (a new uid key would
    scramble every stored id), and the PostgreSQL password from runtime/tinode-db.secret;
  - no email validation and no clean-up of unvalidated accounts (TDH makes the accounts; they have no email);
  - uploads under --uploads, files up to 200 MB.
The web page's React, fonts and icons come from CDNs (jsDelivr, Google Fonts), which desks in China often cannot
reach: index.html loads them from static/vendor instead.
The page's script loads its language and view chunks from "/umd/" (webpack's public path, written for a page at the
site's root); this page is at /chat/, so the chunks 404 and the page stays blank (11-20). umd/index.prod.js gets the
relative "umd/" instead, and index.html asks for the scripts under a new URL so a browser that kept the old copy
fetches them again.
The page wears TDH's look (company-chat-look-v1): tdh-chat.css, beside the page, loaded after Tinode's own sheet.
TDH's own chat page (company-chat-client-v1, server/chat/tdh-web) goes in static/tdh/, with config.js holding the
web API key read from Tinode's own page (the public key its page carries; not kept in the repository).
The chat's page (/chat/, what the desk opens) is TDH's (company-chat-home-v1): Tinode's own page is kept beside it as
tinode.html. runtime/chat-home (or --home) "tinode" puts Tinode's page back at /chat/; "tdh", or nothing, TDH's.
Prints TINODE_SETUP_OK=1.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import secrets
import shutil
from pathlib import Path


def once(t: str, pattern: str, repl: str, what: str) -> str:
    new, n = re.subn(pattern, lambda _m: repl, t, count=0, flags=re.S)
    if n != 1:
        raise SystemExit("TINODE_SETUP_FAIL anchor-%s count=%d" % (what, n))
    return new


def keep_secret(path: Path, make) -> dict:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    val = make()
    path.write_text(json.dumps(val), encoding="utf-8")
    return val


def conf(sample: str, sec: dict, db_pw: str, uploads: str) -> str:
    t = sample
    t = once(t, r'"listen":\s*":6060"', '"listen": "127.0.0.1:6060"', "listen")
    t = once(t, r'"grpc_listen":\s*":16060"', '"grpc_listen": "127.0.0.1:16060"', "grpc")
    t = once(t, r'"logical_names":\s*\[\],', '"logical_names": ["basic:rest", "rest:"],\n\t\t"rest": {"server_url": "http://127.0.0.1:4181/tinode-auth/", '
             '"allow_new_accounts": true, "use_separate_endpoints": false},', "logical-names")
    t = once(t, r'"key":\s*"wfaY2RgF2S1OQI/ZlK\+LSrp1KB2jwAdGAIHQ7JZn\+Kc="', '"key": "%s"' % sec["token_key"], "token-key")
    t = once(t, r'"uid_key":\s*"la6YsO\+bNX/\+XIkOqc5Svw=="', '"uid_key": "%s"' % sec["uid_key"], "uid-key")
    t = once(t, r'"use_adapter":\s*""', '"use_adapter": "postgres"', "adapter")
    t = once(t, r'"User":\s*"postgres",\s*"Passwd":\s*"postgres",\s*"Host":\s*"localhost",',
             '"User": "tinode",\n\t\t\t\t"Passwd": "%s",\n\t\t\t\t"Host": "127.0.0.1",' % db_pw, "postgres")
    # Its own database, made by init-db. Before making it, init-db connects without a database name, which PostgreSQL
    # takes as the role's name ("tinode", kept as an empty database for that); the two must differ.
    t = once(t, r'"Port":\s*"5432",\s*"DBName":\s*"tinode",', '"Port": "5432",\n\t\t\t\t"DBName": "tdhchat",', "dbname")
    t = once(t, r'"upload_dir":\s*"uploads"', '"upload_dir": "%s"' % uploads.replace("\\", "/"), "uploads")
    # Files up to 200 MB (the sample's 8 MB stops most design files and videos).
    t = once(t, r'"max_size":\s*8388608', '"max_size": 209715200', "media-max-size")
    # Email validation: the first "required" list, inside acc_validation.email.
    head, _, tail = t.partition('"acc_validation": {')
    if not tail:
        raise SystemExit("TINODE_SETUP_FAIL anchor-acc-validation")
    tail, n = re.subn(r'"required":\s*\["auth"\],', '"required": [],', tail, count=1)
    if n != 1:
        raise SystemExit("TINODE_SETUP_FAIL anchor-email-required")
    t = head + '"acc_validation": {' + tail
    head, _, tail = t.partition('"acc_gc_config": {')
    if not tail:
        raise SystemExit("TINODE_SETUP_FAIL anchor-acc-gc")
    tail, n = re.subn(r'"enabled":\s*true', '"enabled": false', tail, count=1)
    if n != 1:
        raise SystemExit("TINODE_SETUP_FAIL anchor-acc-gc-enabled")
    return head + '"acc_gc_config": {' + tail


CDN = [
    (r'<script[^>]*src="https://polyfill-fastly\.io/[^"]*"[^>]*></script>\s*', ""),
    (r'https://cdn\.jsdelivr\.net/npm/react@18\.3\.1/umd/react\.production\.min\.js', "vendor/react.production.min.js"),
    (r'https://cdn\.jsdelivr\.net/npm/react-dom@18\.3\.1/umd/react-dom\.production\.min\.js', "vendor/react-dom.production.min.js"),
    (r'https://cdn\.jsdelivr\.net/npm/react-intl@7\.1\.6/react-intl\.iife\.min\.js', "vendor/react-intl.iife.min.js"),
    (r'https://cdn\.jsdelivr\.net/npm/qrcodejs@1\.0\.0/qrcode\.min\.js', "vendor/qrcode.min.js"),
    (r'https://fonts\.googleapis\.com/css\?family=Roboto[^"]*', "vendor/fonts.css"),
    (r'<link[^>]*href="https://fonts\.googleapis\.com/icon\?family=Material\+Icons"[^>]*>\s*', ""),
]


def page(html: str) -> str:
    if "company-chat-tinode-v1" in html:
        return html
    for pat, repl in CDN:
        html, n = re.subn(pat, repl, html, count=1)
        if n != 1:
            raise SystemExit("TINODE_SETUP_FAIL anchor-page " + pat[:40])
    if re.search(r'(src|href)="https://(cdn\.jsdelivr|fonts\.googleapis|polyfill)', html):
        raise SystemExit("TINODE_SETUP_FAIL page-still-loads-a-cdn")
    return html.replace("<head>", "<head>\n<!-- company-chat-tinode-v1: libraries and fonts served from static/vendor -->", 1)


# company-chat-tinode-v2: bump when the scripts change, so browsers do not keep an old copy.
SCRIPT_REV = "tdh4"


def bundle(js: str) -> str:
    """umd/index.prod.js: chunks from umd/ next to the page, not /umd/ at the site's root."""
    n = len(re.findall(r'\.p="/umd/"', js))
    if n == 1:
        return js.replace('.p="/umd/"', '.p="umd/"', 1)
    if n == 0 and len(re.findall(r'\.p="umd/"', js)) == 1:
        return js
    raise SystemExit("TINODE_SETUP_FAIL anchor-public-path count=%d" % n)


def look(html: str) -> str:
    """index.html: TDH's sheet right after Tinode's own, under this revision's URL."""
    html, n = re.subn(r'\s*<link rel="stylesheet" href="tdh-chat\.css[^"]*"\s*/?>', "", html)
    html, n = re.subn(r'(<link rel="stylesheet" href="css/base\.min\.css"\s*/?>)',
                      lambda m: m.group(1) + '\n<link rel="stylesheet" href="tdh-chat.css?v=%s" />' % SCRIPT_REV, html)
    if n != 1:
        raise SystemExit("TINODE_SETUP_FAIL anchor-base-css count=%d" % n)
    return html


def bust(html: str) -> str:
    """index.html: the two scripts under URLs of this revision."""
    for name in ("umd/tinode.prod.js", "umd/index.prod.js"):
        html, n = re.subn(r'src="' + re.escape(name) + r'(\?v=[A-Za-z0-9]+)?"', 'src="%s?v=%s"' % (name, SCRIPT_REV), html)
        if n != 1:
            raise SystemExit("TINODE_SETUP_FAIL anchor-script %s count=%d" % (name, n))
    return html


def web(static: Path, src: Path) -> None:
    """TDH's chat page into static/tdh/: its files under this revision's URLs, and the API key Tinode's page uses."""
    m = re.search(r'"(AQ[A-Za-z0-9_-]{30})"', (static / "umd" / "index.prod.js").read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("TINODE_SETUP_FAIL no-api-key")
    out = static / "tdh"
    out.mkdir(exist_ok=True)
    for name in ("index.html", "app.css", "app.js"):
        text = (src / name).read_text(encoding="utf-8")
        if name == "index.html":
            if text.count("__REV__") < 1:
                raise SystemExit("TINODE_SETUP_FAIL anchor-web-rev")
            text = text.replace("__REV__", SCRIPT_REV)
        (out / name).write_text(text, encoding="utf-8")
    (out / "config.js").write_text("window.TDH_CHAT_KEY = %s;\n" % json.dumps(m.group(1)), encoding="utf-8")


# TDH's page at /chat/ itself: the same page, its files under tdh/ and Tinode's beside it.
ROOT_PATHS = [('href="app.css', 'href="tdh/app.css'), ('src="../vendor/', 'src="vendor/'), ('src="../umd/', 'src="umd/'),
              ('src="config.js', 'src="tdh/config.js'), ('src="app.js', 'src="tdh/app.js')]


def home_page(src: Path) -> str:
    text = (src / "index.html").read_text(encoding="utf-8")
    for a, b in ROOT_PATHS:
        if text.count(a) < 1:
            raise SystemExit("TINODE_SETUP_FAIL anchor-home " + a)
        text = text.replace(a, b)
    return text.replace("__REV__", SCRIPT_REV)


def pages(static: Path, src: Path, home: str) -> None:
    """Tinode's own page as tinode.html (patched as before), and /chat/'s index.html: TDH's page, or Tinode's back."""
    idx = static / "index.html"
    kept = static / "tinode.html"
    if not kept.is_file():
        cur = idx.read_text(encoding="utf-8")
        if "company-chat-client-v1" in cur:
            raise SystemExit("TINODE_SETUP_FAIL no-tinode-page (index.html is TDH's and tinode.html is gone)")
        kept.write_text(cur, encoding="utf-8")
    kept.write_text(look(bust(page(kept.read_text(encoding="utf-8")))), encoding="utf-8")
    web(static, src)
    if home == "tinode":
        shutil.copyfile(kept, idx)
    else:
        idx.write_text(home_page(src), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tinode", required=True)
    ap.add_argument("--runtime", required=True)
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--vendor", required=True)
    ap.add_argument("--home", choices=("tdh", "tinode"), default=None)
    a = ap.parse_args()
    tin, rt = Path(a.tinode), Path(a.runtime)
    sample = tin / "tinode.conf.sample"
    if not sample.is_file():
        shutil.copyfile(tin / "tinode.conf", sample)
    sec = keep_secret(rt / "tinode-secrets.json", lambda: {
        "token_key": base64.b64encode(secrets.token_bytes(32)).decode(), "uid_key": base64.b64encode(secrets.token_bytes(16)).decode()})
    db_pw = (rt / "tinode-db.secret").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{16,}", db_pw):
        raise SystemExit("TINODE_SETUP_FAIL db-secret")
    out = conf(sample.read_text(encoding="utf-8"), sec, db_pw, a.uploads)
    tmp = tin / "tinode.conf.tmp"
    tmp.write_text(out, encoding="utf-8")
    os.replace(tmp, tin / "tinode.conf")
    static = tin / "static"
    shutil.copytree(a.vendor, static / "vendor", dirs_exist_ok=True)
    shutil.copyfile(Path(__file__).resolve().parent / "tdh-chat.css", static / "tdh-chat.css")
    js = static / "umd" / "index.prod.js"
    js.write_text(bundle(js.read_text(encoding="utf-8")), encoding="utf-8")
    home = a.home or ((rt / "chat-home").read_text(encoding="utf-8").strip() if (rt / "chat-home").is_file() else "") or "tdh"
    home = "tinode" if home == "tinode" else "tdh"
    pages(static, Path(__file__).resolve().parent / "tdh-web", home)
    print("CHAT_HOME=" + home)
    print("TINODE_SETUP_OK=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
