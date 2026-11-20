#!/usr/bin/env python3
"""Proof for company-chat-tinode-v1: the people service answers Tinode's REST authenticator (POST /tinode-auth).

A roster password logs in; so does the desk's own login token (no second password); a wrong password, someone
else's token, a person who is not active, or a stranger fail; a first login asks Tinode to create the account
under the roster name, and after `link` the same person comes back with that uid; checkunique, rtagns and the
rest answer as Tinode expects; repeated failures lock like the TDH login; anything through Caddy (it carries
X-Forwarded-For) is refused.

company-chat-directory-v1: the new account is found by its login and roster name (tags); once it exists, the
service logs in as that person (their desk token, against a stand-in Tinode here) and opens their chat with
everyone else who has an account, once: the next login opens nothing more. Prints CHAT_AUTH_PROVE_OK=1.
"""
from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def ask(port: int, body: dict, via_caddy: bool = False) -> tuple[int, dict]:
    req = urllib.request.Request("http://127.0.0.1:%d/tinode-auth/" % port, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    if via_caddy:
        req.add_header("X-Forwarded-For", "203.0.113.9")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return int(resp.status), json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


def sec(login: str, pw: str) -> str:
    return base64.b64encode((login + ":" + pw).encode("utf-8")).decode("ascii")


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CHAT_AUTH_PROVE_FAIL " + what)


class FakeTinode:
    """Just enough of Tinode's long polling: sessions, {hi}, {login basic} (asked of the people service, as Tinode
    does), {sub}, {leave}. Records who opened which chat."""

    def __init__(self, people_port: int):
        self.people_port = people_port
        self.sessions: dict = {}
        self.subs: list = []
        self.lock = threading.Lock()
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _out(self, lines):
                raw = "\n".join(json.dumps(x) for x in lines).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                q = dict(x.split("=", 1) for x in self.path.split("?", 1)[1].split("&"))
                if q.get("apikey") != "AQ" + "x" * 30:
                    self._out([{"ctrl": {"code": 403}}])
                    return
                sid = q.get("sid")
                if not sid:
                    sid = "s%d" % len(fake.sessions)
                    fake.sessions[sid] = {"user": "", "queue": []}
                    self._out([{"ctrl": {"params": {"sid": sid}, "code": 201}}])
                    return
                with fake.lock:
                    out, fake.sessions[sid]["queue"] = fake.sessions[sid]["queue"], []
                self._out(out)

            def do_POST(self):
                q = dict(x.split("=", 1) for x in self.path.split("?", 1)[1].split("&"))
                s = fake.sessions[q["sid"]]
                msg = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                kind = next(iter(msg))
                body = msg[kind]
                code = 200
                if kind == "login":
                    st, r = ask(fake.people_port, {"endpoint": "auth", "secret": body["secret"], "addr": "127.0.0.1"})
                    uid = (r.get("rec") or {}).get("uid")
                    code = 200 if uid else 401
                    s["user"] = uid or ""
                elif kind == "sub":
                    code = 200 if s["user"] else 401
                    if s["user"]:
                        fake.subs.append((s["user"], body["topic"]))
                with fake.lock:
                    s["queue"].append({"ctrl": {"id": body.get("id"), "code": code}})
                self._out([])

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="tdh-chatauth-"))
    runtime = root / "runtime"
    (runtime / "caddy").mkdir(parents=True)
    (runtime / "roster.json").write_text(json.dumps({"owner": "test", "people": [
        {"pid": "p1", "login": "tdh", "name": "", "role": "admin", "dept": "company", "status": "active"},
        {"pid": "p2", "login": "lfh", "name": "梁风禾", "role": "employee", "dept": "d-sales", "status": "active"},
        {"pid": "p3", "login": "gone", "name": "离职", "role": "employee", "dept": "d-sales", "status": "disabled"},
        {"pid": "p4", "login": "nn", "name": "", "role": "employee", "dept": "d-sales", "status": "active"},
    ]}, ensure_ascii=False), encoding="utf-8")
    (runtime / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\nlfh:lfh-pass-456\ngone:gone-pass-789\nnn:nn-pass-1234\n", encoding="utf-8")
    (runtime / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    (runtime / "gw-tokens.json").write_text(json.dumps({"tokens": [
        {"pid": "p2", "token": "dsh_" + "a" * 32, "revoked_at": ""},
        {"pid": "p1", "token": "dsh_" + "b" * 32, "revoked_at": ""},
        {"pid": "p2", "token": "dsh_" + "c" * 32, "revoked_at": "2026-11-01"},
    ]}), encoding="utf-8")
    port = free_port()
    # tdh already has a chat account; nothing opened for it yet (it is the one lfh's join should reach).
    (runtime / "tinode-links.json").write_text(json.dumps({"tdh": "TDHUID00001"}), encoding="utf-8")
    static = root / "tinode" / "static" / "umd"
    static.mkdir(parents=True)
    (static / "index.prod.js").write_text('var k="AQ' + "x" * 30 + '";', encoding="utf-8")
    fake = FakeTinode(port)
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(runtime / "lease"),
               TDH_SMB_LEDGER=str(root / "smb-ledger.jsonl"), TDH_TINODE_URL="http://127.0.0.1:%d" % fake.port,
               TDH_CHAT_DIR_DELAY="0.3")
    proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        st, r = ask(port, {"endpoint": "auth", "secret": sec("lfh", "lfh-pass-456"), "addr": "10.0.0.5"})
        check(st == 200 and r.get("rec", {}).get("state") == "ok" and "uid" not in r["rec"], "roster password, first login: " + json.dumps(r, ensure_ascii=False))
        check(r.get("newacc", {}).get("public", {}).get("fn") == "梁风禾" and r["rec"].get("tags") == ["tdh:lfh", "lfh", "梁风禾"],
              "the account is made under the roster name, found by login and name: " + json.dumps(r, ensure_ascii=False))
        st, r = ask(port, {"endpoint": "link", "secret": sec("lfh", "lfh-pass-456"), "rec": {"uid": "LELEQHDWbgY", "authlvl": "auth"}})
        check(st == 200 and r.get("rec", {}).get("uid") == "LELEQHDWbgY", "link: " + json.dumps(r))
        # The directory: lfh (logged in with lfh's own desk token) opens the chat with tdh, the one other account.
        deadline = time.time() + 15
        while time.time() < deadline and not fake.subs:
            time.sleep(0.1)
        time.sleep(0.5)
        check(fake.subs == [("LELEQHDWbgY", "usrTDHUID00001")], "directory: lfh opens the chat with tdh: " + json.dumps(fake.subs))
        dirfile = json.loads((runtime / "tinode-directory.json").read_text(encoding="utf-8"))
        check(dirfile.get("lfh") == ["TDHUID00001"], "directory: kept: " + json.dumps(dirfile))
        st, r = ask(port, {"endpoint": "auth", "secret": sec("lfh", "dsh_" + "a" * 32), "addr": "10.0.0.5"})
        check(r.get("rec", {}).get("uid") == "LELEQHDWbgY" and "newacc" not in r, "the desk's login token, linked: " + json.dumps(r))
        st, r = ask(port, {"endpoint": "auth", "secret": sec("tdh", "seed-pass-123")})
        check("newacc" not in r and r.get("rec", {}).get("uid") == "TDHUID00001", "an account already made: its uid: " + json.dumps(r))
        st, r = ask(port, {"endpoint": "auth", "secret": sec("nn", "nn-pass-1234")})
        check(r.get("newacc", {}).get("public", {}).get("fn") == "nn" and r["rec"].get("tags") == ["tdh:nn", "nn"], "no roster name: the login: " + json.dumps(r))
        time.sleep(1.5)
        # lfh again: nothing more to open. tdh's own join reaches lfh (tdh has a desk token too).
        check(sorted(fake.subs) == sorted([("LELEQHDWbgY", "usrTDHUID00001"), ("TDHUID00001", "usrLELEQHDWbgY")]),
              "directory: once each way, nothing twice: " + json.dumps(fake.subs))
        ask(port, {"endpoint": "auth", "secret": sec("lfh", "dsh_" + "a" * 32), "addr": "10.0.0.5"})
        time.sleep(1.5)
        check(len(fake.subs) == 2, "directory: a later login opens nothing again: " + json.dumps(fake.subs))
        for bad, what in ((sec("lfh", "wrong-pass"), "a wrong password"), (sec("lfh", "dsh_" + "b" * 32), "someone else's token"),
                          (sec("lfh", "dsh_" + "c" * 32), "a revoked token"), (sec("gone", "gone-pass-789"), "a person not active"),
                          (sec("nobody", "whatever-1"), "a stranger"), ("!!!", "a broken secret")):
            st, r = ask(port, {"endpoint": "auth", "secret": bad, "addr": "10.0.0.6"})
            check(st == 200 and r.get("err") in ("failed", "malformed"), what + ": " + json.dumps(r))
        check(ask(port, {"endpoint": "checkunique", "secret": sec("x", "y")})[1] == {"boolval": True}, "checkunique")
        check(ask(port, {"endpoint": "rtagns"})[1] == {"strarr": ["tdh"]}, "rtagns")
        for ep in ("add", "upd", "del", "gen"):
            check(ask(port, {"endpoint": ep, "secret": sec("lfh", "x")})[1] == {"err": "unsupported"}, ep + ": unsupported")
        st, r = ask(port, {"endpoint": "auth", "secret": sec("lfh", "lfh-pass-456")}, via_caddy=True)
        check(st == 403 and "rec" not in r, "through Caddy: refused")
        # Repeated failures from one address lock like the TDH login does.
        for _ in range(6):
            ask(port, {"endpoint": "auth", "secret": sec("tdh", "nope-nope"), "addr": "10.0.0.7"})
        st, r = ask(port, {"endpoint": "auth", "secret": sec("tdh", "seed-pass-123"), "addr": "10.0.0.7"})
        check(r.get("err") == "policy", "locked after repeated failures: " + json.dumps(r))
        print("CHAT_AUTH_PROVE_OK=1")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    main()
