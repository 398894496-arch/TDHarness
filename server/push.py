"""company-phone-push-v1: notifications on people's phones, from this server through Apple's push service (APNs).

The user, 2026-11-25: 「chat 聊天界面如果有消息 怎么提醒！ AI如果刚刚问了问题 已经出答案了怎么提醒」「连后台推送一起」「电脑已读
手机端就要标记为已读」. While the app is open it shows its own banners; when it is in the background or the phone is
locked only a push reaches it:

- a colleague's message: to every other member of the chat with a phone registered, 「名字：说了什么」, the app's badge
  the person's unread count, one thread per chat;
- read on another device (the desk): a silent push with the new count and the chats read, so the app's badge and its
  notifications in the list go with it;
- the AI's answer (the desk's kernel says so, company-shell turn/end): 「AI 已回复」 and the conversation's title.

Off until the site configures it. D:/dsh/runtime/apns.env (admins only):

    APNS_KEY_FILE=D:/dsh/runtime/apns/AuthKey_XXXXXXXXXX.p8
    APNS_KEY_ID=XXXXXXXXXX
    APNS_TEAM_ID=XXXXXXXXXX
    APNS_TOPIC=cn.tdharness.mobile        # the app's bundle id (default)

The phones: D:/dsh/runtime/push-devices.json, {login: [{"token", "env", "device", "at"}]}. Apple's answer that a token is gone
(410, BadDeviceToken, Unregistered) removes it. The sending is server/apns-send.js (HTTP/2 and ES256 are Node's). The
log has who, what kind, how many, the result; never what was said, never a token in full.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOKEN_OK = re.compile(r"^[0-9a-f]{64,200}$")
MU = threading.Lock()
GONE = ("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic")
READ_GAP = 10.0  # seconds: read-elsewhere pushes of one person, at most this often (Apple throttles silent pushes)


def read_env(path: Path) -> dict:
    out = {}
    try:
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                out[k.strip()] = v.split(" #")[0].strip()
    except OSError:
        pass
    return out


def config(runtime: Path) -> dict | None:
    env = read_env(runtime / "apns.env")
    key = env.get("APNS_KEY_FILE", "")
    if not key or not env.get("APNS_KEY_ID") or not env.get("APNS_TEAM_ID") or not Path(key).is_file():
        return None
    return {"key_file": key, "key_id": env["APNS_KEY_ID"], "team_id": env["APNS_TEAM_ID"],
            "topic": env.get("APNS_TOPIC") or "cn.tdharness.mobile",
            # the signed provider token, reused for 50 minutes (apns-send.js; Apple refuses one more often than 20)
            "token_cache": str(runtime / "apns-token.json")}


# ---- the phones -------------------------------------------------------------------------------------------------

def _devices_path(runtime: Path) -> Path:
    return runtime / "push-devices.json"


def devices(runtime: Path) -> dict:
    try:
        data = json.loads(_devices_path(runtime).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_devices(runtime: Path, data: dict) -> None:
    p = _devices_path(runtime)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def register(runtime: Path, login: str, token: str, env: str, on: bool = True, device: str = "") -> dict:
    """A phone of `login` (on: notify it; off: forget it). One token belongs to one person: the same phone (its app's
    device id) signed in by someone else moves to them, but a token held for another phone is not taken over, and
    turning off only ever forgets one's own."""
    token = str(token or "").strip().lower()
    if not TOKEN_OK.match(token):
        return {"ok": False, "error": "bad-token"}
    env = "production" if env == "production" else "sandbox"
    device = re.sub(r"[^A-Za-z0-9._-]", "", str(device or ""))[:80]
    with MU:
        data = devices(runtime)
        held = next((k for k in data if k != login and any(d.get("token") == token for d in data[k])), "")
        if held:
            their = next(d for d in data[held] if d.get("token") == token)
            if not on:
                return {"ok": True, "on": False}
            if (their.get("device") or "") and their.get("device") != device:
                return {"ok": False, "error": "token-taken"}
        for k in list(data):
            if on or k == login:
                data[k] = [d for d in data[k] if d.get("token") != token]
            if not data[k]:
                del data[k]
        if on:
            data.setdefault(login, []).append({"token": token, "env": env, "device": device, "at": int(time.time())})
            data[login] = data[login][-5:]
        _save_devices(runtime, data)
    return {"ok": True, "on": bool(on)}


def forget(runtime: Path, tokens: list) -> None:
    if not tokens:
        return
    with MU:
        data = devices(runtime)
        for k in list(data):
            data[k] = [d for d in data[k] if d.get("token") not in tokens]
            if not data[k]:
                del data[k]
        _save_devices(runtime, data)


def log(runtime: Path, line: str) -> None:
    try:
        d = runtime.parent / "logs"
        d.mkdir(parents=True, exist_ok=True)
        with (d / "push.log").open("a", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + line + "\n")
    except OSError:
        pass


def node_path() -> str:
    return os.environ.get("TDH_NODE") or shutil.which("node") or r"C:\Program Files\nodejs\node.exe"


def send(runtime: Path, cfg: dict, items: list, node: str | None = None) -> list:
    """Sends `items` ({"login", "payload", "type", "collapse"} — to each of that person's phones); returns the results.
    Tokens Apple says are gone are forgotten."""
    data = devices(runtime)
    out = []
    for it in items:
        for d in data.get(it["login"], []):
            out.append({"token": d["token"], "env": d.get("env", "sandbox"), "payload": it["payload"],
                        "type": it.get("type", "alert"), "collapse": it.get("collapse")})
    if not out:
        return []
    job = dict(cfg, items=out)
    try:
        r = subprocess.run([node or node_path(), str(HERE / "apns-send.js")], input=json.dumps(job), capture_output=True,
                           text=True, encoding="utf-8", timeout=60)
        got = json.loads((r.stdout or "").strip().splitlines()[-1]) if r.stdout else {"ok": False, "why": "no-output"}
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired) as e:
        got = {"ok": False, "why": type(e).__name__}
    results = got.get("results") or []
    gone = [x["token"] for x in results if x.get("status") == 410 or x.get("reason") in GONE]
    forget(runtime, gone)
    ok = sum(1 for x in results if x.get("status") == 200)
    bad = sorted({"%s:%s" % (x.get("status"), x.get("reason")) for x in results if x.get("status") != 200})
    log(runtime, "send kinds=%s phones=%d ok=%d%s%s" % (
        ",".join(sorted({it.get("kind", "?") for it in items})), len(out), ok,
        (" failed=" + "|".join(bad)) if bad else "", "" if got.get("ok") else " why=" + str(got.get("why"))))
    return results


# ---- what a message says -----------------------------------------------------------------------------------------

def message_words(content, head) -> str:
    """One line for a message: its words, or what it is (a picture, a file, a voice message, a call)."""
    head = head if isinstance(head, dict) else {}
    if isinstance(head, dict) and head.get("webrtc"):
        return "邀请你语音通话"
    if isinstance(head.get("tdh_card"), dict):
        return "【任务卡】" + str(head["tdh_card"].get("title") or "")
    if isinstance(content, str):
        return content.strip()[:120]
    if not isinstance(content, dict):
        return "发来一条消息"
    txt = str(content.get("txt") or "").strip()
    kinds = [str((e or {}).get("tp") or "") for e in (content.get("ent") or []) if isinstance(e, dict)]
    mimes = [str(((e or {}).get("data") or {}).get("mime") or "") for e in (content.get("ent") or []) if isinstance(e, dict)]
    if "AU" in kinds:
        return "[语音]"
    if "IM" in kinds or any(m.startswith("image/") for m in mimes):
        return ("[图片] " + txt).strip()[:120] if txt else "[图片]"
    if "EX" in kinds:
        return "[文件] " + str(((content.get("ent") or [{}])[0].get("data") or {}).get("name") or "")
    return txt[:120] or "发来一条消息"


# ---- the chat's side -------------------------------------------------------------------------------------------

def unread_counts(cfg: dict, runtime: Path, logins: list, psql) -> dict:
    """{login: {"total": n, "read": {topic name (the server's): readseq}}} for these people."""
    if not logins:
        return {}
    tags = ",".join("'tdh:%s'" % re.sub(r"[^A-Za-z0-9._-]", "", x) for x in logins)
    sql = ("select coalesce(json_agg(x), '[]') from (select u.tags, s.topic, s.readseqid as r, t.seqid as q "
           "from subscriptions s join users u on u.id = s.userid join topics t on t.name = s.topic "
           "where s.deletedat is null and (s.topic like 'grp%%' or s.topic like 'p2p%%') "
           "and exists (select 1 from jsonb_array_elements_text(u.tags::jsonb) g where g in (%s))) x") % tags
    rows = json.loads(psql(cfg, runtime, sql) or "[]")
    out = {}
    for r in rows if isinstance(rows, list) else []:
        login = next((t[4:] for t in (r.get("tags") or []) if isinstance(t, str) and t.startswith("tdh:")), "")
        if not login:
            continue
        o = out.setdefault(login, {"total": 0, "read": {}})
        q, rd = int(r.get("q") or 0), int(r.get("r") or 0)
        o["total"] += max(0, q - rd)
        o["read"][str(r.get("topic") or "")] = rd
    return out


def their_topic(topic: str, sender_link: str) -> str:
    """The chat as its member's own app names it: a group by its name, a one-to-one by the other person."""
    return topic if topic.startswith("grp") else ("usr" + sender_link if sender_link else "")


def chat_round(chat_cfg: dict, runtime: Path, apns: dict, people: dict, links: dict, bots, psql, fetch, max_id,
               login_of, state: dict, now: float | None = None) -> dict:
    """One round: new messages since the last, then read changes. `state` keeps {"last", "read", "pending", "read_at"};
    the first round only takes its place (no backlog of old messages). The place moves on only once the round's
    notifications are built, so a failure on the way (the database) leaves the messages for the next round."""
    now = time.time() if now is None else now
    data = devices(runtime)
    if "last" not in state:
        state["last"] = max_id(chat_cfg, runtime)
        return {"started": state["last"]}
    rows = fetch(chat_cfg, runtime, state["last"], 200)
    last = state["last"]
    items = []
    touched = set()
    spoke = set()  # (sender, chat): their own read mark moves with what they send; that is no news to their phone
    for r in rows:
        last = max(last, int(r.get("id") or 0))
        head = r.get("head")
        if isinstance(head, str):
            try:
                head = json.loads(head)
            except ValueError:
                head = {}
        head = head if isinstance(head, dict) else {}
        if head.get("replace"):
            continue
        sender = login_of(r.get("from_tags"))
        if not sender:
            continue
        members = [login_of(t) for t in (r.get("member_tags") or [])]
        topic = str(r.get("topic") or "")
        spoke.add((sender, topic))
        content = r.get("content")
        if isinstance(content, str) and content[:1] in "{\"":
            try:
                content = json.loads(content)
            except ValueError:
                pass
        words = message_words(content, head)
        who = str((people.get(sender) or {}).get("name") or sender)
        group = topic.startswith("grp")
        if group:
            pub = r.get("topic_public") or {}
            if isinstance(pub, str):
                try:
                    pub = json.loads(pub)
                except ValueError:
                    pub = {}
            title, body = str((pub or {}).get("fn") or "群聊"), who + "：" + words
        else:
            title, body = who, words
        for m in members:
            if not m or m == sender or m in bots or m not in data:
                continue
            tt = their_topic(topic, links.get(sender, ""))
            if not tt:
                continue
            touched.add(m)
            items.append({"login": m, "kind": "chat", "topic": tt, "seq": int(r.get("seq") or 0),
                          "title": title, "body": body})
    try:
        counts = unread_counts(chat_cfg, runtime, sorted(data), psql) if data else {}
    except (ValueError, RuntimeError, OSError):
        counts = None  # the messages still go, without a badge; read changes wait for a round that can count
    out = []
    for it in items:
        aps = {"alert": {"title": it["title"], "body": it["body"][:180]}, "sound": "default",
               "thread-id": it["topic"], "mutable-content": 1}
        if counts is not None:
            aps["badge"] = (counts.get(it["login"]) or {}).get("total", 0)
        out.append({"login": it["login"], "kind": "chat", "collapse": None,
                    "payload": {"aps": aps, "k": "chat", "t": it["topic"], "seq": it["seq"]}})
    # Read elsewhere: a chat's read mark moved for someone with a phone. The moves gather per person and go at most
    # every READ_GAP seconds, and not in a round that already sends them a message (its badge says the count); they
    # wait, they are not dropped. A silent push carries no "aps" badge (Apple's rule): the count is "b".
    old_read = state.setdefault("read", {})
    pending = state.setdefault("pending", {})
    read_at = state.setdefault("read_at", {})
    for login, c in (counts or {}).items():
        if login in old_read:
            before = old_read[login]
            for t, rd in c["read"].items():
                if rd > int(before.get(t, 0)) and (login, t) not in spoke:
                    p = pending.setdefault(login, {})
                    p[t] = max(rd, p.get(t, 0))
        old_read[login] = c["read"]
        moved = pending.get(login)
        if not moved or login in touched or now - read_at.get(login, 0) < READ_GAP:
            continue
        names = []
        for t in moved:
            if t.startswith("grp"):
                names.append([t, moved[t]])
            else:
                other = _p2p_other(chat_cfg, runtime, t, login, psql, login_of)
                if other and links.get(other):
                    names.append(["usr" + links[other], moved[t]])
        out.append({"login": login, "kind": "read", "type": "background",
                    "payload": {"aps": {"content-available": 1}, "k": "read", "r": names[:40], "b": c["total"]}})
        read_at[login] = now
        del pending[login]
    for login in [k for k in pending if k not in data]:
        del pending[login]
    state["last"] = last
    if out:
        send(runtime, apns, out)
    return {"messages": len(rows), "pushed": len(out)}


def _p2p_other(cfg: dict, runtime: Path, topic: str, me: str, psql, login_of) -> str:
    sql = ("select coalesce(json_agg(u.tags), '[]') from subscriptions s join users u on u.id = s.userid "
           "where s.topic = '%s'") % re.sub(r"[^A-Za-z0-9_-]", "", topic)
    try:
        tags = json.loads(psql(cfg, runtime, sql) or "[]")
    except (ValueError, RuntimeError):
        return ""
    return next((x for x in (login_of(t) for t in tags) if x and x != me), "")


# ---- the AI's side -----------------------------------------------------------------------------------------------

def ai_done(runtime: Path, apns: dict | None, login: str, session: str, title: str, preview: str, reason: str) -> dict:
    """The desk's kernel finished a turn of `login`'s conversation `session`: 「AI 已回复」 on their phones."""
    if apns is None:
        return {"ok": True, "sent": 0, "why": "not-configured"}
    if login not in devices(runtime):
        return {"ok": True, "sent": 0}
    session = re.sub(r"[^A-Za-z0-9_.:-]", "", str(session or ""))[:120]
    head = "AI 出错了" if reason == "error" else "AI 已回复"
    body = (str(title or "").strip()[:60] or "你的问题有答案了")
    if preview and reason != "error":
        body = body + "：" + str(preview).strip().replace("\n", " ")[:120]
    got = send(runtime, apns, [{"login": login, "kind": "ai", "collapse": "ai-" + session[-40:],
                                "payload": {"aps": {"alert": {"title": head, "body": body}, "sound": "default",
                                                    "thread-id": "ai"}, "k": "ai", "s": session}}])
    return {"ok": True, "sent": sum(1 for x in got if x.get("status") == 200)}
