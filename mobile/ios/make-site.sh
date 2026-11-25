#!/bin/bash
# Site.json for one site's build of the app (never committed: it names the site's server and carries its CA).
#   [MORE_CA=entry-ca.crt[,another.crt]] make-site.sh NAME HOST PORT CA_PEM ADDRESS [ADDRESS...]
#   e.g. make-site.sh TDH tdharness.local 8443 company-ca.crt tdharness.local 10.66.0.2
#        MORE_CA=entry-ca.crt make-site.sh TDH tdharness.local 8443 company-ca.crt tdharness.local 10.66.0.2 118.190.105.26
# HOST is the name in the server's certificate; ADDRESSes are tried in order (office LAN name, company tunnel,
# a public entry when the site has one). A public entry that answers with its own certificate (its own CA, limited to
# HOST's domain) needs that CA too: MORE_CA, written to "more_ca" (the app trusts it next to CA_PEM, for HOST only).
set -eu
NAME="$1"; HOST="$2"; PORT="$3"; CA="$4"; shift 4
OUT="$(cd "$(dirname "$0")" && pwd)/TDH/Site.json"
MORE_CA="${MORE_CA:-}" python3 - "$NAME" "$HOST" "$PORT" "$CA" "$OUT" "$@" <<'PY'
import json, os, sys
name, host, port, ca, out = sys.argv[1:6]
def pem_of(path):
    pem = open(path, encoding="ascii").read().strip()
    assert pem.startswith("-----BEGIN CERTIFICATE-----"), "not a PEM certificate: " + path
    return pem
site = {"name": name, "host": host, "port": int(port), "addresses": sys.argv[6:], "ca": pem_of(ca)}
more = [pem_of(p) for p in os.environ["MORE_CA"].split(",") if p.strip()]
if more:
    site["more_ca"] = more
json.dump(site, open(out, "w"), ensure_ascii=False, indent=1)
print("SITE_JSON=" + out)
PY
