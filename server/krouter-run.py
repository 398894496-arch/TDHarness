#!/usr/bin/env python3
"""Run one KRouter step on one TDH memory bank, with that bank's own state folder (company-krouter-nightly-v1).

    krouter-run.py <bank folder> <script.py> [args...]          e.g. import_sessions.py --vault <bank> --file f
    krouter-run.py <bank folder> --record-uses <transcript>...  what these sessions did with the bank's cards
    krouter-run.py <bank folder> --auto-aliases                 draft and apply this bank's alias rows (no ticking)

KRouter itself is unchanged (server/vendor/krouter); krouter-nightly.js calls this for each step."""
from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor" / "krouter" / "scripts"))
sys.path.insert(0, str(HERE))

from krouter_tdh import SCRIPTS, bank_state, ensure_map  # noqa: E402


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: krouter-run.py <bank> <script.py>|--record-uses ...|--auto-aliases", file=sys.stderr)
        return 2
    bank = Path(sys.argv[1])
    if not bank.is_dir():
        print("KROUTER_RUN_FAIL no-bank " + str(bank), file=sys.stderr)
        return 2
    os.environ["KROUTER_STATE_DIR"] = str(bank_state(bank))
    os.environ["KROUTER_VAULT"] = str(bank)
    ensure_map(bank)
    if sys.argv[2] == "--record-uses":
        import experience
        import import_sessions

        n = 0
        for f in sys.argv[3:]:
            s = import_sessions.read_claude(Path(f))
            if s["turns"]:
                n += experience.record_uses(bank, s["id"], s["turns"])
        print("RECORD_USES=%d" % n)
        return 0
    if sys.argv[2] == "--auto-aliases":
        import json

        from krouter_tdh import auto_aliases

        out = auto_aliases(bank)
        print(json.dumps(out, ensure_ascii=False))
        print("AUTO_ALIASES=%d REFUSED=%d" % (out["applied"], len(out["refused"])))
        return 0
    script = SCRIPTS / sys.argv[2]
    if not script.is_file():
        print("KROUTER_RUN_FAIL no-script " + sys.argv[2], file=sys.stderr)
        return 2
    sys.argv = [str(script)] + sys.argv[3:]
    try:
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit as e:
        return int(e.code or 0) if not isinstance(e.code, str) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
