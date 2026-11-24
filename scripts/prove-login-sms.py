#!/usr/bin/env python3
"""Proof for company-login-sms-v1 and company-login-remember-v1 (server/login_sms.py, people-api).

server/login_sms.py on its own:
- mobile numbers: 11 digits, +86 / 0086 / spaces / dashes dropped; anything else is not one;
- Alibaba Cloud's RPC signature matches the documented example (DescribeRegions, testsecret);
- without runtime/sms.json and runtime/aliyun-sms.key, codes are off;
people-api (a throwaway server on a free port; codes go to a test outbox, TDH_SMS_TEST_OUTBOX, instead of texts):
- phones in the roster: an admin sets them (normalised), a bad or a taken one is refused; the public roster never
  carries them; an admin sees all, a person only their own;
- 获取验证码: the same answer for a number that is nobody's (and no text), a disabled person's, and a real one; one a
  minute, ten a day per number, thirty an hour per address;
- signing in with it: the right code once, the login's full sign-in (desk token and share account); a wrong code
  five times and the code is gone; an expired one fails; another person's code does not open your account;
- remembered devices: asked for, a sign-in (code or password) gets a device token; resume with it on that device
  signs in; on another device, after 退出登录 (forget), after a password change, after the person is disabled, after
  the phone number changes, or after 30 days: no;
- nothing here writes a code or a token to the log.
Prints LOGIN_SMS_PROVE_OK=1.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
sys.path.insert(0, str(HERE.parent / "server"))
import login_sms as ls  # noqa: E402


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("LOGIN_SMS_PROVE_FAIL " + what)
    print("ok  " + what)


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main() -> None:
    check(ls.norm_phone("+86 138-0013-8000") == "13800138000" and ls.norm_phone("008613800138000") == "13800138000"
          and ls.norm_phone("12800138000") == "" and ls.norm_phone("1380013800") == "" and ls.norm_phone("abc") == "", "mobile numbers")
    params = {"AccessKeyId": "testid", "Action": "DescribeRegions", "Format": "XML", "SignatureMethod": "HMAC-SHA1",
              "SignatureNonce": "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf", "SignatureVersion": "1.0", "Timestamp": "2016-02-23T12:46:24Z",
              "Version": "2014-05-26"}
    check(ls.signed_query(params, "testsecret").startswith("Signature=OLeaidS1JvxuMvnyHOwuJ%2BuX5qY%3D&"), "Alibaba Cloud's signature, the documented example")
    tmp_rt = Path(tempfile.mkdtemp(prefix="tdh-sms-off-"))
    check(ls.sms_config(tmp_rt) is None and ls.request_code(tmp_rt, "13800138000", "1.2.3.4", lambda p: "x")[0] == 503, "codes off without the SMS setup")
    (tmp_rt / ls.SMS_CONF).write_text(json.dumps({"provider": "dysms", "sign_name": "测试公司", "template_code": "SMS_1"}), encoding="utf-8")
    (tmp_rt / ls.SMS_KEY).write_text("LTAIid\nsecret\n", encoding="utf-8")
    check(ls.sms_config(tmp_rt)["key_id"] == "LTAIid", "on with sms.json and the key")
    # The text goes out as a signed POST (some Dysmsapi actions refuse GET).
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from urllib.parse import parse_qs
    got = []

    class Sms(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            got.append((self.path, parse_qs(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode())))
            body = json.dumps({"Code": "OK" if len(got) == 1 else "isv.BUSINESS_LIMIT_CONTROL"}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    srv = HTTPServer(("127.0.0.1", 0), Sms)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    conf = dict(ls.sms_config(tmp_rt), host="http://127.0.0.1:%d/" % srv.server_port)
    check(ls.send_aliyun(conf, "13800138000", "123456"), "sent: Alibaba Cloud answered OK")
    path, q = got[0]
    check(path == "/" and q["Action"] == ["SendSms"] and q["PhoneNumbers"] == ["13800138000"] and q["SignName"] == ["测试公司"]
          and q["TemplateCode"] == ["SMS_1"] and json.loads(q["TemplateParam"][0]) == {"code": "123456"} and q["Signature"][0] and q["AccessKeyId"] == ["LTAIid"],
          "a signed POST: SendSms, the number, the signature name, the template, the code as ${code}")
    check(not ls.send_aliyun(conf, "13800138000", "123456"), "anything but OK is not sent")
    # 短信认证 (the default, no company papers): SendSmsVerifyCode with a given signature and template, our own code.
    (tmp_rt / ls.SMS_CONF).write_text(json.dumps({"provider": "pnvs", "sign_name": "恒创联众", "template_code": "100001"}), encoding="utf-8")
    pc = ls.sms_config(tmp_rt)
    check(pc["provider"] == "pnvs" and pc["host"] == ls.PNVS_HOST, "pnvs: Dypnsapi's address")
    (tmp_rt / ls.SMS_CONF).write_text(json.dumps({"sign_name": "恒创联众", "template_code": "100001"}), encoding="utf-8")
    check(ls.sms_config(tmp_rt)["provider"] == "pnvs", "pnvs is the default")
    got.clear()
    ls.send_aliyun(dict(ls.sms_config(tmp_rt), host="http://127.0.0.1:%d/" % srv.server_port), "13800138000", "654321")
    q = got[0][1]
    check(q["Action"] == ["SendSmsVerifyCode"] and q["PhoneNumber"] == ["13800138000"] and q["SignName"] == ["恒创联众"] and q["TemplateCode"] == ["100001"]
          and json.loads(q["TemplateParam"][0]) == {"code": "654321", "min": "5"} and q["ValidTime"] == ["300"] and q["CountryCode"] == ["86"] and "PhoneNumbers" not in q,
          "pnvs: SendSmsVerifyCode, our own code and its 5 minutes")
    srv.shutdown()

    root = Path(tempfile.mkdtemp(prefix="tdh-login-sms-"))
    rt = root / "runtime"
    (rt / "caddy").mkdir(parents=True)
    (rt / "roster.json").write_text(json.dumps({"owner": "test", "depts": [{"id": "company", "name": "公司"}], "people": [
        {"login": "tdh", "role": "admin", "dept": "company", "status": "active", "pid": "p-seed"},
        {"login": "lfh", "name": "梁风禾", "role": "employee", "dept": "company", "status": "active", "pid": "p-lfh", "personal": str(root / "company" / "emp-lfh")},
        {"login": "wang", "name": "王伟", "role": "employee", "dept": "company", "status": "active", "pid": "p-wang", "personal": str(root / "company" / "emp-wang")},
    ]}), encoding="utf-8")
    (rt / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\nlfh:lfh-pass-123\nwang:wang-pass-123\n", encoding="utf-8")
    outbox = root / "outbox.txt"
    port = free_port()
    log = root / "api.err"
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(rt / "lease"), TDH_SMB_LEDGER=str(root / "smb.jsonl"),
               TDH_SMS_TEST_OUTBOX=str(outbox), TDH_CHAT_VOICE="0", TDH_CHAT_CALL="0")
    proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=log.open("w"))

    def call(path: str, body: dict | None = None, token: str = "", src: str = "10.0.0.5", method: str = "POST") -> tuple:
        req = urllib.request.Request("http://127.0.0.1:%d/company/%s" % (port, path), data=json.dumps(body or {}).encode() if method == "POST" else None, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Forwarded-For", src)
        if token:
            req.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return int(r.status), json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            return int(e.code), json.loads(e.read().decode() or "{}")

    def codes() -> list:
        return outbox.read_text(encoding="utf-8").split("\n")[:-1] if outbox.is_file() else []

    try:
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        st, admin = call("login", {"username": "tdh", "password": "seed-pass-123"})
        check(st == 200 and admin.get("gw_token") and "remember_token" not in admin, "password sign-in as before; no device token unless asked")
        adm = admin["gw_token"]
        st, emp = call("login", {"username": "lfh", "password": "lfh-pass-123"})
        lfh_tok = emp["gw_token"]

        # Phones in the roster.
        st, got = call("people", {"action": "set", "login": "lfh", "phone": "+86 138 0013 8000"}, adm)
        check(st == 200 and got["phones"] == {"lfh": "13800138000"}, "an admin sets a phone (normalised)")
        check(call("people", {"action": "set", "login": "wang", "phone": "138001380"}, adm)[1].get("error") == "phone-bad", "a bad number refused")
        check(call("people", {"action": "set", "login": "wang", "phone": "13800138000"}, adm)[1].get("error") == "phone-taken", "a taken number refused")
        call("people", {"action": "set", "login": "wang", "phone": "13900139000"}, adm)
        st, pub = call("people", method="GET")
        check("13800138000" not in json.dumps(pub) and "phones" not in pub, "the public roster carries no phones")
        st, mine = call("people", {"action": "phones"}, lfh_tok)
        check(mine["phones"] == {"lfh": "13800138000"}, "a person sees only their own")
        check(call("people", {"action": "set", "login": "wang", "phone": "13700137000"}, lfh_tok)[0] == 403, "and cannot set anyone's")

        # 获取验证码: the same answer either way.
        st, a = call("login/sms-code", {"phone": "13800138000"})
        check(st == 200 and a == {"ok": True, "sent": True, "wait": 60} and len(codes()) == 1 and codes()[0].startswith("13800138000 "), "a code to a real number")
        st, b = call("login/sms-code", {"phone": "13600136000"})
        check(st == 200 and b == a and len(codes()) == 1, "a number that is nobody's: the same answer, no text")
        check(call("login/sms-code", {"phone": "12345"})[0] == 400, "not a mobile number: refused")
        st, w = call("login/sms-code", {"phone": "13800138000"})
        check(st == 429 and w["error"] == "wait" and len(codes()) == 1, "one a minute per number")
        code = codes()[0].split()[1]

        # Signing in with it.
        bad = "000000" if code != "000000" else "111111"
        st, r = call("login/sms", {"phone": "13800138000", "code": bad})
        check(st == 401 and r["error"] == "bad-code", "a wrong code")
        st, r = call("login/sms", {"phone": "13900139000", "code": code})
        check(st == 401, "lfh's code does not open wang's account")
        st, r = call("login/sms", {"phone": "138 0013 8000", "code": code, "remember": True, "device_id": "mac-ABCDEF12"})
        check(st == 200 and r["login"] == "lfh" and r["gw_token"] == lfh_tok and r.get("smb_user") is not None, "the right code: lfh's full sign-in")
        check(r["remember_token"].startswith("tdhr_") and r["remember_days"] == 30, "remembered for 30 days")
        dev = r["remember_token"]
        check(call("login/sms", {"phone": "13800138000", "code": code})[0] == 401, "a code is good once")

        # Remembered devices.
        st, r = call("login/resume", {"token": dev, "device_id": "mac-ABCDEF12"})
        check(st == 200 and r["login"] == "lfh" and r["gw_token"] == lfh_tok and "remember_token" not in r, "resume on that device signs in")
        check(call("login/resume", {"token": dev, "device_id": "win-OTHER999"})[0] == 401, "on another device: no")
        check(call("login/resume", {"token": "tdhr_" + "0" * 32, "device_id": "mac-ABCDEF12"})[0] == 401, "a made-up token: no")
        st, r = call("login/forget", {"token": dev})
        check(r == {"ok": True, "forgot": 1} and call("login/resume", {"token": dev, "device_id": "mac-ABCDEF12"})[0] == 401, "退出登录 forgets it")
        st, r = call("login", {"username": "wang", "password": "wang-pass-123", "remember": True, "device_id": "win-WANG0001"})
        wdev = r["remember_token"]
        check(call("login/resume", {"token": wdev, "device_id": "win-WANG0001"})[0] == 200, "a password sign-in can be remembered too")
        call("people", {"action": "set", "login": "wang", "phone": "13700137000"}, adm)
        check(call("login/resume", {"token": wdev, "device_id": "win-WANG0001"})[0] == 401, "a new phone number signs the devices out")
        wdev = call("login", {"username": "wang", "password": "wang-pass-123", "remember": True, "device_id": "win-WANG0001"})[1]["remember_token"]
        call("people", {"action": "disable", "login": "wang"}, adm)
        check(call("login/resume", {"token": wdev, "device_id": "win-WANG0001"})[0] == 401, "a disabled person's devices are out")
        n = len(codes())
        st, r = call("login/sms-code", {"phone": "13700137000"}, src="10.0.0.6")
        check(st == 200 and len(codes()) == n, "a disabled person's number: the same answer, no text")
        call("people", {"action": "enable", "login": "wang"}, adm)
        wdev = call("login", {"username": "wang", "password": "wang-pass-123", "remember": True, "device_id": "win-WANG0001"})[1]["remember_token"]
        st, r = call("people", {"action": "self", "password_old": "wang-pass-123", "password_new": "wang-pass-456"},
                     call("login", {"username": "wang", "password": "wang-pass-123"})[1]["gw_token"])
        check(st == 200 and call("login/resume", {"token": wdev, "device_id": "win-WANG0001"})[0] == 401, "a password change signs the devices out")

        # Five wrong tries and the code is gone.
        call("login/sms-code", {"phone": "13700137000"}, src="10.0.0.7")
        wcode = codes()[-1].split()[1]
        wrong = "000000" if wcode != "000000" else "111111"
        for _ in range(5):
            call("login/sms", {"phone": "13700137000", "code": wrong}, src="10.0.0.%d" % (20 + _))
        check(call("login/sms", {"phone": "13700137000", "code": wcode}, src="10.0.0.30")[0] == 401, "five wrong tries and the code is gone")

        # The log has no code and no token.
        text = log.read_text(encoding="utf-8", errors="replace")
        check(code not in text and dev not in text and "login sms-code 200 sent" in text, "the log has neither codes nor tokens")
    finally:
        proc.terminate()
        proc.wait(timeout=10)

    # Expiry and limits, in-process (time moved by hand).
    ls.reset()
    rt2 = Path(tempfile.mkdtemp(prefix="tdh-sms-limits-"))
    sent = []
    snd = lambda p, c: sent.append((p, c)) or True
    t0 = 1_800_000_000.0
    for i in range(10):
        st, _b = ls.request_code(rt2, "13800138000", "addr-%d" % i, lambda p: "lfh", snd, now=t0 + i * 61)
    check(st == 200 and len(sent) == 10, "ten codes a day")
    check(ls.request_code(rt2, "13800138000", "addr-x", lambda p: "lfh", snd, now=t0 + 11 * 61)[1]["error"] == "day-limit", "the eleventh: refused")
    check(ls.request_code(rt2, "13800138000", "addr-x", lambda p: "lfh", snd, now=t0 + 86400 + 700)[0] == 200, "the next day: again")
    ls.reset()
    for i in range(30):
        ls.request_code(rt2, "1380013%04d" % i, "one-addr", lambda p: "", snd, now=t0 + i)
    check(ls.request_code(rt2, "13900139999", "one-addr", lambda p: "", snd, now=t0 + 40)[1]["error"] == "too-many", "thirty an hour per address")
    ls.reset()
    ls.request_code(rt2, "13800138000", "a", lambda p: "lfh", snd, now=t0)
    c = sent[-1][1]
    check(ls.check_code("13800138000", c, now=t0 + 301) == "", "a code after 5 minutes: no")
    tok = ls.remember(rt2, "lfh", "mac-ABCDEF12", "sms", now=t0)
    check(ls.resume(rt2, tok, "mac-ABCDEF12", now=t0 + 29 * 86400) == "lfh" and ls.resume(rt2, tok, "mac-ABCDEF12", now=t0 + 30 * 86400 + 1) == "",
          "a remembered device: 30 days, then sign in again")
    check(ls.remember(rt2, "lfh", "short", "sms") == "", "an odd device id gets no token")
    print("LOGIN_SMS_PROVE_OK=1")


if __name__ == "__main__":
    main()
