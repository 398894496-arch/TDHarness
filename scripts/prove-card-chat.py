#!/usr/bin/env python3
"""Proof for company-chat-cards-v1: what happens to a task card between two people is said in their one-to-one chat.

The people service against a stand-in Tinode (prove-chat-assist.py's), its task cards through /company/mailbox as the
desk sends them:
- 徐总 gives 王伟 a card: said by 徐总 in his chat with 王伟, a tdh_card head (issued, the title, who does it, the due
  time, what to do) and the words for any other client;
- 王伟 hands it in: said by 王伟 (submitted, his report); 徐总 sends it back (returned, the reason), then passes it;
- a new due time, a card made void: said, with the reason;
- a card one gives oneself: nothing said;
- TDH 助手 does not read a card said in the chat as words to act on.
Prints CARD_CHAT_PROVE_OK=1.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
sys.path.insert(0, str(HERE.parent / "server"))
import chat_assist  # noqa: E402

spec = importlib.util.spec_from_file_location("prove_chat_assist", HERE / "prove-chat-assist.py")
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)
fr, UID, KEY, SVC = pa.fr, pa.UID, pa.KEY, pa.SVC
BOSS_TOK, WANG_TOK = "dsh_" + "b" * 40, "dsh_" + "w" * 40


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CARD_CHAT_PROVE_FAIL " + what)


def main() -> None:
    check(chat_assist.candidate({"head": {"tdh_card": {"v": 1}}, "from_tags": ["tdh:tdh"], "content": "【任务卡】明天下午把合同发给王伟"}, {}) is None,
          "TDH 助手 does not read a card as words")
    root = Path(tempfile.mkdtemp(prefix="tdh-cardchat-"))
    rt = root / "runtime"
    (rt / "caddy").mkdir(parents=True)
    company = root / "company"
    (rt / "roster.json").write_text(json.dumps({"owner": "test", "people": [
        {"pid": "p1", "login": "tdh", "name": "徐总", "role": "admin", "dept": "company", "status": "active", "personal": str(company / "_office")},
        {"pid": "p2", "login": "lfh", "name": "梁风禾", "role": "employee", "dept": "d-sales", "status": "active", "personal": str(company / "emp-lfh")},
        {"pid": "p3", "login": "wang", "name": "王伟", "role": "employee", "dept": "d-fin", "status": "active", "personal": str(company / "emp-wang")},
    ]}, ensure_ascii=False), encoding="utf-8")
    (rt / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
    (rt / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    (rt / "gw-tokens.json").write_text(json.dumps({"tokens": [{"pid": "p1", "token": BOSS_TOK}, {"pid": "p3", "token": WANG_TOK}]}), encoding="utf-8")
    (rt / "tinode-links.json").write_text(json.dumps(UID), encoding="utf-8")
    (rt / "tinode-directory.json").write_text(json.dumps({w: sorted(u for x, u in UID.items() if x != w) for w in UID}), encoding="utf-8")
    (rt / "gw-service.token").write_text(SVC, encoding="utf-8")
    static = root / "tinode" / "static" / "umd"
    static.mkdir(parents=True)
    (static / "index.prod.js").write_text('var k="' + KEY + '";', encoding="utf-8")
    port = fr.free_port()
    fake = pa.Tinode(port)
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(rt / "lease"), TDH_COMPANY=str(company),
               TDH_SMB_LEDGER=str(root / "smb-ledger.jsonl"), TDH_TINODE_URL="http://127.0.0.1:%d" % fake.port, TDH_CHAT_PROVISION="0",
               TDH_DAILY_REPORT="0", TDH_ERP_SYNC="0", TDH_CHAT_ARCHIVE="0", TDH_NOTIFY_EVERY="0", TZ="Asia/Shanghai")
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def mailbox(tok: str, body: dict) -> dict:
        req = urllib.request.Request("http://127.0.0.1:%d/company/mailbox" % port, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + tok})
        try:
            with op.open(req, timeout=10) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return json.loads(e.read().decode("utf-8"))

    def said(n: int, timeout: float = 10) -> list:
        deadline = time.time() + timeout
        while time.time() < deadline:
            got = [p for p in fake.pubs if (p[2] or {}).get("tdh_card")]
            if len(got) >= n:
                time.sleep(0.3)
                return [p for p in fake.pubs if (p[2] or {}).get("tdh_card")]
            time.sleep(0.1)
        return [p for p in fake.pubs if (p[2] or {}).get("tdh_card")]

    log = root / "people-api.err"
    with open(log, "wb") as err:
        proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=err)
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                op.open("http://127.0.0.1:%d/company/health" % port, timeout=1)
                break
            except Exception:  # noqa: BLE001
                time.sleep(0.2)
        hit = mailbox(BOSS_TOK, {"action": "issue", "to": "wang", "title": "给蔚蓝酒店付住宿费", "assignment": "三晚住宿费 594 元，今天付",
                                 "due": "2026-11-22 18:00"})
        tid = hit.get("ticket") or (hit.get("card") or {}).get("id")
        check(bool(tid), "the card made: %s" % hit)
        got = said(1)
        check(len(got) == 1 and got[0][:2] == (UID["tdh"], "usr" + UID["wang"]), "said by 徐总 in his chat with 王伟: %s" % got)
        c = got[0][2]["tdh_card"]
        check(c["event"] == "issued" and c["id"] == tid and c["title"] == "给蔚蓝酒店付住宿费" and c["to"] == "王伟" and c["from"] == "徐总"
              and c["due"] > 0 and c["note"] == "三晚住宿费 594 元，今天付", "the card's head: %s" % c)
        check(got[0][3] == "【任务卡】给蔚蓝酒店付住宿费\n负责人：王伟　截止：2026-11-22 18:00\n三晚住宿费 594 元，今天付", "the words: %r" % got[0][3])
        mailbox(WANG_TOK, {"action": "submit", "ticket": tid, "summary": "已付，回单在聊天里"})
        got = said(2)
        check(got[1][:2] == (UID["wang"], "usr" + UID["tdh"]) and got[1][2]["tdh_card"]["event"] == "submitted"
              and got[1][2]["tdh_card"]["note"] == "已付，回单在聊天里", "handed in, said by 王伟: %s" % got[1:])
        mailbox(BOSS_TOK, {"action": "verdict", "ticket": tid, "passed": False, "reason": "回单不清楚"})
        got = said(3)
        check(got[2][2]["tdh_card"]["event"] == "returned" and got[2][3] == "【任务卡】给蔚蓝酒店付住宿费：打回，回单不清楚", "sent back: %s" % got[2:])
        mailbox(WANG_TOK, {"action": "submit", "ticket": tid, "summary": "重新拍了回单"})
        mailbox(BOSS_TOK, {"action": "verdict", "ticket": tid, "passed": True})
        got = said(5)
        check([p[2]["tdh_card"]["event"] for p in got] == ["issued", "submitted", "returned", "submitted", "passed"], "the card's life: %s" % [p[2] for p in got])
        n = len(got)
        own = mailbox(BOSS_TOK, {"action": "issue", "to": "tdh", "title": "我自己的事"})
        check(bool(own.get("ticket") or (own.get("card") or {}).get("id")), "own card made")
        time.sleep(1.0)
        check(len(said(n, timeout=0.5)) == n, "a card one gives oneself: nothing said")
        t2 = (mailbox(BOSS_TOK, {"action": "issue", "to": "wang", "title": "盘点仓库"}).get("ticket"))
        mailbox(BOSS_TOK, {"action": "set-due", "ticket": t2, "due": "2026-11-25"})
        mailbox(BOSS_TOK, {"action": "cancel", "ticket": t2, "reason": "不用了"})
        got = said(n + 3)
        check([p[2]["tdh_card"]["event"] for p in got[n:]] == ["issued", "due", "cancelled"], "due and void: %s" % [p[2] for p in got[n:]])
        check(got[-1][3] == "【任务卡】盘点仓库：作废，不用了" and got[-2][3].startswith("【任务卡】盘点仓库：截止改为 2026-11-25"), "their words: %s" % [p[3] for p in got[n:]])
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    text = log.read_text(encoding="utf-8", errors="replace")
    check("card-chat issue" in text and "蔚蓝" not in text, "the log has the card's id, not its words")
    print("CARD_CHAT_PROVE_OK=1")


if __name__ == "__main__":
    main()
