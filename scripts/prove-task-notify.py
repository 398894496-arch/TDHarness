#!/usr/bin/env python3
"""Prove task-card reminders: due-soon goes to the assignee, overdue to the assignee and the
issuer, each once per day; closed cards and cards without a due time stay quiet; the admins'
page lists overdue and waiting cards; WeCom sends only when configured and only to mapped
people, through the configured proxy setting, against a fake WeCom server.
Ends with TASK_NOTIFY_PROVE_OK=1."""
from __future__ import annotations

import http.server
import json
import os
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sent = []


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self._json({"errcode": 0, "access_token": "tok", "expires_in": 7200})

    def do_POST(self):
        sent.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self._json({"errcode": 0})

    def _json(self, j):
        raw = json.dumps(j).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)


srv = http.server.HTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["WECOM_API_BASE"] = "http://127.0.0.1:%d" % srv.server_address[1]
sys.path.insert(0, str(HERE.parent / "server"))
import notify  # noqa: E402
import tickets  # noqa: E402


def check(cond, what):
    if not cond:
        raise SystemExit("TASK_NOTIFY_PROVE_FAIL " + what)


root = Path(tempfile.mkdtemp(prefix="tdh-notify-"))
company = root / "company"
people = {"boss": {"login": "boss", "role": "admin", "dept": "ops", "personal": str(company / "emp-boss")},
          "amy": {"login": "amy", "role": "employee", "dept": "ops", "personal": str(company / "emp-amy")}}
b = tickets.Board(root / "tickets.json", company)
boss, amy = people["boss"], people["amy"]
H = 3600 * 1000
now = tickets.now_ms()
soon = b.apply("issue", boss, people, {"to": "amy", "title": "快到期", "due": now + 5 * H})["ticket"]
late = b.apply("issue", boss, people, {"to": "amy", "title": "超期了", "due": now - H})["ticket"]
far = b.apply("issue", boss, people, {"to": "amy", "title": "还早", "due": now + 72 * H})["ticket"]
b.apply("issue", boss, people, {"to": "amy", "title": "没截止"})
done = b.apply("issue", boss, people, {"to": "amy", "title": "作废的", "due": now - H})["ticket"]
b.apply("cancel", boss, people, {"ticket": done, "reason": "不要了"})

n = tickets.collect_notices(b, people, now)
got = sorted((x["to"], x["kind"], x["ticket"]) for x in n)
check(got == sorted([("amy", "soon", soon), ("amy", "overdue", late), ("boss", "overdue", late)]), "notices %r" % got)
check(tickets.collect_notices(b, people, now) == [], "nothing twice on the same day")
nxt = sorted((x["to"], x["kind"], x["ticket"]) for x in tickets.collect_notices(b, people, now + 24 * H))
check(nxt == sorted([("amy", "overdue", soon), ("boss", "overdue", soon), ("amy", "overdue", late), ("boss", "overdue", late)]),
      "next day: both now overdue, each to assignee and issuer %r" % nxt)
# company-chat-tasks-v1: a due with a time of day is told once more within the hour, and then not as "soon" again;
# a due that is a whole day (23:59:59) is not.
b2 = tickets.Board(root / "tickets2.json", company)
t = tickets.datetime.fromtimestamp(now / 1000).replace(hour=15, minute=0, second=0, microsecond=0)
meet = b2.apply("issue", boss, people, {"to": "amy", "title": "开会", "due": int(t.timestamp() * 1000)})["ticket"]
day_end = b2.apply("issue", boss, people, {"to": "amy", "title": "当天内", "due": t.strftime("%Y-%m-%d")})["ticket"]
at = lambda h, m: int(t.replace(hour=h, minute=m).timestamp() * 1000)
k = lambda when: sorted((x["kind"], x["ticket"], x["text"]) for x in tickets.collect_notices(b2, people, when))
first = k(at(9, 0))
check([(a, b_) for a, b_, _ in first] == sorted([("soon", meet), ("soon", day_end)]), "the morning: both soon %r" % first)
check(all("负责人 amy" in x for _, _, x in first), "the owner by name (no name: the login)")
check([(a, b_) for a, b_, _ in k(at(14, 10))] == [("hour", meet)], "within the hour: the meeting only")
check(k(at(14, 40)) == [], "once within the hour, and no second soon after it")
page = tickets.digest(b, people, now, "boss")
check("超期 1 张" in page and "超期了" in page and "作废的" not in page and "amy 4" in page, "digest %r" % page)
people["eve"] = {"login": "eve", "role": "admin", "dept": "ops", "personal": str(company / "emp-eve")}
check(tickets.digest(b, people, now, "eve") == "", "another admin's page lists cards that are not theirs (point to point)")

rt = root / "runtime"
rt.mkdir()
wc = notify.WeCom(rt)
check(wc.send("amy", "x") == "off" and not sent, "off until configured")
try:
    tickets.parse_due(1764000000)
    check(False, "a due in seconds is refused")
except tickets.Refused:
    pass
(rt / "wecom.env").write_text("WECOM_CORP_ID=c\nWECOM_AGENT_ID=100\nWECOM_SECRET=s\n", encoding="utf-8")
(rt / "wecom-users.json").write_text(json.dumps({"amy": "ZhangAmy"}), encoding="utf-8")
wc = notify.WeCom(rt)
check(wc.send("boss", "x") == "no-userid", "unmapped person not messaged")
check(wc.send("amy", n[0]["text"]) == "sent", "sent")
check(sent and sent[-1]["touser"] == "ZhangAmy" and sent[-1]["agentid"] == 100 and "任务卡" in sent[-1]["text"]["content"], "message %r" % sent[-1:])
notify.log(rt, "amy", "soon", soon, "sent")
check("\tamy\tsoon\t" in (rt / "notify.log").read_text(encoding="utf-8"), "logged")
srv.shutdown()
print("TASK_NOTIFY_PROVE_OK=1")
