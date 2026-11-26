"""company-chat-search-all-v1: a person's search over all their chat messages, for the phone's Chat search.

The user, 2026-11-25: 「搜索 可以有通讯录名单+聊天内容相关」「不是最近30天的聊天记录 是所有聊天记录」. The agent's search
(chat_read.search) reads the last messages of recent chats over Tinode, which is right for an agent but not for a person
looking for something said months ago. This reads Tinode's database (read only, as chat_voice.py and chat_call.py do):
the messages of the chats the person is in (their subscriptions, not left), any age, whose words have the word in them,
newest first. The word reaches the database hex-encoded and is decoded there, so nothing typed can change the query.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import chat_archive
import chat_assist

LOGIN_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
LIMIT = 50
WORD_MAX = 60


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return str(content.get("txt") or "")
    return ""


def search_all(cfg: dict, runtime: Path, login: str, q: str, people: dict, links: dict, limit: int = LIMIT) -> list[dict]:
    """[{chat, topic (as the person's own client names it), seq, from, text, time}], newest first."""
    q = str(q or "").strip()[:WORD_MAX]
    if not q or not LOGIN_OK.match(login or ""):
        return []
    words = "case when json_typeof(m.content::json) = 'string' then m.content::json #>> '{}' else coalesce(m.content::json->>'txt', '') end"
    sql = ("with me as (select u.id from users u where u.tags::jsonb ? '%s' limit 1), "
           "mine as (select s.topic from subscriptions s where s.userid = (select id from me) and s.deletedat is null), "
           "w as (select lower(convert_from(decode('%s', 'hex'), 'UTF8')) as q) "
           "select coalesce(json_agg(x), '[]') from (select m.topic, m.seqid as seq, "
           "to_char(m.createdat, 'YYYY-MM-DD\"T\"HH24:MI:SS') as at, m.content, "
           "(select u.tags from users u where u.id = m.\"from\") as from_tags, "
           "(select json_agg(u2.tags) from subscriptions s join users u2 on u2.id = s.userid where s.topic = m.topic and s.deletedat is null) as member_tags, "
           "(select t.public from topics t where t.name = m.topic) as topic_public "
           "from messages m where m.deletedat is null and m.topic in (select topic from mine) "
           "and strpos(lower(%s), (select q from w)) > 0 "
           "order by m.createdat desc limit %d) x") % ("tdh:" + login, q.encode("utf-8").hex(), words, max(1, min(int(limit), 200)))
    rows = json.loads(chat_assist.psql(cfg, runtime, sql) or "[]")
    out = []
    for r in rows if isinstance(rows, list) else []:
        topic = str(r.get("topic") or "")
        members = [chat_assist.login_of(t) for t in r.get("member_tags") or []]
        if topic.startswith("grp"):
            pub = r.get("topic_public") or {}
            if isinstance(pub, str):
                try:
                    pub = json.loads(pub)
                except ValueError:
                    pub = {}
            chat, seen = str((pub or {}).get("fn") or "群聊"), topic
        else:
            other = next((m for m in members if m and m != login), "")
            chat = str((people.get(other) or {}).get("name") or other or "同事")
            seen = ("usr" + links[other]) if links.get(other) else ""
        who = chat_assist.login_of(r.get("from_tags"))
        text = _text(r.get("content")).strip()
        if not text:
            continue
        try:
            when = chat_archive.local_time(r.get("at") or "").strftime("%Y-%m-%d %H:%M")
        except (ValueError, TypeError):
            when = str(r.get("at") or "")[:16].replace("T", " ")
        out.append({"chat": chat, "topic": seen, "seq": int(r.get("seq") or 0),
                    "from": "我" if who == login else str((people.get(who) or {}).get("name") or who or "同事"),
                    "text": text[:400], "time": when})
    return out
