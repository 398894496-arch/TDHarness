#!/usr/bin/env python3
"""Proof for company-drawing-watch-v1 (server/drawing_watch.py): who opened or downloaded the mould drawings.

On sample Security-log events (4663): a person's reads of a drawing in the watched folder, counted once a file with
its first time; a TDH service account's read, a write, a file outside the folder, a file that is not a drawing and an
Office lock file are not people reading drawings; with no reads the section says nobody did, or, with the audit off,
that it cannot tell. Prints DRAWING_WATCH_PROVE_OK=1.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
os.environ["TZ"] = "Asia/Shanghai"
time.tzset()
import drawing_watch as w  # noqa: E402


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("DRAWING_WATCH_PROVE_FAIL " + what)


def ev(user: str, obj: str, mask: str, utc: str) -> str:
    return ("<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><EventID>4663</EventID>"
            "<TimeCreated SystemTime='%s'/></System><EventData><Data Name='SubjectUserName'>%s</Data>"
            "<Data Name='ObjectName'>%s</Data><Data Name='AccessMask'>%s</Data></EventData></Event>") % (utc, user, obj, mask)


def main() -> None:
    company = Path(tempfile.mkdtemp(prefix="tdh-draw-")) / "company"
    rt = company.parent / "runtime"
    rt.mkdir(parents=True)
    d = str(company / "_handbook" / "_company" / "02 产品与技术").replace("/", "\\")
    xml = "".join([
        ev("smb-guoying", d + "\\来自 潘志涛\\600403-pu-casting-mold-A0.pdf", "0x1", "2026-11-21T02:15:30.1Z"),
        ev("smb-guoying", d + "\\来自 潘志涛\\600403-pu-casting-mold-A0.pdf", "0x1", "2026-11-21T03:00:00.1Z"),
        ev("SMB-LIANGFENGHE", d + "\\来自 梁风禾\\snow-blade-800-drawing.pdf", "0x1", "2026-11-21T06:05:00.1Z"),
        ev("smb-zhangyuan", d + "\\来自 潘志涛\\mold-305x106-structure.png", "0x1", "2026-11-21T01:00:00.1Z"),
        ev("TDHSVC$", d + "\\来自 潘志涛\\600403-ref-1.png", "0x1", "2026-11-21T01:00:00.1Z"),          # the index reading
        ev("smb-zhangyuan", d + "\\来自 潘志涛\\600403-pu-open-casting-mold-A1.pdf", "0x2", "2026-11-21T01:00:00.1Z"),   # a write
        ev("smb-zhangyuan", str(company / "emp-panzhitao" / "600403-mold.pdf").replace("/", "\\"), "0x1", "2026-11-21T01:00:00.1Z"),
        ev("smb-zhangyuan", d + "\\来自 郭迎\\产品说明书.docx", "0x1", "2026-11-21T01:00:00.1Z"),        # not a drawing
        ev("smb-zhangyuan", d + "\\来自 潘志涛\\~$mold-A0.dwg", "0x1", "2026-11-21T01:00:00.1Z"),        # a lock file
    ])
    people = {"guoying": {"name": "郭迎"}, "liangfenghe": {"name": "梁风禾"}, "zhangyuan": {"name": "张媛"}}
    s = w.section(company, rt, people, date(2026, 11, 21), query_fn=lambda day: xml, audit_fn=lambda c, f: True)
    check(s["title"] == "模具图纸查看", s["title"])
    check(s["lines"] == ["张媛：打开或下载 1 个——mold-305x106-structure.png 09:00",
                         "梁风禾：打开或下载 1 个——snow-blade-800-drawing.pdf 14:05",
                         "郭迎：打开或下载 1 个——600403-pu-casting-mold-A0.pdf 10:15（2 次）"], "the lines: %s" % s["lines"])
    s = w.section(company, rt, people, date(2026, 11, 21), query_fn=lambda day: "", audit_fn=lambda c, f: True)
    check(s["lines"] == ["昨天没有人打开或下载模具图纸。"], "nobody: %s" % s["lines"])
    s = w.section(company, rt, people, date(2026, 11, 21), query_fn=lambda day: "", audit_fn=lambda c, f: False)
    check("还没开文件访问审核" in s["lines"][0], "the audit off is said: %s" % s["lines"])
    print("DRAWING_WATCH_PROVE_OK=1")


if __name__ == "__main__":
    main()
