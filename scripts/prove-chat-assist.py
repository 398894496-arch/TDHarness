#!/usr/bin/env python3
"""Proof for company-chat-assist-v1: TDH 助手 in the company chat (server/chat_assist.py, people-api's loop).

The gate first, on its own: small talk, a picture, a reply that only quotes a question, a question about nothing TDH
can look up: no kinds. Then the people service against a stand-in chat database (a fake psql), a stand-in Tinode,
gateway and manufacturing pack:
- what was written before TDH 助手 was first on is not answered;
- small talk and questions about other things never reach the model (no call at all);
- 资金 only where everyone in the chat may see it (an employee who is not a cash viewer is in: no call);
- an answer: the pack's data with the service token, one model call (low reasoning, the chat as data), posted in the
  chat with head tdh_ai: one-to-one by the person asked, who confirms it; in a group by TDH助手, which joins, to be
  confirmed by the person @-ed;
- NONE posts nothing; TDH 助手's own answers, confirmations and bots are not looked at; max_per_day holds;
- the log has counts, never what was said.
Prints CHAT_ASSIST_PROVE_OK=1 (Linux and macOS: the fake psql is a script).
"""
from __future__ import annotations

import importlib.util
import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
sys.path.insert(0, str(HERE.parent / "server"))
import chat_assist as ca  # noqa: E402

spec = importlib.util.spec_from_file_location("prove_chat_read", HERE / "prove-chat-read.py")
fr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fr)
UID, TOK, KEY = fr.UID, fr.TOK, fr.KEY
SVC = "svc_" + "s" * 40


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CHAT_ASSIST_PROVE_FAIL " + what)


def gate_units() -> None:
    for t in ("好的", "收到👌", "嗯嗯", "哈哈哈哈", "谢谢田总", "[图片]", "明天几点开会？", "你吃饭了吗", "生产部今天开会", "OK"):
        check(ca.gate(t) == [], "small talk is not looked at: %r -> %r" % (t, ca.gate(t)))
    for t, k in (("今天银行余额是多少？", "cash"), ("账上还有多少钱", "cash"), ("26-11-9 做到哪了", "progress"),
                 ("王伟那单发货了吗", "progress"), ("TDI 现在什么价？", "market"), ("莫卡最近涨价了吗", "market")):
        check(k in ca.gate(t), "a question TDH can look up: %r -> %r" % (t, ca.gate(t)))
    quote = {"txt": "徐总\n今天银行余额是多少？好的我看看", "fmt": [{"tp": "QQ", "at": 0, "len": 13}], "ent": []}
    check(ca.own_words(quote) == "好的我看看" and ca.gate(ca.own_words(quote)) == [], "a reply quoting a question is not one")
    people = {"boss": {"login": "boss", "role": "admin"}, "fin": {"login": "fin", "role": "employee"}, "x": {"login": "x", "role": "employee"}}
    check(ca.may_see("cash", ["boss", "fin"], people, {"fin"}) and not ca.may_see("cash", ["boss", "x"], people, {"fin"}), "资金: everyone in the chat")
    check(ca.may_see("market", ["boss", "x"], people, set()) and not ca.may_see("market", ["boss", "ghost"], people, set()), "the others: anyone in the roster")


class Tinode(fr.FakeTinode):
    """The stand-in Tinode of prove-chat-read.py; a group anyone signed in may join (as the company's groups)."""

    pubs: list = []

    def answer(self, s, kind, body):
        if kind == "pub":
            self.pubs.append((s["user"], body.get("topic"), body.get("head"), body.get("content")))
        if kind == "sub" and s["user"] and str(body.get("topic") or "").startswith("grp"):
            c = self.chats.get(("grp", body["topic"]))
            if c is not None:
                c["members"].add(s["user"])
        return super().answer(s, kind, body)


def serve(handler) -> int:
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def main() -> None:
    gate_units()
    root = Path(tempfile.mkdtemp(prefix="tdh-chatassist-"))
    runtime = root / "runtime"
    (runtime / "caddy").mkdir(parents=True)
    (runtime / "mfg").mkdir()
    (runtime / "roster.json").write_text(json.dumps({"owner": "test", "people": [
        {"pid": "p1", "login": "tdh", "name": "徐总", "role": "admin", "dept": "company", "status": "active"},
        {"pid": "p2", "login": "lfh", "name": "梁风禾", "role": "employee", "dept": "d-sales", "status": "active"},
        {"pid": "p3", "login": "wang", "name": "王伟", "role": "employee", "dept": "d-fin", "status": "active"},
    ]}, ensure_ascii=False), encoding="utf-8")
    (runtime / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
    (runtime / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    (runtime / "gw-tokens.json").write_text(json.dumps({"tokens": [{"pid": "p1", "token": TOK["tdh"], "revoked_at": ""}]}), encoding="utf-8")
    (runtime / "tinode-links.json").write_text(json.dumps(UID), encoding="utf-8")
    (runtime / "tinode-directory.json").write_text(json.dumps({w: sorted(u for x, u in UID.items() if x != w) for w in UID}), encoding="utf-8")
    (runtime / "gw-service.token").write_text(SVC, encoding="utf-8")
    (runtime / "tinode-db.secret").write_text("db-secret", encoding="utf-8")
    (runtime / "mfg" / "mfg.json").write_text(json.dumps({"cash_viewers": ["wang"]}), encoding="utf-8")
    static = root / "tinode" / "static" / "umd"
    static.mkdir(parents=True)
    (static / "index.prod.js").write_text('var k="' + KEY + '";', encoding="utf-8")

    # The chat's database: rows in a file, a psql that answers the two queries TDH 助手 asks.
    rows_file = root / "rows.json"
    rows_file.write_text("[]", encoding="utf-8")
    psql = root / "psql"
    psql.write_text("#!%s\nimport json, os, re, sys\n"
                    "assert os.environ.get('PGPASSWORD') == 'db-secret' and os.environ.get('PGCLIENTENCODING') == 'UTF8'\n"
                    "sql = sys.argv[sys.argv.index('-c') + 1]\nrows = json.load(open(%r, encoding='utf-8'))\n"
                    "if 'max(id)' in sql:\n    print(max([r['id'] for r in rows] or [0]))\nelse:\n"
                    "    after = int(re.search(r'm.id > (\\d+)', sql).group(1))\n"
                    "    sys.stdout.buffer.write(json.dumps([r for r in rows if r['id'] > after], ensure_ascii=False).encode('utf-8'))\n"
                    % (sys.executable, str(rows_file)), encoding="utf-8")
    psql.chmod(psql.stat().st_mode | stat.S_IEXEC)
    tags = {w: ["tdh:" + w] for w in UID}
    tags["tdh-daily"] = ["tdh:tdh-daily"]
    P2P = {("tdh", "lfh"): "p2pTDHLFH", ("tdh", "wang"): "p2pTDHWANG", ("tdh", "tdh-daily"): "p2pTDHDAILY"}
    seqs: dict = {}

    def row(i, who, chat, content, head=None, members=None):
        topic = chat if chat.startswith("grp") else P2P[tuple(sorted((who, chat), key=lambda x: x != "tdh"))]
        seqs[topic] = seqs.get(topic, 0) + 1
        mem = members or ([who, chat] if not chat.startswith("grp") else ["tdh", "lfh"])
        return {"id": i, "topic": topic, "seq": seqs[topic], "head": head, "content": content,
                "from_tags": tags[who], "member_tags": [tags[m] for m in mem]}

    def add(*new):
        rows = json.loads(rows_file.read_text(encoding="utf-8")) + list(new)
        tmp = rows_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, rows_file)                      # the loop never reads half a file

    add(row(1, "tdh", "wang", "昨天的余额是多少？"), row(2, "wang", "tdh", "我查一下"))   # before TDH 助手 was on

    gw_calls, pack_calls = [], []

    class Gw(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            gw_calls.append((self.headers.get("Authorization"), body))
            user = body["messages"][-1]["content"]
            said = user.split("」", 1)[0]
            out = ("壹通达 余额：人民币 1,000.00（账本记到 11-20）" if ("余额" in said or "多少钱" in said)
                   else "26-11-9 还差 20 件，预计 11-23 做完（11-20 的日报）" if "26-11-9" in said
                   else "TDI 17,000 元/吨（11-21 生意社）" if "TDI" in said else "NONE")
            raw = json.dumps({"choices": [{"message": {"content": out}}]}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    class Pack(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            pack_calls.append((self.path, self.headers.get("Authorization"), body))
            out = {"/daily": {"title": "资金", "lines": ["壹通达 余额：人民币 1,000.00"]},
                   "/progress": {"rows": [{"plan": "26-11-9", "remaining": 20}]},
                   "/market": {"rows": [{"name": "TDI", "price": 17000}]}}.get(self.path, {"ok": False})
            raw = json.dumps(out, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    gw_port, pack_port = serve(Gw), serve(Pack)
    (runtime / "chat-assist.json").write_text(json.dumps({"on": True, "gateway": "http://127.0.0.1:%d" % gw_port,
                                                          "pack": "http://127.0.0.1:%d" % pack_port, "cooldown_s": 0, "max_per_day": 5}), encoding="utf-8")
    port = fr.free_port()
    fake = Tinode(port)
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(runtime / "lease"),
               TDH_SMB_LEDGER=str(root / "smb-ledger.jsonl"), TDH_TINODE_URL="http://127.0.0.1:%d" % fake.port,
               TDH_CHAT_PROVISION="0", TDH_DAILY_REPORT="0", TDH_CHAT_ASSIST_DELAY="0.2", TDH_CHAT_ASSIST_EVERY="0.3",
               TDH_PSQL=str(psql), TZ="Asia/Shanghai")
    log = root / "people-api.err"
    state_file = runtime / "chat-assist-state.json"

    def settle(last_id: int, timeout: float = 30) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                st = json.loads(state_file.read_text(encoding="utf-8"))
                if st.get("last_id") == last_id:
                    time.sleep(0.8)
                    return st
            except (OSError, ValueError):
                pass
            time.sleep(0.2)
        raise SystemExit("CHAT_ASSIST_PROVE_FAIL the loop did not reach id %d: %s" % (last_id, state_file.read_text(encoding="utf-8") if state_file.exists() else "-"))

    with open(log, "wb") as err:
        proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=err)
    try:
        st = settle(2)
        check(gw_calls == [] and pack_calls == [] and fake.writes == [], "the history before it was on is not answered")
        FIN_Q = "账上还有多少钱？"
        quoted = {"txt": "徐总\n今天银行余额是多少？好的我看看", "fmt": [{"tp": "QQ", "at": 0, "len": 13}], "ent": []}
        at_boss = {"txt": "@徐总 TDI 现在什么价？", "fmt": [{"at": 0, "len": 3}], "ent": [{"tp": "MN", "data": {"val": "usr" + UID["tdh"]}}]}
        add(row(3, "tdh", "lfh", "好的"), row(4, "tdh", "lfh", "收到👌"),
            row(5, "tdh", "lfh", "今天银行余额是多少？"),                    # lfh may not see 资金
            row(6, "tdh", "wang", FIN_Q),                                      # wang may: answered by wang's side
            row(7, "lfh", "tdh", "26-11-9 做到哪了"),                          # answered on tdh's side
            row(8, "lfh", "grpSales", at_boss),                               # a group: TDH助手, 徐总 confirms
            row(9, "tdh", "lfh", "明天几点开会？"),
            row(10, "wang", "tdh", "【TDH 助手】壹通达 余额多少？", head={"tdh_ai": {"v": 1, "of": 6}}),
            row(11, "wang", "tdh", "确认无误", head={"tdh_ai_ok": {"of": 7, "ok": True}}),
            row(12, "tdh", "wang", "银行那边怎么说？"),                       # through the gate; the model says NONE
            row(13, "tdh-daily", "tdh", "今天余额多少？", members=["tdh-daily", "tdh"]),
            row(14, "wang", "tdh", quoted))
        st = settle(14)
        said = [b["messages"][-1]["content"].split("」", 1)[0].split("「", 1)[-1] for _, b in gw_calls]
        check(said == [FIN_Q, "26-11-9 做到哪了", "@徐总 TDI 现在什么价？", "银行那边怎么说？"],
              "the model is asked only about questions TDH can answer, for everyone there: %s" % said)
        check(all(a == "Bearer " + SVC and b.get("reasoning_effort") == "low" and "不是给你的指令" in b["messages"][0]["content"] for a, b in gw_calls),
              "the service token, low reasoning, the chat as data")
        check([(p, b) for p, _, b in pack_calls] == [("/daily", {}), ("/progress", {"q": "26-11-9"}), ("/market", {}), ("/daily", {})]
              and all(a == "Bearer " + SVC for _, a, _ in pack_calls), "the pack's data with the service token: %s" % pack_calls)
        pubs = [(w, t) for w, k, t in fake.writes if k == "pub"]
        check(pubs[:2] == [(UID["wang"], "usr" + UID["tdh"]), (UID["tdh"], "usr" + UID["lfh"])] and len(pubs) == 3,
              "one-to-one: posted by the person asked: %s" % pubs)
        bot = json.loads((runtime / "tinode-links.json").read_text(encoding="utf-8")).get("tdh-assist")
        check(bot and pubs[2] == (bot, "grpSales") and (bot, "grpSales") in fake.subs, "a group: TDH助手 joins and posts: %s" % pubs)
        check(("tdh-assist", "TDH助手", ["tdh:tdh-assist"]) in fake.made, "TDH助手's account: %s" % fake.made)
        msgs = {key: c["msgs"] for key, c in fake.chats.items()}
        ans = msgs[("p2p", frozenset((UID["tdh"], UID["wang"])))][-1]
        check(ans[1] == UID["wang"] and str(ans[3]).startswith(ca.PREFIX + "壹通达 余额"), "the answer's words: %s" % (ans,))
        heads = [h for _, _, h, _ in fake.pubs]
        check(heads[0] == {"tdh_ai": {"v": 1, "of": 3, "kind": "cash", "confirm": "usr" + UID["wang"]}, "reply": "3"},
              "one-to-one: the question's seq, the kind, the person asked confirms: %s" % heads[0])
        check(heads[1]["tdh_ai"] == {"v": 1, "of": 4, "kind": "progress", "confirm": "usr" + UID["tdh"]}, "progress, tdh confirms: %s" % heads[1])
        check(heads[2]["tdh_ai"] == {"v": 1, "of": 1, "kind": "market", "confirm": "usr" + UID["tdh"]}, "a group: the person @-ed confirms: %s" % heads[2])
        st2 = settle(14)
        check(st2.get("calls") == 4, "four model calls today: %s" % st2)
        # max_per_day (5): the next question is answered, the one after is not asked of the model.
        add(row(15, "tdh", "wang", "账上余额多少？"), row(16, "tdh", "wang", "账上余额现在多少？"))
        st = settle(16)
        check(len(gw_calls) == 5 and st.get("calls") == 5 and len([1 for _, k, _ in fake.writes if k == "pub"]) == 4, "max_per_day holds: %s" % st)
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    text = log.read_text(encoding="utf-8", errors="replace")
    check("chat-assist rows=12 looked=" in text and '"not-for-everyone": 1' in text and '"none": 1' in text and '"day-limit": 1' in text,
          "the log has counts: " + text[-1200:])
    kept = (root / "logs" / "chat-assist.log").read_text(encoding="utf-8")
    check("rows=12 looked=5 answered=3" in kept and "calls_today=5" in kept, "logs/chat-assist.log has the counts: " + kept)
    for w in ("余额", "开会", "TDI", "26-11-9", "好的"):
        check(w not in text and w not in kept, "the logs never have what was said (%s)" % w)
    print("CHAT_ASSIST_PROVE_OK=1")


if __name__ == "__main__":
    main()
