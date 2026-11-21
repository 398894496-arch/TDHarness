"""company-kb-organize-v1: what people put on the company share goes into the knowledge base by itself.

The user, 2026-11-21: "他们发送上来不就应该自动录入知识库吗" (郭迎's TDH had left two invoice files out of the knowledge
base, asking for a library only three people could open); and before, the knowledge-base sorting a TDH session had
written on the user's Mac (TDH-KB-Archive/archive.py, never run for real), taken over and moved to the server.

Every round (the people service, ten minutes) reads each employee's own folder (company/emp-*), files that have not
moved for two minutes, and copies (never moves; the person keeps theirs) what it can tell by its name and folder into
a zone's category folder, under 来自 <name>:
  private    (行政财务's own, kb-zones.json "private": that department and the admins)
             04 账户税务发票  bank receipts and statements, reconciliations, invoices, tax, the cash ledger, acceptances
             01 财务制度与审批 bills, reimbursements, expense vouchers, finance rules, approvals
             03 人事与薪酬    payroll, staff files, labour contracts, social insurance, ID cards
             02 合同与法务    contracts, agreements, proforma invoices (PI), export orders
             05 行政事务      purchase orders and records, goods received, suppliers' files, licences
  customers  (销售 and 行政财务's, kb-zones.json groups) 02 底价与成本 (floor prices, costs, margins, purchase prices,
             price lists), 01 客户信息 (quotations, customers)
Nothing goes to _company by itself (everyone reads it); what cannot be told is listed for the admins in
_office/知识库待确认.md. A copy that is there already (the same bytes) is not made again; a changed file comes in as a
new version beside the old one. The ledger, invoice lists and reimbursement sheets (.xlsx) also go to the finance
store's inbox (runtime/mfg/finance-inbox), which the manufacturing pack files and sends on to ERPNext.
Chat copies, the chat's finance papers, daily reports, the pack's outputs and hidden folders are not read. The log has
counts only; runtime/kb-organize.json remembers what was copied where.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
from pathlib import Path

STABLE_S = 120
FILE_MAX = 80 * 1024 * 1024
ARCHIVE_MAX = 2 * 1024 * 1024 * 1024      # a zip of customs papers can be 436 MB (郭迎, 2026-11-21): copied as it is
ARCHIVES = {".zip", ".rar", ".7z"}
DOC = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".xls", ".xlsx", ".xlsm", ".doc", ".docx", ".csv", ".txt", ".md", ".wps", ".et",
       ".dps", ".ppt", ".pptx", ".zip", ".rar", ".7z", ".ofd"}
SKIP_DIRS = {"聊天文件", "财务单据", "日报", "mfg", "node_modules", "artifacts", "任务卡", "tasks", "__pycache__", "_memory", "已导入", "收件"}
TEMP = {".partial", ".tmp", ".part", ".crdownload", ".download"}
FIN_SHEET = re.compile(r"发票|账本|银行收付款|银行流水|报销")
RULES = [   # (zone, category, pattern over the lower-cased path), the first that matches
    ("private", "04 账户税务发票", r"报关|出口单证|退税|提单|装箱单"),
    ("private", "02 合同与法务", r"形式发票|proforma|(?<![a-z])pi(?![a-z])|合同|协议|出口订单|法务|律师|诉讼"),
    ("private", "04 账户税务发票", r"付款回单|收款回单|银行回单|回单|银行账户|银行流水|银行对账|资金对账|对账|发票|纳税|税务|完税|资金台账|资金日报|"
                                r"账本|收付款|承兑|流水"),
    ("private", "01 财务制度与审批", r"费用账单|报销|费用凭证|财务制度|审批|费用"),
    ("private", "03 人事与薪酬", r"工资|薪酬|员工档案|劳动合同|社保|公积金|身份证|人事|考勤"),
    ("private", "05 行政事务", r"采购单|采购订单|采购台账|采购记录|入库单|供应商档案|供应商付款|证照|营业执照|资质"),
    ("customers", "02 底价与成本", r"底价|成本|毛利|采购价|价目表|price ?list"),
    ("customers", "01 客户信息", r"报价|quotation|quote|客户"),
]


def _safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", str(name)).strip().strip(".") or "_"


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def zones(company: Path, runtime: Path) -> dict:
    """zone key → its folder under _handbook (only zones whose folder is there)."""
    try:
        z = json.loads((Path(runtime) / "kb-zones.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        z = {}
    out = {}
    if z.get("private"):
        out["private"] = Path(company) / "_handbook" / str(z["private"][0])
    for g in z.get("groups") or []:
        if str(g.get("dir") or "").startswith("_"):
            out.setdefault("customers", Path(company) / "_handbook" / str(g["dir"]))
    return {k: v for k, v in out.items() if v.is_dir()}


def classify(rel: str) -> tuple | None:
    """(zone, category) for a file by its path in the person's folder; None when it cannot be told."""
    key = rel.replace("\\", "/").lower()
    for zone, cat, pat in RULES:
        if re.search(pat, key):
            return zone, cat
    return None


def files_of(folder: Path):
    for parent, dirs, names in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")) and d not in SKIP_DIRS)
        for n in sorted(names):
            if n.startswith((".", "~$")):
                continue
            yield Path(parent) / n


def _place(into: Path, name: str, sha: str) -> tuple:
    """(the path to write, whether the same bytes are there already)."""
    into.mkdir(parents=True, exist_ok=True)
    stem, ext = os.path.splitext(name)
    for n in range(1, 200):
        p = into / (name if n == 1 else "%s (%d)%s" % (stem, n, ext))
        if not p.exists():
            return p, False
        try:
            if p.stat().st_size and _sha(p) == sha:
                return p, True
        except OSError:
            pass
    return into / ("%s (%s)%s" % (stem, time.strftime("%H%M%S"), ext)), False


def run_once(company: Path, runtime: Path, people: dict, now: float | None = None, dry: bool = False) -> dict:
    now = now or time.time()
    company, runtime = Path(company), Path(runtime)
    zs = zones(company, runtime)
    state_f = runtime / "kb-organize.json"
    try:
        state = json.loads(state_f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    done = state.setdefault("files", {})
    review = state.setdefault("review", {})
    out = {"seen": 0, "copied": 0, "same": 0, "review": 0, "finance": 0, "unstable": 0, "by": {}}
    by_folder = {Path(str(p.get("personal") or "")).name: p for p in people.values() if p.get("personal")}
    for folder in sorted(company.glob("emp-*")):
        if not folder.is_dir():
            continue
        who = by_folder.get(folder.name) or {}
        if (who.get("status") or "active") != "active":
            continue
        name = str(who.get("name") or folder.name[4:])
        for f in files_of(folder):
            ext = f.suffix.lower()
            if ext not in DOC or ext in TEMP:
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            if not st.st_size or st.st_size > (ARCHIVE_MAX if ext in ARCHIVES else FILE_MAX):
                continue
            out["seen"] += 1
            rel = f.relative_to(company).as_posix()
            stamp = [st.st_size, int(st.st_mtime)]
            if (done.get(rel) or {}).get("stamp") == stamp or (review.get(rel) or {}).get("stamp") == stamp:
                continue
            if now - st.st_mtime < STABLE_S:
                out["unstable"] += 1
                continue
            got = classify(f.relative_to(folder).as_posix())
            if not got or got[0] not in zs or not (zs[got[0]] / got[1] / "说明.md").is_file():
                review[rel] = {"stamp": stamp, "who": name, "why": "认不出该放哪个区、哪个分类" if not got else "那个区或分类不在"}
                out["review"] += 1
                continue
            review.pop(rel, None)
            zone, cat = got
            try:
                sha = _sha(f)
                dest, same = _place(zs[zone] / cat / _safe("来自 " + name), _safe(f.name), sha)
                if not same and not dry:
                    tmp = dest.with_name(dest.name + ".kb-incoming")
                    shutil.copyfile(f, tmp)
                    os.replace(tmp, dest)
                if ext in (".xlsx", ".xlsm") and FIN_SHEET.search(f.name) and not dry:
                    box = runtime / "mfg" / "finance-inbox"
                    box.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(f, box / ("%s-%s" % (time.strftime("%Y%m%d-%H%M%S"), _safe(f.name))))
                    out["finance"] += 1
            except OSError:
                out["unstable"] += 1
                continue
            done[rel] = {"stamp": stamp, "to": dest.relative_to(company).as_posix(), "sha": sha[:16]}
            out["same" if same else "copied"] += 1
            k = "%s/%s" % (zone, cat)
            out["by"][k] = out["by"].get(k, 0) + (0 if same else 1)
    if not dry:
        tmp = state_f.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, state_f)
        _review_page(company, review)
    out["review_open"] = len(review)
    return out


def _review_page(company: Path, review: dict) -> None:
    """The admins' list of what could not be told (_office/知识库待确认.md)."""
    page = company / "_office" / "知识库待确认.md"
    lines = ["# 知识库待确认", "", "员工放到公司盘、TDH 认不出该放进知识库哪个区的文件（每十分钟更新）。要放就在 TDH 里说「把 xxx 存进知识库的 yyy」，",
             "或者自己拖进 `_handbook` 对应的文件夹；不用放的不用管。", "", "| 来自 | 文件 | 原因 |", "|---|---|---|"]
    for rel, r in sorted(review.items(), key=lambda x: (x[1].get("who", ""), x[0]))[:500]:
        lines.append("| %s | %s | %s |" % (r.get("who", ""), rel.replace("|", "/"), r.get("why", "")))
    try:
        page.parent.mkdir(parents=True, exist_ok=True)
        tmp = page.with_suffix(".tmp")
        tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.replace(tmp, page)
    except OSError:
        pass


if __name__ == "__main__":
    import argparse
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--root", default=os.environ.get("TDH_ROOT") or r"D:\dsh")
    a = ap.parse_args()
    root = Path(a.root)
    roster = json.loads((root / "runtime" / "roster.json").read_text(encoding="utf-8-sig"))
    ppl = {p["login"]: p for p in roster.get("people") or [] if p.get("login")}
    print("KB_ORGANIZE " + json.dumps(run_once(root / "company", root / "runtime", ppl, dry=a.dry_run), ensure_ascii=False))
