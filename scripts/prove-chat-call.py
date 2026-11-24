#!/usr/bin/env python3
"""Proof for company-chat-call-v1 (server/chat_call.py, people-api's chat_call_for / chat_call_once / 转成任务卡).

server/chat_call.py, against stand-ins (recogniser, model gateway, Tinode's record of the call, the chat):
- nothing is taken while transcription is off (chat-voice.json, its "calls", the Model Studio key);
- a piece is taken only as a WAV of 0.3 to 65 seconds from about now, of one of two different people; one side's
  pieces are capped; a call whose minutes are made takes no more;
- each piece becomes words once and is dropped (the recording is not kept); a recogniser that fails is asked again,
  three times at most;
- the minutes wait for both sides' end (or two quiet minutes) and for Tinode's record to say the call is over;
  pieces of a call Tinode has no record of are dropped after a while; a call with no words gets no card;
- the words in order across the two sides, with who said what; the model gets them as data with the two names;
  what it gives is checked (short lines; to-dos only for one of the two, due times that read); a model that does not
  answer is asked again in two later rounds, then the card says the minutes are missing;
- the card is posted by the caller to the other one, head tdh_ai kind call-note with the call's id, and the two
  people as deciders only when there are to-dos; the minutes and the words go to 聊天文件/通话记录 for the summary
  and each of the two;
- the words are given to the call's two people and admins only.
people-api, in-process (its roster, chat accounts, chat and task board stood in for):
- chat_call_for: on / piece (the peer as a chat id, the recording as base64) / end / text; a chat id that is nobody's,
  or one's own, is refused;
- chat_call_once: a card with to-dos is remembered as TDH 助手's proposal under the chat's own topic name;
- 转成任务卡 from one of the two makes a card for each to-do, given by the other one (an employee who may not give
  work to the other: the owner's own), says so in the chat; 不用 makes none; anyone else's answer does nothing.
Prints CHAT_CALL_PROVE_OK=1.
"""
from __future__ import annotations

import base64
import importlib.util
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
import chat_assist  # noqa: E402
import chat_call as cc  # noqa: E402


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CHAT_CALL_PROVE_FAIL " + what)
    print("ok  " + what)


def utc(s: float) -> datetime:
    return datetime.fromtimestamp(s, timezone.utc).replace(tzinfo=None)


def wav(tag: bytes) -> bytes:
    return b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 24 + tag


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="tdh-chatcall-"))
    rt = root / "runtime"
    rt.mkdir()
    company = root / "company"
    office = company / "_office"
    people = {
        "boss": {"login": "boss", "name": "田总", "role": "admin", "personal": str(office), "status": "active"},
        "lfh": {"login": "lfh", "name": "梁风禾", "role": "employee", "personal": str(company / "emp-lfh"), "status": "active"},
        "wang": {"login": "wang", "name": "王伟", "role": "employee", "personal": str(company / "emp-wang"), "status": "active"},
    }
    now = time.time()
    ms_now = int(now * 1000)

    check(cc.call_id("wang", "lfh", 7) == "lfh~wang~7" and cc.parse_id("lfh~wang~7") == ("lfh", "wang", 7)
          and cc.parse_id("../x~y~1") is None and cc.parse_id("a~b~x") is None, "a call's id: the two logins in order and its seq")

    # Off until on, with a key.
    check(cc.put_piece(rt, "lfh", "wang", 7, ms_now, 2000, wav(b"1"), now) == (False, "off"), "nothing taken while off")
    (rt / "chat-voice.json").write_text(json.dumps({"on": True}), encoding="utf-8")
    check(cc.put_piece(rt, "lfh", "wang", 7, ms_now, 2000, wav(b"1"), now) == (False, "off"), "nothing taken without the key")
    (rt / "dashscope.key").write_text("sk-test-not-real", encoding="utf-8")
    (rt / "chat-voice.json").write_text(json.dumps({"on": True, "calls": False}), encoding="utf-8")
    check(not cc.on(rt), "calls: false keeps calls off")
    (rt / "chat-voice.json").write_text(json.dumps({"on": True}), encoding="utf-8")
    check(cc.on(rt), "on with chat-voice on and the key")

    # What a piece may be.
    bad = [("lfh", "lfh", 7, ms_now, 2000, wav(b"x")), ("lfh", "wang", 7, ms_now, 100, wav(b"x")), ("lfh", "wang", 7, ms_now, 70000, wav(b"x")),
           ("lfh", "wang", 7, ms_now - 7 * 3600 * 1000, 2000, wav(b"x")), ("lfh", "wang", 7, ms_now, 2000, b"not a wav"),
           ("lfh", "wang", 0, ms_now, 2000, wav(b"x")), ("../x", "wang", 7, ms_now, 2000, wav(b"x")),
           ("lfh", "wang", 7, ms_now, 2000, wav(b"x" * (cc.SEG_MAX_BYTES + 1)))]
    check(all(not cc.put_piece(rt, *b, now=now)[0] for b in bad), "odd pieces are refused (one's own call, length, time, not a WAV, seq, login, size)")
    check(not (rt / cc.DIR).exists() or not any((rt / cc.DIR).rglob("*.wav")), "nothing kept of them")

    # A call: lfh calls wang; three pieces from lfh, two from wang, out of order.
    t0 = ms_now - 300000
    for who, other, at, ms, tag in [("lfh", "wang", t0 + 1000, 3000, b"L1"), ("wang", "lfh", t0 + 5000, 4000, b"W1"),
                                    ("lfh", "wang", t0 + 10000, 2500, b"L2"), ("wang", "lfh", t0 + 14000, 6000, b"W2"), ("lfh", "wang", t0 + 21000, 2000, b"L3")]:
        check(cc.put_piece(rt, who, other, 7, at, ms, wav(tag), now) == (True, ""), "a piece of %s's side" % who)
    home = rt / cc.DIR / "lfh~wang~7"
    check(len(list((home / "pieces").glob("*.wav"))) == 5, "five pieces in, under one call")

    said = {b"L1": "王伟，报价单今天能发吗？", b"W1": "下午三点前发给你。", b"L2": "好，客户明天上午十点来厂验货。",
            b"W2": "那我明天九点半在门口等他们，样品我来准备。", b"L3": "行，就这么定。"}
    asked = {"rec": 0, "fail": 1}

    def rec(data, mime):
        asked["rec"] += 1
        if asked["fail"]:
            asked["fail"] -= 1
            raise OSError("recogniser down")
        return said[data[-2:]]
    record = {"state": "accepted", "ms": 0}

    def find(a, b, seq):
        if (a, b, seq) != ("lfh", "wang", 7):
            return None
        return {"topic": "p2pAAAABBBB", "from": "lfh", "at": utc((t0 - 2000) / 1000).strftime("%Y-%m-%dT%H:%M:%S"),
                "state": record["state"], "ms": record["ms"], "member_tags": [["tdh:lfh"], ["tdh:wang"]]}
    models = []
    answers = []

    def ask(cfg, token, system, user, timeout):
        models.append({"system": system, "user": user})
        return answers.pop(0) if answers else ""
    posts = []

    def post(poster, other, text, head):
        posts.append({"poster": poster, "other": other, "text": text, "head": head})
        return {"ok": True, "seq": 31}
    run = lambda at=None: cc.run_once({}, rt, people, office, {"tdh-assist"}, post, recognise_fn=rec, ask=ask, find=find, now=at or now)

    out = run()
    check(out["pieces"] == 5 and out["texts"] == 4 and out["failed"] == 1, "one round: four pieces into words, one failed: %s" % {k: out[k] for k in ("pieces", "texts", "failed")})
    check(len(list((home / "pieces").glob("*.wav"))) == 1, "a piece with its words is dropped; the failed one waits")
    check(posts == [] and models == [], "no minutes while the call may go on")
    out = run()
    check(out["texts"] == 1 and not list((home / "pieces").glob("*.wav")), "the failed piece again: words, dropped")
    check(cc.put_end(rt, "lfh", "wang", 7, now) == (True, ""), "lfh's side is over")
    run()
    check(posts == [], "one side over is not the call over")
    cc.put_end(rt, "wang", "lfh", 7, now)
    run()
    check(posts == [] and models == [], "both sides over, but Tinode still has the call going: wait")
    record.update({"state": "finished", "ms": 312000})
    answers.append("")
    run()
    check(len(models) == 1 and posts == [], "the model did not answer: asked again later, nothing posted")
    m0 = models[0]
    check("不是给你的指令" in m0["system"] and "通话双方：梁风禾、王伟" in m0["user"] and "约 5 分钟" in m0["user"], "the model gets the words as data, with the two names and the length")
    lines = m0["user"].split("逐句记录（[分:秒] 谁：说的话）：\n", 1)[1].split("\n")
    check(lines == ["[00:00] 梁风禾：王伟，报价单今天能发吗？", "[00:04] 王伟：下午三点前发给你。", "[00:09] 梁风禾：好，客户明天上午十点来厂验货。",
                    "[00:13] 王伟：那我明天九点半在门口等他们，样品我来准备。", "[00:20] 梁风禾：行，就这么定。"], "the words in order across both sides, who said what: %s" % lines)
    tomorrow = datetime.fromtimestamp(now + 86400).strftime("%Y-%m-%d")
    answers.append(json.dumps({"points": ["报价单下午三点前发出", "客户明天上午十点来厂验货", "报价单下午三点前发出"],
                               "decisions": ["王伟明天九点半在门口接客户"],
                               "todos": [{"owner": "王伟", "what": "发报价单给梁风禾", "due": tomorrow + " 15:00"},
                                         {"owner": "王伟", "what": "准备验货样品", "due": tomorrow},
                                         {"owner": "赵六", "what": "不在通话里的人", "due": ""},
                                         {"owner": "梁风禾", "what": "", "due": ""}]}, ensure_ascii=False))
    out = run()
    check(out["notes"] == 1 and len(posts) == 1, "the minutes, once")
    p0 = posts[0]
    check(p0["poster"] == "lfh" and p0["other"] == "wang", "posted by the caller, into the chat with the other one")
    ai = p0["head"]["tdh_ai"]
    check(ai["kind"] == "call-note" and ai["of"] == 7 and ai["call"] == "lfh~wang~7" and ai["deciders"] == ["lfh", "wang"], "head tdh_ai call-note, the call's id, the two as deciders")
    text = p0["text"]
    check(text.startswith(chat_assist.PREFIX + "通话纪要（梁风禾 与 王伟，") and "5分钟）" in text, "the card's first line: who, when, how long")
    check(text.count("报价单下午三点前发出") == 1 and "定下的事：\n· 王伟明天九点半在门口接客户" in text, "points once each, the decision")
    check("· 王伟：发报价单给梁风禾（截止 " in text and "15:00）" in text and "· 王伟：准备验货样品（截止 " in text and "赵六" not in text,
          "to-dos for the two only, with their due times")
    todos = out["posted"][0]["todos"]
    check(len(todos) == 2 and all(t["owner"] == "wang" for t in todos) and todos[0]["due"] > 0, "two to-dos kept for 转成任务卡: %s" % todos)
    got = sorted(p.relative_to(company).as_posix() for p in company.rglob("*.txt"))
    check(len(got) == 6 and all("/聊天文件/通话记录/" in g for g in got), "minutes and words, for the summary and each of the two: %s" % got)
    check(any(g.startswith("_office/聊天文件/通话记录/") and "/梁风禾 与 王伟/" in g and g.endswith("5分钟 纪要.txt") for g in got)
          and any(g.startswith("emp-lfh/聊天文件/通话记录/") and "/王伟/" in g for g in got)
          and any(g.startswith("emp-wang/聊天文件/通话记录/") and "/梁风禾/" in g and g.endswith("全文.txt") for g in got), "named by the chat, time, length")
    words = next(p for p in company.rglob("*全文.txt") if p.parts[-5] == "emp-lfh" or "emp-lfh" in p.as_posix()).read_text(encoding="utf-8")
    check("[00:13] 王伟：那我明天九点半在门口等他们" in words, "the words file has the conversation")
    note = next(p for p in company.rglob("*纪要.txt")).read_text(encoding="utf-8")
    check(note.startswith("通话纪要") and chat_assist.PREFIX not in note, "the minutes file without TDH 助手's label")
    check(cc.put_piece(rt, "lfh", "wang", 7, ms_now, 2000, wav(b"L9"), now) == (False, "over"), "a call with its minutes takes no more")
    out = run()
    check(out["notes"] == 0 and len(posts) == 1, "and is not posted twice")
    check(cc.words_for(rt, "lfh~wang~7", "wang")["words"].startswith("[00:00] 梁风禾") and cc.words_for(rt, "lfh~wang~7", "lfh")["note"] == text,
          "the two get the minutes and the words")
    check(cc.words_for(rt, "lfh~wang~7", "zhao") is None and cc.words_for(rt, "lfh~wang~7", "boss", admin=True) is not None
          and cc.words_for(rt, "lfh~wang~9", "lfh") is None, "nobody else does; an admin does; an unknown call: nothing")

    # A call with no to-dos: no deciders; a model that never answers: the card says so after three rounds.
    t1 = ms_now - 100000
    cc.put_piece(rt, "wang", "lfh", 8, t1, 2000, wav(b"W1"), now)
    record8 = {"topic": "p2pAAAABBBB", "from": "wang", "at": utc(t1 / 1000).strftime("%Y-%m-%dT%H:%M:%S"),
               "state": "finished", "ms": 30000, "member_tags": [["tdh:lfh"], ["tdh:wang"]]}
    find8 = lambda a, b, seq: record8 if seq == 8 else find(a, b, seq)
    run8 = lambda at: cc.run_once({}, rt, people, office, set(), post, recognise_fn=rec, ask=ask, find=find8, now=at)
    run8(now)
    check(len(posts) == 1, "one side's end not said: wait for the quiet")
    for i in range(3):
        run8(now + cc.QUIET_S + 1 + i)
    check(len(posts) == 2 and "纪要没生成出来" in posts[1]["text"] and "deciders" not in posts[1]["head"]["tdh_ai"] and posts[1]["poster"] == "wang",
          "two quiet minutes and three rounds without the model: a card that says so, no 转成任务卡")
    answers.append(json.dumps({"points": [], "decisions": [], "todos": []}))
    check(cc.card_text(cc.checked({"points": [], "decisions": [], "todos": []}, {}), {"a": "甲", "b": "乙"}, "a", "b", datetime(2026, 11, 24, 9, 5), 45000).endswith(
        "这次通话没有说到要记下的事。") and "45秒" in cc.card_text(None, {}, "a", "b", datetime(2026, 11, 24, 9, 5), 45000), "nothing to keep, and a short call, say so")
    answers.clear()

    # A call with no words: no card. Pieces of a call Tinode never had: dropped.
    asked["fail"] = 0
    said[b"E1"] = ""
    cc.put_piece(rt, "lfh", "wang", 9, ms_now - 60000, 2000, wav(b"E1"), now)
    record9 = dict(record8, from_="lfh")
    find9 = lambda a, b, seq: record9 if seq == 9 else None
    cc.put_end(rt, "lfh", "wang", 9, now)
    cc.put_end(rt, "wang", "lfh", 9, now)
    cc.run_once({}, rt, people, office, set(), post, recognise_fn=rec, ask=ask, find=find9, now=now)
    check(len(posts) == 2 and json.loads((rt / cc.DIR / "lfh~wang~9" / "call.json").read_text(encoding="utf-8")).get("empty"), "a call with no words: no card")
    cc.put_piece(rt, "lfh", "boss", 11, ms_now, 2000, wav(b"L1"), now)
    cc.put_end(rt, "lfh", "boss", 11, now)
    cc.put_end(rt, "boss", "lfh", 11, now)
    cc.run_once({}, rt, people, office, set(), post, recognise_fn=rec, ask=ask, find=lambda a, b, s: None, now=now + 60)
    check((rt / cc.DIR / "boss~lfh~11").is_dir(), "a call Tinode has no record of (yet) is kept a while")
    out = cc.run_once({}, rt, people, office, set(), post, recognise_fn=rec, ask=ask, find=lambda a, b, s: None, now=now + cc.LOST_S + 5)
    check(out["dropped"] == 1 and not (rt / cc.DIR / "boss~lfh~11").exists() and len(posts) == 2, "then dropped, nothing posted")

    # find_call reads Tinode's record (a stand-in psql).
    sqls = []

    def fake_psql(cfg, runtime, sql):
        sqls.append(sql)
        return json.dumps([
            {"topic": "p2pXXXX", "seq": 7, "head": {"webrtc": "started"}, "at": "2026-11-24T02:00:00", "from_tags": ["tdh:boss"],
             "member_tags": [["tdh:boss"], ["tdh:wang"]], "later": [{"replace": ":7", "webrtc": "finished", "webrtc-duration": 9}]},
            {"topic": "p2pAAAABBBB", "seq": 7, "head": {"webrtc": "started", "aonly": True}, "at": "2026-11-24T02:00:00", "from_tags": ["tdh:lfh"],
             "member_tags": [["tdh:lfh"], ["tdh:wang"]], "later": [{"replace": ":7", "webrtc": "accepted"}, {"replace": ":7", "webrtc": "finished", "webrtc-duration": 312000}]}])
    saved = chat_assist.psql
    chat_assist.psql = fake_psql
    got = cc.find_call({}, rt, "lfh", "wang", 7)
    chat_assist.psql = saved
    check(got["topic"] == "p2pAAAABBBB" and got["from"] == "lfh" and got["state"] == "finished" and got["ms"] == 312000,
          "Tinode's record: the chat of exactly these two, the state of the last replacing message: %s" % {k: got[k] for k in ("topic", "from", "state", "ms")})
    check("m.seqid = 7" in sqls[0] and "p2p" in sqls[0] and "webrtc" in sqls[0], "asked by seq, one-to-one chats, call messages")

    prove_people_api(root, people)
    print("CHAT_CALL_PROVE_OK=1")


def prove_people_api(root: Path, people: dict) -> None:
    rt = root / "runtime"
    os.environ.update({"TDH_ROOT": str(root), "TDH_GW_TOKENS": str(rt / "gw-tokens.json"), "TDH_TICKETS": str(rt / "tickets.json"),
                       "TDH_COMPANY": str(root / "company"), "TDH_ROSTER": str(rt / "roster.json")})
    spec = importlib.util.spec_from_file_location("people_api_call", HERE.parent / "server" / "people-api.py")
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    links = {"lfh": "AAA111", "wang": "BBB222", "boss": "CCC333"}
    api._tinode_links = lambda: dict(links)
    api.people_by_login = lambda: people
    api.person = lambda login: people.get(login)
    posted = []
    api.chat_post = lambda sender, topic, content, head=None, ua="": (posted.append({"sender": sender, "topic": topic, "content": content, "head": head}) or {"ok": True, "seq": 40 + len(posted)})

    st, body = api.chat_read_for("lfh", "call", {"op": "on"})
    check(st == 200 and body == {"ok": True, "on": True}, "on: whether calls are transcribed")
    piece = base64.b64encode(wav(b"P1")).decode()
    now_ms = int(time.time() * 1000)
    st, body = api.chat_read_for("lfh", "call", {"op": "piece", "peer": "usrBBB222", "seq": 21, "at": now_ms, "ms": 2000, "wav": piece})
    check(st == 200 and body == {"ok": True} and (rt / "chat-calls" / "lfh~wang~21" / "pieces").is_dir(), "a piece, the peer by chat id")
    check(api.chat_read_for("lfh", "call", {"op": "piece", "peer": "usrNOBODY", "seq": 21, "at": now_ms, "ms": 2000, "wav": piece})[0] == 400
          and api.chat_read_for("lfh", "call", {"op": "piece", "peer": "usrAAA111", "seq": 21, "at": now_ms, "ms": 2000, "wav": piece})[0] == 400,
          "a chat id that is nobody's, or one's own: refused")
    check(api.chat_read_for("lfh", "call", {"op": "piece", "peer": "usrBBB222", "seq": 21, "at": now_ms, "ms": 2000, "wav": "%%%"})[0] == 400,
          "a body that is not base64: refused")
    check(api.chat_read_for("lfh", "call", {"op": "end", "peer": "usrBBB222", "seq": 21}) == (200, {"ok": True}), "end")
    check(api.chat_read_for("wang", "call", {"op": "text", "id": "lfh~wang~7"})[1]["ok"] is True
          and api.chat_read_for("wang", "call", {"op": "text", "id": "boss~lfh~3"})[1] == {"ok": False, "error": "not-found"}
          and api.chat_read_for("boss", "call", {"op": "text", "id": "lfh~wang~7"})[1]["ok"] is True, "text: the two, an admin; not another's call")

    # chat_call_once remembers the to-dos; 转成任务卡.
    todo_due = int((time.time() + 86400) * 1000)
    fake = {"pieces": 1, "texts": 1, "failed": 0, "notes": 1, "dropped": 0,
            "posted": [{"cid": "lfh~wang~30", "topic": "p2pAAAABBBB", "seq": 55, "a": "lfh", "b": "wang", "caller": "lfh", "when": "11-24 10:05",
                        "poster": "lfh", "post_to": "wang", "todos": [{"owner": "wang", "what": "发报价单", "due": todo_due}, {"owner": "lfh", "what": "安排验货", "due": 0}]}]}
    saved = api.chat_call.run_once
    api.chat_call.run_once = lambda *a, **k: json.loads(json.dumps(fake))
    api.chat_call_once()
    api.chat_call.run_once = saved
    state = chat_assist.load_state(rt)
    pend = state["pending"]["p2pAAAABBBB:55"]
    check(pend["type"] == "call-todos" and pend["deciders"] == ["lfh", "wang"] and pend["post_topic"] == "usrBBB222", "the to-dos remembered under the chat's own name")
    out = {}
    api._assist_decided(state, "p2pAAAABBBB", "boss", {"of": 55, "ok": True}, people, out)
    check("p2pAAAABBBB:55" in state["pending"] and not out, "anyone else's 转成任务卡 does nothing")
    api._assist_decided(state, "p2pAAAABBBB", "wang", {"of": 55, "ok": True}, people, out)
    cards = json.loads((rt / "tickets.json").read_text(encoding="utf-8"))["tickets"]
    by = {c["title"]: c for c in cards}
    check(out.get("cards") == 2 and set(by) == {"发报价单", "安排验货"}, "a card for each to-do: %s" % out)
    check(by["发报价单"]["to"] == "wang" and by["发报价单"]["from"] == "wang" and by["安排验货"]["from"] == "lfh",
          "employees: each one's own card (an employee may not give work to another)")
    check("语音通话纪要" in by["发报价单"]["assignment"] and by["发报价单"]["due"] == todo_due, "saying where it came from, with the due time")
    last = posted[-1]
    check(last["sender"] == "lfh" and last["topic"] == "usrBBB222" and "已记成 2 张任务卡" in last["content"] and last["head"]["tdh_ai"]["kind"] == "task-made",
          "said in the chat by the one who posted the minutes")
    check("p2pAAAABBBB:55" not in state["pending"], "answered once")
    state["pending"]["p2pAAAABBBB:56"] = dict(pend, seq=56)
    out = {}
    api._assist_decided(state, "p2pAAAABBBB", "lfh", {"of": 56, "ok": False}, people, out)
    check(out == {"declined": 1} and len(json.loads((rt / "tickets.json").read_text(encoding="utf-8"))["tickets"]) == 2, "不用: no card")
    # An admin in the call gives the other one the card.
    state["pending"]["p2pCCCCAAAA:57"] = dict(pend, seq=57, a="boss", b="lfh", todos=[{"owner": "lfh", "what": "对账", "due": 0}], deciders=["boss", "lfh"])
    api._assist_decided(state, "p2pCCCCAAAA", "boss", {"of": 57, "ok": True}, people, {})
    c = next(c for c in json.loads((rt / "tickets.json").read_text(encoding="utf-8"))["tickets"] if c["title"] == "对账")
    check(c["from"] == "boss" and c["to"] == "lfh", "an admin's call: the card is given by the admin")


if __name__ == "__main__":
    main()
