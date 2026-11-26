#!/usr/bin/env node
'use strict';
/**
 * company-desk-store-v1 (server/desk_store.py): the person's chats live on the company server only; a desk works on a
 * copy in a disk in its memory (mac-ramdisk.sh) and sends every change back within a second or two.
 *
 * The user, 2026-11-25: away from the office a desk took minutes to open, all of it the kernel reading and writing its
 * session logs over the company share (51 sessions: 23 s from a local disk, 190 s from the share). 「会话放在服务器」:
 * nothing of the chats is kept on the desk's own disk; the memory disk goes when the desk quits.
 *
 *   node desk-store.js pull  --dir D    the server's .dsh-desk into D (emptied first), and the baseline of what was sent
 *   node desk-store.js sync  --dir D    send D's changes as they happen, until SIGTERM / SIGINT (then a last flush)
 *   node desk-store.js flush --dir D    send what is not sent yet, once; exit 0 only when nothing is left
 *
 * What is sent: every file under D but lock files, temp files (*.tmp, .dsh-mkdir-*), and D/.desk-store (this
 * program's own state). A file that only grew (same inode, larger) goes as its new tail (append at the size the server
 * had); anything else goes whole (put); a file gone goes as delete. The server takes an append only at the exact size
 * it holds, so a desk and the server never disagree silently: on a refusal the file goes whole.
 * Only the device holding the seat may send (409 not-holder): then this program stops and says so (STORE_LOST_SEAT).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const BATCH_BYTES = 6 * 1024 * 1024;
const BATCH_OPS = 300;
const QUIET_MS = 700;
const SCAN_MS = 3000;
const REQUEST_TIMEOUT_MS = 60000;
const STATE_DIR = '.desk-store';
const SKIP_FILE = /(^session\.lock$)|(\.tmp$)|(^\.~)|(^\.DS_Store$)/;
const SKIP_DIR = /^(\.desk-store|\.dsh-mkdir-.*|\.tmp.*|\.Trashes|\.fseventsd|\.Spotlight-V100|\.TemporaryItems)$/;

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function rcDir() { return arg('rc') || path.join(os.homedir(), '.dsh-company-rc8'); }
function readTrim(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/[\r\n]+/g, '').trim(); } catch { return ''; }
}
function say(line) { process.stdout.write(line + '\n'); }
function token() { return process.env.DEEPSEEK_API_KEY || readTrim(path.join(rcDir(), 'gw.token')); }
function deviceId() { return readTrim(path.join(rcDir(), 'device.id')); }
function storeUrl(what) {
  const site = arg('site') || readTrim(path.join(rcDir(), 'site.login')) || process.env.COMPANY_SITE || '';
  if (!site) throw new Error('store-site-missing');
  return site.replace(/\/company\/login\/?$/, '').replace(/\/$/, '') + '/company/desk-lease/store/' + what;
}

function post(what, body, strict) {
  return new Promise((resolve, reject) => {
    const u = new URL(storeUrl(what));
    const raw = Buffer.from(JSON.stringify(Object.assign({ device_id: deviceId() }, body || {})));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname,
      family: 4, timeout: REQUEST_TIMEOUT_MS,
      // strict: the server's certificate must check out (the company CA, NODE_EXTRA_CA_CERTS): what decides where the
      // tunnel goes is not taken from whoever answers.
      agent: u.protocol === 'https:' ? new https.Agent({ rejectUnauthorized: !!strict }) : undefined,
      headers: { 'Content-Type': 'application/json', 'Content-Length': raw.length, Authorization: 'Bearer ' + token(), 'Cache-Control': 'no-store' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, type: String(res.headers['content-type'] || ''),
        headers_etag: String(res.headers['x-desk-etag'] || ''), body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('store-http-timeout')); });
    req.end(raw);
  });
}
// Windows: the system's own bsdtar. A GNU tar from Git earlier on PATH reads "C:\\..." as a remote host and fails.
function tarBin() {
  if (process.platform !== 'win32') return 'tar';
  const t = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(t) ? t : 'tar';
}
function json(buf) { try { return JSON.parse(buf.toString('utf8')); } catch { return {}; } }

// ---- the local picture -------------------------------------------------------------------------------------------
function walk(dir, rel, out) {
  let ents;
  try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(dir, r, out); continue; }
    if (!e.isFile() || SKIP_FILE.test(e.name)) continue;
    try {
      const st = fs.statSync(path.join(dir, r), { bigint: true });
      out.set(r, { size: Number(st.size), ino: String(st.ino), mtime: String(st.mtimeNs) });
    } catch { /* gone while we looked */ }
  }
  return out;
}
function statePath(dir) { return path.join(dir, STATE_DIR, 'sent.json'); }
function loadSent(dir) {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(statePath(dir), 'utf8')))); } catch { return new Map(); }
}
function saveSent(dir, sent) {
  fs.mkdirSync(path.join(dir, STATE_DIR), { recursive: true });
  const tmp = statePath(dir) + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(sent)));
  fs.renameSync(tmp, statePath(dir));
}
function writeStatus(dir, status) {
  try {
    fs.mkdirSync(path.join(dir, STATE_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, STATE_DIR, 'status.json'), JSON.stringify(Object.assign({ at: Date.now() }, status)));
  } catch { /* status is a courtesy */ }
}

// What to send now, against what the server has (sent).
function plan(dir, sent) {
  const now = walk(dir, '', new Map());
  const ops = [];
  for (const [rel, cur] of now) {
    const had = sent.get(rel);
    if (had && had.size === cur.size && had.ino === cur.ino && had.mtime === cur.mtime) continue;
    if (had && had.ino === cur.ino && cur.size > had.size) ops.push({ op: 'append', path: rel, offset: had.size, cur });
    else ops.push({ op: 'put', path: rel, cur });
  }
  for (const rel of sent.keys()) if (!now.has(rel)) ops.push({ op: 'delete', path: rel });
  return ops;
}

function readRange(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    let got = 0;
    while (got < buf.length) {
      const n = fs.readSync(fd, buf, got, buf.length - got, start + got);
      if (!n) break;
      got += n;
    }
    return buf.subarray(0, got);
  } finally { fs.closeSync(fd); }
}

// Send ops in batches; update sent as each batch lands. Returns 'clean' | 'pending' | 'lost'.
async function push(dir, sent, ops) {
  let i = 0;
  while (i < ops.length) {
    const batch = [];
    const after = [];
    let bytes = 0;
    while (i < ops.length && batch.length < BATCH_OPS) {
      const o = ops[i];
      const file = path.join(dir, o.path);
      let wire;
      let size = o.cur ? o.cur.size : 0;
      try {
        if (o.op === 'delete') wire = { op: 'delete', path: o.path };
        else if (o.op === 'append') {
          const data = readRange(file, o.offset, o.cur.size);
          size = o.offset + data.length;
          wire = { op: 'append', path: o.path, offset: o.offset, data: data.toString('base64') };
        } else {
          const data = fs.readFileSync(file);
          size = data.length;
          wire = { op: 'put', path: o.path, data: data.toString('base64') };
        }
      } catch (e) {
        if (e && e.code === 'ENOENT') { i++; continue; }  // gone since the plan: the next plan deletes it
        throw e;
      }
      const w = wire.data ? wire.data.length : 0;
      if (batch.length && bytes + w > BATCH_BYTES) break;
      batch.push(wire);
      after.push({ o, size });
      bytes += w;
      i++;
    }
    if (!batch.length) continue;
    const res = await post('push', { ops: batch });
    const body = json(res.body);
    if (res.status === 409 && body.error === 'not-holder') return 'lost';
    const done = typeof body.done === 'number' ? body.done : 0;
    for (let k = 0; k < done; k++) {
      const { o, size } = after[k];
      if (o.op === 'delete') sent.delete(o.path);
      else sent.set(o.path, { size, ino: o.cur.ino, mtime: size === o.cur.size ? o.cur.mtime : '' });
    }
    saveSent(dir, sent);
    if (res.status === 409 && body.error === 'offset') {
      // The server holds another length: send that file whole next round.
      const k = done;
      if (after[k]) sent.set(after[k].o.path, { size: -1, ino: '', mtime: '' });
      saveSent(dir, sent);
      return 'pending';
    }
    if (res.status !== 200 || !body.ok) throw new Error('store-push-' + res.status + '-' + (body.error || ''));
  }
  return 'clean';
}

// ---- commands ----------------------------------------------------------------------------------------------------
async function cmdPull() {
  const dir = arg('dir');
  if (!dir) throw new Error('store-dir-missing');
  const t0 = Date.now();
  // A memory disk left from a desk that could not send everything (no network when it quit): send that first. It is
  // never overwritten while something in it has not reached the server.
  if (fs.existsSync(statePath(dir))) {
    const left = plan(dir, loadSent(dir)).length;
    if (left) {
      say('STORE_LEFTOVER=' + left);
      const r = await flushOnce(dir, loadSent(dir));
      if (r !== 'clean') { say('STORE_PULL_PENDING=' + r); process.exit(4); }
    }
  }
  const res = await post('pull', {});
  if (res.status !== 200 || !/x-tar/.test(res.type)) {
    const body = json(res.body);
    throw new Error('store-pull-' + res.status + '-' + (body.error || ''));
  }
  fs.mkdirSync(dir, { recursive: true });
  // A memory disk's own folders (.fseventsd, .Trashes) stay; everything else is the last pull's and goes.
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIR.test(name)) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  fs.rmSync(path.join(dir, STATE_DIR), { recursive: true, force: true });
  const x = spawnSync(tarBin(), ['-xf', '-', '-C', dir], { input: res.body, maxBuffer: 1 << 30, windowsHide: true });
  if (x.status !== 0) throw new Error('store-untar-' + String(x.stderr || '').slice(0, 200));
  const sent = walk(dir, '', new Map());
  saveSent(dir, sent);
  writeStatus(dir, { state: 'clean', pending: 0 });
  say('STORE_PULL_BYTES=' + res.body.length);
  say('STORE_PULL_FILES=' + sent.size);
  say('STORE_PULL_MS=' + (Date.now() - t0));
}

async function flushOnce(dir, sent) {
  for (let round = 0; round < 4; round++) {
    const ops = plan(dir, sent);
    if (!ops.length) return 'clean';
    const r = await push(dir, sent, ops);
    if (r === 'lost') return 'lost';
  }
  return plan(dir, sent).length ? 'pending' : 'clean';
}

async function cmdFlush() {
  const dir = arg('dir');
  if (!dir) throw new Error('store-dir-missing');
  const r = await flushOnce(dir, loadSent(dir));
  writeStatus(dir, { state: r, pending: r === 'clean' ? 0 : plan(dir, loadSent(dir)).length });
  say('STORE_FLUSH=' + r);
  process.exit(r === 'clean' ? 0 : (r === 'lost' ? 3 : 2));
}

async function cmdSync() {
  const dir = arg('dir');
  if (!dir) throw new Error('store-dir-missing');
  const sent = loadSent(dir);
  fs.writeFileSync(path.join(dir, STATE_DIR, 'sync.pid'), String(process.pid));
  let dirty = true;
  let timer = null;
  let busy = false;
  let stopping = false;
  let backoff = 1000;
  const kick = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(round, QUIET_MS);
  };
  try {
    fs.watch(dir, { recursive: true }, (ev, name) => {
      const n = String(name || '');
      if (n.startsWith(STATE_DIR)) return;
      kick();
    });
  } catch (e) { say('STORE_WATCH_OFF=' + ((e && e.message) || e)); }
  async function round() {
    if (busy || stopping) return;
    if (!dirty) return;
    busy = true;
    dirty = false;
    try {
      const r = await flushOnce(dir, sent);
      if (r === 'lost') {
        writeStatus(dir, { state: 'lost' });
        say('STORE_LOST_SEAT=1');
        stopping = true;
        process.exit(3);
      }
      if (r !== 'clean') dirty = true;
      writeStatus(dir, { state: r, pending: r === 'clean' ? 0 : 1 });
      backoff = 1000;
    } catch (e) {
      dirty = true;
      writeStatus(dir, { state: 'error', error: String((e && e.message) || e).slice(0, 200) });
      say('STORE_PUSH_FAIL=' + ((e && e.message) || e));
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30000);
    } finally {
      busy = false;
      if (dirty && !stopping) setTimeout(round, 50);
    }
  }
  setInterval(() => { dirty = true; round(); }, SCAN_MS);
  const stop = async (why) => {
    if (stopping) return;
    stopping = true;
    say('STORE_SYNC_STOP=' + why);
    const end = Date.now() + 25000;
    while (busy && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    let r = 'pending';
    while (Date.now() < end) {
      try { r = await flushOnce(dir, sent); } catch (e) { r = 'error'; say('STORE_PUSH_FAIL=' + ((e && e.message) || e)); }
      if (r === 'clean' || r === 'lost') break;
      await new Promise((res) => setTimeout(res, 1000));
    }
    writeStatus(dir, { state: r });
    say('STORE_FINAL=' + r);
    try { fs.unlinkSync(path.join(dir, STATE_DIR, 'sync.pid')); } catch { /* */ }
    process.exit(r === 'clean' ? 0 : 2);
  };
  process.on('SIGTERM', () => { stop('signal'); });
  process.on('SIGINT', () => { stop('signal'); });
  say('STORE_SYNC=1');
  round();
}

// company-desk-skills-v1 (server: /company/desk-lease/store/skills): the company's skills as one tar, only when they
// changed (the digest of the last one is kept beside them). Over SMB the same 12 files took 35 s at every open.
//   node desk-store.js skills --out D    D holds company/_skills as the server has it; prints SKILLS_FETCH=same|new
async function cmdSkills() {
  const out = arg('out');
  if (!out) throw new Error('store-out-missing');
  const tagFile = out + '.etag';
  const have = fs.existsSync(out) ? readTrim(tagFile) : '';
  const t0 = Date.now();
  const res = await post('skills', { etag: have });
  if (res.status === 200 && /json/.test(res.type) && json(res.body).same) {
    say('SKILLS_FETCH=same');
    say('SKILLS_FETCH_MS=' + (Date.now() - t0));
    return;
  }
  if (res.status !== 200 || !/x-tar/.test(res.type)) throw new Error('skills-fetch-' + res.status + '-' + (json(res.body).error || ''));
  const next = out + '.next';
  fs.rmSync(next, { recursive: true, force: true });
  fs.mkdirSync(next, { recursive: true });
  const x = spawnSync(tarBin(), ['-xf', '-', '-C', next], { input: res.body, maxBuffer: 1 << 30, windowsHide: true });
  if (x.status !== 0) throw new Error('skills-untar-' + String(x.stderr || '').slice(0, 200));
  fs.rmSync(out, { recursive: true, force: true });
  fs.renameSync(next, out);
  fs.writeFileSync(tagFile, String(res.headers_etag || '') + '\n');
  say('SKILLS_FETCH=new');
  say('SKILLS_FETCH_BYTES=' + res.body.length);
  say('SKILLS_FETCH_MS=' + (Date.now() - t0));
}

// company-wg-desk-v1 (tdh-tunnel, mac-tunnel.sh): the company tunnel's hub (to install with) and this device's address.
//   node desk-store.js tunnel-hub                   TUNNEL_HUB_PUBKEY= / TUNNEL_HUB_ENDPOINT= / TUNNEL_SERVER=
//   node desk-store.js tunnel-enroll --dir D        D/public.key sent; D/enroll/peer.json written; TUNNEL_ADDRESS=
async function cmdTunnelHub() {
  const res = await post('../wg/hub', {}, true);
  const d = json(res.body);
  if (res.status !== 200 || !d.ok) throw new Error('tunnel-hub-' + res.status + '-' + (d.error || ''));
  if (!/^[A-Za-z0-9+/]{43}=$/.test(d.hub_pubkey || '') || !/^\d+\.\d+\.\d+\.\d+:\d+$/.test(d.endpoint || '')) throw new Error('tunnel-hub-bad');
  say('TUNNEL_HUB_PUBKEY=' + d.hub_pubkey);
  say('TUNNEL_HUB_ENDPOINT=' + d.endpoint);
  say('TUNNEL_SERVER=' + (d.server || ''));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(d.lan || '')) say('TUNNEL_LAN=' + d.lan);
}
async function cmdTunnelEnroll() {
  const dir = arg('dir');
  if (!dir) throw new Error('tunnel-dir-missing');
  const pub = readTrim(path.join(dir, 'public.key'));
  if (!/^[A-Za-z0-9+/]{43}=$/.test(pub)) throw new Error('tunnel-no-key');
  const peerFile = path.join(dir, 'enroll', 'peer.json');
  let had = {};
  try { had = JSON.parse(fs.readFileSync(peerFile, 'utf8')); } catch { /* first time */ }
  if (had.pubkey === pub && /^10\.66\.0\.\d+\/32$/.test(had.address || '') && !process.argv.includes('--force')) {
    say('TUNNEL_ADDRESS=' + had.address);
    say('TUNNEL_ENROLL=kept');
    return;
  }
  const res = await post('../wg/enroll', { pubkey: pub }, true);
  const d = json(res.body);
  if (res.status !== 200 || !d.ok || !/^10\.66\.0\.\d+\/32$/.test(d.address || '')) throw new Error('tunnel-enroll-' + res.status + '-' + (d.error || ''));
  const tmp = peerFile + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ address: d.address, pubkey: pub }) + '\n');
  fs.renameSync(tmp, peerFile);
  say('TUNNEL_ADDRESS=' + d.address);
  say('TUNNEL_ENROLL=new');
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'tunnel-hub') return cmdTunnelHub();
  if (cmd === 'tunnel-enroll') return cmdTunnelEnroll();
  if (cmd === 'skills') return cmdSkills();
  if (cmd === 'pull') return cmdPull();
  if (cmd === 'flush') return cmdFlush();
  if (cmd === 'sync') return cmdSync();
  say('usage: desk-store.js pull|sync|flush --dir D');
  process.exit(2);
}

main().catch((e) => {
  say('STORE_ERROR=' + ((e && e.message) || e));
  process.exit(2);
});
