"""company-erp-sso-v1: set up TDH's login for ERPNext on this server (run as an administrator; idempotent).

  1. runtime/erp-sso.json: the login's settings and secrets, made once (admins only, like the rest of runtime);
     runtime/erp-roles.json: what each TDH role or department gets in ERPNext at creation (made once, then edited).
  2. ERPNext (WSL distro TDH-ERPNext-Ubuntu, compose project tdh-erpnext): erp-site-setup.py in the backend
     container (the sync's user and API key, the TDH login provider); its redirect address goes into the settings.
  3. The backend reaches the tailnet name: an extra hosts entry in /opt/tdh-erpnext/private-compose.yaml (the file the
     stack always uses), the backend recreated.
  4. Tailscale Serve: https://<erp host>/tdh-sso -> http://127.0.0.1:4181/company/sso (the people service).
  5. The agent's ERPNext guide (skills/company-erpnext) and its reads and writes (skills/company-erpnext-data) into
     the company's _skills.
No secret is printed; prints ERP_SSO_INSTALL_OK=1.
"""
import json
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RT = Path(os.environ.get("TDH_RUNTIME") or r"D:\dsh\runtime")
DISTRO = "TDH-ERPNext-Ubuntu"
SITE = "tdharness.tail9c7cc7.ts.net"
BASE = "https://" + SITE
STACK = ("docker compose -p tdh-erpnext -f compose.yaml -f overrides/compose.mariadb.yaml -f overrides/compose.mariadb-secrets.yaml "
         "-f overrides/compose.redis.yaml -f private-compose.yaml -f db-initialization-fix.yaml")
sys.path.insert(0, str(HERE.parent))
import erp_sso  # noqa: E402


def wsl(script: str, timeout: int = 600) -> str:
    r = subprocess.run(["wsl.exe", "-d", DISTRO, "-u", "root", "--exec", "/bin/bash", "-s"], input=script.encode("utf-8"),
                       capture_output=True, timeout=timeout)
    out = r.stdout.decode("utf-8", "replace")
    if r.returncode != 0:
        raise SystemExit("WSL step failed (%d): %s" % (r.returncode, (out + r.stderr.decode("utf-8", "replace"))[-600:]))
    return out


def save(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def main() -> None:
    cfgf = RT / "erp-sso.json"
    try:
        cfg = json.loads(cfgf.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        cfg = {}
    cfg.update({"on": True, "base": BASE, "client_id": cfg.get("client_id") or "tdh-erpnext", "email_domain": "tdharness.local",
                "erp_origin": "http://127.0.0.1:18080"})
    for k in ("client_secret", "cookie_key", "api_secret"):
        cfg[k] = cfg.get(k) or secrets.token_urlsafe(32)
    cfg["api_key"] = cfg.get("api_key") or secrets.token_hex(8)
    save(cfgf, cfg)
    if not (RT / "erp-roles.json").exists():
        save(RT / "erp-roles.json", erp_sso.ROLES)
    print("1 settings ready (secrets kept in runtime, not shown)")

    setup = "CFG = " + json.dumps({"site": SITE, "base": BASE, "sync_user": "tdh-sync@tdh-service.local", "api_key": cfg["api_key"],
                                   "api_secret": cfg["api_secret"], "client_id": cfg["client_id"], "client_secret": cfg["client_secret"]}) + "\n"
    setup += (HERE / "erp-site-setup.py").read_text(encoding="utf-8")
    script = ("cd /opt/tdh-erpnext && docker exec -i tdh-erpnext-backend-1 bash -c 'cd /home/frappe/frappe-bench/sites && ../env/bin/python -' <<'TDHPY'\n"
              + setup + "\nTDHPY\n")
    got = wsl(script)
    m = re.search(r"^SETUP (\{.*\})$", got, re.M)
    if not m:
        raise SystemExit("ERPNext setup gave no result: " + got[-400:])
    res = json.loads(m.group(1))
    print("2 ERPNext:", json.dumps(res, ensure_ascii=False))
    if not res.get("authorize_ok") or not str(res.get("redirect_uri", "")).startswith(BASE + "/api/method/"):
        raise SystemExit("ERPNext's TDH login is not as expected")
    cfg["redirect_uri"] = res["redirect_uri"]
    save(cfgf, cfg)

    ip = subprocess.run(["tailscale.exe", "ip", "-4"], capture_output=True).stdout.decode().split()[0]
    entry = "%s:%s" % (SITE, ip)
    patch = r"""set -eu
cd /opt/tdh-erpnext
f=private-compose.yaml
if ! grep -q '%(entry)s' "$f"; then
  cp -n "$f" "$f.bak-sso"
  python3 - "$f" '%(entry)s' <<'TDHPY'
import sys
p, entry = sys.argv[1], sys.argv[2]
lines = open(p).read().split("\n")
lines = [l for l in lines if "extra_hosts" not in l and "ts.net:" not in l]
i = lines.index("  backend:")
lines[i + 1:i + 1] = ["    extra_hosts:", '      - "' + entry + '"']
open(p, "w").write("\n".join(lines))
TDHPY
  %(stack)s config --quiet
  %(stack)s up -d --no-deps --pull never backend
fi
for i in $(seq 1 40); do curl -fsS --max-time 3 http://127.0.0.1:18080/api/method/ping | grep -q pong && break; sleep 2; done
docker exec tdh-erpnext-backend-1 getent hosts %(site)s | awk '{print "backend resolves the tailnet name: " ($1 != "" ? "yes" : "no")}'
""" % {"entry": entry, "stack": STACK, "site": SITE}
    print("3", wsl(patch).strip().splitlines()[-1])

    st = json.loads(subprocess.run(["tailscale.exe", "serve", "status", "--json"], capture_output=True).stdout.decode() or "{}")
    handlers = ((st.get("Web") or {}).get(SITE + ":443") or {}).get("Handlers") or {}
    if (handlers.get("/tdh-sso") or {}).get("Proxy") != "http://127.0.0.1:4181/company/sso":
        r = subprocess.run(["tailscale.exe", "serve", "--bg", "--https=443", "--set-path=/tdh-sso", "--yes", "http://127.0.0.1:4181/company/sso"],
                           capture_output=True)
        if r.returncode != 0:
            raise SystemExit("Tailscale Serve failed: " + r.stderr.decode("utf-8", "replace")[-300:])
    st = json.loads(subprocess.run(["tailscale.exe", "serve", "status", "--json"], capture_output=True).stdout.decode() or "{}")
    handlers = ((st.get("Web") or {}).get(SITE + ":443") or {}).get("Handlers") or {}
    funnel = any(bool(v) for v in (st.get("AllowFunnel") or {}).values())
    print("4 serve: / -> %s; /tdh-sso -> %s; funnel %s" % ((handlers.get("/") or {}).get("Proxy"), (handlers.get("/tdh-sso") or {}).get("Proxy"), funnel))
    if funnel or (handlers.get("/") or {}).get("Proxy") != "http://127.0.0.1:18080":
        raise SystemExit("Tailscale Serve is not as expected")
    for name in ("company-erpnext", "company-erpnext-data"):        # the guide; the agent's reads and writes
        skills = Path(os.environ.get("TDH_COMPANY") or r"D:\dsh\company") / "_skills" / name
        skills.mkdir(parents=True, exist_ok=True)
        (skills / "SKILL.md").write_bytes((HERE / "skills" / name / "SKILL.md").read_bytes())
    print("5 skills company-erpnext, company-erpnext-data in _skills (desks take them at their next start)")
    print("ERP_SSO_INSTALL_OK=1")


if __name__ == "__main__":
    main()
