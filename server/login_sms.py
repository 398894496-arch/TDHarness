"""company-login-sms-v1 and company-login-remember-v1: sign in with a text-message code, and stay signed in.

The user, 2026-11-24: 「先解决手机验证码登录的问题并且解决登陆态保存的问题」 (with the defaults put to them: the password
stays for everyone as the way in when texts cannot go out; a device that signed in is remembered for 30 days; Alibaba
Cloud's SMS service).

Codes (company-login-sms-v1):
- A person's mobile number is in the roster (people-api, field "phone", set by an admin). A code goes out only to an
  active person's number; a number that is not in the roster (or a disabled person's) is told so and gets no code
  (the user, 2026-11-24: 「如果不在名单的里手机能不能直接提示 不在名单里不给登录」, over the first version's same answer
  for every number: someone trying numbers can now learn which are the company's, at most 30 an hour per address).
- 6 digits, good for 5 minutes, 5 tries; one code a minute per number, 10 a day per number, 30 an hour per address.
  Codes are kept hashed, in memory only.
- The text goes out through Alibaba Cloud (the RPC signature, HMAC-SHA1, a POST): runtime/sms.json {"provider",
  "sign_name", "template_code"} and runtime/aliyun-sms.key (the AccessKey ID on the first line, its secret on the
  second; admins only, never logged). Without them, codes are off and the password is the way in. Providers:
    pnvs   短信认证 (Dypnsapi SendSmsVerifyCode, the default): one of the signatures and templates Alibaba Cloud gives
           (e.g. 恒创联众, 100001 「您的验证码为${code}…${min}分钟内有效…」); no company papers needed. The code is
           ours (TemplateParam {"code", "min"}), checked here as before. The user, 2026-11-24: 「用免资质签名」 (the
           account is a personal one; a company signature needs the business licence).
    dysms  短信服务 (Dysmsapi SendSms): the company's own signature and template, once they are approved.

Remembered devices (company-login-remember-v1):
- A sign-in (code or password) that asks to be remembered gets a device token ("tdhr_" and 32 hex) for that device id.
  The next open hands it back (resume) and is signed in without typing anything, for 30 days from the sign-in; then
  a code or the password again. Kept hashed (sha256) in runtime/login-remember.json, with the login, the device, when.
- 退出登录 forgets it (here, and the desk deletes its copy); an admin disabling a person, or a password change,
  forgets all of that person's; a token from another device id is refused.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

PHONE = re.compile(r"^1[3-9]\d{9}$")
CODE_S = 300
CODE_TRIES = 5
GAP_S = 60
DAY_MAX = 10
ADDR_HOUR_MAX = 30
# The user, 2026-11-25: 「只要不退出永久免登录」: a remembered device stays signed in as long as it is used — each
# sign-in by its token moves the end a year on (unused for a year, it lapses); signing out ends it at once.
REMEMBER_S = 365 * 86400
DEVICE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
REMEMBER_FILE = "login-remember.json"
SMS_CONF = "sms.json"
SMS_KEY = "aliyun-sms.key"
SMS_HOST = "https://dysmsapi.aliyuncs.com/"
PNVS_HOST = "https://dypnsapi.aliyuncs.com/"
_MU = threading.Lock()
_CODES: dict = {}       # phone -> {"hash", "exp", "tries", "login"}
_SENT: dict = {}        # phone -> [times]
_ADDR: dict = {}        # address -> [times]
_OPEN = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def norm_phone(text) -> str:
    """A mainland mobile number as 11 digits (spaces, dashes and +86 dropped), "" when it is not one."""
    s = re.sub(r"[\s-]", "", str(text or ""))
    if s.startswith("+86"):
        s = s[3:]
    elif s.startswith("0086"):
        s = s[4:]
    return s if PHONE.match(s) else ""


def mask(phone: str) -> str:
    return phone[:3] + "****" + phone[-4:] if len(phone) == 11 else ""


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# -- the text message --------------------------------------------------------------------------------------------

def sms_config(runtime: Path) -> dict | None:
    """{"sign_name", "template_code", "key_id", "key_secret"} when codes can go out, else None."""
    try:
        conf = json.loads((Path(runtime) / SMS_CONF).read_text(encoding="utf-8-sig"))
        lines = [x.strip() for x in (Path(runtime) / SMS_KEY).read_text(encoding="utf-8-sig").splitlines() if x.strip()]
    except (OSError, ValueError):
        return None
    if not isinstance(conf, dict) or len(lines) < 2 or not conf.get("sign_name") or not conf.get("template_code"):
        return None
    provider = "dysms" if conf.get("provider") == "dysms" else "pnvs"
    return {"provider": provider, "sign_name": str(conf["sign_name"]), "template_code": str(conf["template_code"]),
            "key_id": lines[0], "key_secret": lines[1], "host": str(conf.get("host") or (SMS_HOST if provider == "dysms" else PNVS_HOST))}


def _pct(s: str) -> str:
    return urllib.parse.quote(str(s), safe="-_.~")


def signed_query(params: dict, secret: str, method: str = "GET") -> str:
    """Alibaba Cloud's RPC signature (SignatureVersion 1.0, HMAC-SHA1) over <method> /."""
    canon = "&".join("%s=%s" % (_pct(k), _pct(params[k])) for k in sorted(params))
    to_sign = method + "&%2F&" + _pct(canon)
    sig = base64.b64encode(hmac.new((secret + "&").encode("utf-8"), to_sign.encode("utf-8"), hashlib.sha1).digest()).decode("ascii")
    return "Signature=%s&%s" % (_pct(sig), canon)


def send_aliyun(conf: dict, phone: str, code: str, timeout: float = 15) -> bool:
    params = {
        "AccessKeyId": conf["key_id"], "Format": "JSON", "RegionId": "cn-hangzhou", "SignName": conf["sign_name"],
        "SignatureMethod": "HMAC-SHA1", "SignatureNonce": uuid.uuid4().hex, "SignatureVersion": "1.0",
        "TemplateCode": conf["template_code"], "Timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "Version": "2017-05-25",
    }
    if conf.get("provider") == "dysms":
        params.update({"Action": "SendSms", "PhoneNumbers": phone, "TemplateParam": json.dumps({"code": code})})
    else:
        # 短信认证: our own code goes in as it is (Alibaba Cloud does not check it; we do), with its minutes.
        params.update({"Action": "SendSmsVerifyCode", "PhoneNumber": phone, "CountryCode": "86",
                       "TemplateParam": json.dumps({"code": code, "min": str(CODE_S // 60)}), "ValidTime": str(CODE_S), "Interval": str(GAP_S)})
    # POST, the form in the body: some of Dysmsapi's actions refuse GET (UnsupportedHTTPMethod, 2026-11-24).
    body = signed_query(params, conf["key_secret"], "POST").encode("utf-8")
    req = urllib.request.Request(conf["host"].rstrip("/") + "/", data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with _OPEN.open(req, timeout=timeout) as r:
            out = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode("utf-8", "replace"))
        except ValueError:
            out = {}
        sys.stderr.write("login-sms send %s %s\n" % (e.code, str(out.get("Code") or "")[:60]))
        return False
    except Exception:  # noqa: BLE001 - not sent; the caller says so without the reason
        return False
    if str(out.get("Code") or "") != "OK":
        sys.stderr.write("login-sms send refused %s\n" % str(out.get("Code") or "")[:60])
    return str(out.get("Code") or "") == "OK"


# -- codes -------------------------------------------------------------------------------------------------------

def _recent(book: dict, key: str, span: float, now: float) -> list:
    got = [t for t in book.get(key) or [] if now - t < span]
    book[key] = got
    return got


def review_login(runtime: Path, now: float) -> dict | None:
    """company-review-login-v1: the one number a store reviewer signs in with (Apple's beta review needs an account it
    can use; no text can reach it) — runtime/review-login.json {"phone": "1…", "code": "6 digits", "until": seconds
    since 1970}. No text is sent to that number and its code is the file's; everything else is as for any number (a
    person in the roster with it, five wrong tries, the address's limits). Nothing after `until`, nothing without the
    file."""
    try:
        d = json.loads((runtime / "review-login.json").read_text(encoding="utf-8"))
        phone, code, until = norm_phone(d.get("phone")), str(d.get("code") or ""), float(d.get("until") or 0)
    except (OSError, ValueError, TypeError, AttributeError):
        return None
    if not phone or not re.fullmatch(r"\d{6}", code) or now > until:
        return None
    return {"phone": phone, "code": code}


def request_code(runtime: Path, phone_text, addr: str, find_login, sender=None, now: float | None = None) -> tuple:
    """(status, body) for 获取验证码. find_login(phone) -> the active person's login with that number, or "".
    sender(phone, code) -> sent or not (Alibaba Cloud by default)."""
    now = time.time() if now is None else now
    phone = norm_phone(phone_text)
    if not phone:
        return 400, {"ok": False, "error": "bad-phone", "hint": "请填 11 位手机号。"}
    review = review_login(runtime, now)
    fixed = bool(review and review["phone"] == phone)
    conf = sms_config(runtime) if sender is None and not fixed else {}
    if conf is None:
        return 503, {"ok": False, "error": "sms-off", "hint": "公司还没开通短信验证码，请用账号和密码登录。"}
    with _MU:
        if len(_recent(_ADDR, addr, 3600, now)) >= ADDR_HOUR_MAX:
            return 429, {"ok": False, "error": "too-many", "hint": "获取验证码太频繁，请过一会儿再试。"}
        sent = _recent(_SENT, phone, 86400, now)
        if fixed:
            sent = []
        if sent and now - sent[-1] < GAP_S:
            return 429, {"ok": False, "error": "wait", "wait": int(GAP_S - (now - sent[-1])) + 1, "hint": "验证码已发送，请稍后再获取。"}
        if len(sent) >= DAY_MAX:
            return 429, {"ok": False, "error": "day-limit", "hint": "这个号码今天获取验证码的次数太多了，请用密码登录或明天再试。"}
        _ADDR[addr].append(now)
        login = find_login(phone)
        if not login:
            _CODES.pop(phone, None)
            return 404, {"ok": False, "error": "not-registered",
                         "hint": "这个手机号没有登记在公司花名册里（或账号已停用），不能用验证码登录。请找管理员登记，或用账号和密码登录。"}
        sent.append(now)
        code = review["code"] if fixed else "%06d" % secrets.randbelow(1000000)
        _CODES[phone] = {"hash": _hash(phone + ":" + code), "exp": now + CODE_S, "tries": 0, "login": login}
    ok = True if fixed else (sender or (lambda p, c: send_aliyun(conf, p, c)))(phone, code)
    if not ok:
        with _MU:
            _CODES.pop(phone, None)
        return 502, {"ok": False, "error": "sms-failed", "hint": "验证码没发出去，请稍后再试，或用账号和密码登录。"}
    return 200, {"ok": True, "sent": True, "wait": GAP_S}


def check_code(phone_text, code_text, now: float | None = None) -> str:
    """The login a right code is for ("" otherwise). A code is good once; five wrong tries and it is gone."""
    now = time.time() if now is None else now
    phone = norm_phone(phone_text)
    code = re.sub(r"\s", "", str(code_text or ""))
    if not phone or not re.fullmatch(r"\d{6}", code):
        return ""
    with _MU:
        row = _CODES.get(phone)
        if not row or now > row["exp"]:
            _CODES.pop(phone, None)
            return ""
        if not hmac.compare_digest(row["hash"], _hash(phone + ":" + code)):
            row["tries"] += 1
            if row["tries"] >= CODE_TRIES:
                _CODES.pop(phone, None)
            return ""
        _CODES.pop(phone, None)
        return row["login"]


def reset() -> None:
    with _MU:
        _CODES.clear()
        _SENT.clear()
        _ADDR.clear()


# -- remembered devices ------------------------------------------------------------------------------------------

def _book(runtime: Path) -> dict:
    try:
        d = json.loads((Path(runtime) / REMEMBER_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    if not isinstance(d, dict) or not isinstance(d.get("devices"), list):
        d = {"devices": []}
    return d


def _save(runtime: Path, d: dict, now: float) -> None:
    d["devices"] = [x for x in d["devices"] if isinstance(x, dict) and float(x.get("exp") or 0) > now]
    p = Path(runtime) / REMEMBER_FILE
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def remember(runtime: Path, login: str, device: str, how: str, now: float | None = None) -> str:
    """A device token for `login` on `device` (one per device: an older one there is replaced); "" for an odd device."""
    now = time.time() if now is None else now
    if not DEVICE.match(str(device or "")) or not login:
        return ""
    token = "tdhr_" + secrets.token_hex(16)
    with _MU:
        d = _book(runtime)
        d["devices"] = [x for x in d["devices"] if not (x.get("login") == login and x.get("device") == device)]
        d["devices"].append({"hash": _hash(token), "login": login, "device": device, "how": how,
                             "made": int(now), "exp": int(now + REMEMBER_S), "used": int(now)})
        _save(runtime, d, now)
    return token


def resume(runtime: Path, token: str, device: str, now: float | None = None) -> str:
    """The login a device token is good for on that device now ("" otherwise)."""
    now = time.time() if now is None else now
    if not re.fullmatch(r"tdhr_[0-9a-f]{32}", str(token or "")) or not DEVICE.match(str(device or "")):
        return ""
    h = _hash(token)
    with _MU:
        d = _book(runtime)
        for x in d["devices"]:
            if hmac.compare_digest(str(x.get("hash") or ""), h):
                if x.get("device") != device or float(x.get("exp") or 0) <= now:
                    return ""
                x["used"] = int(now)
                x["exp"] = int(now + REMEMBER_S)
                _save(runtime, d, now)
                return str(x.get("login") or "")
    return ""


def forget(runtime: Path, token: str = "", login: str = "", now: float | None = None) -> int:
    """Forget one device token, or every one of a person's. Returns how many."""
    now = time.time() if now is None else now
    h = _hash(token) if token else ""
    with _MU:
        d = _book(runtime)
        keep = [x for x in d["devices"] if not ((h and x.get("hash") == h) or (login and x.get("login") == login))]
        n = len(d["devices"]) - len(keep)
        if n:
            d["devices"] = keep
            _save(runtime, d, now)
    return n


def devices_of(runtime: Path, login: str, now: float | None = None) -> list:
    now = time.time() if now is None else now
    return [{"device": x.get("device"), "how": x.get("how"), "made": x.get("made"), "exp": x.get("exp"), "used": x.get("used")}
            for x in _book(runtime)["devices"] if x.get("login") == login and float(x.get("exp") or 0) > now]
