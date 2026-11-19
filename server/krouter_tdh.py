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
