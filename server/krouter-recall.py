#!/usr/bin/env python3
"""KRouter for the memory layer of the company knowledge search (company-krouter-memory-v1).

knowledge-search.js starts this once and keeps it: one JSON request per line on stdin, one JSON answer
per line on stdout, so a search does not start Python. A request names the memory banks this person
may open (each one a folder: their own memory, the company memory) and the question; every bank is
asked on its own, so a ranking or a refusal never comes from a page the person cannot see.

    {"query": "...", "limit": 6, "banks": [{"name": "personal", "dir": "D:/dsh/company/content/emp-amy/_memory"}]}
 -> {"ok": true, "banks": [{"name": "personal", "confidence": "medium", "strong": 2,
                             "hits": [{"rel": "02-methods/x.md", "how": "...", "score": 3.1, "line": 4, ...}]}]}

KRouter's retrieval only (server/vendor/krouter, pinned): no model is called. Its index for each bank
lives in KROUTER_CACHE_DIR (D:\\dsh\\runtime\\krouter-cache, set by the caller); a bank's files are read
again only when they change.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor" / "krouter" / "scripts"))
# Nothing here calls a model: answer cards, the per-message judge and the nightly run stay off.
for k, v in (("KROUTER_HOST_CLI", "0"), ("KROUTER_NIGHTLY", "0"), ("KROUTER_RECALL_JUDGE", "0"), ("KROUTER_ANSWER_CARDS", "0")):
    os.environ.setdefault(k, v)

import recall_index  # noqa: E402

VERSION = (HERE / "vendor" / "krouter" / "VERSION").read_text(encoding="utf-8").strip() if (HERE / "vendor" / "krouter" / "VERSION").exists() else ""


from krouter_tdh import bank_state, ensure_map  # noqa: E402  one state folder and alias table per bank

DIGEST = "90 系统文件/自动化/下意识.md"
DIGEST_LINES = 60


def hook(req: dict) -> dict:
    """KRouter's own hooks for a TDH desk (session_hook.py does the same for Claude Code on one machine).
    start: the standing index (下意识) of each bank this person opens. prompt: what this message names
    (recollect: alias table, trigger words; cold phrases sort last), at most two pages, each once per session,
    logged as used (the hot cycle's record)."""
    import recollect
    import zones

    which = str(req.get("hook") or "")
    session = str(req.get("session") or "")[:64]
    parts = []
    hits_all = []
    for bank in req.get("banks") or []:
        folder = Path(str((bank or {}).get("dir") or ""))
        if not folder.is_dir():
            continue
        os.environ["KROUTER_STATE_DIR"] = str(bank_state(folder))
        ensure_map(folder)
        if which == "start":
            page = zones.path(folder, DIGEST)
            if page.is_file():
                lines = [l for l in page.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("---")]
                if lines:
                    parts.append("\n".join(lines[:DIGEST_LINES]))
            continue
        text = str(req.get("text") or "").strip()
        if not text or len(text) > 1500:
            continue
        try:
            recollect.keep_index_fresh(folder)
            found = recollect.recollect(folder, text)
            hits = recollect.keep_new(found, "tdh", session)
            recollect.log(hits, "tdh", session)
        except Exception as e:  # noqa: BLE001  a bank that cannot answer leaves the others
            parts.append("")
            continue
        for h in hits:
            hits_all.append((str(bank.get("name") or ""), h))
    if which == "prompt" and hits_all:
        parts = [recollect.render([h for _, h in hits_all[:2]])]
    return {"ok": True, "hook": which, "text": "\n\n".join(p for p in parts if p).strip()}


def ask(req: dict) -> dict:
    if req.get("ping"):
        return {"ok": True, "version": VERSION}
    if req.get("hook"):
        return hook(req)
    query = str(req.get("query") or "").strip()
    try:
        limit = max(1, min(12, int(req.get("limit") or 6)))
    except (TypeError, ValueError):
        limit = 6
    out = []
    for bank in req.get("banks") or []:
        name = str((bank or {}).get("name") or "")
        folder = Path(str((bank or {}).get("dir") or ""))
        if not query or not folder.is_dir():
            out.append({"name": name, "missing": not folder.is_dir(), "hits": []})
            continue
        ensure_map(folder)
        try:
            res = recall_index.recall(folder, query, limit=limit)
        except Exception as e:  # noqa: BLE001  one bank failing leaves the others answered
            out.append({"name": name, "error": "%s: %s" % (type(e).__name__, str(e)[:200]), "hits": []})
            continue
        hits = []
        for h in (res.get("hits") or [])[:limit]:
            ev = h.get("ev") or {}
            hits.append({
                "rel": h.get("rel"),
                "how": h.get("how") or "",
                "score": h.get("score"),
                "tier": h.get("tier") or "",
                "status": h.get("status") or "",
                "line": ev.get("l0") or 1,
            })
        out.append({"name": name, "confidence": res.get("confidence") or "none", "strong": res.get("strong") or 0, "hits": hits})
    return {"ok": True, "banks": out}


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            answer = ask(json.loads(line))
        except Exception as e:  # noqa: BLE001  a bad request must not end the process
            answer = {"ok": False, "error": "%s: %s" % (type(e).__name__, str(e)[:200])}
        sys.stdout.write(json.dumps(answer, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
