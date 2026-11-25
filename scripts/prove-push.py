#!/usr/bin/env python3
"""Proof for company-phone-push-v1 (server/push.py, server/apns-send.js, company-shell's AI-done hook).

server/push.py with fakes for the database, the chat's messages and the sending (nothing reaches Apple):
- a phone's registration: a token is one person's; the same phone (its app's device id) signed in by someone else
  moves to them, a token held for another phone is refused, and turning off only forgets one's own;
- the first round only takes its place (no backlog); a colleague's message is pushed to the other members with
  phones, with their unread count as the badge, not to the sender, not to a bot;
- the database failing to count: the message still goes, without a badge; failing harder (an unexpected error): the
  round's place does not move, so the next round pushes the same messages;
- read elsewhere: a silent push with no Apple badge ("b" is the count) and the chats read; moves gather and go at
  most every 10 s per person; a round that already sends that person a message keeps the moves for later (not lost);
server/apns-send.js (a throwaway P-256 key; no items → no key read, no network):
- the provider token is reused from token_cache within 50 minutes, renewed after, and for another key id;
company-shell addAiDonePush (fake kernel events):
- a long turn's end posts ai-done; not while a desk window was seen in the last minute; not for a stopped turn.
Prints PUSH_PROVE_OK=1.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "server"))
import push  # noqa: E402

T1 = "a" * 64
T2 = "b" * 64
T3 = "c" * 64


def check(cond: bool, what: str) -> None:
    if not cond:
        print("FAIL " + what)
        sys.exit(1)
    print("ok   " + what)


def prove_register(rt: Path) -> None:
    check(push.register(rt, "zhang", "xyz", "sandbox")["error"] == "bad-token", "a malformed token is refused")
    push.register(rt, "zhang", T1, "production", True, "dev-1")
    d = push.devices(rt)
    check(d["zhang"][0]["token"] == T1 and d["zhang"][0]["device"] == "dev-1" and d["zhang"][0]["env"] == "production",
          "a phone is kept with its env and device id")
    got = push.register(rt, "li", T1, "production", True, "dev-9")
    check(got == {"ok": False, "error": "token-taken"} and "li" not in push.devices(rt),
          "another person cannot take a token held for another phone")
    got = push.register(rt, "li", T1, "production", True, "")
    check(got.get("error") == "token-taken", "nor without a device id")
    push.register(rt, "li", T1, "production", False, "dev-9")
    check(push.devices(rt).get("zhang", [{}])[0].get("token") == T1, "turning off someone else's token leaves it")
    push.register(rt, "li", T1, "production", True, "dev-1")
    d = push.devices(rt)
    check("zhang" not in d and d["li"][0]["token"] == T1, "the same phone signed in by someone else moves to them")
    push.register(rt, "li", T1, "production", False, "dev-1")
    check("li" not in push.devices(rt), "turning off one's own forgets it")


class Fake:
    def __init__(self) -> None:
        self.rows: list = []
        self.read = {}       # (login, topic) -> readseq
        self.seq = {}        # topic -> seq
        self.members = {}    # topic -> [login]
        self.count_error = None
        self.sent: list = []

    def psql(self, cfg, runtime, sql):
        if "json_agg(u.tags)" in sql:
            topic = sql.split("'")[-2]
            return json.dumps([["tdh:" + m] for m in self.members.get(topic, [])])
        if self.count_error:
            raise self.count_error
        out = []
        for topic, ms in self.members.items():
            for m in ms:
                if "'tdh:%s'" % m not in sql:
                    continue
                out.append({"tags": ["tdh:" + m], "topic": topic, "r": self.read.get((m, topic), 0), "q": self.seq.get(topic, 0)})
        return json.dumps(out)

    def fetch(self, cfg, runtime, after, limit):
        return [r for r in self.rows if r["id"] > after][:limit]

    def max_id(self, cfg, runtime):
        return max([r["id"] for r in self.rows] or [0])

    def say(self, mid: int, topic: str, sender: str, text: str) -> None:
        self.seq[topic] = self.seq.get(topic, 0) + 1
        self.read[(sender, topic)] = self.seq[topic]
        self.rows.append({"id": mid, "topic": topic, "seq": self.seq[topic], "head": None, "content": text,
                          "from_tags": ["tdh:" + sender], "member_tags": [["tdh:" + m] for m in self.members[topic]],
                          "topic_public": {"fn": "生产群"}})


def login_of(tags) -> str:
    return next((t[4:] for t in (tags or []) if isinstance(t, str) and t.startswith("tdh:")), "")


def prove_rounds(rt: Path) -> None:
    f = Fake()
    f.members = {"grpWORK": ["zhang", "li", "wang", "bot"], "p2pZL": ["zhang", "li"]}
    push.send = lambda runtime, apns, items, node=None: f.sent.extend(items) or []
    push.register(rt, "zhang", T1, "sandbox", True, "dev-z")
    push.register(rt, "li", T2, "sandbox", True, "dev-l")
    push.register(rt, "bot", T3, "sandbox", True, "dev-b")
    people = {"zhang": {"name": "张三"}, "li": {"name": "李四"}, "wang": {"name": "王五"}}
    links = {"zhang": "ZZ", "li": "LL"}
    state: dict = {}

    def rnd(now: float) -> dict:
        return push.chat_round({}, rt, {"key_file": "x"}, people, links, {"bot"}, f.psql, f.fetch, f.max_id, login_of,
                               state, now=now)

    f.say(1, "grpWORK", "wang", "旧消息")
    f.seq["p2pZL"], f.read[("li", "p2pZL")] = 1, 1  # li wrote to zhang long ago, still unread
    got = rnd(1000)
    check("started" in got and not f.sent and state["last"] == 1, "the first round takes its place, no backlog")

    rnd(1001)  # counts seen once: the read marks' starting point
    f.say(2, "grpWORK", "wang", "今天下午三点开会")
    rnd(1002)
    to = {x["login"]: x for x in f.sent}
    check(set(to) == {"zhang", "li"}, "a group message goes to the members with phones (not the sender, not a bot)")
    aps = to["zhang"]["payload"]["aps"]
    check(aps["alert"] == {"title": "生产群", "body": "王五：今天下午三点开会"} and aps["badge"] == 3
          and aps["thread-id"] == "grpWORK" and to["zhang"]["payload"]["seq"] == 2, "title, words, badge, thread, seq")
    check(state["last"] == 2, "the place moves past it")

    f.sent.clear()
    f.say(3, "grpWORK", "wang", "在吗")
    f.count_error = RuntimeError("psql down")
    rnd(1003)
    check(len(f.sent) == 2 and all("badge" not in x["payload"]["aps"] for x in f.sent),
          "the count failing: the message still goes, without a badge")
    check(state["last"] == 3, "and its place moves")

    f.sent.clear()
    f.say(4, "grpWORK", "wang", "收到请回复")
    f.count_error = KeyError("unexpected")
    try:
        rnd(1004)
        raised = False
    except KeyError:
        raised = True
    check(raised and state["last"] == 3 and not f.sent, "an unexpected failure leaves the place where it was")
    f.count_error = None
    rnd(1005)
    check({x["login"] for x in f.sent if x["kind"] == "chat"} == {"zhang", "li"} and state["last"] == 4,
          "so the next round pushes the same message")

    # Read elsewhere (the desk): zhang reads the group.
    f.sent.clear()
    f.read[("zhang", "grpWORK")] = f.seq["grpWORK"]
    rnd(1020)
    reads = [x for x in f.sent if x["kind"] == "read"]
    check(len(reads) == 1 and reads[0]["login"] == "zhang" and reads[0]["type"] == "background",
          "read on the desk: one silent push to that person")
    p = reads[0]["payload"]
    check(p["aps"] == {"content-available": 1} and p["b"] == 1 and p["r"] == [["grpWORK", 4]],
          "no Apple badge on a silent push; the count is \"b\", the chats read are \"r\"")

    f.sent.clear()
    f.read[("zhang", "p2pZL")] = f.seq["p2pZL"]
    rnd(1023)
    check(not [x for x in f.sent if x["kind"] == "read"], "another read 3 s later waits (at most one every 10 s)")
    rnd(1031)
    reads = [x for x in f.sent if x["kind"] == "read"]
    check(len(reads) == 1 and reads[0]["payload"]["r"] == [["usrLL", 1]] and reads[0]["payload"]["b"] == 0,
          "and goes 10 s after the last, one-to-one chats named as the phone names them")

    # A read move in a round that also sends that person a message: kept, not dropped.
    f.sent.clear()
    f.read[("li", "grpWORK")] = f.seq["grpWORK"]
    f.say(5, "p2pZL", "zhang", "好的")
    rnd(1050)
    check([x["kind"] for x in f.sent if x["login"] == "li"] == ["chat"], "a round with a message for li: no read push yet")
    check(not [x for x in f.sent if x["login"] == "zhang"], "the sender's own read mark moving is no news to their phone")
    f.sent.clear()
    rnd(1052)
    reads = [x for x in f.sent if x["kind"] == "read" and x["login"] == "li"]
    check(len(reads) == 1 and ["grpWORK", 4] in reads[0]["payload"]["r"], "the read move goes in the next round")


def prove_token_cache(tmp: Path) -> None:
    node = shutil.which("node")
    if not node:
        print("skip apns-send.js (no node)")
        return
    key = tmp / "k.p8"
    subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(tmp / "ec.pem")], check=True)
    subprocess.run(["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", str(tmp / "ec.pem"), "-out", str(key)], check=True)
    cache = tmp / "apns-token.json"
    send_js = str(ROOT / "server" / "apns-send.js")

    def run(job: dict) -> dict:
        r = subprocess.run([node, send_js], input=json.dumps(job), capture_output=True, text=True, timeout=30)
        return json.loads(r.stdout.strip().splitlines()[-1])

    got = run({"key_file": str(tmp / "missing.p8"), "items": []})
    check(got == {"ok": True, "results": []}, "no items: nothing read, nothing sent")
    job = {"key_file": str(key), "key_id": "KEY1", "team_id": "TEAM", "token_cache": str(cache), "token_only": True}
    a = run(job)
    c1 = json.loads(cache.read_text())
    b = run(job)
    check(a["ok"] and a["iat"] == b["iat"] and json.loads(cache.read_text())["jwt"] == c1["jwt"],
          "the provider token is reused (Apple refuses one more often than every 20 minutes)")
    check(set(c1) == {"kid", "team", "iat", "jwt"} and "PRIVATE" not in cache.read_text(), "the cache holds no key")
    c1["iat"] -= 51 * 60
    cache.write_text(json.dumps(c1))
    c = run(job)
    check(c["iat"] > c1["iat"] + 50 * 60, "renewed after 50 minutes")
    d = run(dict(job, key_id="KEY2"))
    check(json.loads(cache.read_text())["kid"] == "KEY2" and d["ok"], "and for another key")


def prove_ai_hook() -> None:
    node = shutil.which("node")
    if not node:
        print("skip addAiDonePush (no node)")
        return
    js = r"""
const m = await import(process.argv[1]);
const out = {};
function run(seen, kind) {
  let on; const sent = [];
  m.addAiDonePush({ on: (n, f) => { on = f; } }, (b) => { sent.push(b); return Promise.resolve(); }, () => seen);
  const real = Date.now; const t = real();
  const s = { id: "sess-1", header: { title: "报价单" } };
  Date.now = () => t; on(s, { type: "turn/start" });
  on(s, { type: "assistant/message", data: { content: [{ type: "text", text: "已经整理好了" }] } });
  Date.now = () => t + 20000; on(s, { type: "turn/end", data: { reason: { kind } } });
  Date.now = real;
  return { sent, t };
}
const away = run(0, "stop");
out.away = away.sent;
const at = run(Date.now() + 19000, "stop");
out.atDesk = at.sent.length;
out.stopped = run(0, "aborted").sent.length;
console.log(JSON.stringify(out));
"""
    path = (ROOT / "desk" / "plugins" / "company-shell" / "lib" / "index.js").as_uri()
    r = subprocess.run([node, "--input-type=module", "-e", js, path], capture_output=True, text=True, timeout=60)
    got = json.loads(r.stdout.strip().splitlines()[-1])
    check(len(got["away"]) == 1 and got["away"][0]["session"] == "sess-1" and got["away"][0]["title"] == "报价单"
          and got["away"][0]["preview"] == "已经整理好了" and got["away"][0]["reason"] == "done",
          "a long turn's end with no desk window in front: ai-done with the title and first words")
    check(got["atDesk"] == 0, "a desk window seen in the last minute: no push")
    check(got["stopped"] == 0, "a stopped turn: no push")


def main() -> None:
    with tempfile.TemporaryDirectory() as d:
        rt = Path(d) / "runtime"
        rt.mkdir()
        prove_register(rt)
        prove_rounds(rt)
        prove_token_cache(Path(d))
    prove_ai_hook()
    print("PUSH_PROVE_OK=1")


if __name__ == "__main__":
    main()
