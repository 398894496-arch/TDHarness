#!/usr/bin/env python3
"""Proof for company-erp-data-v1 (server/erp_data.py): the agent reads and writes ERPNext as the person who asks.

The people service against a stand-in ERPNext (its users, roles, keys, documents; every call's Authorization checked):
- the sync's round gives every active person's ERPNext user a key (made through ERPNext by the sync's own user),
  kept on the server only, never shown; the finance sync's user is made with its roles and its key; a second
  round makes none again; a person who leaves loses theirs;
- POST /company/ext/erp/<route> with the person's desk token: list / get / count / report go to ERPNext with that
  person's key (王伟's call is 王伟's, not the sync's); ERPNext's 403 comes back as erp-forbidden with its words;
- create makes a draft (a docstatus given is dropped), update cannot change docstatus, submit submits a draft
  and refuses one that is not; only business documents are written (User refused); secrets' doctypes are never
  read; a bad token gets nothing;
- the log has who, route, doctype, name and status; never a document's contents nor a key.
Prints ERP_DATA_PROVE_OK=1.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
sys.path.insert(0, str(HERE.parent / "server"))
import erp_data  # noqa: E402

SYNC_KEY, SYNC_SECRET = "synckey000001", "syncsecret0000000001"
TOK = {"tdh": "dsh_" + "t" * 40, "wang": "dsh_" + "w" * 40, "gone": "dsh_" + "g" * 40}
BASE = "https://erp.tdh.test"


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("ERP_DATA_PROVE_FAIL " + what)


class FakeErp:
    def __init__(self):
        self.users = {"tdh@tdh.test": {"enabled": 1, "roles": ["System Manager"]}, "wang@tdh.test": {"enabled": 1, "roles": ["Stock User"]},
                      "gone@tdh.test": {"enabled": 0, "roles": []}}
        self.keys = {SYNC_KEY: (SYNC_SECRET, "sync")}
        self.calls, self.generated, self.docs = [], [], {"SO-1": {"name": "SO-1", "doctype": "Sales Order", "docstatus": 0, "customer": "埃及客户",
                                                                    "items": [{"item_code": "PU-1", "qty": 5}]}}
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

            def _who(self):
                a = self.headers.get("Authorization") or ""
                k, _, sec = a[len("token "):].partition(":")
                got = fake.keys.get(k)
                return got[1] if got and got[0] == sec else None

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(n) or b"{}") if n else {}

            def handle_one(self, method):
                u = urllib.parse.urlparse(self.path)
                q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
                who = self._who()
                body = self._body() if method in ("POST", "PUT") else {}
                fake.calls.append((method, u.path, who, q, body))
                if who is None:
                    return self._json(401, {"exc_type": "AuthenticationError"})
                p = urllib.parse.unquote(u.path)
                if p == "/api/resource/Role":
                    return self._json(200, {"data": [{"name": r} for r in ("System Manager", "Accounts Manager", "Accounts User", "Purchase Master Manager",
                                                                           "Sales Master Manager", "Item Manager", "Purchase User", "Sales User", "Stock User")]})
                if p == "/api/resource/User" and method == "GET":
                    return self._json(200, {"data": [{"name": k, "enabled": v["enabled"]} for k, v in fake.users.items() if k.endswith("@tdh.test")]})
                if p == "/api/resource/User" and method == "POST":
                    fake.users[body["email"]] = {"enabled": body["enabled"], "roles": [r["role"] for r in body["roles"]]}
                    return self._json(200, {"data": {"name": body["email"]}})
                if p.startswith("/api/resource/User/"):
                    name = p.rsplit("/", 1)[1]
                    if name not in fake.users:
                        return self._json(404, {"exc_type": "DoesNotExistError"})
                    if method == "PUT":
                        fake.users[name].update({"enabled": body.get("enabled", 1), "roles": [r["role"] for r in body.get("roles") or []]})
                    u2 = fake.users[name]
                    return self._json(200, {"data": {"name": name, "enabled": u2["enabled"], "roles": [{"role": r} for r in u2["roles"]],
                                                     "api_key": u2.get("api_key")}})
                if p == "/api/method/frappe.core.doctype.user.user.generate_keys":
                    if who != "sync":
                        return self._json(403, {})
                    if "user" not in body:                      # as ERPNext 16: the body only
                        return self._json(500, {"exc_type": "TypeError"})
                    user = body["user"]
                    k = fake.users[user].setdefault("api_key", "k-" + user.split("@")[0])
                    sec = "s-%s-%d" % (user.split("@")[0], len(fake.generated))
                    fake.keys[k] = (sec, user)
                    fake.generated.append(user)
                    return self._json(200, {"message": {"api_secret": sec}})
                if p == "/api/resource/Sales Order" and method == "GET":
                    return self._json(200, {"data": [{"name": "SO-1", "customer": "埃及客户"}]})
                if p == "/api/resource/Sales Order" and method == "POST":
                    name = "SO-%d" % (len(fake.docs) + 1)
                    fake.docs[name] = dict(body, name=name, doctype="Sales Order", docstatus=0)
                    return self._json(200, {"data": fake.docs[name]})
                if p.startswith("/api/resource/Sales Order/"):
                    name = p.rsplit("/", 1)[1]
                    if method == "PUT":
                        fake.docs[name].update(body)
                    return self._json(200, {"data": fake.docs[name]})
                if p == "/api/resource/Purchase Invoice":
                    return self._json(403, {"_server_messages": json.dumps([json.dumps({"message": "没有权限：采购发票"})])})
                if p == "/api/method/frappe.client.get_count":
                    return self._json(200, {"message": 7})
                if p == "/api/method/frappe.desk.query_report.run":
                    return self._json(200, {"message": {"columns": [{"label": "物料", "fieldname": "item_code"}, {"label": "数量"}],
                                                        "result": [["PU-1", 40]]}})
                if p == "/api/method/frappe.client.submit":
                    d = fake.docs[body["doc"]["name"]]
                    d["docstatus"] = 1
                    return self._json(200, {"message": d})
                return self._json(404, {})

            def do_GET(self):
                self.handle_one("GET")

            def do_POST(self):
                self.handle_one("POST")

            def do_PUT(self):
                self.handle_one("PUT")

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.port = self.httpd.server_address[1]


def free_port() -> int:
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main() -> None:
    erp = FakeErp()
    root = Path(tempfile.mkdtemp(prefix="tdh-erpdata-"))
    rt = root / "runtime"
    (rt / "caddy").mkdir(parents=True)
    people = [
        {"pid": "p1", "login": "tdh", "name": "徐总", "role": "admin", "dept": "company", "status": "active"},
        {"pid": "p2", "login": "wang", "name": "王伟", "role": "employee", "dept": "d-store", "status": "active"},
        {"pid": "p3", "login": "gone", "name": "离职", "role": "employee", "dept": "d-store", "status": "disabled"},
    ]
    roster = rt / "roster.json"
    roster.write_text(json.dumps({"owner": "test", "depts": [{"id": "d-store", "name": "仓库"}], "people": people}, ensure_ascii=False), encoding="utf-8")
    (rt / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
    (rt / "caddy" / "seed-admin.txt").write_text("tdh seed-pass-123\n", encoding="utf-8")
    (rt / "gw-tokens.json").write_text(json.dumps({"tokens": [{"pid": "p1", "token": TOK["tdh"]}, {"pid": "p2", "token": TOK["wang"]},
                                                              {"pid": "p3", "token": TOK["gone"]}]}), encoding="utf-8")
    (rt / "erp-sso.json").write_text(json.dumps({"on": True, "base": BASE, "client_id": "tdh-erpnext", "client_secret": "cs-000000000001",
                                                 "cookie_key": "ck-000000000001", "email_domain": "tdh.test", "erp_origin": "http://127.0.0.1:%d" % erp.port,
                                                 "api_key": SYNC_KEY, "api_secret": SYNC_SECRET, "redirect_uri": BASE + "/api/method/x"}), encoding="utf-8")
    port = free_port()
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(rt / "lease"), TDH_SMB_LEDGER=str(root / "smb.jsonl"),
               TDH_CHAT_PROVISION="0", TDH_DAILY_REPORT="0", TDH_CHAT_ARCHIVE="0", TDH_NOTIFY_EVERY="0",
               TDH_ERP_SYNC_DELAY="0.2", TDH_ERP_SYNC_EVERY="1.0", TZ="Asia/Shanghai")
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def ext(who: str, route: str, body: dict) -> tuple:
        req = urllib.request.Request("http://127.0.0.1:%d/company/ext/erp/%s" % (port, route), data=json.dumps(body, ensure_ascii=False).encode(),
                                     method="POST", headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOK.get(who, "dsh_" + "x" * 40)})
        try:
            with op.open(req, timeout=15) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())

    keys = rt / "erp-keys.json"
    fin = rt / "erp-finance.json"
    log = root / "people-api.err"
    with open(log, "wb") as err:
        proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.DEVNULL, stderr=err)
    try:
        deadline = time.time() + 20
        while time.time() < deadline and not (keys.exists() and fin.exists()):
            time.sleep(0.2)
        k = json.loads(keys.read_text(encoding="utf-8"))
        check(sorted(k) == ["tdh@tdh.test", "wang@tdh.test"] and all(v["key"] and v["secret"] for v in k.values()), "a key for each active person: %s" % sorted(k))
        f = json.loads(fin.read_text(encoding="utf-8"))
        check(f["user"] == erp_data.FINANCE_USER and f["secret"] and "Accounts Manager" in erp.users[erp_data.FINANCE_USER]["roles"],
              "the finance sync's user, its roles and key: %s" % erp.users.get(erp_data.FINANCE_USER))
        check(all(c[2] == "sync" for c in erp.calls if c[1].endswith("generate_keys")), "keys made by the sync's own user")
        n = len(erp.generated)
        time.sleep(2.5)
        check(len(erp.generated) == n == 3, "a second round makes no key again: %s" % erp.generated)

        st, r = ext("wang", "list", {"doctype": "Sales Order", "fields": ["name", "customer"], "filters": [["status", "=", "Draft"]], "limit": 999})
        check(st == 200 and r["rows"] == [{"name": "SO-1", "customer": "埃及客户"}], "list: %s %s" % (st, r))
        call = erp.calls[-1]
        check(call[2] == "wang@tdh.test" and call[3]["limit_page_length"] == "200" and json.loads(call[3]["filters"]) == [["status", "=", "Draft"]],
              "as 王伟 himself, at most 200: %s" % (call,))
        st, r = ext("wang", "list", {"doctype": "Purchase Invoice"})
        check(st == 403 and r["error"] == "erp-forbidden" and "没有权限：采购发票" in r["why"], "ERPNext's no comes back with its words: %s" % r)
        st, r = ext("wang", "count", {"doctype": "Sales Order", "filters": {"status": "Draft"}})
        check(st == 200 and r["count"] == 7, "count: %s" % r)
        st, r = ext("tdh", "report", {"report": "Stock Balance", "filters": {"company": "壹通达"}})
        check(st == 200 and r["columns"] == ["物料", "数量"] and r["rows"] == [["PU-1", 40]] and erp.calls[-1][2] == "tdh@tdh.test", "report as 徐总: %s" % r)
        st, r = ext("wang", "list", {"doctype": "Sales Order", "fields": ["name; drop table"]})
        check(st == 400 and r["error"] == "fields", "a field that is not a field: %s" % r)
        for dt in ("OAuth Bearer Token", "User Permission", "Social Login Key"):
            st, r = ext("tdh", "list", {"doctype": dt})
            check(st == 403 and r["error"] == "doctype-not-here", "never read: %s" % dt)

        st, r = ext("wang", "create", {"doctype": "Sales Order", "doc": {"customer": "埃及客户", "docstatus": 1, "items": [{"item_code": "PU-1", "qty": 3}]}})
        check(st == 200 and r["docstatus"] == 0 and "docstatus" not in erp.calls[-1][4] and erp.calls[-1][2] == "wang@tdh.test", "a draft, as 王伟: %s" % r)
        made = r["name"]
        st, r = ext("wang", "update", {"doctype": "Sales Order", "name": made, "changes": {"docstatus": 1}})
        check(st == 400 and r["error"] == "docstatus", "update does not submit")
        st, r = ext("wang", "update", {"doctype": "Sales Order", "name": made, "changes": {"delivery_date": "2026-12-01"}})
        check(st == 200 and erp.docs[made]["delivery_date"] == "2026-12-01", "a draft changed")
        st, r = ext("wang", "submit", {"doctype": "Sales Order", "name": made})
        check(st == 200 and r["docstatus"] == 1 and erp.docs[made]["docstatus"] == 1, "submitted: %s" % r)
        st, r = ext("wang", "submit", {"doctype": "Sales Order", "name": made})
        check(st == 409 and r["error"] == "not-draft", "not twice")
        st, r = ext("tdh", "create", {"doctype": "User", "doc": {"email": "x@tdh.test"}})
        check(st == 403 and r["error"] == "not-writable", "only business documents are written")
        st, r = ext("nobody", "list", {"doctype": "Sales Order"})
        check(st == 401, "a bad token gets nothing")
        st, r = ext("gone", "list", {"doctype": "Sales Order"})
        check(st == 401, "nor someone who left")

        people[1]["status"] = "disabled"
        roster.write_text(json.dumps({"owner": "test", "depts": [{"id": "d-store", "name": "仓库"}], "people": people}, ensure_ascii=False), encoding="utf-8")
        deadline = time.time() + 10
        while time.time() < deadline and "wang@tdh.test" in json.loads(keys.read_text(encoding="utf-8")):
            time.sleep(0.2)
        check("wang@tdh.test" not in json.loads(keys.read_text(encoding="utf-8")), "a person who leaves loses their key here")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    text = log.read_text(encoding="utf-8", errors="replace") + (root / "logs" / "erp-agent.log").read_text(encoding="utf-8")
    check("wang list Sales Order - 200 rows=1" in text and "wang submit Sales Order %s 200" % made in text, "the log has who and what: " + text[-500:])
    for w in ["埃及客户", "PU-1", SYNC_SECRET, f["secret"]] + [v["secret"] for v in k.values()]:
        check(w not in text, "never a document's contents nor a key in the log (%s)" % w[:6])
    print("ERP_DATA_PROVE_OK=1")


if __name__ == "__main__":
    main()
