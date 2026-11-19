"""Tell people about their task cards through a WeCom (企业微信) self-built app.

Off until the site configures it. D:/dsh/runtime/wecom.env (admins only):

    WECOM_CORP_ID=...
    WECOM_AGENT_ID=...
    WECOM_SECRET=...
    WECOM_PROXY=http://127.0.0.1:7890     # optional: the API only accepts the app's trusted IP

and D:/dsh/runtime/wecom-users.json, {"<login>": "<WeCom userid>"}: a person not in it is
not messaged (the log says so). Nothing secret is logged; the log line is who, kind, card, result.
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = os.environ.get("WECOM_API_BASE") or "https://qyapi.weixin.qq.com"


def read_env(path: Path) -> dict:
    out = {}
    try:
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    except OSError:
        pass
    return out


class WeCom:
    def __init__(self, runtime: Path):
        self.runtime = Path(runtime)
        self.env = read_env(self.runtime / "wecom.env")
        try:
            self.users = json.loads((self.runtime / "wecom-users.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            self.users = {}
        self._token = ("", 0.0)

    @property
    def on(self) -> bool:
        return all(self.env.get(k) for k in ("WECOM_CORP_ID", "WECOM_AGENT_ID", "WECOM_SECRET"))

    def _open(self, req, timeout=15):
        proxy = self.env.get("WECOM_PROXY")
        handlers = [urllib.request.ProxyHandler({"http": proxy, "https": proxy})] if proxy else [urllib.request.ProxyHandler({})]
        return urllib.request.build_opener(*handlers).open(req, timeout=timeout)

    def token(self) -> str:
        tok, until = self._token
        if tok and time.time() < until:
            return tok
        q = urllib.parse.urlencode({"corpid": self.env["WECOM_CORP_ID"], "corpsecret": self.env["WECOM_SECRET"]})
        with self._open(API + "/cgi-bin/gettoken?" + q) as r:
            j = json.loads(r.read())
        if j.get("errcode") not in (0, None) or not j.get("access_token"):
            raise RuntimeError("gettoken errcode %s" % j.get("errcode"))
        self._token = (j["access_token"], time.time() + int(j.get("expires_in") or 7200) - 300)
        return self._token[0]

    def send(self, login: str, text: str) -> str:
        """'sent', or why not: 'off', 'no-userid', 'error <code>'."""
        if not self.on:
            return "off"
        uid = self.users.get(login)
        if not uid:
            return "no-userid"
        body = json.dumps({"touser": uid, "msgtype": "text", "agentid": int(self.env["WECOM_AGENT_ID"]),
                           "text": {"content": text[:2000]}}, ensure_ascii=False).encode("utf-8")
        try:
            req = urllib.request.Request(API + "/cgi-bin/message/send?access_token=" + self.token(), data=body, method="POST")
            req.add_header("Content-Type", "application/json")
            with self._open(req) as r:
                j = json.loads(r.read())
        except Exception as e:  # noqa: BLE001 - a message must never take the people service down
            return "error " + type(e).__name__
        return "sent" if j.get("errcode") == 0 else "error %s" % j.get("errcode")


def log(runtime: Path, who: str, kind: str, ticket: str, result: str) -> None:
    try:
        with (Path(runtime) / "notify.log").open("a", encoding="utf-8") as f:
            f.write("%s\t%s\t%s\t%s\t%s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), who, kind, ticket, result))
    except OSError:
        pass
