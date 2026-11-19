#!/usr/bin/env python3
"""Prove the emitted Caddyfile carries the extension hook: exactly one import of
D:/dsh/runtime/caddy/ext/*.caddy, inside the https site block, before the
catch-all handle (so a pack's /company/<pack>* route is reached), and that
setup makes the folder with a placeholder so the import always matches a file.
No Caddy binary needed. Ends with CADDY_EXT_PROVE_OK=1.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMPORT = "import D:/dsh/runtime/caddy/ext/*.caddy"


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("CADDY_EXT_PROVE_FAIL " + what)


def main() -> None:
    d = Path(tempfile.mkdtemp(prefix="tdh-caddy-ext-"))
    site = d / "site.yml"
    site.write_text("host: tdh.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n", encoding="utf-8")
    out = d / "Caddyfile"
    r = subprocess.run([sys.executable, str(ROOT / "server" / "site-cs.py"), "--site", str(site), "emit-caddy", "--out", str(out)],
                       capture_output=True, text=True)
    check(r.returncode == 0, "emit-caddy " + r.stderr)
    text = out.read_text(encoding="utf-8").replace("\r\n", "\n")
    lines = [ln.strip() for ln in text.split("\n")]
    check(lines.count(IMPORT) == 1, "one import line")
    site_open = text.index("https://tdh.local:8443")
    at = text.index(IMPORT)
    catch_all = text.index("\thandle {\n")
    check(site_open < at < catch_all, "the import sits in the site block before the catch-all")
    # Braces balance and the import is one level inside the site block.
    depth = 0
    for ch in text[:at]:
        depth += (ch == "{") - (ch == "}")
    check(depth == 1, "import at site-block depth, got %d" % depth)
    check(text.count("{") == text.count("}"), "balanced braces")

    setup = (ROOT / "scripts" / "setup-server.ps1").read_text(encoding="utf-8")
    check("'caddy\\ext'" in setup and "00-placeholder.caddy" in setup, "setup makes ext\\ with a placeholder")
    check(setup.index("emit-caddy") < setup.index("00-placeholder.caddy") < setup.index("Autostart-Caddy-8443' $caddyExe"),
          "placeholder is written before Caddy is started")
    print("CADDY_EXT_PROVE_OK=1")


if __name__ == "__main__":
    main()
