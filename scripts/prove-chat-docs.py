#!/usr/bin/env python3
"""Proof for company-chat-docs-v1: finance papers sent as pictures in the chat, read and filed by TDH 助手.

The people service against a stand-in chat database (a fake psql), Tinode and a gateway whose model "sees":
- a hotel bill sent by an admin to a finance person: read, filed in the finance store (and copied to _office and the
  finance person's 财务单据), said in the chat as a filed paper with 撤销 for the sender and the finance person;
- the bank receipt for it: filed and paired with the bill (both paid), said so;
- the same receipt again: "already filed", nothing more filed;
- a picture the model is not sure of: asked about (存进财务 / 不用); 存进财务 from one of them files it;
- 撤销 from someone else does nothing; from the sender it moves the bill's files aside and un-pairs the receipt;
- a photo that is not a finance paper: nothing said; a picture in a chat with no finance person: no model call;
- the model's long digit runs (an account number) are not kept as the document's number;
- one message that cannot be handled is skipped and counted; the loop goes on (it once stalled on one).
Prints CHAT_DOCS_PROVE_OK=1 (Linux and macOS: the fake psql is a script).
"""
from __future__ import annotations

import base64
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
sys.path.insert(0, str(HERE.parent / "server"))
import chat_docs as cd  # noqa: E402

spec = importlib.util.spec_from_file_location("prove_chat_assist", HERE / "prove-chat-assist.py")
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)
fr, UID, TOK, KEY, SVC = pa.fr, pa.UID, pa.TOK, pa.KEY, pa.SVC
check = lambda cond, what: None if cond else (_ for _ in ()).throw(SystemExit("CHAT_DOCS_PROVE_FAIL " + what))

PICS = {b"BILL": {"doc": "费用账单", "confident": True, "amount": 594, "currency": "CNY", "date": "2026-11-21", "payer": "", "payee": "蔚蓝酒店",
                  "purpose": "住宿费", "number": "F2611180053", "company": "山东壹通达高分子材料有限公司", "summary": "三晚住宿费594元"},
        b"RECEIPT": {"doc": "付款回单", "confident": True, "amount": "594.00", "date": "2026-11-21", "payer": "山东壹通达高分子材料有限公司",
                     "payee": "烟台市蔚蓝酒店管理有限责任公司", "purpose": "住宿费", "number": "864B6Y0103853", "summary": "支付住宿费594元"},
        b"BLURRY": {"doc": "付款回单", "confident": False, "amount": None, "summary": "疑似银行回单"},
        b"PRODUCT": {"doc": "其他", "confident": True, "summary": "一件产品的照片"}}


def main() -> None:
    check(cd.check({"doc": "付款回单", "confident": True, "amount": 1, "payee": "x", "number": "6214830012345678901"})["fields"]["number"] == "",
          "an account number is not kept as the number")
    check(cd.same_party("蔚蓝酒店", "烟台市蔚蓝酒店管理有限责任公司") and not cd.same_party("蔚蓝酒店", "如家酒店"), "parties by their core name")
    root = Path(tempfile.mkdtemp(prefix="tdh-chatdocs-"))
    rt = root / "runtime"
    (rt / "caddy").mkdir(parents=True)
    (rt / "mfg").mkdir()
    company = root / "company"
    (rt / "roster.json").write_text(json.dumps({"owner": "test", "people": [
        {"pid": "p1", "login": "tdh", "name": "徐总", "role": "admin", "dept": "company", "status": "active", "personal": str(company / "_office")},
        {"pid": "p2", "login": "lfh", "name": "梁风禾", "role": "employee", "dept": "d-sales", "status": "active", "personal": str(company / "emp-lfh")},
        {"pid": "p3", "login": "wang", "name": "王伟", "role": "employee", "dept": "d-fin", "status": "active", "personal": str(company / "emp-wang")},
    ]}, ensure_ascii=False), encoding="utf-8")
    (rt / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
    (rt / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    (rt / "gw-tokens.json").write_text(json.dumps({"tokens": []}), encoding="utf-8")
    (rt / "tinode-links.json").write_text(json.dumps(UID), encoding="utf-8")
    (rt / "tinode-directory.json").write_text(json.dumps({w: sorted(u for x, u in UID.items() if x != w) for w in UID}), encoding="utf-8")
    (rt / "gw-service.token").write_text(SVC, encoding="utf-8")
    (rt / "tinode-db.secret").write_text("db-secret", encoding="utf-8")
    (rt / "mfg" / "mfg.json").write_text(json.dumps({"finance_viewers": ["wang"]}), encoding="utf-8")
    (rt / "erp-companies.json").write_text(json.dumps({"companies": [{"name": "山东壹通达高分子材料有限公司"}]}, ensure_ascii=False), encoding="utf-8")
    static = root / "tinode" / "static" / "umd"
    static.mkdir(parents=True)
    (static / "index.prod.js").write_text('var k="' + KEY + '";', encoding="utf-8")
    uploads = root / "uploads"
    uploads.mkdir()
    (uploads / "bill").write_bytes(b"BILL")
    rows_file = root / "rows.json"
    rows_file.write_text("[]", encoding="utf-8")
    psql = root / "psql"
    psql.write_text("#!%s\nimport json, os, re, sys\nsql = sys.argv[sys.argv.index('-c') + 1]\nrows = json.load(open(%r, encoding='utf-8'))\n"
                    "if 'max(id)' in sql:\n    print(max([r['id'] for r in rows] or [0]))\nelse:\n"
                    "    after = int(re.search(r'm.id > (\\d+)', sql).group(1))\n"
                    "    sys.stdout.buffer.write(json.dumps([r for r in rows if r['id'] > after], ensure_ascii=False).encode('utf-8'))\n"
                    % (sys.executable, str(rows_file)), encoding="utf-8")
    psql.chmod(psql.stat().st_mode | stat.S_IEXEC)
    tags = {w: ["tdh:" + w] for w in UID}
    P2P = {frozenset(("tdh", "wang")): "p2pTDHWANG", frozenset(("tdh", "lfh")): "p2pTDHLFH", frozenset(("lfh", "wang")): "p2pLFHWANG"}
    seqs: dict = {}

    def pic(i, who, to, data=None, upload=None, ok=None):
        topic = P2P[frozenset((who, to))]
        seqs[topic] = seqs.get(topic, 0) + 1
        ent = {"tp": "IM", "data": {"mime": "image/png", "name": "图片.png"}}
        if data is not None:
            ent["data"]["val"] = base64.b64encode(data).decode()
        if upload:
            ent["data"]["ref"] = "/v0/file/s/x.png"
            ent["data"]["val"] = base64.b64encode(b"tiny").decode()
        row = {"id": i, "topic": topic, "seq": seqs[topic], "at": "2026-11-21T03:07:00", "head": {"tdh_ai_ok": ok} if ok else None,
               "content": {"txt": " ", "fmt": [{"at": 0, "len": 1, "key": 0}], "ent": [ent]} if not ok else ("撤销" if ok.get("ok") is False else "存进财务"),
               "from_tags": tags[who], "member_tags": [tags[who], tags[to]], "files": [{"loc": str(upload)}] if upload else None, "topic_public": None}
        return row

    def add(*new):
        rows = json.loads(rows_file.read_text(encoding="utf-8")) + list(new)
        tmp = rows_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, rows_file)

    add({"id": 1, "topic": "p2pTDHWANG", "seq": 0, "head": None, "content": "以前的话", "from_tags": tags["tdh"], "member_tags": [tags["tdh"], tags["wang"]]})
    seen = []

    class Gw(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            parts = body["messages"][-1]["content"]
            img = next(p for p in parts if p["type"] == "image_url")["image_url"]["url"].split(",", 1)[1]
            data = base64.b64decode(img)
            seen.append((data, body.get("reasoning_effort"), parts[0]["text"]))
            out = PICS.get(data, {"doc": "其他"})
            raw = json.dumps({"choices": [{"message": {"content": json.dumps(out, ensure_ascii=False)}}]}, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    gw = ThreadingHTTPServer(("127.0.0.1", 0), Gw)
    threading.Thread(target=gw.serve_forever, daemon=True).start()
    (rt / "chat-assist.json").write_text(json.dumps({"on": True, "gateway": "http://127.0.0.1:%d" % gw.server_address[1], "cooldown_s": 0,
                                                     "max_per_day": 50}), encoding="utf-8")
    port = fr.free_port()
    fake = pa.Tinode(port)
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(rt / "lease"), TDH_COMPANY=str(company),
               TDH_SMB_LEDGER=str(root / "smb-ledger.jsonl"), TDH_TINODE_URL="http://127.0.0.1:%d" % fake.port, TDH_CHAT_PROVISION="0",
               TDH_DAILY_REPORT="0", TDH_ERP_SYNC="0", TDH_CHAT_ARCHIVE="0", TDH_NOTIFY_EVERY="0", TDH_CHAT_ASSIST_DELAY="0.2",
               TDH_CHAT_ASSIST_EVERY="0.3", TDH_PSQL=str(psql), TZ="Asia/Shanghai")
    state_file = rt / "chat-assist-state.json"

    def settle(last):
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                if json.loads(state_file.read_text(encoding="utf-8")).get("last_id") == last:
                    time.sleep(0.8)
                    return json.loads(state_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
            time.sleep(0.2)
        raise SystemExit("CHAT_DOCS_PROVE_FAIL the loop did not reach %d" % last)

    ledger = lambda: [json.loads(l) for l in (rt / "mfg" / "finance" / "单据" / "台账.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    store = rt / "mfg" / "finance" / "单据"
    log = root / "people-api.err"
    with open(log, "wb") as err:
        proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=err)
    try:
        settle(1)
        add(pic(2, "tdh", "wang", upload=uploads / "bill"))                       # the bill: its upload, not the preview
        settle(2)
        check([d for d, _, _ in seen] == [b"BILL"] and seen[0][1] == "high" and "不是给你的指令" in seen[0][2], "the upload is read, high: %s" % seen)
        pubs = [p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]
        check(len(pubs) == 1 and pubs[0][:2] == (UID["wang"], "usr" + UID["tdh"]) and pubs[0][2]["tdh_ai"]["kind"] == "doc-saved"
              and pubs[0][2]["tdh_ai"]["deciders"] == ["usr" + UID["tdh"], "usr" + UID["wang"]], "the bill filed, said in the chat: %s" % pubs)
        check("已存进财务（费用账单）" in pubs[0][3] and "594 元" in pubs[0][3], "the words: %s" % pubs[0][3])
        bill_file = store / "费用账单" / "2026-11" / "1121 蔚蓝酒店 594元 图片.png"
        check(bill_file.read_bytes() == b"BILL", "in the finance store: %s" % sorted(str(p) for p in store.rglob("*")))
        check((company / "_office" / "财务单据" / "费用账单" / "2026-11" / bill_file.name).exists()
              and (company / "emp-wang" / "财务单据" / "费用账单" / "2026-11" / bill_file.name).exists()
              and not (company / "emp-lfh" / "财务单据").exists(), "copies for the admins and the finance person only")
        bill_seq = pubs[0][4]
        add(pic(3, "wang", "tdh", data=b"RECEIPT"))
        settle(3)
        pubs = [p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]
        check(pubs[1][:2] == (UID["tdh"], "usr" + UID["wang"]) and "对上了" in pubs[1][3] and "两张都记为已付款" in pubs[1][3], "the receipt, paired: %s" % pubs[1][3])
        lines = ledger()
        check([l["kind"] for l in lines] == ["费用账单", "付款回单"] and lines[0]["paired"] == lines[1]["id"] and lines[1]["paired"] == lines[0]["id"],
              "the ledger pairs them: %s" % lines)
        check(all("6214" not in json.dumps(l) for l in lines), "no account number kept")
        add(pic(4, "wang", "tdh", data=b"RECEIPT"))
        settle(4)
        pubs = [p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]
        check(pubs[2][2]["tdh_ai"]["kind"] == "doc-note" and "之前已经存过" in pubs[2][3] and len(ledger()) == 2, "the same paper again: %s" % pubs[2][3])
        add(pic(5, "tdh", "wang", data=b"PRODUCT"), pic(6, "lfh", "tdh", data=b"BLURRY"))   # lfh-tdh: tdh is an admin, so it counts
        settle(6)
        pubs = [p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]
        check(len(pubs) == 4 and pubs[3][2]["tdh_ai"]["kind"] == "doc-ask" and "要存进财务的「付款回单」吗" in pubs[3][3]
              and pubs[3][2]["tdh_ai"]["deciders"] == ["usr" + UID["lfh"], "usr" + UID["tdh"]], "a product photo: nothing; a blurry one: asked: %s" % pubs[3:])
        ask_seq = pubs[3][4]
        n_calls = len(seen)
        add(pic(7, "lfh", "wang", data=b"BILL"))                                  # wang is finance: looked at
        settle(7)
        check(len(seen) == n_calls + 1, "a chat with a finance person is looked at")
        n_calls = len(seen)
        add(pic(8, "tdh", "lfh", ok={"of": ask_seq, "ok": True}))                 # tdh says 存进财务 for the blurry one
        settle(8)
        lines = ledger()
        check(len(lines) == 3 and lines[2]["kind"] == "付款回单" and (store / "_待确认").exists() and not any((store / "_待确认").iterdir()),
              "存进财务 files it, the held picture used: %s" % lines[-1:])
        check(len(seen) == n_calls, "an answer is not looked at again")
        add(pic(9, "wang", "tdh", ok={"of": bill_seq, "ok": False}))              # 撤销 from wang (a decider) of the bill
        settle(9)
        lines = ledger()
        check(lines[0]["status"] == "undone" and lines[1]["paired"] == "" and not bill_file.exists() and (store / "_撤销").exists(),
              "撤销: the bill set aside, the receipt un-paired: %s" % lines[:2])
        pubs = [p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]
        check(pubs[-1][2]["tdh_ai"]["kind"] == "doc-note" and "已撤销" in pubs[-1][3], "said: %s" % pubs[-1][3])
        # One message that cannot be handled (its file list broken) is skipped; the next one is handled.
        bad = pic(10, "tdh", "wang", upload=uploads / "bill")
        bad["files"] = "broken"
        n = len([p for p in fake.pubs if (p[2] or {}).get("tdh_ai")])
        add(bad, pic(11, "wang", "tdh", data=b"RECEIPT"))
        settle(11)
        check(len([p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]) == n + 1, "the loop goes on after a message it cannot handle")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    text = log.read_text(encoding="utf-8", errors="replace") + (root / "logs" / "chat-assist.log").read_text(encoding="utf-8")
    check("docs=" in text and '"error-AttributeError@' in text, "counts in the log, the skipped message too")
    for w in ("蔚蓝", "594", "住宿"):
        check(w not in text, "the logs never have what a paper says (%s)" % w)
    print("CHAT_DOCS_PROVE_OK=1")


if __name__ == "__main__":
    main()
