#!/usr/bin/env python3
"""Proof for company-kb-organize-v1 (server/kb_organize.py): people's own folders into the knowledge base by themselves.

On temporary folders shaped like the share: customs papers (a zip), an invoice table, a bill, a contract, a payroll
sheet, a quotation and a price list are copied into their zone's category under 来自 <name>; what the rules cannot place
goes to the model: sure, it is filed where it says (_company too); not sure, the person is asked (their 放进去 files it,
不放 never asks again); no admin's list; the person is told what went in; chat copies and hidden folders are not read; a file
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
             "snow-blade-drawing.pdf": b"d", "产品说明书-刮板.pdf": b"manual", "随手记.txt": b"note",
             "聊天文件/图片/a.png": b"chat", ".dsh-desk/x.pdf": b"hidden", "~$锁.xlsx": b"lock"}
    old = time.time() - 600
    for rel, data in files.items():
        p = fay / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        os.utime(p, (old, old))
    fresh = fay / "正在写的发票.pdf"
    fresh.write_bytes(b"busy")
    people = {"guoying": {"login": "guoying", "name": "郭迎", "status": "active", "dept": "d-fin", "personal": str(fay)},
              "tdh": {"login": "tdh", "name": "郑飞飞", "role": "admin", "status": "active"}}
    asked, told, seen = [], [], []

    def model(inner, name, dept, zm):
        seen.append(inner)
        check(zm["private"]["who"] == "郭迎，和管理员（郑飞飞）" and "02 产品与技术" in zm["company"]["categories"], "the menu: %s" % zm)
        if "说明书" in inner:
            return {"zone": "company", "category": "02 产品与技术", "confident": True}
        if "drawing" in inner:
            return {"zone": "company", "category": "02 产品与技术", "confident": False}
        return {"zone": "private", "category": "05 行政事务", "confident": False}

    def ask(login, inner, zone_name, cat, who):
        asked.append((login, inner, zone_name, cat, who))
        return 100 + len(asked)

    out = k.run_once(company, rt, people, model=model, ask=ask, tell=lambda login, items: told.append((login, items)))
    got = sorted(str(p.relative_to(company / "_handbook")) for p in (company / "_handbook").rglob("*") if p.is_file() and p.name != "说明.md")
    want = sorted([
        "d-fin/04 账户税务发票/来自 郭迎/出口报关单.zip", "d-fin/04 账户税务发票/来自 郭迎/2021年发票统计表.xlsx",
        "d-fin/01 财务制度与审批/来自 郭迎/1121 蔚蓝酒店 费用账单.png", "d-fin/02 合同与法务/来自 郭迎/销售合同-澳洲.pdf",
        "d-fin/03 人事与薪酬/来自 郭迎/11月工资表.xlsx", "_sales-finance/01 客户信息/来自 郭迎/报价单-埃及.xlsx",
        "_sales-finance/02 底价与成本/来自 郭迎/TONDA Price List.xlsx", "_company/02 产品与技术/来自 郭迎/产品说明书-刮板.pdf"])
    check(got == want, "into their zones:\n%s\nwant\n%s" % ("\n".join(got), "\n".join(want)))
    check(sorted(seen) == ["snow-blade-drawing.pdf", "产品说明书-刮板.pdf", "随手记.txt"], "only what the rules cannot place goes to the model: %s" % seen)
    check(sorted(a[1] for a in asked) == ["snow-blade-drawing.pdf", "随手记.txt"] and asked[0][0] == "guoying"
          and any(a[2] == "全公司共享区" and a[4] == "全公司" for a in asked), "the unsure ones asked of their person: %s" % asked)
    check(out["copied"] == 8 and out["asked"] == 2 and out["unstable"] == 1 and out["finance"] == 1, "the counts: %s" % out)
    check(not (company / "_office" / "知识库待确认.md").exists(), "no admin's list")
    check(told and told[0][0] == "guoying" and len(told[0][1]) == 8 and ("出口报关单.zip", "行政财务私密区", "04 账户税务发票") in told[0][1],
          "the person told what went in: %s" % told)
    drawing = next(a for a in asked if a[1] == "snow-blade-drawing.pdf")
    note = next(a for a in asked if a[1] == "随手记.txt")
    check(not k.decide(rt, "tdh", 101, True), "someone else's answer does not count")
    check(k.decide(rt, "guoying", 100 + asked.index(drawing) + 1, True) and k.decide(rt, "guoying", 100 + asked.index(note) + 1, False), "their answers")
    inbox = list((rt / "mfg" / "finance-inbox").iterdir())
    check(len(inbox) == 1 and inbox[0].name.endswith("2021年发票统计表.xlsx"), "the invoice table to the finance inbox: %s" % inbox)
    check((fay / "2021年发票统计表.xlsx").exists(), "the person keeps theirs")
    out = k.run_once(company, rt, people, model=model, ask=ask)
    check(out["copied"] == 1 and (company / "_handbook" / "_company" / "02 产品与技术" / "来自 郭迎" / "snow-blade-drawing.pdf").exists()
          and len(asked) == 2 and out["finance"] == 0, "放进去 files it, 不放 is not asked again, nothing else again: %s %s" % (out, asked))
    check(not list((company / "_handbook").rglob("随手记.txt")), "不放: not in")
    os.utime(fresh, (old, old))
    (fay / "报价单-埃及.xlsx").write_bytes(b"q2")
    os.utime(fay / "报价单-埃及.xlsx", (old + 60, old + 60))
    out = k.run_once(company, rt, people, model=model, ask=ask)
    check((company / "_handbook" / "_sales-finance" / "01 客户信息" / "来自 郭迎" / "报价单-埃及 (2).xlsx").read_bytes() == b"q2"
          and (company / "_handbook" / "d-fin" / "04 账户税务发票" / "来自 郭迎" / "正在写的发票.pdf").exists(), "a new version beside; the waiting one now: %s" % out)
    print("KB_ORGANIZE_PROVE_OK=1")


if __name__ == "__main__":
    main()
