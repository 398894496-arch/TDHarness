"""company-chat-docs-v1: file the finance papers already sent in the chat, quietly (nothing is said in the chat; the
assistant does the new ones and says so). Run on the server: python chat_docs_backfill.py --after <message id> [--only <id,id>].
Only what check() calls sure is filed; what it is not sure of is counted, not filed. Prints counts.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chat_assist  # noqa: E402
import chat_docs  # noqa: E402

BOTS = ("tdh-daily", "tdh-assist")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--after", type=int, required=True)
    ap.add_argument("--root", default=os.environ.get("TDH_ROOT") or r"D:\dsh")
    ap.add_argument("--only", default="", help="only these message ids, comma separated")
    a = ap.parse_args()
    only = {int(x) for x in a.only.split(",") if x.strip()}
    root = Path(a.root)
    rt = root / "runtime"
    cfg = chat_assist.load_config(rt)
    token = (rt / "gw-service.token").read_text(encoding="utf-8").strip()
    roster = json.loads((rt / "roster.json").read_text(encoding="utf-8-sig"))
    people = {p["login"]: p for p in roster.get("people") or [] if isinstance(p, dict) and p.get("login")}
    fin = chat_docs.finance_people(people, rt)
    office = root / "company" / "_office"
    copies = [office] + [Path(str(people[k]["personal"])) for k in sorted(fin) if people[k].get("role") != "admin" and people[k].get("personal")
                         and os.path.normcase(os.path.abspath(str(people[k]["personal"]))) != os.path.normcase(os.path.abspath(str(office)))]
    try:
        ours = {c["name"] for c in json.loads((rt / "erp-companies.json").read_text(encoding="utf-8-sig")).get("companies") or []}
    except (OSError, ValueError, KeyError, TypeError):
        ours = set()
    ledger = chat_docs.Ledger(rt / "mfg" / "finance")
    out = {"pictures": 0, "filed": 0, "paired": 0, "unsure": 0, "duplicate": 0, "not_finance": 0}
    after = a.after
    while True:
        rows = chat_assist.fetch(cfg, rt, after)
        for row in rows:
            after = max(after, int(row.get("id") or 0))
            head = row.get("head") if isinstance(row.get("head"), dict) else {}
            sender = chat_assist.login_of(row.get("from_tags"))
            members = sorted({chat_assist.login_of(t) for t in row.get("member_tags") or []} - {""} - set(BOTS))
            if only and int(row.get("id") or 0) not in only:
                continue
            if head.get("tdh_ai") or not sender or sender in BOTS or not (set(members) & fin):
                continue
            topic = str(row.get("topic") or "")
            pub = row.get("topic_public") if isinstance(row.get("topic_public"), dict) else {}
            chat = (pub.get("fn") or "群聊") if topic.startswith("grp") else " 与 ".join((people.get(m) or {}).get("name") or m for m in members)
            for pic in chat_docs.pictures(row):
                out["pictures"] += 1
                act = chat_docs.check(chat_docs.recognize(cfg, token, pic, []))
                if act["action"] == "none":
                    out["not_finance"] += 1
                elif act["action"] == "ask":
                    out["unsure"] += 1
                elif ledger.duplicate(act["fields"]):
                    out["duplicate"] += 1
                else:
                    line = ledger.file_in(pic, act["fields"], {"when": chat_docs.when_of(row), "chat": chat, "sender": sender, "msg": row.get("id")},
                                          copies, ours)
                    out["filed"] += 1
                    out["paired"] += 1 if line.get("paired") else 0
        if len(rows) < 200:
            break
    print("BACKFILL " + json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
