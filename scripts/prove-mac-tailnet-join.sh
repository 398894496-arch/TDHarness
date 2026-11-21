#!/bin/bash
# Proof for company-mac-tailnet-join-v1 (desk/pack/mac/mac-join-off-lan.sh) against a stand-in
# Tailscale and a stand-in osascript: no site files -> nothing; already on the company tailnet ->
# nothing asked; "later" -> marked, nothing installed; a fresh Mac -> installs, then `up` with the key
# from a file that is gone afterwards; signed in to another tailnet -> `login` (a second account),
# never `up --reset`. Ends with MAC_TAILNET_JOIN_PROVE_OK=1.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
JOIN="$HERE/../desk/pack/mac/mac-join-off-lan.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/tdh-tsjoin.XXXXXX")"
trap 'rm -rf "$T"' EXIT
SERVER=100.78.1.2
fail() { echo "MAC_TAILNET_JOIN_PROVE_FAIL $*" >&2; exit 1; }

# stand-in Tailscale: state in $T/state ("none" = daemon not up yet), calls in $T/calls
mkdir -p "$T/src/Contents/MacOS"
cat > "$T/src/Contents/MacOS/Tailscale" <<EOF
#!/bin/bash
st="\$(cat "$T/state" 2>/dev/null || echo NeedsLogin)"
case "\$1" in
  status)
    [[ "\$st" == none ]] && exit 1
    peer=""; [[ "\$st" == company ]] && peer='"$SERVER"'
    [[ "\$st" == other ]] && peer='"100.99.0.1"'
    bs=Running; [[ "\$st" == NeedsLogin ]] && bs=NeedsLogin
    printf '{\n  "BackendState": "%s",\n  "Peer": {"x": {"TailscaleIPs": [%s]}}\n}\n' "\$bs" "\$peer" ;;
  up|login)
    echo "\$*" >> "$T/calls"
    for a in "\$@"; do case "\$a" in --auth-key=file:*) k="\${a#--auth-key=file:}"; cat "\$k" > "$T/keyseen"; echo "\$k" > "$T/keypath" ;; esac; done
    echo company > "$T/state" ;;
esac
EOF
chmod +x "$T/src/Contents/MacOS/Tailscale"
# stand-in osascript: a choice dialog answers $T/answer, a notice is logged
cat > "$T/osa" <<EOF
#!/bin/bash
echo "\$2" >> "$T/dialogs"
case "\$2" in "button returned of"*) cat "$T/answer" ;; esac
EOF
chmod +x "$T/osa"
cat > "$T/install" <<EOF
#!/bin/bash
mkdir -p "$T/app" && cp -R "$T/src/." "$T/app/" && echo installed >> "$T/calls"
EOF
chmod +x "$T/install"

ROOT="$T/root"
mkdir -p "$ROOT"
run() {
  TDH_TS_APP="$T/app" TDH_TS_OSA="$T/osa" TDH_TS_INSTALL="$T/install" TDH_TS_WAIT=3 TDH_TS_HOME="$T/home" \
    bash "$JOIN" "$ROOT" 2>/dev/null | sed -n 's/^TS_JOIN=//p'
}
reset() { rm -rf "$T/app" "$T/calls" "$T/dialogs" "$T/home" "$T/keyseen" "$T/keypath" "$T/state"; }

r="$(run)"; [[ "$r" == skip-no-site-tailnet ]] || fail "no vendor: $r"

mkdir -p "$ROOT/vendor"
printf 'ip=%s\nnode=tdharness\n' "$SERVER" > "$ROOT/vendor/company-tailnet.txt"
printf 'join-key-for-test\n' > "$ROOT/vendor/employee.auth"
: > "$ROOT/vendor/Tailscale.pkg"

# already on the company tailnet
reset; mkdir -p "$T/app" && cp -R "$T/src/." "$T/app/"; echo company > "$T/state"
r="$(run)"; [[ "$r" == on-company ]] || fail "on company: $r"
[[ ! -e "$T/dialogs" && ! -e "$T/calls" ]] || fail "on company still asked or joined"

# "later"
reset; echo "以后再说" > "$T/answer"
r="$(run)"; [[ "$r" == declined ]] || fail "later: $r"
[[ -f "$T/home/ts-join.declined" && ! -e "$T/app" ]] || fail "later: not marked, or installed anyway"

# a fresh Mac: install, then up with the key from a file
reset; echo "继续" > "$T/answer"
r="$(run)"; [[ "$r" == joined-up ]] || fail "fresh: $r ($(cat "$T/calls" 2>/dev/null))"
grep -q '^installed$' "$T/calls" || fail "fresh: not installed"
line="$(grep '^up ' "$T/calls")" || fail "fresh: no up"
[[ "$line" == *"--accept-dns=true"* && "$line" == *"--hostname="* && "$line" != *"--reset"* ]] || fail "fresh: flags $line"
[[ "$(cat "$T/keyseen")" == join-key-for-test ]] || fail "fresh: key not passed"
[[ ! -e "$(cat "$T/keypath")" ]] || fail "fresh: key file left behind"
[[ ! -e "$T/home/ts-join.declined" ]] || fail "fresh: decline mark kept"

# signed in to another tailnet: add the company one, do not replace
reset; echo "继续" > "$T/answer"; mkdir -p "$T/app" && cp -R "$T/src/." "$T/app/"; echo other > "$T/state"
r="$(run)"; [[ "$r" == joined-login ]] || fail "other tailnet: $r"
grep -q '^login ' "$T/calls" && ! grep -q '^up ' "$T/calls" || fail "other tailnet: $(cat "$T/calls")"

# Tailscale never comes up
reset; echo "继续" > "$T/answer"; mkdir -p "$T/app" && cp -R "$T/src/." "$T/app/"; echo none > "$T/state"
r="$(run)"; [[ "$r" == fail-not-started ]] || fail "not started: $r"

echo MAC_TAILNET_JOIN_PROVE_OK=1
