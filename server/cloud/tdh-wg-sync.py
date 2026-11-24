#!/usr/bin/env python3
"""company-wg-enroll-v1, the hub's half: keep wg0's desks equal to the company server's list.

Runs on the Qingdao hub (systemd: tdh-wg-sync.service). Every few seconds it asks the company server, through the
tunnel, for the desks that may connect (POST https://10.66.0.2:8443/company/desk-lease/wg/peers, the hub's own token
in /etc/wireguard/hub.token) and makes wg0 match: new desks added, desks no longer listed (a person disabled or
removed there, a device re-keyed) taken off. Peers written in /etc/wireguard/wg0.conf (the company server, hand-made
ones) are never touched. When the server does not answer, nothing changes.
"""
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.request

IFACE = "wg0"
CONF = "/etc/wireguard/wg0.conf"
TOKEN = "/etc/wireguard/hub.token"
URL = os.environ.get("TDH_PEERS_URL", "https://10.66.0.2:8443/company/desk-lease/wg/peers")
EVERY = int(os.environ.get("TDH_SYNC_EVERY", "5"))
KEY_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")
IP_RE = re.compile(r"^10\.66\.0\.(2[0-9]|[3-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|250)$")


def static_keys():
    keys = set()
    try:
        for line in open(CONF, encoding="utf-8"):
            m = re.match(r"\s*PublicKey\s*=\s*(\S+)", line)
            if m:
                keys.add(m.group(1))
    except OSError:
        pass
    return keys


def wanted():
    token = open(TOKEN, encoding="utf-8").read().strip()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # inside the tunnel, to the one address it can reach; the token is what counts
    req = urllib.request.Request(URL, data=b"{}", method="POST", headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + token, "Host": "tdharness.local:8443"})
    with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
        d = json.loads(r.read())
    if not d.get("ok") or not isinstance(d.get("peers"), list):
        raise RuntimeError("bad answer")
    out = {}
    for p in d["peers"]:
        k, ip = str(p.get("pubkey") or ""), str(p.get("ip") or "")
        if KEY_RE.match(k) and IP_RE.match(ip):
            out[k] = ip
    return out


def current():
    r = subprocess.run(["wg", "show", IFACE, "allowed-ips"], capture_output=True, text=True, check=True)
    out = {}
    for line in r.stdout.splitlines():
        parts = line.split()
        if parts:
            out[parts[0]] = parts[1].split("/")[0] if len(parts) > 1 and parts[1] != "(none)" else ""
    return out


def once():
    want = wanted()
    keep = static_keys()
    have = current()
    changed = 0
    for k, ip in want.items():
        if k in keep:
            continue
        if have.get(k) != ip:
            subprocess.run(["wg", "set", IFACE, "peer", k, "allowed-ips", ip + "/32"], check=True)
            changed += 1
    for k in have:
        if k not in keep and k not in want:
            subprocess.run(["wg", "set", IFACE, "peer", k, "remove"], check=True)
            changed += 1
    return changed, len(want)


def main():
    last = None
    while True:
        try:
            changed, n = once()
            state = "ok %d desks" % n
            if changed:
                print("TDH_WG_SYNC changed=%d desks=%d" % (changed, n), flush=True)
        except Exception as e:  # noqa: BLE001  keep the hub as it is and try again
            state = "error %s" % str(e)[:120]
        if state != last:
            print("TDH_WG_SYNC " + state, flush=True)
            last = state
        if "--once" in sys.argv:
            return
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
