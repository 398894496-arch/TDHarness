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
  - uploads under --uploads.
The web page's React, fonts and icons come from CDNs (jsDelivr, Google Fonts), which desks in China often cannot
reach: index.html loads them from static/vendor instead. Prints TINODE_SETUP_OK=1.
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
    t = once(t, r'"upload_dir":\s*"uploads"', '"upload_dir": "%s"' % uploads.replace("\\", "/"), "uploads")
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tinode", required=True)
    ap.add_argument("--runtime", required=True)
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--vendor", required=True)
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
    idx = static / "index.html"
    idx.write_text(page(idx.read_text(encoding="utf-8")), encoding="utf-8")
    print("TINODE_SETUP_OK=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
