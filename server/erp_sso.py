"""company-erp-sso-v1: TDH accounts in ERPNext, and TDH's login for it.

The user, 2026-11-21: ERPNext (on this server, in WSL, https://tdharness.tail9c7cc7.ts.net on the tailnet only) takes
the TDH accounts as they are ("按照TDH账号映射过去"), with an entry under 聊天 in the desk's left column; what each
role does in ERPNext is tuned later.

Login. ERPNext's own social login with TDH as the provider (OAuth 2 authorization code). Tailscale Serve sends
https://<erp host>/tdh-sso/* to the people service's /company/sso/*, so the browser and ERPNext's backend reach it at
the same tailnet name with its real certificate (the backend container resolves the name to the node's tailnet
address by an extra hosts entry). ERPNext keeps no password of anyone:
  start      the desk's entry (POST /company/ext/erp/ticket with the person's login token gives a one-time ticket,
             two minutes) opens /tdh-sso/start?t=<ticket> in the browser: the person is known, a signed cookie on
             /tdh-sso keeps them known for ten minutes, and the browser goes on to ERPNext's TDH login (its
             authorize link, read from ERPNext's login page), so no password is asked.
  authorize  ERPNext sends the browser here (client id and redirect address must be ERPNext's own): with the
             cookie, at once; without it, TDH's username and password (the TDH login's rules, its lockout too).
             A code, one minute, once.
  token      ERPNext's backend changes the code (with the client secret) for an access token, five minutes.
  userinfo   who that is: sub (the TDH login), email <login>@<email_domain> (the ERPNext user), name.
Only active people of the roster get through; ERPNext's users of people who left are disabled by the sync.

Sync (every ten minutes): every active person has an enabled ERPNext user <login>@<email_domain>, with the roles of
their TDH role and department at creation (runtime/erp-roles.json, else ROLES below; roles ERPNext does not have are
left out); later rounds keep the name and the enabled flag in step and never take roles away. A person disabled or
removed in TDH is disabled in ERPNext. Users outside <email_domain> (Administrator, the sync user's own) are not
touched. The sync uses an API key of its own (runtime/erp-sso.json, admins only); nothing here is ever logged but
counts.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TICKET_S, CODE_S, TOKEN_S, COOKIE_S = 120, 60, 300, 600
COOKIE = "tdh_sso"
HOME = "/desk/home"                       # ERPNext 16's own home (company-erp-home-v1)
PUBLIC = "/tdh-sso"                       # the path the browser sees (Tailscale Serve -> /company/sso)
SYNC_DOMAIN_RE = re.compile(r"^[a-z0-9.-]+\.[a-z]{2,}$")
ROLES = {
    "admin": ["System Manager", "Accounts Manager", "Sales Manager", "Purchase Manager", "Stock Manager", "Manufacturing Manager"],
    "depts": {"行政财务": ["Accounts User", "Purchase User"], "销售": ["Sales User"], "生产设计": ["Manufacturing User", "Stock User"],
              "内勤": ["Sales User", "Stock User"]},
    "default": ["Employee"],
}
_OPEN = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # this machine only, never a proxy


def load_config(runtime: Path) -> dict:
    try:
        cfg = json.loads((Path(runtime) / "erp-sso.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    need = ("base", "client_id", "client_secret", "cookie_key", "email_domain", "erp_origin")
    if not isinstance(cfg, dict) or not cfg.get("on") or any(not cfg.get(k) for k in need):
        return {}
    if not SYNC_DOMAIN_RE.match(str(cfg["email_domain"])):
        return {}
    cfg["base"] = str(cfg["base"]).rstrip("/")
    return cfg


def load_roles(runtime: Path) -> dict:
    try:
        r = json.loads((Path(runtime) / "erp-roles.json").read_text(encoding="utf-8-sig"))
        return r if isinstance(r, dict) else ROLES
    except (OSError, ValueError):
        return ROLES


class Once:
    """One-time values with an expiry, in this process only (tickets, codes, access tokens)."""

    def __init__(self):
        self._d: dict = {}
        self._mu = threading.Lock()

    def put(self, value: dict, ttl: float, prefix: str) -> str:
        key = prefix + secrets.token_urlsafe(24)
        now = time.time()
        with self._mu:
            for k in [k for k, v in self._d.items() if v[1] < now]:
                del self._d[k]
            self._d[key] = (value, now + ttl)
        return key

    def take(self, key: str) -> dict | None:
        with self._mu:
            v = self._d.pop(str(key or ""), None)
        return v[0] if v and v[1] >= time.time() else None

    def peek(self, key: str) -> dict | None:
        with self._mu:
            v = self._d.get(str(key or ""))
        return v[0] if v and v[1] >= time.time() else None


def sign(key: str, login: str, ttl: float = COOKIE_S, now: float | None = None) -> str:
    exp = str(int((now or time.time()) + ttl))
    raw = login + "|" + exp
    mac = hmac.new(key.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode((raw + "|" + mac).encode()).decode().rstrip("=")


def unsign(key: str, value: str, now: float | None = None) -> str:
    try:
        raw = base64.urlsafe_b64decode(str(value) + "=" * (-len(str(value)) % 4)).decode()
        login, exp, mac = raw.rsplit("|", 2)
    except (ValueError, UnicodeDecodeError):
        return ""
    good = hmac.new(key.encode(), (login + "|" + exp).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(good, mac) or not exp.isdigit() or int(exp) < (now or time.time()):
        return ""
    return login


def cookie_of(header: str) -> str:
    for part in str(header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v
    return ""


def email_of(login: str, domain: str) -> str:
    return "%s@%s" % (login, domain)


def userinfo(row: dict, domain: str) -> dict:
    login = str(row.get("login") or "")
    name = str(row.get("name") or "").strip() or login
    return {"sub": login, "email": email_of(login, domain), "email_verified": True, "name": name, "given_name": name,
            "preferred_username": login}


def redirect_ok(cfg: dict, client_id: str, redirect_uri: str) -> bool:
    """ERPNext's client, sending back to its own TDH callback (the one its setup reported, else the usual one)."""
    want = cfg.get("redirect_uri") or cfg["base"] + "/api/method/frappe.integrations.oauth2_logins.custom/tdh"
    return hmac.compare_digest(str(client_id), cfg["client_id"]) and str(redirect_uri) == want


def with_query(url: str, **params) -> str:
    sep = "&" if "?" in url else "?"
    return url + sep + urllib.parse.urlencode(params)


def login_page(params: dict, error: str = "") -> bytes:
    """TDH's login for ERPNext (no outside assets)."""
    hidden = "".join('<input type="hidden" name="%s" value="%s">' % (html.escape(k), html.escape(str(v)))
                     for k, v in params.items() if k in ("client_id", "redirect_uri", "state", "response_type", "scope"))
    err = '<p class="err">%s</p>' % html.escape(error) if error else ""
    page = ("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta name=\"referrer\" content=\"no-referrer\"><title>用 TDH 账号登录 ERPNext</title><style>"
            "body{margin:0;font:15px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:#f5f6f8;color:#0f1115;"
            "display:grid;place-items:center;min-height:100vh}form{background:#fff;padding:28px 26px;border-radius:12px;width:min(340px,90vw);"
            "box-shadow:0 8px 30px rgba(15,17,21,.1)}h1{font-size:18px;margin:0 0 6px}p{margin:0 0 18px;color:#61666b;font-size:13px}"
            "label{display:block;font-size:13px;margin:12px 0 6px}input[type=text],input[type=password]{width:100%%;box-sizing:border-box;"
            "padding:9px 10px;border:1px solid #d8dbe0;border-radius:6px;font:inherit}button{margin-top:18px;width:100%%;padding:10px;border:0;"
            "border-radius:6px;background:#0f1115;color:#fff;font:inherit;cursor:pointer}.err{color:#d93025;margin:10px 0 0}</style></head><body>"
            "<form method=\"post\" action=\"%s/authorize\"><h1>用 TDH 账号登录 ERPNext</h1><p>账号和密码就是登录 TDH 用的那一套。</p>%s"
            "<label>TDH 账号</label><input type=\"text\" name=\"username\" autocomplete=\"username\" autofocus required>"
            "<label>密码</label><input type=\"password\" name=\"password\" autocomplete=\"current-password\" required>%s"
            "<button type=\"submit\">登录</button></form></body></html>") % (PUBLIC, hidden, err)
    return page.encode("utf-8")


def authorize_link(page: str, base: str) -> str:
    """ERPNext's TDH login link (its authorize address with its own state), from its login page."""
    for m in re.finditer(r'href="([^"]+)"', page or ""):
        url = html.unescape(m.group(1))
        if url.startswith(base + PUBLIC + "/authorize?"):
            return url
    return ""


def erp_login_link(cfg: dict, timeout: float = 15) -> str:
    """Asks ERPNext (as a guest, as the browser would) for its login page and takes the TDH link from it."""
    # company-erp-home-v1 (the user, 2026-11-21: ERPNext 16 showed its app chooser, 「ERPNext」 and 「框架」, first): the
    # login lands on ERPNext's own home (/desk/home), never on the chooser (/app -> /desk).
    req = urllib.request.Request(cfg["erp_origin"].rstrip("/") + "/login?redirect-to=" + urllib.parse.quote(HOME, safe=""))
    host = urllib.parse.urlparse(cfg["base"]).netloc
    req.add_header("Host", host)
    req.add_header("X-Forwarded-Proto", "https")
    req.add_header("X-Forwarded-Host", host)
    try:
        with _OPEN.open(req, timeout=timeout) as r:
            return authorize_link(r.read().decode("utf-8", "replace"), cfg["base"])
    except (OSError, urllib.error.URLError, ValueError):
        return ""


# -- the sync --------------------------------------------------------------------------------------------------------

def erp_api(cfg: dict, method: str, path: str, body: dict | None = None, timeout: float = 20) -> tuple[int, dict]:
    req = urllib.request.Request(cfg["erp_origin"].rstrip("/") + path, method=method,
                                 data=json.dumps(body).encode("utf-8") if body is not None else None)
    req.add_header("Authorization", "token %s:%s" % (cfg.get("api_key") or "", cfg.get("api_secret") or ""))
    req.add_header("Accept", "application/json")
    req.add_header("Host", urllib.parse.urlparse(cfg["base"]).netloc)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with _OPEN.open(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace") or "{}")
        except ValueError:
            return e.code, {}


def roles_for(row: dict, dept: str, mapping: dict, known: set) -> list[str]:
    if row.get("role") == "admin":
        want = list(mapping.get("admin") or [])
    else:
        want = list((mapping.get("depts") or {}).get(dept) or mapping.get("default") or [])
    return [r for r in dict.fromkeys(want) if r in known]


def sync(cfg: dict, people: dict, depts: dict, mapping: dict, api=None) -> dict:
    """One round: TDH's roster onto ERPNext's users. Returns counts."""
    api = api or (lambda m, p, b=None: erp_api(cfg, m, p, b))
    domain = cfg["email_domain"]
    out = {"ok": True, "created": 0, "enabled": 0, "disabled": 0, "renamed": 0, "failed": 0}
    st, j = api("GET", "/api/resource/Role?" + urllib.parse.urlencode({"fields": json.dumps(["name", "desk_access", "disabled"]), "limit_page_length": 1000}))
    if st != 200:
        return {"ok": False, "why": "erp-%s" % st}
    known = {r.get("name") for r in j.get("data") or []}
    # company-erp-admin-all-v1 (the user, 2026-11-21, 郑飞飞 told "Work Order 权限不足"): TDH's admins have every role
    # ERPNext has for its desk, kept so each round (a role added later reaches them too; none is taken away).
    every = sorted(r["name"] for r in j.get("data") or [] if r.get("name") and r["name"] not in ("Administrator", "Guest", "All")
                   and int(r.get("desk_access", 1) or 0) and not int(r.get("disabled") or 0))
    st, j = api("GET", "/api/resource/User?" + urllib.parse.urlencode({
        "fields": json.dumps(["name", "enabled", "first_name"]), "filters": json.dumps([["name", "like", "%@" + domain]]),
        "limit_page_length": 1000}))
    if st != 200:
        return {"ok": False, "why": "erp-users-%s" % st}
    have = {u["name"]: u for u in j.get("data") or [] if str(u.get("name") or "").endswith("@" + domain)}
    active = {}
    for login, row in people.items():
        if (row.get("status") or "active") == "active" and re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,63}", str(login)):
            active[email_of(login, domain)] = row
    for email, row in active.items():
        name = str(row.get("name") or "").strip() or row["login"]
        u = have.get(email)
        if u is None:
            roles = every if row.get("role") == "admin" else roles_for(row, depts.get(row.get("dept"), ""), mapping, known)
            st, _ = api("POST", "/api/resource/User", {"email": email, "first_name": name, "enabled": 1, "send_welcome_email": 0,
                                                       "user_type": "System User", "roles": [{"role": r} for r in roles]})
            out["created" if st in (200, 201) else "failed"] += 1
            continue
        change = {}
        if not int(u.get("enabled") or 0):
            change["enabled"] = 1
        if (u.get("first_name") or "") != name:
            change["first_name"] = name
        if change:
            st, _ = api("PUT", "/api/resource/User/" + urllib.parse.quote(email), change)
            if st == 200:
                out["enabled" if "enabled" in change else "renamed"] += 1
            else:
                out["failed"] += 1
    out["admin_roles"] = 0
    for email, row in active.items():
        if row.get("role") != "admin" or email not in have:
            continue
        st, d = api("GET", "/api/resource/User/" + urllib.parse.quote(email))
        if st != 200:
            continue
        mine = {r.get("role") for r in ((d.get("data") or {}).get("roles") or [])}
        if set(every) - mine:
            st, _ = api("PUT", "/api/resource/User/" + urllib.parse.quote(email), {"roles": [{"role": r} for r in sorted(mine | set(every))]})
            out["admin_roles" if st == 200 else "failed"] += 1
    for email, u in have.items():
        if email not in active and int(u.get("enabled") or 0):
            st, _ = api("PUT", "/api/resource/User/" + urllib.parse.quote(email), {"enabled": 0})
            out["disabled" if st == 200 else "failed"] += 1
    out["ok"] = not out["failed"]
    return out
