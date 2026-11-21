"""company-erp-data-v1: TDH's agent reads and writes ERPNext as the person who asks; the finance sync's own user.

The user, 2026-11-21: ERPNext's guide for the agent, so TDH's process can read and write it ("方便TDH进程调用读写功能"),
with each person's own ERPNext permissions ("同意，按本人权限"); and a finance sync user of its own ("同意新建").

Keys. Every active person's ERPNext user (<login>@<email_domain>, made by erp_sso.sync) gets an API key and secret,
generated through ERPNext by the sync's own user (System Manager) and kept on this server only, in
runtime/erp-keys.json (admins only); nobody is shown one. A person who leaves loses theirs here, and ERPNext disables
their user (the sync), so a key that was kept anywhere would not work either. The finance sync's user
(tdh-finance@tdh-service.local: Accounts Manager and what it needs to make parties and items, outside the people's
email domain so the sync never disables it) keeps its key in runtime/erp-finance.json.

The agent's routes (POST /company/ext/erp/<route>, the person's desk token; company_ext pack "erp"):
  list    {doctype, fields?, filters?, or_filters?, order_by?, limit?}       rows (at most 200)
  get     {doctype, name}                                                    one document
  count   {doctype, filters?}
  report  {report, filters?}                                                 a query report's columns and rows (500)
  create  {doctype, doc}                                                     a draft (docstatus 0), never submitted here
  update  {doctype, name, changes}                                           a draft's fields (not its docstatus)
  submit  {doctype, name}                                                    only after the person said so (the skill)
All as the person: what ERPNext lets them see and do, nothing more. Writes go to the business documents only
(WRITABLE); a few doctypes are never read (secrets, sessions). No cancel and no delete here: those stay in ERPNext's
own pages. The log has who, which route, which doctype and document, and the answer's status; never a document's
contents.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
from pathlib import Path

import erp_sso

FINANCE_USER = "tdh-finance@tdh-service.local"
FINANCE_ROLES = ["Accounts Manager", "Accounts User", "Purchase Master Manager", "Sales Master Manager", "Item Manager",
                 "Purchase User", "Sales User"]
DOCTYPE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 \-]{1,60}$")
FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,60}(\.[A-Za-z_][A-Za-z0-9_]{0,60})?$|^count\(\*\)( as [a-z_]+)?$|^`tab[A-Za-z ]+`\.[a-z_]+$")
NEVER_READ = re.compile(r"OAuth|Social Login|Token|Password|Session|Access Log|Activity Log|Error Log|User Permission|Has Role|"
                        r"System Settings|Email Account|Integration Request|Webhook|Scheduled Job|RQ Job", re.I)
WRITABLE = {
    "Item", "Item Price", "Customer", "Supplier", "Contact", "Address", "Lead", "Opportunity",
    "Quotation", "Sales Order", "Delivery Note", "Sales Invoice",
    "Material Request", "Request for Quotation", "Supplier Quotation", "Purchase Order", "Purchase Receipt", "Purchase Invoice",
    "Stock Entry", "Stock Reconciliation", "BOM", "Work Order", "Job Card", "Production Plan", "Quality Inspection",
    "Payment Entry", "Journal Entry", "Task", "Project", "ToDo", "Note", "Comment", "Event",
}
LIMIT = 200
OUT_MAX = 60000


def _save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _load(path: Path) -> dict:
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def generate(api, email: str) -> dict | None:
    """A new API key and secret for an ERPNext user (the old secret stops working). None when it failed."""
    st, j = api("POST", "/api/method/frappe.core.doctype.user.user.generate_keys?" + urllib.parse.urlencode({"user": email}), {})
    m = (j or {}).get("message") or {}
    if st != 200 or not m.get("api_secret"):
        return None
    key = m.get("api_key")
    if not key:
        st, u = api("GET", "/api/resource/User/" + urllib.parse.quote(email) + "?" + urllib.parse.urlencode({"fields": json.dumps(["api_key"])}), None)
        key = ((u or {}).get("data") or {}).get("api_key")
    return {"key": key, "secret": m["api_secret"]} if key else None


def ensure_keys(cfg: dict, people: dict, store: Path, api=None) -> dict:
    """Every active person's ERPNext user has a key here; nobody else's is kept. Counts."""
    api = api or (lambda m, p, b=None: erp_sso.erp_api(cfg, m, p, b))
    keys = _load(store)
    domain = cfg["email_domain"]
    active = {erp_sso.email_of(k, domain) for k, r in people.items() if (r.get("status") or "active") == "active"
              and re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,63}", str(k))}
    out = {"made": 0, "dropped": 0, "failed": 0}
    st, j = api("GET", "/api/resource/User?" + urllib.parse.urlencode({
        "fields": json.dumps(["name", "enabled"]), "filters": json.dumps([["name", "like", "%@" + domain]]), "limit_page_length": 1000}), None)
    if st != 200:
        return {"ok": False, "why": "erp-users-%s" % st}
    enabled = {u["name"] for u in (j.get("data") or []) if int(u.get("enabled") or 0)}
    for email in sorted(active & enabled):
        if (keys.get(email) or {}).get("secret"):
            continue
        got = generate(api, email)
        if got:
            keys[email] = dict(got, at=int(time.time()))
            out["made"] += 1
        else:
            out["failed"] += 1
    for email in [e for e in keys if e not in active]:
        del keys[email]
        out["dropped"] += 1
    if out["made"] or out["dropped"]:
        _save(store, keys)
    out["ok"] = not out["failed"]
    return out


def ensure_finance_user(cfg: dict, store: Path, api=None) -> dict:
    """The finance sync's own user, its roles (the ones ERPNext has), its key. What it did."""
    api = api or (lambda m, p, b=None: erp_sso.erp_api(cfg, m, p, b))
    st, j = api("GET", "/api/resource/Role?" + urllib.parse.urlencode({"fields": json.dumps(["name"]), "limit_page_length": 500}), None)
    if st != 200:
        return {"ok": False, "why": "erp-roles-%s" % st}
    known = {r.get("name") for r in j.get("data") or []}
    roles = [r for r in FINANCE_ROLES if r in known]
    out = {"ok": True, "user": FINANCE_USER, "roles": roles}
    st, u = api("GET", "/api/resource/User/" + urllib.parse.quote(FINANCE_USER), None)
    if st == 404:
        st, _ = api("POST", "/api/resource/User", {"email": FINANCE_USER, "first_name": "TDH 财务同步", "enabled": 1, "send_welcome_email": 0,
                                                    "user_type": "System User", "roles": [{"role": r} for r in roles]})
        if st not in (200, 201):
            return {"ok": False, "why": "create-%s" % st}
        out["created"] = True
    elif st == 200:
        have = {r.get("role") for r in ((u.get("data") or {}).get("roles") or [])}
        if not set(roles) <= have or not int((u.get("data") or {}).get("enabled") or 0):
            st, _ = api("PUT", "/api/resource/User/" + urllib.parse.quote(FINANCE_USER),
                        {"enabled": 1, "roles": [{"role": r} for r in sorted(have | set(roles))]})
            if st != 200:
                return {"ok": False, "why": "roles-%s" % st}
            out["roles_set"] = True
    else:
        return {"ok": False, "why": "user-%s" % st}
    saved = _load(store)
    if not saved.get("secret"):
        got = generate(api, FINANCE_USER)
        if not got:
            return {"ok": False, "why": "keys"}
        _save(store, dict(got, user=FINANCE_USER, at=int(time.time())))
        out["key_made"] = True
    return out


# -- the agent's routes -------------------------------------------------------------------------------------------

def _as(cfg: dict, key: dict):
    """ERPNext's API as the holder of `key`."""
    c = dict(cfg, api_key=key["key"], api_secret=key["secret"])
    return lambda m, p, b=None: erp_sso.erp_api(c, m, p, b, timeout=60)


def _jsonish(v, kind):
    if v in (None, "", [], {}):
        return None
    if isinstance(v, str):
        v = json.loads(v)
    if not isinstance(v, kind):
        raise ValueError("shape")
    return v


def _why(j: dict) -> str:
    """ERPNext's own words for a refusal, short (its _server_messages / exception), no traceback."""
    msg = ""
    try:
        sm = json.loads(j.get("_server_messages") or "[]")
        msg = " / ".join(json.loads(x).get("message", "") if isinstance(x, str) else str(x) for x in sm)
    except (ValueError, TypeError, AttributeError):
        msg = ""
    if not msg:
        msg = str(j.get("exception") or j.get("exc_type") or "")
    return re.sub(r"<[^>]+>", "", msg)[:400]


def handle(route: str, body: dict, email: str, cfg: dict, keys: dict, api=None) -> tuple[int, dict]:
    """One agent request as `email`. (status, answer)."""
    key = keys.get(email)
    if api is None:
        if not key or not key.get("secret"):
            return 409, {"ok": False, "error": "no-erp-key", "why": "这个人的 ERPNext 账号还没准备好（每十分钟同步一次），稍后再试。"}
        api = _as(cfg, key)
    body = body if isinstance(body, dict) else {}
    doctype = str(body.get("doctype") or "")
    if route in ("list", "get", "count", "create", "update", "submit"):
        if not DOCTYPE_RE.match(doctype):
            return 400, {"ok": False, "error": "doctype"}
        if NEVER_READ.search(doctype):
            return 403, {"ok": False, "error": "doctype-not-here"}
    if route in ("create", "update", "submit") and doctype not in WRITABLE:
        return 403, {"ok": False, "error": "not-writable", "why": "这里只写业务单据（%s）；别的请在 ERPNext 页面里改。" % "、".join(sorted(WRITABLE))}
    try:
        if route == "list":
            fields = _jsonish(body.get("fields"), list) or ["name"]
            if not all(isinstance(f, str) and (f == "*" or FIELD_RE.match(f)) for f in fields):
                return 400, {"ok": False, "error": "fields"}
            q = {"fields": json.dumps(fields), "limit_page_length": max(1, min(int(body.get("limit") or 20), LIMIT))}
            for k in ("filters", "or_filters"):
                v = _jsonish(body.get(k), (list, dict))
                if v is not None:
                    q[k] = json.dumps(v, ensure_ascii=False)
            if body.get("order_by"):
                ob = str(body["order_by"])
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,60}( (asc|desc))?", ob):
                    return 400, {"ok": False, "error": "order_by"}
                q["order_by"] = ob
            st, j = api("GET", "/api/resource/%s?%s" % (urllib.parse.quote(doctype), urllib.parse.urlencode(q)), None)
            return _answer(st, j, rows=(j or {}).get("data"))
        if route == "get":
            name = str(body.get("name") or "")
            if not name:
                return 400, {"ok": False, "error": "name"}
            st, j = api("GET", "/api/resource/%s/%s" % (urllib.parse.quote(doctype), urllib.parse.quote(name, safe="")), None)
            return _answer(st, j, doc=(j or {}).get("data"))
        if route == "count":
            q = {"doctype": doctype}
            v = _jsonish(body.get("filters"), (list, dict))
            if v is not None:
                q["filters"] = json.dumps(v, ensure_ascii=False)
            st, j = api("GET", "/api/method/frappe.client.get_count?" + urllib.parse.urlencode(q), None)
            return _answer(st, j, count=(j or {}).get("message"))
        if route == "report":
            report = str(body.get("report") or "")
            if not DOCTYPE_RE.match(report):
                return 400, {"ok": False, "error": "report"}
            filters = _jsonish(body.get("filters"), dict) or {}
            st, j = api("GET", "/api/method/frappe.desk.query_report.run?" + urllib.parse.urlencode(
                {"report_name": report, "filters": json.dumps(filters, ensure_ascii=False)}), None)
            m = (j or {}).get("message") or {}
            cols = [c.get("label") or c.get("fieldname") if isinstance(c, dict) else str(c) for c in m.get("columns") or []]
            return _answer(st, j, columns=cols, rows=(m.get("result") or [])[:500])
        if route == "create":
            doc = _jsonish(body.get("doc"), dict)
            if not doc:
                return 400, {"ok": False, "error": "doc"}
            doc = {k: v for k, v in doc.items() if k not in ("docstatus", "name", "owner", "creation", "modified")}
            st, j = api("POST", "/api/resource/%s" % urllib.parse.quote(doctype), doc)
            d = (j or {}).get("data") or {}
            return _answer(st, j, name=d.get("name"), docstatus=d.get("docstatus"), doc=d)
        if route == "update":
            name = str(body.get("name") or "")
            changes = _jsonish(body.get("changes"), dict)
            if not name or not changes:
                return 400, {"ok": False, "error": "changes"}
            if "docstatus" in changes:
                return 400, {"ok": False, "error": "docstatus", "why": "提交用 submit；作废和删除请在 ERPNext 页面里做。"}
            st, j = api("PUT", "/api/resource/%s/%s" % (urllib.parse.quote(doctype), urllib.parse.quote(name, safe="")), changes)
            d = (j or {}).get("data") or {}
            return _answer(st, j, name=d.get("name"), docstatus=d.get("docstatus"))
        if route == "submit":
            name = str(body.get("name") or "")
            if not name:
                return 400, {"ok": False, "error": "name"}
            st, j = api("GET", "/api/resource/%s/%s" % (urllib.parse.quote(doctype), urllib.parse.quote(name, safe="")), None)
            if st != 200:
                return _answer(st, j)
            doc = (j or {}).get("data") or {}
            if int(doc.get("docstatus") or 0) != 0:
                return 409, {"ok": False, "error": "not-draft", "docstatus": doc.get("docstatus")}
            st, j = api("POST", "/api/method/frappe.client.submit", {"doc": doc})
            d = (j or {}).get("message") or {}
            return _answer(st, j, name=d.get("name"), docstatus=d.get("docstatus"))
    except (ValueError, TypeError):
        return 400, {"ok": False, "error": "bad-json"}
    return 404, {"ok": False, "error": "route", "routes": ["list", "get", "count", "report", "create", "update", "submit"]}


def _answer(st: int, j: dict, **out) -> tuple[int, dict]:
    if st in (200, 201):
        res = dict({"ok": True}, **{k: v for k, v in out.items() if v is not None})
        raw = json.dumps(res, ensure_ascii=False, default=str)
        if len(raw) > OUT_MAX:
            for k in ("rows", "doc"):
                if isinstance(res.get(k), list):
                    while res[k] and len(json.dumps(res, ensure_ascii=False, default=str)) > OUT_MAX:
                        res[k] = res[k][: max(1, len(res[k]) // 2)]
                    res["cut"] = True
            if len(json.dumps(res, ensure_ascii=False, default=str)) > OUT_MAX:
                res = {"ok": True, "cut": True, "note": "结果太大，请少要几个字段或加筛选", **{k: v for k, v in res.items() if k in ("name", "count", "docstatus")}}
        return 200, res
    if st == 403:
        return 403, {"ok": False, "error": "erp-forbidden", "why": "ERPNext 不让这个人做这件事（按他在 ERPNext 里的权限）。" + (_why(j or {}) and "ERPNext：" + _why(j or {}))}
    if st == 404:
        return 404, {"ok": False, "error": "erp-not-found", "why": _why(j or {})}
    return (st if 400 <= st < 500 else 502), {"ok": False, "error": "erp-%s" % st, "why": _why(j or {})}
