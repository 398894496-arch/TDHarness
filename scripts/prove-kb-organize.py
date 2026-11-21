#!/usr/bin/env python3
"""Proof for company-kb-organize-v1 (server/kb_organize.py): people's own folders into the knowledge base by themselves.

On temporary folders shaped like the share: customs papers (a zip), an invoice table, a bill, a contract, a payroll
sheet, a quotation and a price list are copied into their zone's category under 来自 <name>; a drawing nobody can place
is listed for the admins (nothing goes to _company by itself); chat copies and hidden folders are not read; a file
still being written waits; the invoice table also goes to the finance store's inbox; a second round copies nothing;
a changed file comes in beside the old one; the person keeps theirs. Prints KB_ORGANIZE_PROVE_OK=1.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
import kb_organize as k  # noqa: E402


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("KB_ORGANIZE_PROVE_FAIL " + what)


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="tdh-kborg-"))
    company, rt = root / "company", root / "runtime"
    rt.mkdir(parents=True)
    (rt / "kb-zones.json").write_text(json.dumps({"private": ["d-fin"], "groups": [{"dir": "_sales-finance", "depts": ["d-sales", "d-fin"]}]}), encoding="utf-8")
    for zone, cats in (("d-fin", ["01 财务制度与审批", "02 合同与法务", "03 人事与薪酬", "04 账户税务发票", "05 行政事务"]),
                       ("_sales-finance", ["01 客户信息", "02 底价与成本"]), ("_company", ["02 产品与技术"])):
        for c in cats:
            (company / "_handbook" / zone / c).mkdir(parents=True)
            (company / "_handbook" / zone / c / "说明.md").write_text("x", encoding="utf-8")
    (company / "_office").mkdir()
    fay = company / "emp-guoying"
    files = {"上传到知识库/出口报关单.zip": b"PK zip", "2021年发票统计表.xlsx": b"xlsx1", "1121 蔚蓝酒店 费用账单.png": b"png",
             "合同/销售合同-澳洲.pdf": b"pdf", "11月工资表.xlsx": b"pay", "报价单-埃及.xlsx": b"q", "TONDA Price List.xlsx": b"pl",
             "snow-blade-drawing.pdf": b"d", "聊天文件/图片/a.png": b"chat", ".dsh-desk/x.pdf": b"hidden", "~$锁.xlsx": b"lock"}
    old = time.time() - 600
    for rel, data in files.items():
        p = fay / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        os.utime(p, (old, old))
    fresh = fay / "正在写的发票.pdf"
    fresh.write_bytes(b"busy")
    people = {"guoying": {"login": "guoying", "name": "郭迎", "status": "active", "personal": str(fay)}}
    out = k.run_once(company, rt, people)
    got = sorted(str(p.relative_to(company / "_handbook")) for p in (company / "_handbook").rglob("*") if p.is_file() and p.name != "说明.md")
    want = sorted([
        "d-fin/04 账户税务发票/来自 郭迎/出口报关单.zip", "d-fin/04 账户税务发票/来自 郭迎/2021年发票统计表.xlsx",
        "d-fin/01 财务制度与审批/来自 郭迎/1121 蔚蓝酒店 费用账单.png", "d-fin/02 合同与法务/来自 郭迎/销售合同-澳洲.pdf",
        "d-fin/03 人事与薪酬/来自 郭迎/11月工资表.xlsx", "_sales-finance/01 客户信息/来自 郭迎/报价单-埃及.xlsx",
        "_sales-finance/02 底价与成本/来自 郭迎/TONDA Price List.xlsx"])
    check(got == want, "into their zones:\n%s\nwant\n%s" % ("\n".join(got), "\n".join(want)))
    check(not list((company / "_handbook" / "_company").rglob("*.pdf")), "nothing into _company by itself")
    check(out["copied"] == 7 and out["review"] == 1 and out["unstable"] == 1 and out["finance"] == 1, "the counts: %s" % out)
    page = (company / "_office" / "知识库待确认.md").read_text(encoding="utf-8")
    check("snow-blade-drawing.pdf" in page and "郭迎" in page and "聊天文件" not in page, "the admins' list: " + page)
    inbox = list((rt / "mfg" / "finance-inbox").iterdir())
    check(len(inbox) == 1 and inbox[0].name.endswith("2021年发票统计表.xlsx"), "the invoice table to the finance inbox: %s" % inbox)
    check((fay / "2021年发票统计表.xlsx").exists(), "the person keeps theirs")
    out = k.run_once(company, rt, people)
    check(out["copied"] == 0 and out["finance"] == 0, "a second round copies nothing: %s" % out)
    os.utime(fresh, (old, old))
    (fay / "报价单-埃及.xlsx").write_bytes(b"q2")
    os.utime(fay / "报价单-埃及.xlsx", (old + 60, old + 60))
    out = k.run_once(company, rt, people)
    check((company / "_handbook" / "_sales-finance" / "01 客户信息" / "来自 郭迎" / "报价单-埃及 (2).xlsx").read_bytes() == b"q2"
          and (company / "_handbook" / "d-fin" / "04 账户税务发票" / "来自 郭迎" / "正在写的发票.pdf").exists(), "a new version beside; the waiting one now: %s" % out)
    print("KB_ORGANIZE_PROVE_OK=1")


if __name__ == "__main__":
    main()
