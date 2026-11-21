"""company-chat-archive-v1: the files sent in the company chat, kept on the company disk by kind.

The user, 2026-11-21: the chat's files recognised by kind and kept together ("自动识别文件类型自动归类保存在一起");
each person a copy of the files of their own chats, the admins one of all of them ("每人一份 + 管理员一份汇总").

Every few minutes the people service reads the chat's new messages that carry a file or a picture (its database, read
only; the file itself is Tinode's upload on this server, found by filemsglinks / fileuploads, or a small picture kept
in the message) and copies the file, under its own name, to
    <company>/_office/聊天文件/<kind>/<YYYY-MM>/<chat>/<MMDD-HHMM> <sender> <name>       all chats (admins only)
    <member's personal folder>/聊天文件/<kind>/<YYYY-MM>/<chat>/<MMDD-HHMM> <sender> <name>
for every member of that chat whose personal folder is not the admins' (an admin's is _office: the summary is theirs).
<chat> is the group's name, or in a one-to-one chat the other person (the summary: both, "A 与 B").
<kind>: 合同发票报价 by the name first (合同 发票 报价 订单 PI CI PL invoice quotation contract), then by the extension:
图纸 表格 文档 图片 压缩包 音视频, else 其他. Nothing is overwritten (a second file of one name gets " (2)"); names are made
safe for Windows; a file that cannot be read is skipped and said in the counts. The first round starts from the first
message, so what was sent before is kept too. The log has counts only.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import chat_assist

ROOT_NAME = "聊天文件"
KINDS = [
    ("合同发票报价", None, re.compile(r"合同|发票|报价|订单|对账单|形式发票|装箱单|(?<![a-z])(pi|ci|pl)(?![a-z])|invoice|quotation|contract|packing", re.I)),
    ("图纸", {".dwg", ".dxf", ".step", ".stp", ".igs", ".iges", ".x_t", ".sldprt", ".sldasm", ".slddrw", ".prt", ".catpart", ".stl", ".3dm"}, None),
    ("表格", {".xls", ".xlsx", ".xlsm", ".csv", ".et", ".ods", ".numbers"}, None),
    ("文档", {".doc", ".docx", ".pdf", ".ppt", ".pptx", ".txt", ".md", ".wps", ".rtf", ".odt", ".pages", ".key"}, None),
    ("图片", {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".bmp", ".tif", ".tiff", ".svg"}, None),
    ("压缩包", {".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz"}, None),
    ("音视频", {".mp4", ".mov", ".avi", ".mkv", ".wmv", ".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".webm"}, None),
]
MIME_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "application/pdf": ".pdf"}
BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def kind_of(name: str) -> str:
    base = os.path.basename(str(name or ""))
    ext = os.path.splitext(base)[1].lower()
    for kind, exts, rx in KINDS:
        if rx is not None and rx.search(os.path.splitext(base)[0]):
            return kind
        if exts and ext in exts:
            return kind
    return "其他"


def safe(text: str, limit: int = 80) -> str:
    t = BAD.sub("_", str(text or "")).strip().strip(".")
    return (t[:limit].rstrip(" .") or "_")


def unique(path: Path) -> Path:
    if not path.exists():
        return path
    stem, ext = path.stem, path.suffix
    for n in range(2, 1000):
        p = path.with_name("%s (%d)%s" % (stem, n, ext))
        if not p.exists():
            return p
    return path.with_name("%s (%s)%s" % (stem, datetime.now().strftime("%H%M%S%f"), ext))


def files_of(row: dict) -> list[dict]:
    """The files of one message: name, kind, and where the bytes are (a path on this server, or bytes)."""
    content = row.get("content") if isinstance(row.get("content"), dict) else {}
    ents = [e for e in content.get("ent") or [] if (e or {}).get("tp") in ("IM", "EX")]
    uploads = list(row.get("files") or [])
    out = []
    for i, e in enumerate(ents):
        d = e.get("data") or {}
        name = str(d.get("name") or "")
        if not name:
            name = ("图片" if e["tp"] == "IM" else "文件") + MIME_EXT.get(str(d.get("mime") or ""), "")
        item = {"name": name, "kind": kind_of(name)}
        if d.get("val"):
            try:
                item["bytes"] = base64.b64decode(str(d["val"]))
            except (ValueError, TypeError):
                continue
        elif d.get("ref") and uploads:
            item["path"] = str((uploads.pop(0) or {}).get("loc") or "")
        else:
            continue
        out.append(item)
    return out


def fetch(cfg: dict, runtime: Path, after: int, upto: int, limit: int = 200) -> list[dict]:
    sql = ("select coalesce(json_agg(x order by x.id), '[]') from (select m.id, m.topic, "
           "to_char(m.createdat, 'YYYY-MM-DD\"T\"HH24:MI:SS') as at, m.head, m.content, "
           "(select u.tags from users u where u.id = m.\"from\") as from_tags, "
           "(select json_agg(u2.tags) from subscriptions s join users u2 on u2.id = s.userid where s.topic = m.topic and s.deletedat is null) as member_tags, "
           "(select json_agg(json_build_object('loc', f.location) order by l.id) from filemsglinks l join fileuploads f on f.id = l.fileid where l.msgid = m.id) as files, "
           "(select t.public from topics t where t.name = m.topic) as topic_public "
           "from messages m where m.id > %d and m.id <= %d and m.deletedat is null "
           "and (m.content::text like '%%\"tp\":\"IM\"%%' or m.content::text like '%%\"tp\":\"EX\"%%') order by m.id limit %d) x") % (int(after), int(upto), int(limit))
    rows = json.loads(chat_assist.psql(cfg, runtime, sql) or "[]")
    return rows if isinstance(rows, list) else []


def local_time(at: str) -> datetime:
    try:
        return datetime.fromisoformat(str(at)).replace(tzinfo=timezone.utc).astimezone()
    except ValueError:
        return datetime.now()


def place(row: dict, people: dict, office: Path, bots) -> tuple[list, str]:
    """Where one message's files go, [(base folder, chat name)] for the summary and each member, and who sent it."""
    sender = chat_assist.login_of(row.get("from_tags"))
    members = sorted({chat_assist.login_of(t) for t in row.get("member_tags") or []} - {""} - set(bots))
    name = lambda login: str((people.get(login) or {}).get("name") or login)
    topic = str(row.get("topic") or "")
    group = str(((row.get("topic_public") or {}) if isinstance(row.get("topic_public"), dict) else {}).get("fn") or "群聊")
    out = []
    summary = group if topic.startswith("grp") else " 与 ".join(name(m) for m in members) or "私聊"
    out.append((office, summary))
    seen = {os.path.normcase(os.path.abspath(str(office)))}
    for m in members:
        personal = str((people.get(m) or {}).get("personal") or "").strip()
        if not personal or (people.get(m) or {}).get("status", "active") != "active":
            continue
        key = os.path.normcase(os.path.abspath(personal))
        if key in seen:
            continue
        seen.add(key)
        other = [x for x in members if x != m]
        chat = group if topic.startswith("grp") else (name(other[0]) if other else "私聊")
        out.append((Path(personal), chat))
    return out, sender


def archive(row: dict, people: dict, office: Path, bots) -> dict:
    """Copy one message's files. Returns counts."""
    out = {"files": 0, "copies": 0, "unreadable": 0}
    head = row.get("head") if isinstance(row.get("head"), dict) else {}
    if head.get("tdh_ai") or head.get("tdh_ai_ok"):
        return out
    items = files_of(row)
    if not items:
        return out
    places, sender = place(row, people, office, bots)
    if sender in bots:
        return out
    when = local_time(row.get("at") or "")
    who = safe(str((people.get(sender) or {}).get("name") or sender or "同事"), 30)
    for it in items:
        out["files"] += 1
        data = it.get("bytes")
        src = it.get("path")
        if data is None and not (src and os.path.isfile(src)):
            out["unreadable"] += 1
            continue
        fname = "%s %s %s" % (when.strftime("%m%d-%H%M"), who, safe(it["name"], 120))
        for base, chat in places:
            folder = Path(base) / ROOT_NAME / it["kind"] / when.strftime("%Y-%m") / safe(chat, 60)
            try:
                folder.mkdir(parents=True, exist_ok=True)
                dest = unique(folder / fname)
                if data is not None:
                    dest.write_bytes(data)
                else:
                    shutil.copyfile(src, dest)
                out["copies"] += 1
            except OSError:
                out["unreadable"] += 1
    return out


def run_once(cfg: dict, runtime: Path, people: dict, office: Path, bots) -> dict:
    """One round over the chat's new messages with files (the first round from the very first message)."""
    state_file = Path(runtime) / "chat-archive-state.json"
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    after = int(state.get("last_id") or 0)
    upto = chat_assist.max_id(cfg, runtime)
    total = {"rows": 0, "files": 0, "copies": 0, "unreadable": 0}
    if upto <= after:
        return total
    while True:
        rows = fetch(cfg, runtime, after, upto)
        for row in rows:
            total["rows"] += 1
            for k, v in archive(row, people, office, bots).items():
                total[k] += v
            after = max(after, int(row.get("id") or 0))
        if len(rows) < 200:
            break
    state["last_id"] = upto
    tmp = state_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, state_file)
    return total
