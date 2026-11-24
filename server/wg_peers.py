"""company-wg-enroll-v1: each desk's key for the company tunnel (the Qingdao hub, company-wg-hub-v1).

The user, 2026-11-25: 「我要求改好以后任何客户端都不要弹出这个窗口，默认连接新买的服务器」 — no more Tailscale; every desk
reaches this server through the company's own hub (WireGuard, 10.66.0.0/24, UDP 51820 on the cloud server).

A desk makes its own key pair (the private half never leaves it) and sends the public half with its sign-in token
(enroll). This server gives that device one address and keeps it in runtime/wg-peers.json. The hub asks for the list
every few seconds (peers, with the hub's own token) and takes exactly it: a person disabled or removed here drops out
of the list, so their devices are off the tunnel within seconds.

Addresses: .1 the hub, .2 this server, .3–.19 kept for hand-made peers (the hub's own config), desks from .20 up.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
import re
import tempfile
import time
from pathlib import Path

NET = "10.66.0."
FIRST, LAST = 20, 250
KEY_RE = re.compile(r"^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$")
DEVICE_RE = re.compile(r"^[A-Za-z0-9._-]{8,80}$")


class PeerError(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


def _load(path: Path) -> dict:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) and isinstance(d.get("peers"), list) else {"peers": []}
    except (OSError, ValueError):
        return {"peers": []}


def _save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".wg-peers.", suffix=".tmp", dir=str(path.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def hub_config(runtime: Path) -> dict:
    """runtime/wg-hub.json: {"pubkey": ..., "endpoint": "host:port"} — what a desk dials."""
    try:
        d = json.loads((runtime / "wg-hub.json").read_text(encoding="utf-8"))
        if KEY_RE.match(str(d.get("pubkey") or "")) and ":" in str(d.get("endpoint") or ""):
            return {"pubkey": d["pubkey"], "endpoint": d["endpoint"], "server": d.get("server") or NET + "2"}
    except (OSError, ValueError):
        pass
    return {}


def enroll(path: Path, login: str, device_id: str, pubkey: str, now: int | None = None) -> dict:
    if not DEVICE_RE.match(device_id or ""):
        raise PeerError(400, "bad-device")
    if not KEY_RE.match(pubkey or ""):
        raise PeerError(400, "bad-key")
    try:
        if len(base64.b64decode(pubkey)) != 32:
            raise PeerError(400, "bad-key")
    except ValueError:
        raise PeerError(400, "bad-key")
    data = _load(path)
    peers = data["peers"]
    for p in peers:  # a key belongs to one device of one person
        if p.get("pubkey") == pubkey and (p.get("login") != login or p.get("device") != device_id):
            raise PeerError(409, "key-taken")
    mine = next((p for p in peers if p.get("login") == login and p.get("device") == device_id), None)
    if mine is None:
        used = {p.get("ip") for p in peers}
        free = next((NET + str(i) for i in range(FIRST, LAST + 1) if NET + str(i) not in used), None)
        if free is None:
            raise PeerError(507, "no-address")
        mine = {"login": login, "device": device_id, "ip": free}
        peers.append(mine)
    mine["pubkey"] = pubkey
    mine["at"] = int(now if now is not None else time.time())
    _save(path, data)
    return {"address": mine["ip"] + "/32"}


def peers_for_hub(path: Path, active) -> list:
    """The desks the hub lets in: only people still active here (active(login) -> bool)."""
    return [{"pubkey": p["pubkey"], "ip": p["ip"]} for p in _load(path)["peers"]
            if p.get("pubkey") and p.get("ip") and active(p.get("login"))]


def hub_token_ok(runtime: Path, given: str) -> bool:
    try:
        want = (runtime / "wg-hub.token").read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return bool(want) and bool(given) and hmac.compare_digest(want, given)


def selftest() -> int:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "wg-peers.json"
        k1 = base64.b64encode(bytes(range(32))).decode()
        k2 = base64.b64encode(bytes(range(1, 33))).decode()
        a = enroll(p, "alice", "dev-aaaaaaaa", k1)
        assert a == {"address": "10.66.0.20/32"}, a
        assert enroll(p, "alice", "dev-aaaaaaaa", k2) == a          # same device, new key: same address
        assert enroll(p, "bob", "dev-bbbbbbbb", k1)["address"] == "10.66.0.21/32"
        try:
            enroll(p, "carol", "dev-cccccccc", k2)
            raise AssertionError("took another device's key")
        except PeerError as e:
            assert e.code == "key-taken"
        for bad in ("short", "x" * 44, k1[:-1] + "B"):
            try:
                enroll(p, "alice", "dev-aaaaaaaa", bad)
                raise AssertionError("accepted key " + bad)
            except PeerError:
                pass
        hub = peers_for_hub(p, lambda login: login != "bob")
        assert hub == [{"pubkey": k2, "ip": "10.66.0.20"}], hub
        (Path(d) / "wg-hub.token").write_text("secret\n")
        assert hub_token_ok(Path(d), "secret") and not hub_token_ok(Path(d), "nope") and not hub_token_ok(Path(d), "")
    print("WG_PEERS_SELFTEST_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(selftest())
