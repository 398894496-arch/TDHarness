#!/bin/bash
# company-mobile-entry-v1 / company-turn-v1: the cloud hub's public entry for phones (nginx, tdh-entry.nginx.conf),
# its bans (fail2ban/) and the TURN server for chat calls (coturn, turnserver.conf). Run as root on the hub, from a
# copy of this folder:
#   install-entry.sh csr                         a request for tdharness.local's certificate, on stdout; the key is
#                                                made once in /etc/tdh-entry and never leaves this machine
#   install-entry.sh cert ENTRY.crt COMPANY.crt  the certificate entry-ca.ps1 signed for that request, and the company
#                                                root (D:\dsh\runtime\company-ca.crt) the company site is checked with
#   install-entry.sh apply PUBLIC_IP             nginx, fail2ban and coturn configured and (re)started; the TURN secret
#                                                is made once in /etc/tdh-entry/turn.secret
# Prints ENTRY_OK=1. Nothing secret is printed.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
D=/etc/tdh-entry
HOST=tdharness.local
fail() { echo "ENTRY_FAIL $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail root
install -d -m 0700 -o root -g root "$D"

case "${1:-}" in
csr)
	[ -f "$D/entry.key" ] || (umask 077 && openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$D/entry.key")
	openssl req -new -key "$D/entry.key" -subj "/CN=$HOST" -addext "subjectAltName=DNS:$HOST"
	;;
cert)
	crt=${2:?ENTRY.crt}; root=${3:?COMPANY.crt}
	[ "$(openssl x509 -in "$crt" -noout -pubkey | sha256sum)" = "$(openssl pkey -in "$D/entry.key" -pubout | sha256sum)" ] || fail cert-not-for-this-key
	openssl x509 -in "$crt" -noout -checkhost "$HOST" | grep -q "does match" || fail cert-name
	openssl x509 -in "$crt" -noout -checkend 2592000 >/dev/null || fail cert-expires-within-30-days
	openssl x509 -in "$root" -noout >/dev/null || fail company-root
	install -m 0644 "$crt" "$D/entry.crt"
	install -m 0644 "$root" "$D/company-root.crt"
	echo "ENTRY_CERT_OK=1 until=$(openssl x509 -in "$D/entry.crt" -noout -enddate | cut -d= -f2)"
	;;
apply)
	pub=${2:?PUBLIC_IP}
	priv=$(ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)
	[[ "$pub" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$priv" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail addresses
	[ -f "$D/entry.crt" ] && [ -f "$D/company-root.crt" ] || fail no-certificate-yet
	[ -f "$D/turn.secret" ] || (umask 077 && openssl rand -hex 32 > "$D/turn.secret")
	secret=$(cat "$D/turn.secret")
	[[ "$secret" =~ ^[0-9a-f]{64}$ ]] || fail turn-secret

	install -m 0644 "$HERE/tdh-entry.nginx.conf" /etc/nginx/conf.d/tdh-entry.conf
	rm -f /etc/nginx/sites-enabled/default
	nginx -t -q || fail nginx-config
	systemctl enable -q nginx
	systemctl reload-or-restart nginx

	install -m 0644 "$HERE/fail2ban/tdh-entry.jail.conf" /etc/fail2ban/jail.d/tdh-entry.conf
	install -m 0644 "$HERE/fail2ban/tdh-entry-login.conf" /etc/fail2ban/filter.d/tdh-entry-login.conf
	install -m 0644 "$HERE/fail2ban/tdh-entry-scan.conf" /etc/fail2ban/filter.d/tdh-entry-scan.conf
	touch /var/log/nginx/tdh-entry.log
	systemctl enable -q fail2ban
	systemctl restart fail2ban

	[ -f /etc/turnserver.conf.dist ] || cp -p /etc/turnserver.conf /etc/turnserver.conf.dist
	tmp=$(mktemp)
	sed -e "s/__PUBLIC_IP__/$pub/g" -e "s/__PRIVATE_IP__/$priv/g" -e "s/__SECRET__/$secret/" "$HERE/turnserver.conf" > "$tmp"
	install -m 0640 -o root -g turnserver "$tmp" /etc/turnserver.conf
	rm -f "$tmp"
	systemctl enable -q coturn
	systemctl restart coturn

	sleep 2
	for s in nginx fail2ban coturn; do systemctl is-active -q "$s" || fail "$s-not-running"; done
	echo "ENTRY_OK=1 public=$pub private=$priv"
	;;
*)
	fail "usage: csr | cert ENTRY.crt COMPANY.crt | apply PUBLIC_IP"
	;;
esac
