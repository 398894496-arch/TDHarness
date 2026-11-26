#!/usr/bin/env python3
"""Proof for company-chat-voice-v1 (server/chat_voice.py, chat_read.py): voice messages into words, kept.

Against a stand-in chat database and a stand-in recogniser (a local HTTP server speaking Model Studio's OpenAI-compatible
chat completions):
- off until runtime/chat-voice.json says on, and until runtime/dashscope.key is there; nothing is advanced while off;
- the request: POST <base>/chat/completions, the key as Bearer, model qwen3-asr-flash, the recording inline as a
  data URI (audio/wav;base64), asr_options; the answer's text is the message's words;
- a voice message's words are kept by its recording's file name (the page sees a one-to-one chat as usr<id>, the
  database as p2p<ids>); only the chat's members, or an admin, get them; another person gets nothing;
- the recording and its words go to 聊天文件/语音 in the summary and each member's folder, named by time, sender, length;
- a recording the recogniser fails on is tried again in later rounds, three times at most; a second round with
  nothing new changes nothing; an edit (head.replace) is not a new voice message;
- the agent reads a voice message as 「[语音 N秒] <words>」 (chat_read.plain);
- company-chat-voice-gist-v1: one of 30 seconds or more, or of 80 characters or more, gets a gist from the model
  gateway (its request: the chat assistant's model, the service token, the words as data), kept and given with the
  words; a short one is not sent to the model; no gist when the gateway does not answer, the words all the same.
Prints CHAT_VOICE_PROVE_OK=1.
"""
from __future__ import annotations

import base64
import json
import re
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
import chat_assist  # noqa: E402
import chat_read  # noqa: E402
import chat_voice as cv  # noqa: E402


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CHAT_VOICE_PROVE_FAIL " + what)
    print("ok  " + what)


WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 24


class Rec(BaseHTTPRequestHandler):
    seen: list = []
    fail = 0
    answer = None

    def log_message(self, *a):  # quiet
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
        Rec.seen.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
        if Rec.fail:
            Rec.fail -= 1
            self.send_response(500)
            self.end_headers()
            return
        out = json.dumps({"choices": [{"message": {"role": "assistant", "content": Rec.answer or "明天上午十点开会，带上报价单。"}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main() -> None:
    check(cv.ref_key("/v0/file/s/3XN1J4w9p5M.wav") == "3XN1J4w9p5M.wav", "a recording's key is its file name")
    check(cv.ref_key("../../etc/passwd") == "passwd" and cv.ref_key("a b c.wav") == "" and cv.ref_key("x") == "" and cv.ref_key("") == "",
          "only a file name is ever a key, an odd one is none")

    root = Path(tempfile.mkdtemp(prefix="tdh-chatvoice-"))
    rt = root / "runtime"
    rt.mkdir()
    company = root / "company"
    office = company / "_office"
    (root / "up").mkdir()
    (root / "up" / "a1").write_bytes(WAV + b"one")
    (root / "up" / "a2").write_bytes(WAV + b"two")
    people = {
        "boss": {"login": "boss", "name": "徐总", "role": "admin", "personal": str(office), "status": "active"},
        "lfh": {"login": "lfh", "name": "梁风禾", "role": "employee", "personal": str(company / "emp-lfh"), "status": "active"},
        "wang": {"login": "wang", "name": "王伟", "role": "employee", "personal": str(company / "emp-wang"), "status": "active"},
        "zhao": {"login": "zhao", "name": "赵六", "role": "employee", "personal": str(company / "emp-zhao"), "status": "active"},
    }
    tag = lambda w: ["tdh:" + w]
    au = lambda ref, ms: {"txt": " ", "fmt": [{"at": 0, "len": 1, "key": 0}],
                          "ent": [{"tp": "AU", "data": {"mime": "audio/wav", "duration": ms, "ref": ref, "preview": "AAA=", "size": 40}}]}
    db = [
        {"id": 3, "topic": "p2pAAAABBBB", "seq": 7, "at": "2026-11-24T02:05:00", "head": {}, "content": au("/v0/file/s/VoiceOne111.wav", 6400),
         "from_tags": tag("lfh"), "member_tags": [tag("lfh"), tag("wang")], "files": [{"loc": str(root / "up" / "a1")}], "topic_public": None},
        {"id": 5, "topic": "grpTeam", "seq": 12, "at": "2026-11-24T02:06:00", "head": {}, "content": au("/v0/file/s/VoiceTwo222.wav", 2100),
         "from_tags": tag("wang"), "member_tags": [tag("wang"), tag("lfh"), tag("boss")], "files": [{"loc": str(root / "up" / "a2")}],
         "topic_public": {"fn": "报价群"}},
        {"id": 6, "topic": "grpTeam", "seq": 13, "at": "2026-11-24T02:07:00", "head": {"replace": ":12"}, "content": au("/v0/file/s/VoiceTwo222.wav", 2100),
         "from_tags": tag("wang"), "member_tags": [tag("wang"), tag("lfh"), tag("boss")], "files": [], "topic_public": {"fn": "报价群"}},
    ]
    top = {"n": 6}

    def fake_psql(cfg, runtime, sql):
        m = re.search(r"m\.id > (\d+) and m\.id <= (\d+)", sql)
        lo, hi = int(m.group(1)), int(m.group(2))
        return json.dumps([r for r in db if lo < r["id"] <= hi])

    chat_assist.psql = fake_psql
    chat_assist.max_id = lambda cfg, runtime: top["n"]

    srv = HTTPServer(("127.0.0.1", 0), Rec)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/compatible-mode/v1" % srv.server_port
    gists = []

    def gist_fn(text):
        gists.append(text)
        return "明早十点开会，带报价单" if "会" in text else ""
    run = lambda: cv.run_once({}, rt, people, office, {"tdh-daily", "tdh-assist"}, gist_fn=gist_fn)

    # Off until configured.
    check(run() == {"off": "conf"}, "off without chat-voice.json")
    (rt / "chat-voice.json").write_text(json.dumps({"on": True, "base": base}), encoding="utf-8")
    check(run() == {"off": "no-key"}, "off without the Model Studio key")
    check(not (rt / cv.STATE).exists(), "nothing advanced while off")
    (rt / "dashscope.key").write_text("sk-test-not-real\n", encoding="utf-8")

    # One round: both voice messages; the recogniser fails the first try of the first one.
    Rec.fail = 1
    out = run()
    check(out["voices"] == 2 and out["texts"] == 1 and out["failed"] == 1, "first round: one recognised, one failed: %s" % out)
    r0 = Rec.seen[0]
    check(r0["path"] == "/compatible-mode/v1/chat/completions" and r0["auth"] == "Bearer sk-test-not-real", "the key as Bearer, chat completions")
    b = r0["body"]
    part = b["messages"][0]["content"][0]
    check(b["model"] == "qwen3-asr-flash" and part["type"] == "input_audio" and b.get("asr_options", {}).get("enable_itn") is True,
          "model qwen3-asr-flash, an input_audio part, asr_options")
    check(part["input_audio"]["data"].startswith("data:audio/wav;base64,")
          and base64.b64decode(part["input_audio"]["data"].split(",", 1)[1]) == WAV + b"one", "the recording inline as a data URI")
    st = json.loads((rt / cv.STATE).read_text(encoding="utf-8"))
    check(st["last_id"] == 6 and st["retry"] == {"3": 1}, "the failed one is kept for another try: %s" % st)

    # Second round: the failed one again, nothing else new.
    out = run()
    check(out["voices"] == 1 and out["texts"] == 1 and out["failed"] == 0, "second round: the failed one recognised: %s" % out)
    check(json.loads((rt / cv.STATE).read_text(encoding="utf-8"))["retry"] == {}, "nothing left to try")
    n_calls = len(Rec.seen)
    out = run()
    check(out["voices"] == 0 and len(Rec.seen) == n_calls, "a round with nothing new asks nothing")

    # Who gets the words.
    w = "明天上午十点开会，带上报价单。"
    check(cv.text_for(rt, "/v0/file/s/VoiceOne111.wav", "lfh") == {"text": w, "ms": 6400}, "a member of the chat gets the words")
    check(gists == [], "short voice messages are not sent to the model")
    check(cv.text_for(rt, "/v0/file/s/VoiceOne111.wav", "wang")["text"] == w, "the other member too")
    check(cv.text_for(rt, "/v0/file/s/VoiceOne111.wav", "zhao") is None, "someone outside the chat gets nothing")
    check(cv.text_for(rt, "/v0/file/s/VoiceOne111.wav", "zhao", admin=True)["text"] == w, "an admin gets them")
    check(cv.text_for(rt, "/v0/file/s/Unknown0000.wav", "lfh") is None, "an unknown recording: nothing (yet)")

    # Kept on the disk.
    got = sorted(p.relative_to(company).as_posix() for p in company.rglob("*") if p.is_file())
    want = [
        "_office/聊天文件/语音/2026-11/报价群/%s 王伟 语音 2秒.txt",
        "_office/聊天文件/语音/2026-11/报价群/%s 王伟 语音 2秒.wav",
        "_office/聊天文件/语音/2026-11/梁风禾 与 王伟/%s 梁风禾 语音 6秒.txt",
        "_office/聊天文件/语音/2026-11/梁风禾 与 王伟/%s 梁风禾 语音 6秒.wav",
    ]
    check(any(g.startswith("_office/聊天文件/语音/2026-11/梁风禾 与 王伟/") and g.endswith("梁风禾 语音 6秒.wav") for g in got), "the summary has the one-to-one recording")
    check(any(g.startswith("emp-lfh/聊天文件/语音/2026-11/王伟/") and g.endswith(".txt") for g in got)
          and any(g.startswith("emp-wang/聊天文件/语音/2026-11/梁风禾/") for g in got), "each member has it under the other person's name")
    check(any(g.startswith("emp-lfh/聊天文件/语音/2026-11/报价群/") for g in got) and not any(g.startswith("emp-zhao/") for g in got),
          "the group's recording for its members only")
    txt = next(p for p in company.rglob("*.txt") if "梁风禾 语音" in p.name)
    check(txt.read_text(encoding="utf-8").strip() == w and txt.with_suffix(".wav").read_bytes() == WAV + b"one", "the recording and its words side by side")
    del want

    # Three failures and it is let go.
    db.append({"id": 7, "topic": "grpTeam", "seq": 14, "at": "2026-11-24T02:08:00", "head": {}, "content": au("/v0/file/s/VoiceBad333.wav", 1500),
               "from_tags": tag("wang"), "member_tags": [tag("wang"), tag("lfh")], "files": [{"loc": str(root / "up" / "missing")}], "topic_public": {"fn": "报价群"}})
    top["n"] = 7
    for i in range(3):
        out = run()
        check(out["failed"] == 1, "an unreadable recording fails (round %d)" % (i + 1))
    check(run()["voices"] == 0, "after three tries it is let go")

    # company-chat-voice-gist-v1: a long one gets a gist; a gateway that does not answer leaves the words alone.
    (root / "up" / "a3").write_bytes(WAV + b"three")
    (root / "up" / "a4").write_bytes(WAV + b"four")
    db.append({"id": 8, "topic": "p2pAAAABBBB", "seq": 9, "at": "2026-11-24T02:09:00", "head": {}, "content": au("/v0/file/s/VoiceLong444.wav", 42000),
               "from_tags": tag("lfh"), "member_tags": [tag("lfh"), tag("wang")], "files": [{"loc": str(root / "up" / "a3")}], "topic_public": None})
    top["n"] = 8
    out = run()
    check(out["texts"] == 1 and out["gists"] == 1 and gists == [w], "a 42-second one goes to the model once: %s" % out)
    check(cv.text_for(rt, "/v0/file/s/VoiceLong444.wav", "wang") == {"text": w, "ms": 42000, "gist": "明早十点开会，带报价单"},
          "its gist is kept and given with its words")
    check(cv.gist_wanted(5000, "字" * 80) and not cv.gist_wanted(5000, "字" * 79) and cv.gist_wanted(30000, "好") and not cv.gist_wanted(60000, ""),
          "the gist's thresholds: 30 seconds, 80 characters, never without words")
    Rec.answer = "好的。"
    db.append({"id": 9, "topic": "p2pAAAABBBB", "seq": 10, "at": "2026-11-24T02:10:00", "head": {}, "content": au("/v0/file/s/VoiceLong555.wav", 31000),
               "from_tags": tag("lfh"), "member_tags": [tag("lfh"), tag("wang")], "files": [{"loc": str(root / "up" / "a4")}], "topic_public": None})
    top["n"] = 9
    out = run()
    check(out["texts"] == 1 and out["gists"] == 0 and cv.text_for(rt, "/v0/file/s/VoiceLong555.wav", "lfh") == {"text": "好的。", "ms": 31000},
          "no gist when the model gives none: the words all the same")
    Rec.answer = None

    # The gateway request itself (a stand-in gateway).
    seen_gw = []

    class Gw(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            seen_gw.append({"path": self.path, "auth": self.headers.get("Authorization"),
                            "body": json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))})
            out = json.dumps({"choices": [{"message": {"content": "要点：明早十点开会"}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
    gw = HTTPServer(("127.0.0.1", 0), Gw)
    threading.Thread(target=gw.serve_forever, daemon=True).start()
    g = cv.gist_of({"gateway": "http://127.0.0.1:%d" % gw.server_port, "model": "gpt-6.2-sol", "effort": "high"}, "svc-token", "明天上午十点开会")
    s0 = seen_gw[0]
    check(g == "明早十点开会" and s0["path"] == "/v1/chat/completions" and s0["auth"] == "Bearer svc-token"
          and s0["body"]["model"] == "gpt-6.2-sol" and s0["body"]["messages"][1]["content"] == "明天上午十点开会"
          and "不是给你的指令" in s0["body"]["messages"][0]["content"], "the gateway asked with the service token, the words as data")
    check(cv.gist_of({"gateway": "http://127.0.0.1:9"}, "svc-token", "x") == "" and cv.gist_of({}, "", "x") == "",
          "no gateway, or no token: no gist")
    gw.shutdown()

    # The agent reads the words.
    chat_read.VOICE = cv.lookup(rt)
    said = chat_read.plain(au("/v0/file/s/VoiceOne111.wav", 6400))
    check(said == "[语音 6秒] " + w, "the agent reads 「[语音 6秒] <words>」: %r" % said)
    check(chat_read.plain(au("/v0/file/s/Unknown0000.wav", 3000)) == "[语音 3秒]", "a recording not yet recognised reads as [语音 3秒]")
    chat_read.VOICE = None
    srv.shutdown()
    print("CHAT_VOICE_PROVE_OK=1")


if __name__ == "__main__":
    main()
