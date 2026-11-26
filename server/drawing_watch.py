"""company-drawing-watch-v1: who opened or downloaded the mould drawings, in 田总's next morning report.

The user, 2026-11-21: the mould drawings stay in the shared zone ("模具图纸相关都放在共享区"), but anyone who views or
downloads one is told to 田总 in the next day's report ("任何人查看或者下载过 在第二天的日报通知田总").

People open the share's files themselves (a mapped drive), not through TDH, so only Windows can say who read one: the
File System audit (event 4663, a read of a file in a folder that carries a read audit entry), each person on their own
account (smb-<login>, server/smb-accounts.ps1). Turning that audit on is a security setting the server's
administrator makes (the commands are in the hand-over); this module only reads the log.

runtime/drawing-watch.json: {"folders": [paths under company], "pattern": what counts as a drawing (the name),
"to": [logins told]}. On a viewer's account only (smb-*): TDH's own services reading a file (the index, the sorting)
are not people. Over SMB opening and downloading are both reads; the report says 打开或下载. Each person: each file
once (its first time that day, and how many times). With the audit off the section says so.
"""
from __future__ import annotations

import json
import re
import subprocess
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

DEFAULT = {"folders": ["_handbook/_company/02 产品与技术"],
           "pattern": r"模具|mold|mould|drawing|图纸|\.(dwg|dxf|step|stp|igs|iges|stl|x_t|sldprt|sldasm|slddrw)$", "to": []}
NS = {"e": "http://schemas.microsoft.com/win/2004/08/events/event"}
READ_MASK = 0x1          # ReadData
OFFICE_TEMP = re.compile(r"^~\$|\.tmp$", re.I)


def config(runtime: Path) -> dict:
    try:
        j = json.loads((Path(runtime) / "drawing-watch.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        j = {}
    return dict(DEFAULT, **{k: v for k, v in j.items() if v})


def query(day: date, since: datetime | None = None, until: datetime | None = None) -> str:
    """The day's 4663 events from the Security log, as wevtutil gives them (XML, one <Event> each); since/until (local
    times, company-evening-report-v1): that window instead of the day."""
    start = (since or datetime.combine(day, datetime.min.time())).astimezone(timezone.utc)
    end = until.astimezone(timezone.utc) if until else start + timedelta(days=1)
    q = "*[System[(EventID=4663) and TimeCreated[@SystemTime>='%s' and @SystemTime<'%s']]]" % (
        start.strftime("%Y-%m-%dT%H:%M:%S.000Z"), end.strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    r = subprocess.run(["wevtutil", "qe", "Security", "/q:" + q, "/f:xml"], capture_output=True, timeout=300)
    return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else ""


def audit_on(company: Path, folders: list) -> bool:
    """Whether a watched folder carries a read audit entry (read-only: Get-Acl -Audit)."""
    for f in folders:
        p = str(Path(company) / f)
        r = subprocess.run(["powershell", "-NoProfile", "-Command",
                            "(Get-Acl -LiteralPath '%s' -Audit).GetAuditRules($true,$true,[System.Security.Principal.SecurityIdentifier]).Count" % p.replace("'", "''")],
                           capture_output=True, timeout=60)
        try:
            if int(r.stdout.decode().strip() or 0) > 0:
                return True
        except ValueError:
            pass
    return False


def reads(xml_text: str, company: Path, cfg: dict) -> list:
    """[(login, file name, local time)] of people's reads of watched drawings, in the order they came."""
    roots = [str(Path(company) / f).replace("/", "\\").lower().rstrip("\\") + "\\" for f in cfg["folders"]]
    pat = re.compile(cfg["pattern"], re.I)
    out = []
    for m in re.finditer(r"<Event[ >].*?</Event>", xml_text or "", re.S):
        try:
            ev = ET.fromstring(m.group(0))
        except ET.ParseError:
            continue
        data = {d.get("Name"): (d.text or "") for d in ev.iterfind(".//e:EventData/e:Data", NS)}
        user, obj = data.get("SubjectUserName", ""), data.get("ObjectName", "")
        try:
            mask = int(data.get("AccessMask", "0"), 16)
        except ValueError:
            mask = 0
        if not user.lower().startswith("smb-") or not mask & READ_MASK:
            continue
        low = obj.replace("/", "\\").lower()
        if not any(low.startswith(r) for r in roots):
            continue
        name = obj.replace("/", "\\").rsplit("\\", 1)[-1]
        if not name or OFFICE_TEMP.search(name) or not pat.search(name):
            continue
        t = ev.find("e:System/e:TimeCreated", NS)
        when = ""
        try:
            when = datetime.strptime(str(t.get("SystemTime"))[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).astimezone().strftime("%H:%M")
        except (AttributeError, ValueError):
            pass
        out.append((user[4:].lower(), name, when))
    return out


def lines(found: list, people: dict) -> list:
    """The report's lines: one per person, each file once with its first time and how many times."""
    by: dict = {}
    for login, name, when in found:
        files = by.setdefault(login, {})
        f = files.setdefault(name, {"first": when, "n": 0})
        f["n"] += 1
    out = []
    for login, files in sorted(by.items(), key=lambda x: str((people.get(x[0]) or {}).get("name") or x[0])):
        who = str((people.get(login) or {}).get("name") or login)
        bits = ["%s %s%s" % (n, f["first"], "（%d 次）" % f["n"] if f["n"] > 1 else "") for n, f in sorted(files.items(), key=lambda x: x[1]["first"])]
        out.append("%s：打开或下载 %d 个——%s" % (who, len(files), "；".join(bits[:12]) + ("……" if len(bits) > 12 else "")))
    return out


def section(company: Path, runtime: Path, people: dict, day: date, query_fn=query, audit_fn=audit_on,
            since: datetime | None = None, until: datetime | None = None) -> dict:
    """{"title", "lines"} for the report of those told (cfg "to"); since/until: the evening report's 24 hours."""
    cfg = config(runtime)
    found = reads(query_fn(day, since, until) if since else query_fn(day), company, cfg)
    ls = lines(found, people)
    if not ls:
        ls = [("%s以来没有人打开或下载模具图纸。" % since.strftime("昨天 %H:%M")) if since else "昨天没有人打开或下载模具图纸。"] \
            if audit_fn(company, cfg["folders"]) else ["服务器还没开文件访问审核，记不到谁看过图纸（要管理员在服务器上开一次）。"]
    return {"title": "模具图纸查看", "lines": ls}
