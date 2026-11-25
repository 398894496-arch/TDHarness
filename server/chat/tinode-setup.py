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
  - uploads under --uploads, files up to 200 MB;
  - voice calls (company-chat-call-v1): webrtc on, its ICE servers from runtime/chat-ice.json (a JSON list as
    tinode.conf has it) or one public STUN server reachable in China (stun.miwifi.com). The desks of the office and of
    the tunnel reach each other directly; STUN only helps two desks behind different home routers.
  - company-turn-v1: when runtime/chat-turn.json is there ({"urls": ["turn:<ip>:3478?transport=udp", ...],
    "days": 30}), a TURN server is added (coturn on the cloud entry, server/cloud/turnserver.conf, use-auth-secret):
    a phone on 4G and a desk behind a company router cannot reach each other without one. Its credential is coturn's
    time-limited kind (user "<expiry>:tdh", HMAC-SHA1 of it under runtime/chat-turn.secret), lasting "days".
    Tinode reads its ICE servers once, at start, and hands the same ones to every client: so
      tinode-setup.py --turn-refresh --tinode D:/dsh/tinode --runtime D:/dsh/runtime
    (the task TDH-Tinode-TURN, daily 04:20, install-chat.ps1) writes a new credential into tinode.conf's webrtc block
    and restarts Tinode (Autostart-Tinode) when fewer than 7 days are left, the TURN urls changed, or --force; never
    while a call may be going on (a one-to-one call message of the last 3 hours that no later message ended): then it
    waits for the next run. Prints TURN_REFRESH=0|1|wait.
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
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import time
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


ICE_DEFAULT = [{"urls": ["stun:stun.miwifi.com:3478"]}]


def webrtc(t: str, ice: list) -> str:
    """tinode.conf's webrtc block: on, with these ICE servers and no ICE servers file (company-chat-call-v1)."""
    head, mark, tail = t.partition('"webrtc": {')
    if not mark or tail.find('"webrtc": {') >= 0:
        raise SystemExit("TINODE_SETUP_FAIL anchor-webrtc")
    end = tail.find("\n\t}")
    if end < 0:
        raise SystemExit("TINODE_SETUP_FAIL anchor-webrtc-end")
    block, rest = tail[:end], tail[end:]
    block, n1 = re.subn(r'"enabled":\s*(?:false|true)', '"enabled": true', block, count=1)
    block, n2 = re.subn(r'"ice_servers":\s*(?:\[[^\n]*\]|\[.*?\n\t\t\]),', lambda _m: '"ice_servers": %s,' % json.dumps(ice), block, count=1, flags=re.S)
    block, n3 = re.subn(r'"ice_servers_file":\s*"[^"]*"', '"ice_servers_file": ""', block, count=1)
    if (n1, n2, n3) != (1, 1, 1):
        raise SystemExit("TINODE_SETUP_FAIL anchor-webrtc-parts %d%d%d" % (n1, n2, n3))
    return head + mark + block + rest


def ice_servers(runtime: Path, now: float | None = None) -> list:
    f = Path(runtime) / "chat-ice.json"
    got = ICE_DEFAULT
    if f.is_file():
        got = json.loads(f.read_text(encoding="utf-8-sig"))
        if not (isinstance(got, list) and got and all(isinstance(x, dict) and isinstance(x.get("urls"), list) and x["urls"]
                                                     and all(re.match(r"^(stun|turns?):[^\s\"]+$", str(u)) for u in x["urls"]) for x in got)):
            raise SystemExit("TINODE_SETUP_FAIL chat-ice")
    turn = turn_server(runtime, now)
    return list(got) + ([turn] if turn else [])


TURN_DAYS = 30
TURN_RENEW_S = 7 * 86400
TURN_USER = re.compile(r'"username":\s*"(\d+):tdh"')
CALL_ENDS = ("finished", "missed", "declined", "disconnected")


def turn_server(runtime: Path, now: float | None = None) -> dict | None:
    """company-turn-v1: the TURN server of runtime/chat-turn.json with a credential coturn's use-auth-secret takes."""
    f = Path(runtime) / "chat-turn.json"
    if not f.is_file():
        return None
    cfg = json.loads(f.read_text(encoding="utf-8-sig"))
    urls = cfg.get("urls") if isinstance(cfg, dict) else None
    if not (isinstance(urls, list) and urls and all(re.match(r"^turns?:[^\s\"]+$", str(u)) for u in urls)):
        raise SystemExit("TINODE_SETUP_FAIL chat-turn")
    secret = (Path(runtime) / "chat-turn.secret").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{32,}", secret):
        raise SystemExit("TINODE_SETUP_FAIL chat-turn-secret")
    days = int(cfg.get("days") or TURN_DAYS)
    if not 1 <= days <= 90:
        raise SystemExit("TINODE_SETUP_FAIL chat-turn-days")
    user = "%d:tdh" % int((time.time() if now is None else now) + days * 86400)
    cred = base64.b64encode(hmac.new(secret.encode(), user.encode(), hashlib.sha1).digest()).decode()
    return {"urls": [str(u) for u in urls], "username": user, "credential": cred}


def webrtc_block(t: str) -> str:
    _, mark, tail = t.partition('"webrtc": {')
    end = tail.find("\n\t}")
    if not mark or end < 0:
        raise SystemExit("TINODE_SETUP_FAIL anchor-webrtc")
    return tail[:end]


def turn_due(conf_text: str, want: dict | None, now: float) -> bool:
    """Whether tinode.conf's TURN entry has to be written again: fewer than 7 days left, other urls, or added/removed."""
    block = webrtc_block(conf_text)
    m = TURN_USER.search(block)
    if want is None:
        return m is not None
    if m is None or int(m.group(1)) - now < TURN_RENEW_S:
        return True
    return not all(json.dumps(u) in block for u in want["urls"])


def calls_open(runtime: Path, psql: str) -> int | None:
    """One-to-one call messages of the last 3 hours that no later message ended (Tinode keeps the state in the head of
    the messages that replace the call's own); None when the database cannot be asked."""
    ends = ",".join("'%s'" % s for s in CALL_ENDS)
    sql = ("select count(*) from messages m where m.topic like 'p2p%%' and m.deletedat is null "
           "and m.head->>'webrtc' is not null and m.head->>'replace' is null and m.head->>'webrtc' not in (%s) "
           "and m.createdat > (now() at time zone 'utc') - interval '3 hours' "
           "and not exists (select 1 from messages r where r.topic = m.topic and r.seqid > m.seqid "
           "and r.head->>'replace' = ':' || m.seqid and r.head->>'webrtc' in (%s))") % (ends, ends)
    try:
        pw = (Path(runtime) / "tinode-db.secret").read_text(encoding="utf-8").strip()
        r = subprocess.run([psql, "-h", "127.0.0.1", "-U", "tinode", "-d", "tdhchat", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
                           env=dict(os.environ, PGPASSWORD=pw), capture_output=True, timeout=30)
        return int(r.stdout.decode().strip()) if r.returncode == 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def restart_tinode() -> bool:
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Stop-ScheduledTask -TaskName Autostart-Tinode; Start-Sleep 2; Start-ScheduledTask -TaskName Autostart-Tinode"],
                   capture_output=True, timeout=60)
    for _ in range(40):
        time.sleep(1)
        try:
            socket.create_connection(("127.0.0.1", 6060), timeout=2).close()
            return True
        except OSError:
            pass
    return False


def turn_refresh(tin: Path, rt: Path, psql: str, force: bool) -> int:
    now = time.time()
    conf_path = tin / "tinode.conf"
    cur = conf_path.read_text(encoding="utf-8")
    want = turn_server(rt, now)
    if not force and not turn_due(cur, want, now):
        return report(rt, "TURN_REFRESH=0")
    n = calls_open(rt, psql)
    if n != 0:
        return report(rt, "TURN_REFRESH=wait calls=%s" % ("unknown" if n is None else n))
    tmp = tin / "tinode.conf.tmp"
    tmp.write_text(webrtc(cur, ice_servers(rt, now)), encoding="utf-8")
    os.replace(tmp, conf_path)
    up = restart_tinode()
    return report(rt, "TURN_REFRESH=1 turn=%s tinode=%s" % ("on" if want else "off", "up" if up else "DOWN"), 0 if up else 1)


def report(rt: Path, line: str, code: int = 0) -> int:
    print(line)
    logs = Path(rt).parent / "logs"
    if logs.is_dir():
        with open(logs / "tinode-turn.log", "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + line + "\n")
    return code


def conf(sample: str, sec: dict, db_pw: str, uploads: str, ice: list | None = None) -> str:
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
    t = webrtc(t, ice or ICE_DEFAULT)
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


# company-chat-tinode-v2: the scripts' URLs change whenever their content does, so browsers do not keep an old copy.
# main() sets it from the files themselves (TDH's page and sheet); "tdh4" is what a direct call without main gets.
SCRIPT_REV = "tdh4"


def content_rev(chat_dir: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    for f in ("tdh-web/index.html", "tdh-web/app.js", "tdh-web/app.css", "tdh-chat.css"):
        h.update((chat_dir / f).read_bytes())
    return "tdh-" + h.hexdigest()[:10]


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
        # Any earlier revision: content_rev's ("tdh-" and hex) as well as the old fixed ones ("tdh4").
        html, n = re.subn(r'src="' + re.escape(name) + r'(\?v=[^"]*)?"', 'src="%s?v=%s"' % (name, SCRIPT_REV), html)
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
    ap.add_argument("--uploads")
    ap.add_argument("--vendor")
    ap.add_argument("--home", choices=("tdh", "tinode"), default=None)
    ap.add_argument("--turn-refresh", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--psql", default=r"D:\dsh\pgsql\bin\psql.exe")
    a = ap.parse_args()
    tin, rt = Path(a.tinode), Path(a.runtime)
    if a.turn_refresh:
        return turn_refresh(tin, rt, a.psql, a.force)
    if not (a.uploads and a.vendor):
        ap.error("--uploads and --vendor are needed")
    sample = tin / "tinode.conf.sample"
    if not sample.is_file():
        shutil.copyfile(tin / "tinode.conf", sample)
    sec = keep_secret(rt / "tinode-secrets.json", lambda: {
        "token_key": base64.b64encode(secrets.token_bytes(32)).decode(), "uid_key": base64.b64encode(secrets.token_bytes(16)).decode()})
    db_pw = (rt / "tinode-db.secret").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{16,}", db_pw):
        raise SystemExit("TINODE_SETUP_FAIL db-secret")
    out = conf(sample.read_text(encoding="utf-8"), sec, db_pw, a.uploads, ice_servers(rt))
    tmp = tin / "tinode.conf.tmp"
    tmp.write_text(out, encoding="utf-8")
    os.replace(tmp, tin / "tinode.conf")
    static = tin / "static"
    shutil.copytree(a.vendor, static / "vendor", dirs_exist_ok=True)
    global SCRIPT_REV
    SCRIPT_REV = content_rev(Path(__file__).resolve().parent)
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
