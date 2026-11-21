#!/usr/bin/env python3
"""Proof for company-daily-report-v1 (server/daily_report.py and the people service's part).

- The page: the packs' money lines (loopback only; a pack that does not answer says so), the task cards'
  morning page, and each active person's day from the brain's L0 evidence, condensed by the gateway's GPT
  (the service token, the sessions' titles and facts in the prompt); without the gateway the titles stand in.
  Who did not use TDH is one line; the skipped logins are left out. The page is escaped and has no script.
- When: past the configured time and not sent today; no config or no "to": never.
- The people service: POST /company/daily-report is for admins; dry makes the page in the recipient's own
  日报/ folder and sends nothing (no state written), a bad day is refused; the loop and chat_send are there.
Prints DAILY_REPORT_PROVE_OK=1.
"""
from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("daily_report", HERE.parent / "server" / "daily_report.py")
dr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dr)


def check(cond, what):
    if not cond:
        raise SystemExit("DAILY_REPORT_PROVE_FAIL " + what)


SEEN = {"gw": [], "pack": []}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path == "/v1/chat/completions":
            SEEN["gw"].append((self.headers.get("Authorization"), body))
            out = {"choices": [{"message": {"content": "整理了甲公司的报价单并核了料重。\n注意：报价还没发给客户。"}}]}
        else:
            SEEN["pack"].append((self.headers.get("Authorization"), body))
            out = {"title": "资金", "lines": ["壹通达 余额：人民币 1,000.00", "付了款还没收到票 8,000.00"]}
        raw = json.dumps(out, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


fake = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=fake.serve_forever, daemon=True).start()
FAKE = "http://127.0.0.1:%d" % fake.server_address[1]

root = Path(tempfile.mkdtemp(prefix="tdh-daily-"))
day = date(2026, 11, 20)
L0 = """---
date: 2026-11-20
owner: alice
layer: l0
---

# L0 d-1 / alice / 2026-11-20

## session-b
- time: 2026-11-20T15:10:00.000+08:00
- title: 核甲公司报价 <b>加急</b>
- fact: 要求：按新料价核甲公司 600×300 筛板报价 | 结果：报价单已出
- completion: reported-complete

## session-a
- time: 2026-11-20T09:05:00.000+08:00
- title: 查 11 月生产进度
- fact: 要求：26-11-3 什么时候好 | 结果：预计 11-24
- completion: reported-complete
"""
f = root / "brain" / "10-l0" / "d-1" / "alice" / "2026-11" / "2026-11-20.md"
f.parent.mkdir(parents=True)
f.write_text(L0, encoding="utf-8")
(root / "brain" / "10-l0" / "boss" / "tdh" / "2026-11").mkdir(parents=True)
(root / "brain" / "10-l0" / "boss" / "tdh" / "2026-11" / "2026-11-20.md").write_text(L0.replace("alice", "tdh"), encoding="utf-8")

s = dr.parse_l0(L0)
check(s[0]["title"].startswith("查 11 月") and s[1]["title"].startswith("核甲公司") and s[0]["completion"] == "reported-complete", "L0 sessions in time order: %r" % s)

people = {"tdh": {"login": "tdh", "role": "admin", "status": "active"},
          "alice": {"login": "alice", "name": "王小丽", "dept": "d-1", "status": "active"},
          "bob": {"login": "bob", "name": "李大海", "dept": "d-2", "status": "active"},
          "gone": {"login": "gone", "name": "离职的", "dept": "d-2", "status": "disabled"}}
depts = {"d-1": "销售", "d-2": "生产设计"}
cards = "任务卡日报 11-21：进行中 2 张\n超期 1 张：\n- alice「报价」截止 11-20 18:00\n按人：alice 2"
cfg = dict(dr.DEFAULTS, to=["tdh"], gateway=FAKE, packs=[{"title": "资金", "url": FAKE + "/daily"},
                                                          {"title": "外面的", "url": "http://example.com/daily"},
                                                          {"title": "行情", "url": FAKE + "/daily-market", "weekdays": [0]}])
out = dr.run(cfg, people, depts, root / "brain", cards, "svc_token", now=datetime(2026, 11, 21, 7, 31))
t = out["text"]
check(out["day"] == "2026-11-20" and t.startswith("TDH 日报 11-20（周五）"), "yesterday's page, weekday: " + t[:30])
check("【资金】" in t and "壹通达 余额：人民币 1,000.00" in t and "外面的" not in t, "the loopback pack's lines, nothing from elsewhere")
check("【行情】" not in t, "a Monday-only pack is left out on a Saturday")
t_mon = dr.run(cfg, people, depts, root / "brain", cards, "svc_token", now=datetime(2026, 11, 23, 7, 31))["text"]
check("【行情】" in t_mon, "and is there on Monday")
check("【任务卡】进行中 2 张" in t and "alice「报价」" in t, "the cards' page")
check("【员工】1 人用了 TDH，1 人没用" in t and "王小丽：整理了甲公司的报价单并核了料重。 注意：报价还没发给客户。" in t and "没用 TDH：李大海" in t, "people, one line each: " + t)
check("离职的" not in t and "tdh：" not in t, "disabled and skipped logins left out")
auth, body = SEEN["gw"][0]
prompt = body["messages"][0]["content"]
check(auth == "Bearer svc_token" and "核甲公司报价" in prompt and "查 11 月生产进度" in prompt and "不要编" in prompt, "the gateway asked with the service token and the sessions")
check(SEEN["pack"][0] == ("Bearer svc_token", {"day": "2026-11-20"}), "the pack asked for that day with the service token")
h = out["html"]
check("<script" not in h and "&lt;b&gt;加急&lt;/b&gt;" in h and "<b>加急" not in h and "prefers-color-scheme:dark" in h, "page escaped, no script, dark mode")

cfg2 = dict(cfg, gateway="http://127.0.0.1:%d" % free_port(), packs=[{"title": "资金", "url": "http://127.0.0.1:%d/daily" % free_port()}])
t2 = dr.run(cfg2, people, depts, root / "brain", "", "svc_token", now=datetime(2026, 11, 21, 7, 31))["text"]
check("王小丽：2 次对话：查 11 月生产进度；核甲公司报价" in t2, "no gateway: the titles stand in: " + t2)
check("这一块今天没取到" in t2 and "【任务卡】" not in t2, "a pack down says so; no cards, no cards section")

st = {}
check(not dr.due(datetime(2026, 11, 21, 7, 29), cfg, st) and dr.due(datetime(2026, 11, 21, 7, 30), cfg, st), "due from 07:30")
check(not dr.due(datetime(2026, 11, 21, 9, 0), cfg, {"day": "2026-11-21"}) and not dr.due(datetime(2026, 11, 21, 9, 0), {}, {}), "once a day; never without config")
check(dr.due(datetime(2026, 11, 21, 11, 29), cfg, st) and not dr.due(datetime(2026, 11, 21, 11, 30), cfg, st) and not dr.due(datetime(2026, 11, 20, 23, 10), cfg, st), "only within 4 hours of 07:30: never late at night")
# company-evening-report-v1: at 17:00 the page is the day's own, the 24 hours up to it: the evening before (the real
# brain) and the day so far (the scratch brain the service makes just before); the morning's slot does not stop it.
ev = dict(cfg, at="17:00")
check(dr.evening(ev) and not dr.evening(cfg), "17:00 is the evening page")
check(dr.due(datetime(2026, 11, 21, 17, 0), ev, {"day": "2026-11-21"}) and not dr.due(datetime(2026, 11, 21, 16, 59), ev, {})
      and not dr.due(datetime(2026, 11, 21, 17, 5), ev, {"day": "2026-11-21", "slot": "2026-11-21@17:00"}), "evening slot apart from the morning")
today = root / "today"
tf = today / "10-l0" / "d-1" / "alice" / "2026-11" / "2026-11-21.md"
tf.parent.mkdir(parents=True)
tf.write_text(L0.replace("2026-11-20T15:10", "2026-11-21T10:00").replace("2026-11-20T09:05", "2026-11-21T18:30"), encoding="utf-8")
SEEN["gw"].clear()
eo = dr.run(ev, people, depts, root / "brain", cards, "svc_token", now=datetime(2026, 11, 21, 17, 0), today_brain=today)
pr = SEEN["gw"][-1][1]["messages"][0]["content"]
check(eo["late"] and eo["day"] == "2026-11-21" and eo["text"].startswith("TDH 晚报 11-21（周六）") and "傍晚" in eo["html"], "the evening page: " + eo["text"][:30])
check("王小丽今天在公司 TDH 里的 1 次" in pr and "核甲公司报价" in pr and "查 11 月生产进度" not in pr, "yesterday after 17:00 and today before now, not yesterday morning nor after now: " + pr[:200])
check(eo["since"] == datetime(2026, 11, 20, 17, 0), "since the evening before")

rt = root / "rt"
rt.mkdir()
check(dr.load_config(rt) == {}, "no file, no config")
(rt / "daily-report.json").write_text(json.dumps({"at": "08:00"}), encoding="utf-8")
check(dr.load_config(rt) == {}, "no recipients, no config")
(rt / "daily-report.json").write_text(json.dumps({"to": ["x"], "at": "08:00"}), encoding="utf-8")
c = dr.load_config(rt)
check(c["at"] == "08:00" and c["from"] == "tdh-daily" and c["skip"] == ["tdh"], "defaults under the file's values")
p = dr.write_page(str(root / "company" / "emp-x"), "2026-11-20", h)
check(p is not None and p.name == "2026-11-20.html" and p.parent.name == "日报", "the page in the recipient's 日报/")

# The people service: admin endpoint, dry run into the recipient's own folder, nothing sent, no state.
runtime = root / "runtime"
(runtime / "caddy").mkdir(parents=True)
(root / "company" / "emp-tdh").mkdir(parents=True, exist_ok=True)
(runtime / "roster.json").write_text(json.dumps({"owner": "test", "depts": [{"id": "d-1", "name": "销售"}], "people": [
    {"login": "tdh", "role": "admin", "dept": "company", "status": "active", "pid": "p-seed", "personal": str(root / "company" / "emp-tdh")},
    {"login": "alice", "name": "王小丽", "role": "employee", "dept": "d-1", "status": "active", "pid": "p-a"}]}), encoding="utf-8")
(runtime / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
(runtime / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
(runtime / "gw-service.token").write_text("svc_token", encoding="utf-8")
(runtime / "daily-report.json").write_text(json.dumps({"to": ["tdh"], "gateway": FAKE, "packs": [{"title": "资金", "url": FAKE + "/daily"}]}), encoding="utf-8")
port = free_port()
env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(runtime / "lease"),
           TDH_SMB_LEDGER=str(root / "smb.jsonl"), TDH_CHAT_PROVISION="0", TDH_DAILY_REPORT="0", TDH_NOTIFY_EVERY="0")
proc = subprocess.Popen([sys.executable, str(HERE.parent / "server" / "people-api.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def call(path, body, token=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


try:
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    code, hit = call("/company/login", {"username": "tdh", "password": "seed-pass-123"})
    check(code == 200 and hit.get("ok"), "seed login")
    admin = hit["gw_token"]
    check(call("/company/daily-report", {"dry": True})[0] == 403, "no token: refused")
    check(call("/company/daily-report", {"dry": True, "day": "11-20"}, admin)[0] == 400, "a bad day is refused")
    code, j = call("/company/daily-report", {"dry": True, "day": "2026-11-20"}, admin)
    check(code == 200 and j.get("ok") and j["day"] == "2026-11-20" and j["sent"] == [], "dry: made, not sent: %r" % j)
    check(j["files"] == ["emp-tdh/日报/2026-11-20.html"] and (root / "company" / "emp-tdh" / "日报" / "2026-11-20.html").is_file(), "the page in tdh's own folder")
    check("王小丽：整理了甲公司的报价单" in j["text"] and "【资金】" in j["text"], "the service's page has the people and the money")
    check(not (runtime / "daily-report-state.json").exists(), "a dry run leaves no state")
    check("day=2026-11-20 dry=True" in (root / "logs" / "daily-report.log").read_text(encoding="utf-8"), "one log line, no content")
finally:
    proc.terminate()
    proc.wait(timeout=5)
    fake.shutdown()

src = (HERE.parent / "server" / "people-api.py").read_text(encoding="utf-8")
check("def chat_send(sender: str, to: str, text: str)" in src and '{"pub": {"topic": topic, "noecho": True, "content": text}}' in src, "chat_send posts as the sender")
check('target=daily_report_loop' in src and 'TDH_DAILY_REPORT", "1") != "0"' in src, "the loop starts unless turned off")
check('row.get("role") != "admin"' in src.split('if path == "/company/daily-report":')[1][:400], "the endpoint is for admins")
print("DAILY_REPORT_PROVE_OK=1")
