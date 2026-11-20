"""What krouter-recall.py (the knowledge search's KRouter) and krouter-run.py (the nightly) agree on for a
TDH memory bank: where its KRouter state lives (one folder per bank, so the prompt hook's record of one bank is
read by that bank's hot cycle only), and that it has its own alias table (an empty one, not KRouter's sample).
company-krouter-nightly-v1."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE / "vendor" / "krouter" / "scripts"
STATE_ROOT = Path(os.environ.get("KROUTER_STATE_ROOT") or (Path(os.environ.get("TDH_ROOT") or "D:/dsh") / "runtime" / "krouter-state"))
MAP_HEAD = "# id|aliases separated by ;|Vault-relative source|evidence anchor\n"


def bank_state(folder: Path) -> Path:
    return STATE_ROOT / hashlib.sha1(str(Path(folder).resolve()).encode("utf-8")).hexdigest()[:12]


def ensure_map(folder: Path) -> None:
    try:
        import zones

        table = zones.path(Path(folder), "90 系统文件/canonical_sources.psv")
        if not table.exists():
            table.parent.mkdir(parents=True, exist_ok=True)
            table.write_text(MAP_HEAD, encoding="utf-8")
    except Exception:  # noqa: BLE001  never in the way
        pass


# company-krouter-auto-alias-v1: on a TDH server the alias table keeps itself (2026-11-19: 别名表要自动，不能人工维护).
# KRouter drafts lock rows for a person to tick (propose_aliases.py); here the nightly drafts and applies them itself,
# through KRouter's own re-check (propose_aliases.apply: the page is still there, no alias is taken or would lock
# another page). What a person would have weeded out is weeded out by rule instead:
#   - experience cards get no aliases: a card is a lesson with its subject taken out, not a thing anyone names, and
#     the session start already lists them (the experience digest);
#   - aliases are the model's short nouns only, not title fragments (a card title split up gives half sentences);
#   - a generic word, or a noun that another page's title also holds, is not a name.
CARD_DIR = "02 经验与方法/经验卡/"
AUTO_OUT_HEAD = ("---\ntitle: 别名候选\nstatus: generated\n---\n\n# 别名候选\n\n"
                 "TDH 服务器每天夜里自动生成，自动核对后写进别名表，不用人工打勾。"
                 "这里只留下没通过核对的行（名词被占用、会锁到别的页、页面不在了）。\n\n")
GENERIC = {"经验", "规则", "方法", "记录", "总结", "流程", "问题", "做法", "注意事项", "说明", "资料", "文档", "公司",
           "客户", "员工", "工作", "通知", "安排", "处理", "情况", "内容", "信息", "管理", "制度", "要求", "标准"}


def auto_aliases(bank: Path, limit: int = 40) -> dict:
    import propose_aliases as pa
    import recall_index as ri
    import zones
    from canonical_lookup import load_rows, map_for, normalize

    bank = Path(bank)
    table = map_for(bank)
    rows = load_rows(table) if table.is_file() else []
    locked = {source for _cid, _aliases, source, _anchor in rows}
    taken = {normalize(a) for _cid, aliases, _s, _a in rows for a in aliases}
    con = ri.connect(ri.cache_path(bank))
    ri.refresh(bank, con)
    docs = con.execute("SELECT rel, tier, status, how, title FROM docs").fetchall()
    titles = {rel: normalize(title or Path(rel).stem) for rel, _t, _s, _h, title in docs}
    pages = []
    for rel, tier, status, how, title in docs:
        canon = zones.canon(bank, rel)
        if tier not in ("rule", "topic") or rel in locked or (status or "") in ri.DEAD_STATUS or canon.startswith(CARD_DIR):
            continue
        meta, _body = ri.split_frontmatter((bank / rel).read_text(encoding="utf-8", errors="replace"))
        if ri.is_secret_page(canon, meta):
            continue
        pages.append((rel, tier, how, meta.get("title") or title or Path(rel).stem))
    want = pa.demand(bank)
    pages.sort(key=lambda p: (-want.get(p[0], 0), p[1] != "rule", p[0]))
    pages = pages[:limit]
    if not pages:
        return {"pages": 0, "applied": 0, "refused": []}
    nouns = pa.model_nouns(bank, [p[0] for p in pages])
    drafts, proposed = [], set()
    for rel, _tier, how, title in pages:
        keep = []
        for w in dict.fromkeys(str(x).strip() for x in nouns.get(rel, [])):
            n = normalize(w)
            latin = all(ord(ch) < 128 for ch in w)
            if not n or n in proposed or w in GENERIC or not (pa.MIN_LEN <= len(w) <= (pa.LATIN_MAX if latin else pa.MAX_LEN)):
                continue
            if any(n in t for other, t in titles.items() if other != rel):
                continue
            keep.append(w)
        keep = pa.free_aliases(keep, rel, rows, taken, bank)[:5]
        proposed.update(normalize(w) for w in keep)
        if keep:
            drafts.append((rel, keep, (how or title).replace("|", "／").replace("\n", " ")[:40]))
    out = zones.path(bank, pa.OUT)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"- [x] {cid}|{';'.join(keep)}|{rel}|{anchor}" for cid, (rel, keep, anchor) in zip(pa.next_ids(rows, len(drafts)), drafts)]
    out.write_text(AUTO_OUT_HEAD + "\n".join(lines) + "\n", encoding="utf-8")
    res = pa.apply(bank) if lines else {"applied": 0, "refused": []}
    return {"pages": len(pages), "applied": res.get("applied", 0), "rows": res.get("rows", []), "refused": res.get("refused", []),
            "reason": res.get("reason", "")}
