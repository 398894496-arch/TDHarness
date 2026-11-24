"""company-desk-store-v1: a person's chats (<personal>/.dsh-desk) served whole and written back in pieces.

The user, 2026-11-25: away from the office a desk took minutes to open, all of it the kernel reading and writing its
session logs over the company share (SMB): a demo kernel over the same 51 sessions started in 23 s with them on a
local disk, 190 s with them on the share. The chats stay on this server only (「会话放在服务器」), so a desk now takes
them whole at sign-in (pull: one tar, read here at disk speed) into a disk in its memory (never its own disk),
works there, and sends every change back within a second or two (push). Only the device that holds the person's seat
(desk_lease) may push, so two desks never write the same chats; the share copy stays the one durable copy, read by
everything else here (the nightly report, KRouter) as before.

pull  -> tar of .dsh-desk (sessions/, storages/, manifest.json), without lock files and temp files.
push  -> ops, applied in order, each one all or nothing:
         {"op": "put", "path": rel, "data": b64}                 whole file (new, or rewritten in place)
         {"op": "append", "path": rel, "offset": n, "data": b64} bytes at the end; refused (409 "offset") unless the
                                                                 file is exactly n bytes long, so the desk then puts it
         {"op": "delete", "path": rel}                            the file, then its empty folders up to .dsh-desk
Paths are relative to .dsh-desk, forward slashes, no "..", no leading dot names other than .dsh-desk's own files.
"""
from __future__ import annotations

import base64
import io
import os
import re
import tarfile
import tempfile
from pathlib import Path

ROOT_NAME = ".dsh-desk"
# Lock files are each process's own (flock); temp files are a writer's half-done work.
SKIP_NAME = re.compile(r"(^session\.lock$)|(^\..*\.tmp$)|(\.tmp$)|(^\.~)")
REL_OK = re.compile(r"^[A-Za-z0-9._@+=~ \-一-鿿]+(/[A-Za-z0-9._@+=~ \-一-鿿]+)*$")
OPS_MAX = 400


class StoreError(Exception):
    def __init__(self, status: int, code: str, detail: str = ""):
        super().__init__(code)
        self.status = status
        self.code = code
        self.detail = detail


def root_of(personal: str) -> Path:
    return Path(personal) / ROOT_NAME


def _safe(root: Path, rel: str) -> Path:
    rel = str(rel or "").replace("\\", "/")
    if rel.startswith("/") or ":" in rel:
        raise StoreError(400, "bad-path", rel[:120])
    rel = rel.strip("/")
    if not rel or not REL_OK.match(rel) or any(p in ("", ".", "..") for p in rel.split("/")):
        raise StoreError(400, "bad-path", rel[:120])
    if SKIP_NAME.search(rel.rsplit("/", 1)[-1]):
        raise StoreError(400, "skip-path", rel[:120])
    target = (root / rel).resolve()
    base = root.resolve()
    if base != target and base not in target.parents:
        raise StoreError(400, "bad-path", rel[:120])
    return target


def pack(root: Path) -> bytes:
    """The whole .dsh-desk as an uncompressed tar (the logs are zstd already)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tar:
        if root.is_dir():
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith((".tmp", ".dsh-mkdir-")))
                for name in sorted(filenames):
                    if SKIP_NAME.search(name):
                        continue
                    full = Path(dirpath) / name
                    rel = full.relative_to(root).as_posix()
                    try:
                        data = full.read_bytes()
                        st = full.stat()
                    except OSError:
                        continue  # removed or locked while we walked: the next pull has it
                    info = tarfile.TarInfo(rel)
                    info.size = len(data)
                    info.mtime = int(st.st_mtime)
                    info.mode = 0o600
                    tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _write_atomic(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + target.name + ".", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _b64(op: dict) -> bytes:
    try:
        return base64.b64decode(str(op.get("data") or ""), validate=True)
    except (ValueError, TypeError):
        raise StoreError(400, "bad-data")


def apply_ops(root: Path, ops: list) -> dict:
    """Apply ops in order. Stops at the first refused op; earlier ones stay applied (each is whole)."""
    if not isinstance(ops, list) or len(ops) > OPS_MAX:
        raise StoreError(400, "bad-ops")
    root.mkdir(parents=True, exist_ok=True)
    done = 0
    for op in ops:
        if not isinstance(op, dict):
            raise StoreError(400, "bad-ops")
        kind = str(op.get("op") or "")
        target = _safe(root, op.get("path"))
        if kind == "put":
            _write_atomic(target, _b64(op))
        elif kind == "append":
            data = _b64(op)
            try:
                offset = int(op.get("offset"))
            except (TypeError, ValueError):
                raise StoreError(400, "bad-offset")
            size = target.stat().st_size if target.exists() else -1
            if size != offset:
                return {"ok": False, "error": "offset", "done": done, "path": op.get("path"), "size": size}
            with open(target, "ab") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
        elif kind == "delete":
            try:
                target.unlink()
            except FileNotFoundError:
                pass
            parent = target.parent
            base = root.resolve()
            while parent.resolve() != base and base in parent.resolve().parents:
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
        else:
            raise StoreError(400, "bad-op", kind[:20])
        done += 1
    return {"ok": True, "done": done}


def selftest() -> int:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d) / "p" / ROOT_NAME
        (root / "sessions" / "slug" / "s1").mkdir(parents=True)
        (root / "sessions" / "slug" / "s1" / "session.v4.jsonl.zstd").write_bytes(b"abc")
        (root / "sessions" / "slug" / "s1" / "session.lock").write_bytes(b"")
        (root / "storages").mkdir()
        (root / "storages" / "workspace.json").write_text("{}")
        tar = tarfile.open(fileobj=io.BytesIO(pack(root)))
        names = sorted(tar.getnames())
        assert names == ["sessions/slug/s1/session.v4.jsonl.zstd", "storages/workspace.json"], names
        e = lambda b: base64.b64encode(b).decode()  # noqa: E731
        r = apply_ops(root, [{"op": "append", "path": "sessions/slug/s1/session.v4.jsonl.zstd", "offset": 3, "data": e(b"de")}])
        assert r == {"ok": True, "done": 1}, r
        assert (root / "sessions/slug/s1/session.v4.jsonl.zstd").read_bytes() == b"abcde"
        r = apply_ops(root, [{"op": "append", "path": "sessions/slug/s1/session.v4.jsonl.zstd", "offset": 3, "data": e(b"x")}])
        assert r["error"] == "offset" and r["size"] == 5, r
        r = apply_ops(root, [{"op": "put", "path": "sessions/slug/s2/session.v4.jsonl.zstd", "data": e(b"new")},
                             {"op": "put", "path": "storages/workspace.json", "data": e(b'{"a":1}')}])
        assert r["done"] == 2 and (root / "storages/workspace.json").read_text() == '{"a":1}'
        r = apply_ops(root, [{"op": "delete", "path": "sessions/slug/s2/session.v4.jsonl.zstd"}])
        assert not (root / "sessions/slug/s2").exists() and (root / "sessions/slug").exists()
        for bad in ("../x", "/etc/passwd", "sessions/../../x", "sessions/a/session.lock", "a/./b", ""):
            try:
                apply_ops(root, [{"op": "put", "path": bad, "data": e(b"x")}])
                raise AssertionError("accepted " + bad)
            except StoreError:
                pass
        assert not any(p.name.endswith(".tmp") for p in root.rglob("*"))
    print("DESK_STORE_SELFTEST_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(selftest())
