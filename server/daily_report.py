"""company-daily-report-v1: one page each morning for the boss (requirements F3 and the cash page).

  资金      from each extension pack that offers a /daily section (the manufacturing pack: balances, the day's
            money in and out, acceptances, invoices to chase, exports not paid yet)
  任务卡    open cards, overdue first, what waits for approval (tickets.digest)
  员工      what each person did in TDH the day before: the brain's L0 evidence (one entry per conversation:
            title, what was asked and how it ended), condensed by the site's GPT through this server's own
            gateway into a line or two with what went wrong or is at risk; who did not use TDH, one line

The people service runs it at the configured time (it can sign in to the chat as the sender with a one-time
ticket) and sends a short message in the chat; the whole page goes into each recipient's own folder, 日报/.
runtime/daily-report.json (no file, or no "to": nothing is made or sent):
  {"to": ["<login>"], "from": "tdh", "at": "07:30", "skip": ["tdh"],
   "packs": [{"title": "资金", "url": "http://127.0.0.1:4190/daily"}],
   "gateway": "http://127.0.0.1:8450", "model": "gpt-6.2-sol"}
Nothing here writes to the brain, the board or the packs; only the recipients' 日报/ folder and the state file.
"""
from __future__ import annotations

import html
import json
import re
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

DEFAULTS = {"from": "tdh", "at": "07:30", "skip": ["tdh"], "packs": [], "gateway": "http://127.0.0.1:8450",
            "model": "gpt-6.2-sol"}
_OPEN = urllib.request.build_opener(urllib.request.ProxyHandler({}))      # this machine only, never a proxy


def load_config(runtime: Path) -> dict:
    try:
        cfg = json.loads((Path(runtime) / "daily-report.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    if not isinstance(cfg, dict) or not cfg.get("to"):
        return {}
    return dict(DEFAULTS, **cfg)


def due(now: datetime, cfg: dict, state: dict) -> bool:
    """Time for today's page: past the hour and minute, and not sent today."""
    if not cfg:
        return False
    try:
        hh, mm = (int(x) for x in str(cfg.get("at") or "07:30").split(":", 1))
    except ValueError:
        hh, mm = 7, 30
    return (now.hour, now.minute) >= (hh, mm) and state.get("day") != now.strftime("%Y-%m-%d")


# -- what people did -------------------------------------------------------------------------------------------

def parse_l0(text: str) -> list[dict]:
    """The sessions of one person's L0 day file: time, title, fact, completion."""
    out = []
    for block in re.split(r"\n(?=## session-)", text or ""):
        if not block.startswith("## session-"):
            continue
        row = {}
        for line in block.splitlines()[1:]:
            m = re.match(r"- (time|title|fact|completion|correction_kind): ?(.*)$", line)
            if m:
                row[m.group(1)] = m.group(2).strip()
        if row:
            out.append(row)
    out.sort(key=lambda r: r.get("time", ""))
    return out


def l0_sessions(brain: Path, login: str, day: date) -> list[dict]:
    rows = []
    for f in sorted(Path(brain).glob("10-l0/*/%s/%s/%s.md" % (login, day.strftime("%Y-%m"), day.isoformat()))):
        try:
            rows += parse_l0(f.read_text(encoding="utf-8"))
        except OSError:
            continue
    return rows


def summarize(cfg: dict, token: str, name: str, sessions: list[dict], timeout: float = 60) -> str:
    """A line or two in Chinese from the sessions' titles and facts; "" when the gateway does not answer."""
    if not token or not sessions:
        return ""
    items = "\n".join("- %s｜%s｜%s" % (s.get("title", ""), s.get("fact", "")[:400], s.get("completion", ""))
                      for s in sessions[:30])
    prompt = ("下面是%s昨天在公司 TDH 里的 %d 次工作记录（标题｜要做什么、结果｜完成情况）。\n%s\n\n"
              "用一两句中文写他昨天做了什么，写具体的事，不要套话。有没完成的、出错的或要老板注意的风险，"
              "另起一句以「注意：」开头；没有就不写。只根据记录，不要编。不超过 120 字。") % (name, len(sessions), items)
    body = json.dumps({"model": cfg.get("model") or DEFAULTS["model"], "temperature": 0,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request((cfg.get("gateway") or DEFAULTS["gateway"]).rstrip("/") + "/v1/chat/completions",
                                 data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + token)
    try:
        with _OPEN.open(req, timeout=timeout) as r:
            j = json.loads(r.read().decode("utf-8", "replace"))
        return str(j["choices"][0]["message"]["content"]).strip()[:400]
    except Exception:  # noqa: BLE001 - the page goes out with the plain list instead
        return ""


def people_work(brain: Path, people: dict, day: date, skip: list, depts: dict, cfg: dict, token: str) -> tuple[list, list]:
    """(worked, idle): per active person who used TDH that day, their sessions and a summary; the others' names."""
    worked, idle = [], []
    for login, row in sorted(people.items(), key=lambda kv: (depts.get(kv[1].get("dept"), ""), kv[1].get("name") or kv[0])):
        if login in skip or (row.get("status") or "active") != "active":
            continue
        name = row.get("name") or login
        sessions = l0_sessions(brain, login, day)
        if not sessions:
            idle.append(name)
            continue
        worked.append({"login": login, "name": name, "dept": depts.get(row.get("dept"), ""), "sessions": sessions,
                       "summary": summarize(cfg, token, name, sessions)})
    return worked, idle


# -- the packs' sections ---------------------------------------------------------------------------------------

def pack_sections(cfg: dict, token: str, day: date, timeout: float = 120) -> list[dict]:
    out = []
    for p in cfg.get("packs") or []:
        url = str(p.get("url") or "")
        if not url.startswith("http://127.0.0.1:"):
            continue                                   # this machine only
        req = urllib.request.Request(url, data=json.dumps({"day": day.isoformat()}).encode(), method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer " + token)
        title = str(p.get("title") or "扩展")
        try:
            with _OPEN.open(req, timeout=timeout) as r:
                j = json.loads(r.read().decode("utf-8", "replace"))
            title = str(p.get("title") or j.get("title") or title)
            lines = [str(x) for x in (j.get("lines") or [])][:30]
        except Exception as e:  # noqa: BLE001 - one pack down must not stop the page
            lines = ["这一块今天没取到（%s）" % type(e).__name__]
        out.append({"title": title, "lines": lines})
    return out


# -- the page ----------------------------------------------------------------------------------------------------

WEEK = "一二三四五六日"


def build(day: date, sections: list[dict], cards: str, worked: list, idle: list) -> dict:
    """The chat message (short) and the page (all of it)."""
    head = "TDH 日报 %s（周%s）" % (day.strftime("%m-%d"), WEEK[day.weekday()])
    msg = [head]
    for s in sections:
        msg.append("【%s】" % s["title"])
        msg += ["  " + x for x in s["lines"][:8]]
    if cards:
        lines = cards.splitlines()
        msg.append("【任务卡】" + re.sub(r"^任务卡日报 \S+：", "", lines[0]))
        msg += ["  " + x for x in lines[1:8]]
    msg.append("【员工】%d 人用了 TDH" % len(worked) + ("，%d 人没用" % len(idle) if idle else ""))
    for w in worked:
        msg.append("  %s：%s" % (w["name"], w["summary"] or "%d 次对话：%s" % (
            len(w["sessions"]), "；".join(s.get("title", "") for s in w["sessions"][:3]))))
    if idle:
        msg.append("  没用 TDH：" + "、".join(idle))
    esc = html.escape
    body = []
    for s in sections:
        body.append("<h2>%s</h2><ul>%s</ul>" % (esc(s["title"]), "".join("<li>%s</li>" % esc(x) for x in s["lines"])))
    if cards:
        lines = cards.splitlines()
        body.append("<h2>任务卡</h2><p>%s</p><ul>%s</ul>" % (esc(lines[0]), "".join("<li>%s</li>" % esc(x.lstrip("- ")) for x in lines[1:])))
    rows = []
    for w in worked:
        detail = "".join("<li><span class=m>%s</span> %s<br><span class=m>%s</span></li>" % (
            esc(s.get("time", "")[11:16]), esc(s.get("title", "")), esc(s.get("fact", "")[:300])) for s in w["sessions"])
        rows.append("<div class=p><h3>%s <span class=m>%s · %d 次对话</span></h3><p>%s</p><details><summary>每次对话</summary><ul>%s</ul></details></div>" % (
            esc(w["name"]), esc(w["dept"]), len(w["sessions"]), esc(w["summary"] or "（没能自动概括，看下面每次对话）"), detail))
    body.append("<h2>员工（%d 人用了 TDH）</h2>%s%s" % (len(worked), "".join(rows) or "<p class=m>没有人用</p>",
                                                     ("<p class=m>没用 TDH：%s</p>" % esc("、".join(idle))) if idle else ""))
    page = """<!doctype html><html lang=zh-CN><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>%(head)s</title><style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--t:#16181d;--m:#6b7280;--l:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--card:#1d1f23;--t:#e8e9ec;--m:#9aa0aa;--l:#2c2f35}}
body{margin:0;background:var(--bg);color:var(--t);font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:860px;margin:0 auto;padding:20px 16px 40px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}
h3{font-size:14px;margin:0 0 4px}.m{color:var(--m);font-weight:400}ul{margin:4px 0;padding-left:20px}
.p{background:var(--card);border:1px solid var(--l);border-radius:10px;padding:10px 14px;margin:8px 0}
details summary{cursor:pointer;color:var(--m);font-size:12px}</style></head><body><main>
<h1>%(head)s</h1><div class=m>每天早上自动生成：资金、任务卡、每个人昨天在 TDH 里做了什么</div>%(body)s</main></body></html>""" % {
        "head": esc(head), "body": "".join(body)}
    return {"text": "\n".join(msg), "html": page, "title": head}


def run(cfg: dict, people: dict, depts: dict, brain: Path, cards_text: str, token: str, now: datetime | None = None,
        day: date | None = None) -> dict:
    """Everything but sending: yesterday's page (or the given day's)."""
    now = now or datetime.now()
    day = day or (now.date() - timedelta(days=1))
    sections = pack_sections(cfg, token, day)
    worked, idle = people_work(brain, people, day, list(cfg.get("skip") or []), depts, cfg, token)
    out = build(day, sections, cards_text, worked, idle)
    out["day"] = day.isoformat()
    return out


def write_page(personal: str, day: str, page: str) -> Path | None:
    if not personal:
        return None
    d = Path(str(personal).replace("\\", "/")) / "日报"
    d.mkdir(parents=True, exist_ok=True)
    f = d / ("%s.html" % day)
    f.write_text(page, encoding="utf-8")
    return f


def now_local() -> datetime:
    return datetime.fromtimestamp(time.time())
