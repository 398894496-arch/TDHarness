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
v2: the receipt sent by a 付款 card's assignee goes on that card (uploaded, handed in to its issuer), said in the chat;
its 撤销 takes it off and hands the card back; a PDF is read as a file; an .xlsx 付款计划 is read from its cells (dates
as dates) and filed with its lines, a sheet that does not speak of paying is not read; "今天有哪些需要付款的事项" gives
the model what there is to pay (the plan, the bill with no receipt, the open 付款 card); a plan's line due today is said
to whoever sent the plan, once.
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
        b"PRODUCT": {"doc": "其他", "confident": True, "summary": "一件产品的照片"},
        b"%PDF INVOICE": {"doc": "发票", "confident": True, "amount": 1200, "date": "2026-11-20", "payer": "山东壹通达高分子材料有限公司",
                          "payee": "龙口市顺达物流有限公司", "number": "26372000000123456789", "summary": "运费发票1200元"}}
PLAN_REPLY = lambda today: {"doc": "付款计划", "confident": True, "summary": "11月下旬付款安排", "date": today,
                            "items": [{"payee": "龙口市顺达物流有限公司", "amount": 1200, "due": today, "paid": False, "note": "运费"},
                                      {"payee": "烟台市蔚蓝酒店管理有限责任公司", "amount": 594, "due": today, "paid": False, "note": "住宿"},
                                      {"payee": "万华化学", "amount": 88000, "due": "2026-12-05", "paid": True, "note": "MDI"}]}


def xlsx(rows: list, date_cols=()) -> bytes:
    """A minimal .xlsx: shared strings, one custom date format, one sheet."""
    import io
    import zipfile
    strings = []
    cells = []
    for r, row in enumerate(rows, 1):
        cs = []
        for c, v in enumerate(row):
            ref = "%s%d" % ("ABCDEFG"[c], r)
            if isinstance(v, str):
                strings.append(v)
                cs.append('<c r="%s" t="s"><v>%d</v></c>' % (ref, len(strings) - 1))
            else:
                cs.append('<c r="%s"%s><v>%s</v></c>' % (ref, ' s="1"' if c in date_cols else "", v))
        cells.append('<row r="%d">%s</row>' % (r, "".join(cs)))
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("xl/sharedStrings.xml", '<sst %s>%s</sst>' % (ns, "".join("<si><t>%s</t></si>" % t for t in strings)))
        z.writestr("xl/styles.xml", '<styleSheet %s><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/></numFmts>'
                   '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>' % ns)
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet %s><sheetData>%s</sheetData></worksheet>' % (ns, "".join(cells)))
    return b.getvalue()


def main() -> None:
    check(cd.check({"doc": "付款回单", "confident": True, "amount": 1, "payee": "x", "number": "6214830012345678901"})["fields"]["number"] == "",
          "an account number is not kept as the number")
    check(cd.same_party("蔚蓝酒店", "烟台市蔚蓝酒店管理有限责任公司") and not cd.same_party("蔚蓝酒店", "如家酒店"), "parties by their core name")
    sheet = xlsx([["收款单位", "金额", "应付日期", "备注"], ["龙口市顺达物流有限公司", 1200, 46347, "运费"]], date_cols=(2,))
    check(cd.sheet_text(sheet) == "收款单位\t金额\t应付日期\t备注\n龙口市顺达物流有限公司\t1200\t2026-11-21\t运费", "the sheet's cells, the date a date: %r" % cd.sheet_text(sheet))
    check(cd.sheet_text(b"not a zip") == "", "not a sheet: nothing")
    plan = cd.check(PLAN_REPLY("2026-11-21"))
    check(plan["action"] == "save" and plan["fields"]["amount"] == 89794 and len(plan["fields"]["items"]) == 3 and plan["fields"]["items"][2]["paid"],
          "a plan with its lines: %s" % plan)
    check(cd.check({"doc": "付款计划", "confident": True, "items": [{"note": "?"}]})["action"] == "ask", "a plan with no line to pay: asked")
    now_ms = int(time.time() * 1000)
    cards = [{"id": "a", "title": "给蔚蓝酒店付住宿费", "state": "待提交", "created_at": now_ms - 1000},
             {"id": "b", "title": "安排付款", "state": "待提交", "created_at": now_ms - 2000},
             {"id": "c", "title": "把样品寄给客户", "state": "待提交", "created_at": now_ms - 500},
             {"id": "d", "title": "付蔚蓝酒店594", "state": "已通过", "created_at": now_ms}]
    rc = {"kind": "付款回单", "amount": 594.0, "payee": "烟台市蔚蓝酒店管理有限责任公司", "payer": "山东壹通达高分子材料有限公司"}
    ours = {"山东壹通达高分子材料有限公司"}
    check((cd.card_for(rc, cards, ours, set(), now_ms) or {}).get("id") == "a", "the card that names the party")
    check((cd.card_for(dict(rc, payee="如家酒店"), cards, ours, {"b"}, now_ms) or {}).get("id") == "b", "else the only 付款 card made from this chat")
    cards.append({"id": "e", "title": "安排付款给供应商", "state": "待提交", "created_at": now_ms - 3000})
    check(cd.card_for(dict(rc, payee="如家酒店"), cards, ours, {"b", "e"}, now_ms) is None, "two of this chat's: none (not a guess)")
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
    (rt / "mfg" / "mfg.json").write_text(json.dumps({"finance_viewers": ["wang"], "cash_viewers": ["wang"]}), encoding="utf-8")
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

    def doc(i, who, to, name, mime, upload):
        topic = P2P[frozenset((who, to))]
        seqs[topic] = seqs.get(topic, 0) + 1
        return {"id": i, "topic": topic, "seq": seqs[topic], "at": "2026-11-21T05:00:00", "head": None,
                "content": {"txt": " ", "fmt": [{"at": 0, "len": 1, "key": 0}], "ent": [{"tp": "EX", "data": {"mime": mime, "name": name, "ref": "/v0/file/s/f"}}]},
                "from_tags": tags[who], "member_tags": [tags[who], tags[to]], "files": [{"loc": str(upload)}], "topic_public": None}

    def words(i, who, to, text):
        topic = P2P[frozenset((who, to))]
        seqs[topic] = seqs.get(topic, 0) + 1
        return {"id": i, "topic": topic, "seq": seqs[topic], "at": "2026-11-21T06:00:00", "head": None, "content": text,
                "from_tags": tags[who], "member_tags": [tags[who], tags[to]], "files": None, "topic_public": None}

    def add(*new):
        rows = json.loads(rows_file.read_text(encoding="utf-8")) + list(new)
        tmp = rows_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, rows_file)

    add({"id": 1, "topic": "p2pTDHWANG", "seq": 0, "head": None, "content": "以前的话", "from_tags": tags["tdh"], "member_tags": [tags["tdh"], tags["wang"]]})
    seen = []
    asked: list = []
    files_seen: list = []

    class Gw(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            parts = body["messages"][-1]["content"]
            if isinstance(parts, str):                                      # the assistant's decide(): an answer
                asked.append(parts)
                out = {"action": "answer", "answer": "今天要付两笔"}
            else:
                img = next((p["image_url"]["url"] for p in parts if p["type"] == "image_url"), None)
                pdf = next((p["file"] for p in parts if p["type"] == "file"), None)
                if img:
                    data = base64.b64decode(img.split(",", 1)[1])
                elif pdf:
                    data = base64.b64decode(pdf["file_data"].split(",", 1)[1])
                    files_seen.append(pdf["filename"])
                else:
                    data = b"SHEET:" + parts[0]["text"].split("的内容", 1)[-1].encode()
                seen.append((data, body.get("reasoning_effort"), parts[0]["text"]))
                out = PLAN_REPLY(time.strftime("%Y-%m-%d")) if data.startswith(b"SHEET:") else PICS.get(data, {"doc": "其他"})
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
               TDH_DAILY_REPORT="0", TDH_ERP_SYNC="0", TDH_CHAT_ARCHIVE="0", TDH_NOTIFY_EVERY="1", TDH_CHAT_ASSIST_DELAY="0.2",
               TDH_CHAT_ASSIST_EVERY="0.3", TDH_PSQL=str(psql), TZ="Asia/Shanghai", TDH_PLAN_HOUR="0")
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
        board = rt / "tickets.json"
        board.write_text(json.dumps({"tickets": [
            {"id": "t-pay", "title": "给蔚蓝酒店付住宿费", "from": "tdh", "to": "wang", "dept": "d-fin", "state": "待提交", "assignment": "给蔚蓝酒店付住宿费",
             "summary": "", "files": [], "sessions": [], "archived": False, "hidden_by": [], "created_at": int(time.time() * 1000) - 60000,
             "due": 0, "comments": [], "events": []}]}, ensure_ascii=False), encoding="utf-8")
        add(pic(3, "wang", "tdh", data=b"RECEIPT"))
        settle(3)
        pubs = [p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]
        check(pubs[1][:2] == (UID["tdh"], "usr" + UID["wang"]) and "对上了" in pubs[1][3] and "两张都记为已付款" in pubs[1][3], "the receipt, paired: %s" % pubs[1][3])
        check("回单已附在任务卡「给蔚蓝酒店付住宿费」上，交给徐总验收" in pubs[1][3], "said it is on the card: %s" % pubs[1][3])
        card = json.loads(board.read_text(encoding="utf-8"))["tickets"][0]
        check(card["state"] == "待审批" and card["submitted_by"] == "wang" and len(card["files"]) == 1 and "付款回单已到" in card["summary"],
              "the receipt on the card, handed in: %s" % card)
        receipt_seq = pubs[1][4]
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
        add(pic(10, "wang", "tdh", ok={"of": receipt_seq, "ok": False}))           # 撤销 of the receipt: off the card
        settle(10)
        card = json.loads(board.read_text(encoding="utf-8"))["tickets"][0]
        check(card["state"] == "待提交" and card["files"] == [] and "撤销" in card["comments"][-1]["text"], "the card handed back: %s" % card)
        # A PDF: read as a file, filed under its name.
        (uploads / "inv").write_bytes(b"%PDF INVOICE")
        add(doc(11, "wang", "tdh", "顺达运费发票.pdf", "application/pdf", uploads / "inv"))
        settle(11)
        check(files_seen == ["顺达运费发票.pdf"] and (store / "发票" / "2026-11" / "1121 顺达物流 1200元 顺达运费发票.pdf").read_bytes() == b"%PDF INVOICE",
              "a PDF read and filed: %s" % sorted(str(p.relative_to(store)) for p in store.rglob("*.pdf")))
        check(all("26372000000123456789" not in json.dumps(l) for l in ledger()), "an invoice's 20 digits are not kept either")
        # Sheets: one that speaks of paying is read from its cells; one that does not is not.
        (uploads / "plan").write_bytes(xlsx([["收款单位", "金额", "应付日期"], ["龙口市顺达物流有限公司", 1200, 46347]], date_cols=(2,)))
        (uploads / "sched").write_bytes(xlsx([["计划单", "数量"], ["26-11-9", 300]]))
        n_calls = len(seen)
        add(doc(12, "lfh", "wang", "排产.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", uploads / "sched"),
            doc(13, "wang", "tdh", "11月付款计划.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", uploads / "plan"))
        settle(13)
        check(len(seen) == n_calls + 1 and b"2026-11-21" in seen[-1][0] and "Excel 表格「11月付款计划.xlsx」" in seen[-1][2], "only the paying sheet read, its cells")
        pubs = [p for p in fake.pubs if (p[2] or {}).get("tdh_ai")]
        check("已存为付款计划：3 笔，合计 89794 元" in pubs[-1][3], "the plan said: %s" % pubs[-1][3])
        plan_line = ledger()[-1]
        check(plan_line["kind"] == "付款计划" and len(plan_line["items"]) == 3 and (store / plan_line["file"]).exists(), "the plan filed: %s" % plan_line)
        # 今天有哪些需要付款的事项: what there is to pay goes to the model.
        add(words(14, "tdh", "wang", "今天有哪些需要付款的事项？"))
        settle(14)
        check(asked and "要付的款" in asked[-1], "the question is given what there is to pay: %s" % asked[-1:])
        pay = json.loads(asked[-1].split("TDH 查到的资金（JSON）：\n", 1)[1])["要付的款"]
        lines = {i["收款方"]: i for i in pay["付款计划"]["条目"]}
        check(pay["付款计划"]["谁发的"] == "王伟" and lines["龙口市顺达物流有限公司"]["已付"] is False and lines["万华化学"]["已付"] is True,
              "the plan's lines: %s" % pay["付款计划"])
        check([c["任务"] for c in pay["付款任务卡"]] == ["给蔚蓝酒店付住宿费"] and pay["付款任务卡"][0]["负责人"] == "王伟", "the open 付款 card: %s" % pay["付款任务卡"])
        check(pay["没对上回单的账单"] == [], "the bill was undone, so none: %s" % pay["没对上回单的账单"])
        # The plan's lines due today: said to its sender, once.
        deadline = time.time() + 20
        while time.time() < deadline and not [p for p in fake.pubs if "付款计划里到期" in str(p[3])]:
            time.sleep(0.3)
        told = [p for p in fake.pubs if "付款计划里到期" in str(p[3])]
        check(len(told) == 1 and "龙口市顺达物流有限公司 1200 元" in str(told[0][3]) and "万华化学" not in str(told[0][3]), "the reminder: %s" % told)
        time.sleep(2.5)
        check(len([p for p in fake.pubs if "付款计划里到期" in str(p[3])]) == 1, "said once a day")
        # One message that cannot be handled (its file list broken) is skipped; the next one is handled.
        bad = pic(15, "tdh", "wang", upload=uploads / "bill")
        bad["files"] = "broken"
        n = len([p for p in fake.pubs if (p[2] or {}).get("tdh_ai")])
        add(bad, pic(16, "wang", "tdh", data=b"PRODUCT"), pic(17, "lfh", "tdh", data=b"BLURRY"))
        settle(17)
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
