#!/usr/bin/env python3
"""Proof for company-chat-archive-v1 (server/chat_archive.py): the chat's files onto the company disk, by kind.

Against a stand-in chat database (a fake psql) and temporary folders:
- kinds: by the name first (合同、发票、报价…), then the extension (图纸、表格、文档、图片、压缩包、音视频), else 其他;
- an uploaded file (Tinode's path on the server) and a picture kept in the message are both copied, under their names;
- the admins' summary has every chat (a one-to-one chat as "A 与 B", a group by its name); each employee has only
  the files of their own chats, the one-to-one chat named after the other person; an admin's personal folder is the
  summary (no second copy); a disabled member gets nothing; a bot's and TDH 助手's messages carry nothing;
- a second file of one name is " (2)", nothing overwritten; names safe for Windows; a file that is gone is counted;
- the first round starts at the first message; a second round copies nothing again.
Prints CHAT_ARCHIVE_PROVE_OK=1 (Linux and macOS: the fake psql is a script).
"""
from __future__ import annotations

import base64
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
import chat_archive as ca  # noqa: E402
import chat_assist  # noqa: E402


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CHAT_ARCHIVE_PROVE_FAIL " + what)


def main() -> None:
    for name, kind in (("销售合同-澳洲.pdf", "合同发票报价"), ("PI 26-11-9.xlsx", "合同发票报价"), ("刮板模具.dwg", "图纸"), ("零件.STEP", "图纸"),
                       ("排产.xlsx", "表格"), ("说明.docx", "文档"), ("屏幕截图.png", "图片"), ("资料.zip", "压缩包"), ("会议.m4a", "音视频"),
                       ("notes.conf", "其他"), ("pipeline.txt", "文档"), ("spicy.png", "图片")):
        check(ca.kind_of(name) == kind, "kind of %s: %s" % (name, ca.kind_of(name)))
    check(ca.safe('a/b:c*?"<>|.') == "a_b_c______", "safe names: %r" % ca.safe('a/b:c*?"<>|.'))

    root = Path(tempfile.mkdtemp(prefix="tdh-chatarchive-"))
    rt = root / "runtime"
    rt.mkdir()
    (rt / "tinode-db.secret").write_text("db-secret", encoding="utf-8")
    company = root / "company"
    office = company / "_office"
    uploads = root / "uploads"
    uploads.mkdir()
    (uploads / "f1").write_bytes(b"%PDF contract")
    (uploads / "f2").write_bytes(b"PK zip")
    (uploads / "f3").write_bytes(b"\x89PNG group pic")
    people = {
        "boss": {"login": "boss", "name": "徐总", "role": "admin", "personal": str(office), "status": "active"},
        "lfh": {"login": "lfh", "name": "梁风禾", "role": "employee", "personal": str(company / "emp-lfh"), "status": "active"},
        "wang": {"login": "wang", "name": "王伟", "role": "employee", "personal": str(company / "emp-wang"), "status": "active"},
        "gone": {"login": "gone", "name": "离职", "role": "employee", "personal": str(company / "emp-gone"), "status": "disabled"},
    }
    tags = {w: ["tdh:" + w] for w in list(people) + ["tdh-daily"]}
    pic = base64.b64encode(b"\x89PNG inline").decode()
    ex = lambda name, ref="/v0/file/s/x.bin": {"tp": "EX", "data": {"mime": "application/octet-stream", "name": name, "ref": ref}}
    rows = [
        {"id": 3, "topic": "p2pBL", "at": "2026-11-20T01:05:00", "content": {"txt": "", "fmt": [{"at": -1, "len": 0, "key": 0}], "ent": [ex("销售合同:澳洲.pdf")]},
         "from_tags": tags["boss"], "member_tags": [tags["boss"], tags["lfh"]], "files": [{"loc": str(uploads / "f1")}], "topic_public": None},
        {"id": 5, "topic": "grpS", "at": "2026-11-20T02:00:00", "content": {"txt": " ", "ent": [{"tp": "IM", "data": {"mime": "image/png", "ref": "/v0/file/s/p.png", "val": base64.b64encode(b"tiny preview").decode()}}]},
         "from_tags": tags["wang"], "member_tags": [tags["boss"], tags["lfh"], tags["wang"], tags["gone"]], "files": [{"loc": str(uploads / "f3")}],
         "topic_public": {"fn": "销售群"}},
        {"id": 6, "topic": "p2pLW", "at": "2026-11-20T03:00:00", "content": {"txt": "两个", "ent": [ex("资料.zip"), {"tp": "IM", "data": {"mime": "image/png", "val": pic}}]},
         "from_tags": tags["lfh"], "member_tags": [tags["lfh"], tags["wang"]], "files": [{"loc": str(uploads / "f2")}], "topic_public": None},
        {"id": 7, "topic": "p2pBL", "at": "2026-11-20T01:05:30", "content": {"txt": "", "ent": [ex("销售合同:澳洲.pdf")]},
         "from_tags": tags["boss"], "member_tags": [tags["boss"], tags["lfh"]], "files": [{"loc": str(uploads / "f1")}], "topic_public": None},
        {"id": 8, "topic": "p2pBL", "at": "2026-11-20T04:00:00", "content": {"txt": "", "ent": [ex("没了.pdf")]},
         "from_tags": tags["boss"], "member_tags": [tags["boss"], tags["lfh"]], "files": [{"loc": str(uploads / "gone-file")}], "topic_public": None},
        {"id": 9, "topic": "p2pDB", "at": "2026-11-20T05:00:00", "content": {"txt": "", "ent": [ex("日报.html")]},
         "from_tags": tags["tdh-daily"], "member_tags": [tags["tdh-daily"], tags["boss"]], "files": [{"loc": str(uploads / "f1")}], "topic_public": None},
        {"id": 10, "topic": "p2pBL", "head": {"tdh_ai": {"v": 1}}, "at": "2026-11-20T06:00:00", "content": {"txt": "", "ent": [ex("ai.pdf")]},
         "from_tags": tags["lfh"], "member_tags": [tags["boss"], tags["lfh"]], "files": [{"loc": str(uploads / "f1")}], "topic_public": None},
    ]
    rows_file = root / "rows.json"
    rows_file.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    psql = root / "psql"
    psql.write_text("#!%s\nimport json, os, re, sys\nassert os.environ.get('PGPASSWORD') == 'db-secret'\n"
                    "sql = sys.argv[sys.argv.index('-c') + 1]\nrows = json.load(open(%r, encoding='utf-8'))\n"
                    "if 'max(id)' in sql:\n    print(12)\nelse:\n"
                    "    a, b = (int(x) for x in re.search(r'm.id > (\\d+) and m.id <= (\\d+)', sql).groups())\n"
                    "    sys.stdout.buffer.write(json.dumps([r for r in rows if a < r['id'] <= b], ensure_ascii=False).encode('utf-8'))\n"
                    % (sys.executable, str(rows_file)), encoding="utf-8")
    psql.chmod(psql.stat().st_mode | stat.S_IEXEC)
    os.environ["TDH_PSQL"] = str(psql)
    os.environ["TZ"] = "Asia/Shanghai"
    import time
    time.tzset()
    cfg = chat_assist.load_config(rt)
    bots = {"tdh-daily": "TDH早报", "tdh-assist": "TDH助手"}
    out = ca.run_once(cfg, rt, people, office, bots)
    got = sorted(str(p.relative_to(company)) for p in company.rglob("*") if p.is_file())
    want = sorted([
        "_office/聊天文件/合同发票报价/2026-11/徐总 与 梁风禾/1120-0905 徐总 销售合同_澳洲.pdf",
        "_office/聊天文件/合同发票报价/2026-11/徐总 与 梁风禾/1120-0905 徐总 销售合同_澳洲 (2).pdf",
        "emp-lfh/聊天文件/合同发票报价/2026-11/徐总/1120-0905 徐总 销售合同_澳洲.pdf",
        "emp-lfh/聊天文件/合同发票报价/2026-11/徐总/1120-0905 徐总 销售合同_澳洲 (2).pdf",
        "_office/聊天文件/图片/2026-11/销售群/1120-1000 王伟 图片.png",
        "emp-lfh/聊天文件/图片/2026-11/销售群/1120-1000 王伟 图片.png",
        "emp-wang/聊天文件/图片/2026-11/销售群/1120-1000 王伟 图片.png",
        "_office/聊天文件/压缩包/2026-11/梁风禾 与 王伟/1120-1100 梁风禾 资料.zip",
        "_office/聊天文件/图片/2026-11/梁风禾 与 王伟/1120-1100 梁风禾 图片.png",
        "emp-lfh/聊天文件/压缩包/2026-11/王伟/1120-1100 梁风禾 资料.zip",
        "emp-lfh/聊天文件/图片/2026-11/王伟/1120-1100 梁风禾 图片.png",
        "emp-wang/聊天文件/压缩包/2026-11/梁风禾/1120-1100 梁风禾 资料.zip",
        "emp-wang/聊天文件/图片/2026-11/梁风禾/1120-1100 梁风禾 图片.png",
    ])
    check(got == want, "the files where they belong:\n%s\nwant:\n%s" % ("\n".join(got), "\n".join(want)))
    check(not (company / "emp-gone").exists(), "a disabled member gets nothing")
    check((company / "_office/聊天文件/图片/2026-11/梁风禾 与 王伟/1120-1100 梁风禾 图片.png").read_bytes() == b"\x89PNG inline", "the picture kept in the message")
    check((company / "emp-wang/聊天文件/图片/2026-11/销售群/1120-1000 王伟 图片.png").read_bytes() == b"\x89PNG group pic", "the uploaded picture, not its preview")
    check(out == {"rows": 7, "files": 6, "copies": 13, "unreadable": 1}, "the counts: %s" % out)
    check(json.loads((rt / "chat-archive-state.json").read_text())["last_id"] == 12, "where it got to")
    out = ca.run_once(cfg, rt, people, office, bots)
    check(out["copies"] == 0 and len([p for p in company.rglob("*") if p.is_file()]) == len(want), "a second round copies nothing again")
    print("CHAT_ARCHIVE_PROVE_OK=1")


if __name__ == "__main__":
    main()
