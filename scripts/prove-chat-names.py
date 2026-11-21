#!/usr/bin/env python3
"""Proof for company-chat-names-v1: the chat's display name follows the roster.

The people service against a stand-in Tinode (prove-chat-read.py's) whose accounts have a public (a name, a photo):
- 徐总's chat account still says "tdh" (made before the roster had a name): the round sets 徐总, the photo kept;
- 梁风禾 and 王伟 have their roster names already: noted, nothing set;
- the next round logs in for nobody; a name changed in the roster is set on the next round, only that one;
- a bot is left alone.
Prints CHAT_NAMES_PROVE_OK=1.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
spec = importlib.util.spec_from_file_location("prove_chat_assist", HERE / "prove-chat-assist.py")
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)
fr, UID, KEY, SVC = pa.fr, pa.UID, pa.KEY, pa.SVC


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CHAT_NAMES_PROVE_FAIL " + what)


class Tinode(pa.Tinode):
    """Also {sub me} with its desc, and {set me desc}, as Tinode: set replaces the public as given."""

    def __init__(self, port: int):
        super().__init__(port)
        self.fn[UID["tdh"]] = "tdh"
        self.photo = {UID["tdh"]: {"type": "image/png", "ref": "/v0/file/s/me.png"}}
        self.logins: list = []
        self.sets: list = []

    def answer(self, s, kind, body):
        mid = body.get("id")
        if kind == "login":
            out = super().answer(s, kind, body)
            self.logins.append(s["user"])
            return out
        if s.get("user") and body.get("topic") == "me" and kind == "sub" and (body.get("get") or {}).get("what") == "desc":
            pub = {"fn": self.fn.get(s["user"], "")}
            if s["user"] in self.photo:
                pub["photo"] = self.photo[s["user"]]
            return [{"meta": {"id": mid, "topic": "me", "desc": {"public": pub}}}, {"ctrl": {"id": mid, "code": 200}}]
        if s.get("user") and body.get("topic") == "me" and kind == "set":
            pub = (body.get("desc") or {}).get("public") or {}
            self.sets.append((s["user"], pub))
            self.fn[s["user"]] = pub.get("fn", "")
            self.photo[s["user"]] = pub.get("photo")
            return [{"ctrl": {"id": mid, "code": 200}}]
        return super().answer(s, kind, body)


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="tdh-chatnames-"))
    rt = root / "runtime"
    (rt / "caddy").mkdir(parents=True)
    company = root / "company"
    people = [
        {"pid": "p1", "login": "tdh", "name": "徐总", "role": "admin", "dept": "company", "status": "active", "personal": str(company / "_office")},
        {"pid": "p2", "login": "lfh", "name": "梁风禾", "role": "employee", "dept": "d-sales", "status": "active", "personal": str(company / "emp-lfh")},
        {"pid": "p3", "login": "wang", "name": "王伟", "role": "employee", "dept": "d-fin", "status": "active", "personal": str(company / "emp-wang")},
    ]
    roster = rt / "roster.json"
    roster.write_text(json.dumps({"owner": "test", "people": people}, ensure_ascii=False), encoding="utf-8")
    (rt / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
    (rt / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    (rt / "gw-tokens.json").write_text(json.dumps({"tokens": []}), encoding="utf-8")
    links = dict(UID, **{"tdh-assist": "BOT1"})
    (rt / "tinode-links.json").write_text(json.dumps(links), encoding="utf-8")
    (rt / "tinode-directory.json").write_text(json.dumps({w: sorted(u for x, u in links.items() if x != w) for w in links}), encoding="utf-8")
    (rt / "gw-service.token").write_text(SVC, encoding="utf-8")
    static = root / "tinode" / "static" / "umd"
    static.mkdir(parents=True)
    (static / "index.prod.js").write_text('var k="' + KEY + '";', encoding="utf-8")
    port = fr.free_port()
    fake = Tinode(port)
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(rt / "lease"), TDH_COMPANY=str(company),
               TDH_SMB_LEDGER=str(root / "smb-ledger.jsonl"), TDH_TINODE_URL="http://127.0.0.1:%d" % fake.port, TDH_CHAT_PROVISION="1",
               TDH_CHAT_PROVISION_DELAY="0.3", TDH_CHAT_PROVISION_EVERY="0.6", TDH_DAILY_REPORT="0", TDH_ERP_SYNC="0", TDH_CHAT_ARCHIVE="0",
               TDH_NOTIFY_EVERY="0", TZ="Asia/Shanghai")
    names = rt / "tinode-names.json"

    def wait(cond, what: str, timeout: float = 15) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if cond():
                return
            time.sleep(0.1)
        raise SystemExit("CHAT_NAMES_PROVE_FAIL " + what)

    def noted() -> dict:
        try:
            return json.loads(names.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    log = root / "people-api.err"
    with open(log, "wb") as err:
        proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=err)
    try:
        wait(lambda: noted() == {"tdh": "徐总", "lfh": "梁风禾", "wang": "王伟"}, "every name noted: %s" % noted())
        check(fake.sets == [(UID["tdh"], {"fn": "徐总", "photo": {"type": "image/png", "ref": "/v0/file/s/me.png"}})],
              "only 徐总's set, the photo kept: %s" % fake.sets)
        check("BOT1" not in fake.logins, "a bot is left alone")
        n = len(fake.logins)
        time.sleep(1.5)
        check(len(fake.logins) == n, "a round with nothing changed logs in for nobody")
        people[2]["name"] = "王伟伟"
        roster.write_text(json.dumps({"owner": "test", "people": people}, ensure_ascii=False), encoding="utf-8")
        wait(lambda: noted().get("wang") == "王伟伟", "the new name noted")
        check(fake.sets[-1] == (UID["wang"], {"fn": "王伟伟"}) and len(fake.sets) == 2 and fake.logins[n:] == [UID["wang"]],
              "only the changed one: %s %s" % (fake.sets, fake.logins[n:]))
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    check("chat-names" in log.read_text(encoding="utf-8", errors="replace"), "counts in the log")
    print("CHAT_NAMES_PROVE_OK=1")


if __name__ == "__main__":
    main()
