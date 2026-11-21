#!/usr/bin/env python3
"""Proof for company-erp-sso-v1: TDH's login for ERPNext and the roster sync (server/erp_sso.py, people-api).

Against a stand-in ERPNext (its login page with the TDH link, its Role and User REST API):
- the desk's ticket needs the person's login token (none, or a disabled person's: 401) and works once;
- start: the ticket sets a signed cookie on /tdh-sso and sends the browser on to ERPNext's own TDH link (taken from
  its login page, asked for with ERPNext's public name);
- authorize: only for ERPNext's client id and its redirect address; with the cookie, a code at once; without it,
  TDH's login page; a wrong password is refused and counted for the lockout; the right one gives a code; a forged
  cookie or a disabled person's gives the login page;
- token: the client secret (form or HTTP Basic), a code once, for the same redirect address;
- userinfo: sub, email <login>@<domain>, the roster name; a bad token is 401;
- the TDH password check mints no desk token;
- sync: active people get ERPNext users with their roles (unknown roles left out), a person who left is disabled,
  Administrator and other domains are not touched, a second round changes nothing; the logs have no secret.
Prints ERP_SSO_PROVE_OK=1.
"""
from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
BASE = "https://erp.test"
REDIRECT = BASE + "/api/method/frappe.integrations.oauth2_logins.custom/tdh"
SECRET = "cs-" + "k" * 40
COOKIE_KEY = "ck-" + "q" * 40
KEY, KSECRET = "ak-sync", "as-" + "z" * 30
TOK = {"lfh": "dsh_" + "a" * 32, "tdh": "dsh_" + "b" * 32, "gone": "dsh_" + "d" * 32}


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("ERP_SSO_PROVE_FAIL " + what)


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPEN = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)


def call(port: int, method: str, path: str, body=None, headers=None, form=False):
    data = None
    if body is not None:
        data = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode()
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=data, method=method)
    req.add_header("Content-Type", "application/x-www-form-urlencoded" if form else "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        r = OPEN.open(req, timeout=20)
        return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


class FakeErp:
    def __init__(self):
        self.users = {"Administrator": {"name": "Administrator", "enabled": 1, "first_name": "Administrator"},
                      "old@tdh.test": {"name": "old@tdh.test", "enabled": 1, "first_name": "走了的人"},
                      "someone@other.org": {"name": "someone@other.org", "enabled": 1, "first_name": "别的"},
                      "tdh@tdh.test": {"name": "tdh@tdh.test", "enabled": 0, "first_name": "徐总"}}
        self.roles = ["System Manager", "Accounts Manager", "Sales Manager", "Purchase Manager", "Stock Manager",
                      "Accounts User", "Purchase User", "Sales User", "Stock User", "Employee"]
        self.created, self.puts, self.auths, self.hosts = [], [], set(), []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _json(self, status, obj):
                raw = json.dumps(obj, ensure_ascii=False).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                u = urllib.parse.urlparse(self.path)
                if u.path == "/login":
                    fake.hosts.append((self.headers.get("Host"), self.headers.get("X-Forwarded-Proto")))
                    link = BASE + "/tdh-sso/authorize?" + urllib.parse.urlencode({"client_id": "tdh-erpnext", "redirect_uri": REDIRECT,
                                                                                "response_type": "code", "scope": "openid", "state": "STATE1"})
                    raw = ('<html><a href="https://elsewhere.example/x">x</a><a class="btn" href="%s">TDH</a></html>'
                           % link.replace("&", "&amp;")).encode()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                fake.auths.add(self.headers.get("Authorization"))
                if u.path == "/api/resource/Role":
                    return self._json(200, {"data": [{"name": r} for r in fake.roles]})
                if u.path.startswith("/api/resource/User/"):
                    name = urllib.parse.unquote(u.path.rsplit("/", 1)[1])
                    if name not in fake.users:
                        return self._json(404, {})
                    return self._json(200, {"data": dict(fake.users[name], roles=fake.users[name].get("roles") or [])})
                if u.path == "/api/resource/User":
                    q = urllib.parse.parse_qs(u.query)
                    like = json.loads(q["filters"][0])[0][2].replace("%", "")
                    return self._json(200, {"data": [dict(v) for k, v in fake.users.items() if k.endswith(like)]})
                self._json(404, {})

            def do_POST(self):
                fake.auths.add(self.headers.get("Authorization"))
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                fake.created.append(body)
                fake.users[body["email"]] = {"name": body["email"], "enabled": body["enabled"], "first_name": body["first_name"], "roles": body.get("roles") or []}
                self._json(200, {"data": {"name": body["email"]}})

            def do_PUT(self):
                fake.auths.add(self.headers.get("Authorization"))
                name = urllib.parse.unquote(urllib.parse.urlparse(self.path).path.rsplit("/", 1)[1])
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                fake.puts.append((name, body))
                fake.users[name].update(body)
                self._json(200, {"data": {"name": name}})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


def main() -> None:
    erp = FakeErp()
    root = Path(tempfile.mkdtemp(prefix="tdh-erpsso-"))
    rt = root / "runtime"
    (rt / "caddy").mkdir(parents=True)
    (rt / "roster.json").write_text(json.dumps({"owner": "test", "depts": [
        {"id": "d-sales", "name": "销售"}, {"id": "d-prod", "name": "生产设计"}], "people": [
        {"pid": "p1", "login": "tdh", "name": "徐总", "role": "admin", "dept": "company", "status": "active"},
        {"pid": "p2", "login": "lfh", "name": "梁风禾", "role": "employee", "dept": "d-sales", "status": "active"},
        {"pid": "p3", "login": "wang", "name": "王伟", "role": "employee", "dept": "d-prod", "status": "active"},
        {"pid": "p4", "login": "gone", "name": "离职", "role": "employee", "dept": "d-sales", "status": "disabled"},
    ]}, ensure_ascii=False), encoding="utf-8")
    (rt / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\nlfh:lfh-pass-456\nwang:wang-pass-789\ngone:gone-pass-000\n", encoding="utf-8")
    (rt / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    tokens = [{"pid": "p2", "token": TOK["lfh"], "revoked_at": ""}, {"pid": "p1", "token": TOK["tdh"], "revoked_at": ""},
              {"pid": "p4", "token": TOK["gone"], "revoked_at": ""}]
    (rt / "gw-tokens.json").write_text(json.dumps({"tokens": tokens}), encoding="utf-8")
    (rt / "erp-sso.json").write_text(json.dumps({"on": True, "base": BASE, "client_id": "tdh-erpnext", "client_secret": SECRET,
                                                 "cookie_key": COOKIE_KEY, "email_domain": "tdh.test", "erp_origin": "http://127.0.0.1:%d" % erp.port,
                                                 "api_key": KEY, "api_secret": KSECRET}), encoding="utf-8")
    port = free_port()
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(rt / "lease"),
               TDH_SMB_LEDGER=str(root / "smb-ledger.jsonl"), TDH_CHAT_PROVISION="0", TDH_DAILY_REPORT="0", TDH_CHAT_ASSIST="0",
               TDH_ERP_SYNC_DELAY="0.2", TDH_ERP_SYNC_EVERY="1.5", TDH_NOTIFY_EVERY="0", TDH_ERP_KEYS="0")   # keys: prove-erp-data.py
    log = root / "people-api.err"
    with open(log, "wb") as err:
        proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=err)
    try:
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        check(call(port, "GET", "/company/sso/health")[0] == 200, "health")
        # The desk's ticket.
        check(call(port, "POST", "/company/ext/erp/ticket", {})[0] == 401, "a ticket needs a login token")
        check(call(port, "POST", "/company/ext/erp/ticket", {}, {"Authorization": "Bearer " + TOK["gone"]})[0] == 401, "not for a disabled person")
        st, _, body = call(port, "POST", "/company/ext/erp/ticket", {}, {"Authorization": "Bearer " + TOK["lfh"]})
        url = json.loads(body).get("url", "")
        check(st == 200 and url.startswith(BASE + "/tdh-sso/start?t=t-"), "the ticket link: %s" % body)
        t = url.split("t=", 1)[1]
        # start
        st, h, _ = call(port, "GET", "/company/sso/start?t=" + t)
        loc, ck = h.get("Location", ""), h.get("Set-Cookie", "")
        check(st == 302 and loc.startswith(BASE + "/tdh-sso/authorize?") and "state=STATE1" in loc and "&amp;" not in loc,
              "start goes on to ERPNext's own TDH link: %s %s" % (st, loc))
        check(erp.hosts[-1] == ("erp.test", "https"), "ERPNext's login page asked with its public name: %s" % erp.hosts)
        check(ck.startswith("tdh_sso=") and "Path=/tdh-sso" in ck and "HttpOnly" in ck and "Secure" in ck and "SameSite=Lax" in ck, "the cookie: %s" % ck)
        check(call(port, "GET", "/company/sso/start?t=" + t)[0] == 403, "a ticket works once")
        cookie = ck.split(";", 1)[0]
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(loc).query))
        # authorize
        bad = dict(q, redirect_uri="https://evil.example/cb")
        check(call(port, "GET", "/company/sso/authorize?" + urllib.parse.urlencode(bad), headers={"Cookie": cookie})[0] == 400, "only ERPNext's redirect address")
        check(call(port, "GET", "/company/sso/authorize?" + urllib.parse.urlencode(dict(q, client_id="x")), headers={"Cookie": cookie})[0] == 400, "only ERPNext's client")
        st, h, _ = call(port, "GET", "/company/sso/authorize?" + urllib.parse.urlencode(q), headers={"Cookie": "a=b; " + cookie})
        back = h.get("Location", "")
        check(st == 302 and back.startswith(REDIRECT + "?code=c-") and back.endswith("state=STATE1"), "with the cookie, a code at once: %s" % back)
        code = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(back).query))["code"]
        st, h, page = call(port, "GET", "/company/sso/authorize?" + urllib.parse.urlencode(q))
        check(st == 200 and 'action="/tdh-sso/authorize"' in page and 'name="state" value="STATE1"' in page and "TDH 账号" in page
              and "frame-ancestors 'none'" in h.get("Content-Security-Policy", ""), "no cookie: TDH's login page")
        forged = "tdh_sso=" + base64.urlsafe_b64encode(b"tdh|9999999999|00").decode()
        check(call(port, "GET", "/company/sso/authorize?" + urllib.parse.urlencode(q), headers={"Cookie": forged})[0] == 200, "a forged cookie: the login page")
        sys.path.insert(0, str(HERE.parent / "server"))
        import erp_sso as es
        gone = "tdh_sso=" + es.sign(COOKIE_KEY, "gone")
        check(call(port, "GET", "/company/sso/authorize?" + urllib.parse.urlencode(q), headers={"Cookie": gone})[0] == 200, "a disabled person's cookie: the login page")
        st, _, page = call(port, "POST", "/company/sso/authorize", dict(q, username="wang", password="nope"), form=True)
        check(st == 401 and "账号或密码不对" in page, "a wrong password")
        check(call(port, "POST", "/company/sso/authorize", dict(q, username="gone", password="gone-pass-000"), form=True)[0] == 401, "a disabled person's password")
        n_tokens = len(json.loads((rt / "gw-tokens.json").read_text(encoding="utf-8"))["tokens"])
        st, h, _ = call(port, "POST", "/company/sso/authorize", dict(q, username="WANG", password="wang-pass-789"), form=True)
        check(st == 302 and h.get("Location", "").startswith(REDIRECT + "?code=c-") and h.get("Set-Cookie", "").startswith("tdh_sso="), "the right password: a code and the cookie")
        check(len(json.loads((rt / "gw-tokens.json").read_text(encoding="utf-8"))["tokens"]) == n_tokens, "no desk token minted for ERPNext")
        code2 = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(h["Location"]).query))["code"]
        # token
        form = {"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT, "client_id": "tdh-erpnext"}
        check(call(port, "POST", "/company/sso/token", dict(form, client_secret="wrong"), form=True)[0] == 401, "a wrong client secret")
        check(call(port, "POST", "/company/sso/token", dict(form, client_secret=SECRET, redirect_uri=BASE + "/other"), form=True)[0] == 400, "the same redirect address")
        st, _, body = call(port, "POST", "/company/sso/token", dict(form, code=code2, client_secret=SECRET), form=True)
        check(st == 200, "the second code, by form")
        st, _, body = call(port, "POST", "/company/sso/token", dict(form, client_id="", code=code), form=True,
                           headers={"Authorization": "Basic " + base64.b64encode(("tdh-erpnext:" + SECRET).encode()).decode()})
        check(st == 400, "the first code was spent by the wrong redirect try")
        st, _, body = call(port, "POST", "/company/ext/erp/ticket", {}, {"Authorization": "Bearer " + TOK["tdh"]})
        t2 = json.loads(body)["url"].split("t=", 1)[1]
        st, h, _ = call(port, "GET", "/company/sso/start?t=" + t2)
        c2 = h["Set-Cookie"].split(";", 1)[0]
        st, h, _ = call(port, "GET", "/company/sso/authorize?" + urllib.parse.urlencode(q), headers={"Cookie": c2})
        code3 = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(h["Location"]).query))["code"]
        st, _, body = call(port, "POST", "/company/sso/token", dict(form, client_id="", code=code3), form=True,
                           headers={"Authorization": "Basic " + base64.b64encode(("tdh-erpnext:" + SECRET).encode()).decode()})
        tok = json.loads(body).get("access_token", "")
        check(st == 200 and tok.startswith("a-") and json.loads(body)["token_type"] == "Bearer", "a token, by HTTP Basic: %s" % body)
        check(call(port, "POST", "/company/sso/token", dict(form, code=code3, client_secret=SECRET), form=True)[0] == 400, "a code once")
        # userinfo
        st, _, body = call(port, "GET", "/company/sso/userinfo?access_token=" + urllib.parse.quote(tok))
        info = json.loads(body)
        check(st == 200 and info == {"sub": "tdh", "email": "tdh@tdh.test", "email_verified": True, "name": "徐总", "given_name": "徐总",
                                     "preferred_username": "tdh"}, "userinfo: %s" % body)
        check(call(port, "GET", "/company/sso/userinfo", headers={"Authorization": "Bearer " + tok})[0] == 200, "userinfo by the header too")
        check(call(port, "GET", "/company/sso/userinfo?access_token=a-nope")[0] == 401, "a bad token")
        # sync
        deadline = time.time() + 20
        while time.time() < deadline and len(erp.created) < 3:
            time.sleep(0.2)
        time.sleep(2.5)                                        # a second round
        made = {c["email"]: c for c in erp.created}
        check(sorted(made) == ["lfh@tdh.test", "wang@tdh.test"], "users made for active people not yet there: %s" % sorted(made))
        check([r["role"] for r in made["lfh@tdh.test"]["roles"]] == ["Sales User"] and [r["role"] for r in made["wang@tdh.test"]["roles"]] == ["Stock User"],
              "roles by department, unknown ones left out: %s" % {k: v["roles"] for k, v in made.items()})
        check(all(c["send_welcome_email"] == 0 and c["user_type"] == "System User" and "new_password" not in c for c in erp.created), "no mail, no password")
        check(("tdh@tdh.test", {"enabled": 1}) in erp.puts and ("old@tdh.test", {"enabled": 0}) in erp.puts, "enabled again / disabled: %s" % erp.puts)
        check(not any(n in ("Administrator", "someone@other.org") for n, _ in erp.puts), "Administrator and other domains untouched")
        roles_put = [b for n, b in erp.puts if n == "tdh@tdh.test" and "roles" in b]
        check(len(roles_put) == 1 and sorted(r["role"] for r in roles_put[0]["roles"]) == sorted(erp.roles),
              "an admin has every role ERPNext has (company-erp-admin-all-v1): %s" % roles_put)
        check(len(erp.created) == 2 and len(erp.puts) == 3, "a second round changes nothing: %s %s" % (erp.created, erp.puts))
        check(erp.auths == {"token %s:%s" % (KEY, KSECRET)}, "the sync's own API key")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    text = log.read_text(encoding="utf-8", errors="replace") + (root / "logs" / "erp-sync.log").read_text(encoding="utf-8")
    check('"created": 2' in text and '"disabled": 1' in text, "logs/erp-sync.log has the counts: " + text[-600:])
    for secret in (SECRET, COOKIE_KEY, KSECRET, "lfh-pass-456", "wang-pass-789", tok):
        check(secret not in text, "no secret in the logs")
    skill = (HERE.parent / "server" / "erp" / "skills" / "company-erpnext" / "SKILL.md").read_text(encoding="utf-8")
    head = skill.split("\n---", 1)[0]
    check(head.startswith("---\nname: company-erpnext\n") and "whenToUse:" in head and "disable-model-invocation" not in head,
          "the ERPNext guide is in the agent's list")
    for w in ("https://tdharness.tail9c7cc7.ts.net", "TDH 左栏的「ERPNext」", "company-erpnext-data", "山东壹通达高分子材料有限公司", "烟台腾达聚氨酯有限公司", "内部客户", "提交", "修订", "物料移动", "销售出库", "采购入库", "生产工单"):
        check(w in skill, "the guide says: " + w)
    print("ERP_SSO_PROVE_OK=1")


if __name__ == "__main__":
    main()
