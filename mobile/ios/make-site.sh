#!/bin/bash
# Site.json for one site's build of the app (never committed: it names the site's server and carries its CA).
#   make-site.sh NAME HOST PORT CA_PEM ADDRESS [ADDRESS...]
#   e.g. make-site.sh TDH tdharness.local 8443 company-ca.crt tdharness.local 10.66.0.2
# HOST is the name in the server's certificate; ADDRESSes are tried in order (office LAN name, company tunnel,
# a public entry when the site has one).
set -eu
NAME="$1"; HOST="$2"; PORT="$3"; CA="$4"; shift 4
OUT="$(cd "$(dirname "$0")" && pwd)/TDH/Site.json"
python3 - "$NAME" "$HOST" "$PORT" "$CA" "$OUT" "$@" <<'PY'
import json, sys
name, host, port, ca, out = sys.argv[1:6]
pem = open(ca, encoding="ascii").read().strip()
assert pem.startswith("-----BEGIN CERTIFICATE-----"), "not a PEM certificate"
json.dump({"name": name, "host": host, "port": int(port), "addresses": sys.argv[6:], "ca": pem}, open(out, "w"), ensure_ascii=False, indent=1)
print("SITE_JSON=" + out)
PY
