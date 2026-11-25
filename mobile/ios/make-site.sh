#!/bin/bash
# Site.json for one site's build of the app (never committed: it names the site's server and carries its CA).
#   make-site.sh NAME HOST PORT CA_PEM[,MORE_CA_PEM...] ADDRESS [ADDRESS...]
#   e.g. make-site.sh TDH tdharness.local 8443 company-ca.crt,entry-ca.crt tdharness.local 10.66.0.2 118.190.105.26
# HOST is the name in the server's certificate; ADDRESSes are tried at once, the first to answer is used (office LAN
# name, company tunnel, a public entry when the site has one). The first CA is the company root (D:\dsh\runtime\
# company-ca.crt); more are the roots of public entries (the cloud entry's: D:\dsh\runtime\entry-ca\entry-ca.crt).
set -eu
NAME="$1"; HOST="$2"; PORT="$3"; CA="$4"; shift 4
OUT="$(cd "$(dirname "$0")" && pwd)/TDH/Site.json"
python3 - "$NAME" "$HOST" "$PORT" "$CA" "$OUT" "$@" <<'PY'
import json, sys
name, host, port, ca, out = sys.argv[1:6]
pems = [open(f, encoding="ascii").read().strip() for f in ca.split(",")]
assert all(p.startswith("-----BEGIN CERTIFICATE-----") and p.count("BEGIN CERTIFICATE") == 1 for p in pems), "not one PEM certificate each"
json.dump({"name": name, "host": host, "port": int(port), "addresses": sys.argv[6:], "ca": pems[0], "more_ca": pems[1:]},
          open(out, "w"), ensure_ascii=False, indent=1)
print("SITE_JSON=" + out)
PY
