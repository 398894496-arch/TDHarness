#!/usr/bin/env python3
"""Proof for company-chat-read-v1: a person's own chats for their own TDH agent (POST /company/ext/chat/<list|read|search>).

Against a stand-in Tinode with three people and four chats (two one-to-one chats of tdh's, one group tdh is in, and
a chat between the two others):
- the person is the one of the login token: no token, a revoked one or a disabled person's is refused (401); a person
  with no chat account is told so; a route that is not list/read/search is 404;
- list: only the chats the person is in (the chat between the others is not there), newest first, unread counts;
- read: by a whole name or a part of it; the last messages oldest first, an edit folded into its message, a picture
  as [图片], a file as [文件] name, a quote, the person's own messages as 我; limit and since; a chat not theirs is never
  subscribed to; nothing is marked read and nothing is posted (no {note}, no {pub}), every chat opened is left;
- search: a word in the chats of the last days, newest first, an older message not;
- the service's log has counts, never what was said;
- the answer stays within the budget the desk shows the agent, the older messages left out first.

company-chat-bot-v1: the daily report comes from TDH早报 (tdh-daily), the server's own chat account: it cannot log in
with a password or a desk token, its account is made under that name at its first message, which comes in a chat of
its own; it opens no chat with anyone else, so it is in nobody else's list (prove-people.py: no one can be added under
its login); an admin's trial to one person goes to them only and is not today's report.
Prints CHAT_READ_PROVE_OK=1.
"""
from __future__ import annotations

import base64
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
os.environ["TZ"] = "Asia/Shanghai"
time.tzset()
spec = importlib.util.spec_from_file_location("chat_read", HERE.parent / "server" / "chat_read.py")
cr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cr)

KEY = "AQ" + "x" * 30
TOK = {"tdh": "dsh_" + "b" * 32, "lfh": "dsh_" + "a" * 32, "gone": "dsh_" + "d" * 32, "nochat": "dsh_" + "e" * 32,
       "old": "dsh_" + "c" * 32}
UID = {"tdh": "TDH1", "lfh": "LFH1", "wang": "WANG1"}


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CHAT_READ_PROVE_FAIL " + what)


def ago(days: float = 0, hours: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def ask(port: int, path: str, body: dict, auth: str = "") -> tuple[int, dict]:
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    if auth:
        req.add_header("Authorization", "Bearer " + auth)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return int(resp.status), json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


IMG = {"txt": " ", "fmt": [{"at": 0, "len": 1, "key": 0}], "ent": [{"tp": "IM", "data": {"mime": "image/png", "name": "a.png", "val": "iVBORw0KGgo="}}]}
FILE = {"txt": "报价单发你了", "fmt": [{"at": -1, "len": 0, "key": 0}], "ent": [{"tp": "EX", "data": {"mime": "application/pdf", "name": "报价单.pdf", "val": "JVBERi0="}}]}
QUOTE = {"txt": "梁风禾\n交，上午十点好的，我安排车", "fmt": [{"tp": "QQ", "at": 0, "len": 10}, {"tp": "BR", "at": 3, "len": 1}], "ent": []}


class FakeTinode:
    """Tinode's long polling, enough for reading: {hi}, {login basic} (asked of the people service), {sub} (members
    only), {get me sub}, {get data}, {leave}. Records every sub, leave, note and pub."""

    def __init__(self, people_port: int):
        self.people_port = people_port
        self.sessions: dict = {}
        self.subs: list = []
        self.leaves: list = []
        self.writes: list = []
        self.made: list = []
        self.fn = {UID["tdh"]: "徐总", UID["lfh"]: "梁风禾", UID["wang"]: "王伟"}
        self.lock = threading.Lock()
        p2p = lambda a, b: ("p2p", frozenset((UID[a], UID[b])))
        self.chats = {
            p2p("tdh", "lfh"): {"read": {UID["tdh"]: 2, UID["lfh"]: 5}, "msgs": [
                (1, UID["tdh"], ago(2), "明天交货吗", None),
                (2, UID["lfh"], ago(2, -1), "交，下午三点", None),
                (3, UID["lfh"], ago(1), IMG, None),
                (4, UID["lfh"], ago(1, -1), "交，上午十点", {"replace": ":2"}),
                (5, UID["tdh"], ago(0, 3), QUOTE, {"reply": "2"}),
            ]},
            p2p("tdh", "wang"): {"read": {UID["tdh"]: 1, UID["wang"]: 1}, "msgs": [(1, UID["wang"], ago(3), FILE, None)]},
            p2p("lfh", "wang"): {"read": {}, "msgs": [(1, UID["lfh"], ago(0, 1), "私下说的，交货别告诉老板", None)]},
            ("grp", "grpSales"): {"members": {UID["tdh"], UID["lfh"]}, "fn": "销售群", "read": {UID["tdh"]: 1}, "msgs": [
                (1, UID["lfh"], ago(60), "上个季度的交货单", None),
                (2, UID["lfh"], ago(0, 5), "@徐总 交货单在共享盘", None),
            ]},
            ("grp", "grpEmpty"): {"members": {UID["tdh"]}, "fn": "空群", "read": {}, "msgs": []},
        }
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _out(self, lines):
                raw = "\n".join(json.dumps(x, ensure_ascii=False) for x in lines).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                q = dict(x.split("=", 1) for x in self.path.split("?", 1)[1].split("&"))
                if q.get("apikey") != KEY:
                    self._out([{"ctrl": {"code": 403}}])
                    return
                sid = q.get("sid")
                if not sid:
                    with fake.lock:
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
                out = fake.answer(s, kind, body)
                with fake.lock:
                    s["queue"] += out
                self._out([])

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def _mine(self, me: str):
        """(the topic name as `me` sees it, the chat) for each chat `me` is in."""
        for key, c in self.chats.items():
            if key[0] == "grp" and me in c["members"]:
                yield key[1], c
            elif key[0] == "p2p" and me in key[1]:
                yield "usr" + next(iter(key[1] - {me})), c

    def answer(self, s: dict, kind: str, body: dict) -> list:
        mid = body.get("id")
        ctrl = lambda code, **params: [{"ctrl": dict({"id": mid, "code": code}, **({"params": params} if params else {}))}]
        me = s["user"]
        if kind == "hi":
            return ctrl(201)
        if kind == "login":
            st, r = ask(self.people_port, "/tinode-auth/", {"endpoint": "auth", "secret": body["secret"], "addr": "127.0.0.1"})
            uid = (r.get("rec") or {}).get("uid") or ""
            if not uid and r.get("newacc"):
                # As Tinode does: make the account under the name it is given, tell the people service its uid.
                who = base64.b64decode(body["secret"]).decode("utf-8").split(":", 1)[0]
                uid = "NEW" + who.upper().replace("-", "")
                self.made.append((who, r["newacc"]["public"]["fn"], r["rec"].get("tags")))
                self.fn[uid] = r["newacc"]["public"]["fn"]
                ask(self.people_port, "/tinode-auth/", {"endpoint": "link", "secret": body["secret"], "rec": {"uid": uid, "authlvl": "auth"}})
            s["user"] = uid
            return ctrl(200 if s["user"] else 401)
        if not me:
            return ctrl(401)
        topic = body.get("topic")
        if kind in ("note", "pub", "set", "del"):
            self.writes.append((me, kind, topic))
            if kind == "pub" and str(topic).startswith("usr"):
                c = self.chats[("p2p", frozenset((me, topic[3:])))]
                c["msgs"].append((len(c["msgs"]) + 1, me, ago(), body.get("content"), None))
            return ctrl(200)
        if kind == "sub" and str(topic).startswith("usr") and topic[3:] in self.fn:
            self.chats.setdefault(("p2p", frozenset((me, topic[3:]))), {"read": {}, "msgs": []})  # Tinode opens a one-to-one chat on both sides
        mine = dict(self._mine(me))
        if kind == "sub":
            self.subs.append((me, topic))
            return ctrl(200) if topic == "me" or topic in mine else ctrl(403)
        if kind == "leave":
            self.leaves.append((me, topic))
            return ctrl(200)
        if kind == "get" and topic == "me" and body.get("what") == "sub":
            subs = []
            for name, c in mine.items():
                last = c["msgs"][-1] if c["msgs"] else None
                fn = c.get("fn") or self.fn.get(name[3:], name)
                subs.append({"topic": name, "public": {"fn": fn}, "seq": last[0] if last else 0,
                             "read": c["read"].get(me, 0), "touched": last[2] if last else ago(9)})
            return [{"meta": {"id": mid, "topic": "me", "sub": subs}}] if subs else ctrl(204)
        if kind == "get" and body.get("what") == "data":
            if topic not in mine:
                return ctrl(403)
            limit = int((body.get("data") or {}).get("limit") or 24)
            rows = list(reversed(mine[topic]["msgs"]))[:limit]  # Tinode: the newest first
            out = []
            for seq, frm, ts, content, head in rows:
                d = {"topic": topic, "from": "usr" + frm, "ts": ts, "seq": seq, "content": content}
                if head:
                    d["head"] = head
                out.append({"data": d})
            return out + (ctrl(200, what="data", count=len(rows)) if rows else ctrl(204))
        return ctrl(400)


def units() -> None:
    check(cr.plain("就一句") == "就一句", "plain text")
    check(cr.plain(IMG) == "[图片]", "a picture: " + cr.plain(IMG))
    check(cr.plain(FILE) == "报价单发你了 [文件] 报价单.pdf", "a file: " + cr.plain(FILE))
    check(cr.plain(QUOTE) == "（引用：梁风禾 交，上午十点）好的，我安排车", "a quote: " + cr.plain(QUOTE))
    check(len(cr.plain("长" * 2000)) == cr.TEXT_MAX, "a long message is cut")
    chats = [{"topic": "usrA", "name": "王伟"}, {"topic": "usrB", "name": "王伟伟"}, {"topic": "grpC", "name": "销售 群"}]
    check(cr.find_chat(chats, "王伟伟")["topic"] == "usrB" and cr.find_chat(chats, "王伟")["topic"] == "usrA", "a whole name first")
    check(cr.find_chat(chats, "销售群")["topic"] == "grpC" and cr.find_chat(chats, "售")["topic"] == "grpC", "spaces ignored, a part of a name")
    check(cr.find_chat(chats, "") is None and cr.find_chat(chats, "李四") is None, "no name, not mine")
    rows = [{"time": "2026-11-%02d 10:00" % (i + 1), "text": "字" * 1000} for i in range(20)]
    keep, cut = cr.fit(rows, newest_last=True)
    check(cut > 0 and keep[-1] is rows[-1] and sum(len(r["text"]) for r in keep) <= cr.BUDGET, "the older ones left out first")
    keep, cut = cr.fit(list(reversed(rows)), newest_last=False)
    check(cut > 0 and keep[0] is rows[-1], "search: newest first, the older ones left out")


def main() -> None:
    units()
    root = Path(tempfile.mkdtemp(prefix="tdh-chatread-"))
    runtime = root / "runtime"
    (runtime / "caddy").mkdir(parents=True)
    (runtime / "roster.json").write_text(json.dumps({"owner": "test", "people": [
        {"pid": "p1", "login": "tdh", "name": "徐总", "role": "admin", "dept": "company", "status": "active"},
        {"pid": "p2", "login": "lfh", "name": "梁风禾", "role": "employee", "dept": "d-sales", "status": "active"},
        {"pid": "p3", "login": "wang", "name": "王伟", "role": "employee", "dept": "d-sales", "status": "active"},
        {"pid": "p4", "login": "gone", "name": "离职", "role": "employee", "dept": "d-sales", "status": "disabled"},
        {"pid": "p5", "login": "nochat", "name": "新人", "role": "employee", "dept": "d-sales", "status": "active"},
    ]}, ensure_ascii=False), encoding="utf-8")
    (runtime / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
    (runtime / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    (runtime / "gw-tokens.json").write_text(json.dumps({"tokens": [
        {"pid": "p1", "token": TOK["tdh"], "revoked_at": ""},
        {"pid": "p2", "token": TOK["lfh"], "revoked_at": ""},
        {"pid": "p4", "token": TOK["gone"], "revoked_at": ""},
        {"pid": "p5", "token": TOK["nochat"], "revoked_at": ""},
        {"pid": "p1", "token": TOK["old"], "revoked_at": "2026-11-01"},
    ]}), encoding="utf-8")
    (runtime / "tinode-links.json").write_text(json.dumps(UID), encoding="utf-8")
    # Everyone's chats with everyone are open already: the directory has nothing to do.
    (runtime / "tinode-directory.json").write_text(json.dumps({w: sorted(u for x, u in UID.items() if x != w) for w in UID}), encoding="utf-8")
    static = root / "tinode" / "static" / "umd"
    static.mkdir(parents=True)
    (static / "index.prod.js").write_text('var k="' + KEY + '";', encoding="utf-8")
    port = free_port()
    fake = FakeTinode(port)
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(runtime / "lease"),
               TDH_SMB_LEDGER=str(root / "smb-ledger.jsonl"), TDH_TINODE_URL="http://127.0.0.1:%d" % fake.port,
               TDH_CHAT_DIR_DELAY="0.3", TDH_CHAT_PROVISION="0", TZ="Asia/Shanghai")
    log = root / "people-api.err"
    with open(log, "wb") as err:
        proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=err)
    try:
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        P = "/company/ext/chat/"
        # Who may ask.
        check(ask(port, P + "list", {})[0] == 401, "no token")
        check(ask(port, P + "list", {}, TOK["old"])[0] == 401, "a revoked token")
        check(ask(port, P + "list", {}, TOK["gone"])[0] == 401, "a disabled person")
        st, r = ask(port, P + "list", {}, TOK["nochat"])
        check(st == 200 and r.get("error") == "no-chat-account" and r.get("hint"), "no chat account yet: " + json.dumps(r, ensure_ascii=False))
        check(ask(port, P + "delete", {}, TOK["tdh"])[0] == 404, "only list, read, search")
        # list
        st, r = ask(port, P + "list", {}, TOK["tdh"])
        names = [c["name"] for c in r.get("chats") or []]
        check(st == 200 and r.get("ok") and names == ["梁风禾", "销售群", "王伟"], "my chats, newest first, the empty group left out: " + json.dumps(r, ensure_ascii=False))
        by = {c["name"]: c for c in r["chats"]}
        check(by["梁风禾"]["unread"] == 3 and by["梁风禾"]["kind"] == "私聊" and by["销售群"]["kind"] == "群" and by["王伟"]["unread"] == 0,
              "unread and kind: " + json.dumps(r["chats"], ensure_ascii=False))
        # read
        st, r = ask(port, P + "read", {"chat": "梁风禾"}, TOK["tdh"])
        texts = [(m["from"], m["text"]) for m in r.get("messages") or []]
        check(st == 200 and r.get("ok") and r.get("chat") == "梁风禾" and texts == [
            ("我", "明天交货吗"), ("梁风禾", "交，上午十点"), ("梁风禾", "[图片]"), ("我", "（引用：梁风禾 交，上午十点）好的，我安排车")],
              "a chat, oldest first, the edit folded in: " + json.dumps(r, ensure_ascii=False))
        check(all(len(m["time"]) == 16 for m in r["messages"]), "times to the minute")
        st, r = ask(port, P + "read", {"chat": "风禾", "limit": 2}, TOK["tdh"])
        check([m["text"] for m in r.get("messages") or []] == ["[图片]", "（引用：梁风禾 交，上午十点）好的，我安排车"], "a part of the name; the last two: " + json.dumps(r, ensure_ascii=False))
        st, r = ask(port, P + "read", {"chat": "王伟"}, TOK["tdh"])
        check(r.get("messages") == [{"time": r["messages"][0]["time"], "from": "王伟", "text": "报价单发你了 [文件] 报价单.pdf"}], "a file: " + json.dumps(r, ensure_ascii=False))
        st, r = ask(port, P + "read", {"chat": "销售群", "since": (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")}, TOK["tdh"])
        check([m["text"] for m in r.get("messages") or []] == ["@徐总 交货单在共享盘"], "since: " + json.dumps(r, ensure_ascii=False))
        check(ask(port, P + "read", {"chat": "销售群", "since": "上周"}, TOK["tdh"])[0] == 400, "a bad since")
        before = list(fake.subs)
        st, r = ask(port, P + "read", {"chat": "usrWANG1-LFH1"}, TOK["tdh"])
        check(r.get("error") == "no-such-chat" and "梁风禾" in r.get("chats", []), "not a chat of mine: " + json.dumps(r, ensure_ascii=False))
        check(all(t == "me" for _, t in fake.subs[len(before):]), "a name not mine: no chat opened: " + json.dumps(fake.subs[len(before):]))
        # search
        st, r = ask(port, P + "search", {"q": "交货"}, TOK["tdh"])
        hits = [(h["chat"], h["text"]) for h in r.get("hits") or []]
        check(st == 200 and hits == [("销售群", "@徐总 交货单在共享盘"), ("梁风禾", "明天交货吗")],
              "a word in my chats of the last 30 days, newest first; the others' chat and the old message not: " + json.dumps(r, ensure_ascii=False))
        st, r = ask(port, P + "search", {"q": "交货", "days": 90}, TOK["tdh"])
        check([h["text"] for h in r.get("hits") or []][-1] == "上个季度的交货单", "90 days: the old one too: " + json.dumps(r, ensure_ascii=False))
        check(ask(port, P + "search", {}, TOK["tdh"])[0] == 400, "search needs a word")
        # lfh sees the chat with wang, tdh never did.
        st, r = ask(port, P + "search", {"q": "私下"}, TOK["lfh"])
        check([h["chat"] for h in r.get("hits") or []] == ["王伟"], "lfh's own chat: " + json.dumps(r, ensure_ascii=False))
        tdh_subs = {t for who, t in fake.subs if who == UID["tdh"]}
        check(tdh_subs <= {"me", "usrLFH1", "usrWANG1", "grpSales"}, "tdh opened only tdh's chats: " + json.dumps(sorted(tdh_subs)))
        opened = [(w, t) for w, t in fake.subs if t != "me"]
        check(sorted(opened) == sorted(fake.leaves), "every chat opened was left: %s / %s" % (opened, fake.leaves))
        check(fake.writes == [], "nothing marked read, nothing posted: " + json.dumps(fake.writes))

        # company-chat-bot-v1: TDH早报.
        bot = lambda pw: base64.b64encode(("tdh-daily:" + pw).encode("utf-8")).decode("ascii")
        for pw in ("tdh-daily", "seed-pass-123", TOK["tdh"], "tkt_" + "0" * 40):
            st, r = ask(port, "/tinode-auth/", {"endpoint": "auth", "secret": bot(pw), "addr": "10.0.0.9"})
            check(r.get("err") == "failed", "TDH早报 does not log in with a password, a token or a made-up ticket: " + json.dumps(r))
        (runtime / "daily-report.json").write_text(json.dumps({
            "to": ["tdh"], "packs": [], "gateway": "http://127.0.0.1:9",
            "at": (datetime.now() + timedelta(hours=12)).strftime("%H:%M"), "window_hours": 1}), encoding="utf-8")
        check("tdh-daily" not in json.loads((runtime / "tinode-links.json").read_text(encoding="utf-8")), "no account for TDH早报 yet")
        writes = len(fake.writes)
        st, r = ask(port, "/company/daily-report", {}, TOK["tdh"])
        check(st == 200 and [x.get("ok") for x in r.get("sent") or []] == [True], "the report goes out: " + json.dumps(r, ensure_ascii=False))
        check(fake.made == [("tdh-daily", "TDH早报", ["tdh:tdh-daily"])], "TDH早报's account, made at its first message: " + json.dumps(fake.made, ensure_ascii=False))
        botuid = json.loads((runtime / "tinode-links.json").read_text(encoding="utf-8")).get("tdh-daily")
        check(botuid == "NEWTDHDAILY", "its uid is kept: %s" % botuid)
        check(fake.writes[writes:] == [(botuid, "pub", "usr" + UID["tdh"])], "one message, from TDH早报 to 徐总: " + json.dumps(fake.writes[writes:]))
        st, r = ask(port, P + "list", {}, TOK["tdh"])
        check(st == 200 and r["chats"][0]["name"] == "TDH早报" and r["chats"][0]["unread"] == 1, "徐总 has a chat TDH早报 of its own: " + json.dumps(r, ensure_ascii=False))
        st, r = ask(port, P + "read", {"chat": "TDH早报"}, TOK["tdh"])
        check(r["messages"][0]["from"] == "同事" and "完整日报" in r["messages"][0]["text"], "the message: " + json.dumps(r, ensure_ascii=False))
        st, r = ask(port, P + "list", {}, TOK["lfh"])
        check("TDH早报" not in [c["name"] for c in r.get("chats") or []], "not in anyone else's list: " + json.dumps(r, ensure_ascii=False))
        time.sleep(1.0)
        check([t for w, t in fake.subs if w == botuid] == ["usr" + UID["tdh"]], "TDH早报 opened no other chat: " + json.dumps(fake.subs))
        # A trial to one person: only to them, and it is not today's report.
        state = (runtime / "daily-report-state.json").read_text(encoding="utf-8")
        st, r = ask(port, "/company/daily-report", {"to": "lfh"}, TOK["tdh"])
        check(st == 200 and [(x["to"], x["ok"]) for x in r.get("sent") or []] == [("lfh", True)], "a trial to lfh: " + json.dumps(r, ensure_ascii=False))
        check(fake.writes[-1] == (botuid, "pub", "usr" + UID["lfh"]), "from TDH早报 to lfh: " + json.dumps(fake.writes[-1:]))
        check((runtime / "daily-report-state.json").read_text(encoding="utf-8") == state, "a trial is not today's report")
        check(ask(port, "/company/daily-report", {"to": "nobody"}, TOK["tdh"])[0] == 400, "a trial to someone not in the roster")
        check(ask(port, "/company/daily-report", {"to": "tdh"}, TOK["lfh"])[0] == 403, "admins only")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    text = log.read_text(encoding="utf-8", errors="replace")
    check("chat-read tdh read n=4" in text and "chat-read tdh search n=2" in text, "the log has the counts: " + text[-800:])
    for said in ("交货", "上午十点", "报价单", "私下", "图片"):
        check(said not in text, "the log never has what was said (%s)" % said)
    print("CHAT_READ_PROVE_OK=1")


if __name__ == "__main__":
    main()
