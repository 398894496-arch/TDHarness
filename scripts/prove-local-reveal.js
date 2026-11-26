#!/usr/bin/env node
// Proof for company-local-reveal-v1 and company-server-share-path-v1 (desk/pack/common/desk-hub-relay.js,
// server/site-patches/patch_media_download.py).
//  1. The computer's relay answers POST /_tdh/reveal: a desk path on the share — its own name or the server's folder
//     behind it (/_hub/status "company") — is shown in this computer's file manager (Windows explorer /select on
//     \\<site host>\dsh-company\..., the Mac `open -R` under the mount); a file that is gone shows its nearest folder;
//     anything off the share, without the header, from another origin or by GET is refused.
//  2. The server kernel's sidebar reads \\<host>\dsh-company\... as TDH_COMPANY_LOCAL\... (and only with it set).
// The relay runs with a stub that records the spawn instead of opening a window, and answers /_hub/status itself.
// Ends with LOCAL_REVEAL_PROVE_OK=1.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RELAY = path.join(ROOT, 'desk', 'pack', 'common', 'desk-hub-relay.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-reveal-'));

const STUB = `
const cp = require("child_process"), fs = require("fs"), https = require("https"), { EventEmitter } = require("events"), { Readable } = require("stream");
const plat = process.env.PROVE_PLATFORM;
Object.defineProperty(process, "platform", { value: plat });
cp.spawn = function (cmd, args, o) {
  process.stdout.write("SPAWN " + JSON.stringify({ cmd, args, verbatim: !!(o && o.windowsVerbatimArguments) }) + "\\n");
  return { on() { return this; }, unref() {} };
};
if (plat === "win32") {
  const realStat = fs.stat;
  fs.stat = function (p, cb) {
    if (/^\\\\\\\\tdharness\\.local\\\\dsh-company/.test(p)) {
      if (/gone/.test(p)) return cb(new Error("ENOENT"));
      return cb(null, { isDirectory: () => !/\\.\\w+$/.test(p) });
    }
    return realStat(p, cb);
  };
}
const realReq = https.request;
https.request = function (o, cb) {
  if (String(o.path).endsWith("/_hub/status")) {
    process.stdout.write("HUB " + JSON.stringify({ auth: o.headers.authorization }) + "\\n");
    const r = new EventEmitter();
    r.end = () => cb(Readable.from([Buffer.from(JSON.stringify({ ok: true, company: "D:\\\\dsh\\\\company" }))]));
    r.destroy = () => {};
    return r;
  }
  return realReq.apply(this, arguments);
};
`;
fs.writeFileSync(path.join(tmp, 'stub.cjs'), STUB);
fs.writeFileSync(path.join(tmp, 'tok'), 'tok123\n');

function startRelay(platform, port, env) {
  const p = spawn(process.execPath, ['--require', path.join(tmp, 'stub.cjs'), RELAY, '--site', 'https://tdharness.local:8443',
    '--port', String(port), '--token-file', path.join(tmp, 'tok')], { env: Object.assign({}, process.env, env, { PROVE_PLATFORM: platform }) });
  let out = '';
  p.stdout.on('data', (b) => { out += b; });
  p.stderr.on('data', () => {});
  return {
    lines: () => out.split('\n').filter(Boolean),
    ready: () => new Promise((resolve, reject) => {
      const end = Date.now() + 10000;
      (function wait() { if (out.includes('RELAY_LISTEN=')) resolve(); else if (Date.now() > end) reject(new Error('relay-not-up')); else setTimeout(wait, 50); })();
    }),
    stop: () => p.kill(),
  };
}

function post(port, body, headers, method) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(body === undefined ? '' : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, method: method || 'POST', path: '/_tdh/reveal',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': raw.length }, headers) }, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => { const t = Buffer.concat(c).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, json: j, text: t }); });
    });
    r.on('error', reject);
    r.end(raw);
  });
}
const H = (port) => ({ 'X-TDH-Local': '1', Origin: 'http://127.0.0.1:' + port });
const spawns = (relay) => relay.lines().filter((l) => l.startsWith('SPAWN ')).map((l) => JSON.parse(l.slice(6)));
const settle = () => new Promise((r) => setTimeout(r, 150));

async function windows() {
  const port = 17951;
  const relay = startRelay('win32', port, {});
  await relay.ready();
  try {
    let r = await post(port, { path: '\\\\tdharness.local\\dsh-company\\emp-a\\flipflow-3d-A.png' }, H(port));
    assert.deepStrictEqual(r.json, { tdhLocal: true, ok: true }, 'share-name path');
    r = await post(port, { path: 'D:\\dsh\\company\\emp-a\\三维 模型\\gone.glb' }, H(port));
    assert.deepStrictEqual(r.json, { tdhLocal: true, ok: true }, 'server path, file gone');
    r = await post(port, { path: 'd:/dsh/company/emp-a/b.glb' }, H(port));
    assert.strictEqual(r.json.ok, true, 'server path, forward slashes');
    for (const bad of ['C:\\Windows\\system32\\calc.exe', 'D:\\dsh\\companyX\\a.png', '\\\\tdharness.local\\c$\\Windows',
      '\\\\tdharness.local\\dsh-company\\..\\x', '\\\\tdharness.local\\dsh-company\\emp-a\\a"b.png']) {
      r = await post(port, { path: bad }, H(port));
      assert.deepStrictEqual(r.json, { tdhLocal: true, ok: false, why: 'not-on-share' }, 'refused: ' + bad);
    }
    r = await post(port, { path: '\\\\tdharness.local\\dsh-company\\emp-a\\x.png' }, {});
    assert.strictEqual(r.status, 403, 'no header');
    r = await post(port, { path: '\\\\tdharness.local\\dsh-company\\emp-a\\x.png' }, { 'X-TDH-Local': '1', Origin: 'https://evil.example' });
    assert.strictEqual(r.status, 403, 'other origin');
    r = await post(port, undefined, { 'X-TDH-Local': '1' }, 'GET');
    assert.strictEqual(r.status, 403, 'GET');
    r = await post(port, { path: '\\\\tdharness.local\\dsh-company\\emp-a\\x.png' }, { 'X-TDH-Local': '1', Host: 'evil:' + port });
    assert.strictEqual(r.status, 403, 'other host');
    await settle();
    const s = spawns(relay);
    assert.deepStrictEqual(s, [
      { cmd: 'explorer.exe', args: ['/select,"\\\\tdharness.local\\dsh-company\\emp-a\\flipflow-3d-A.png"'], verbatim: true },
      { cmd: 'explorer.exe', args: ['"\\\\tdharness.local\\dsh-company\\emp-a\\三维 模型"'], verbatim: true },
      { cmd: 'explorer.exe', args: ['/select,"\\\\tdharness.local\\dsh-company\\emp-a\\b.glb"'], verbatim: true },
    ], 'explorer calls');
    assert(relay.lines().some((l) => l === 'HUB {"auth":"Bearer tok123"}'), 'hub asked with the sign-in token');
  } finally { relay.stop(); }
}

async function mac() {
  const port = 17952;
  const mnt = path.join(tmp, 'company');
  fs.mkdirSync(path.join(mnt, 'emp-a'), { recursive: true });
  fs.writeFileSync(path.join(mnt, 'emp-a', 'a.png'), 'x');
  const relay = startRelay('darwin', port, { COMPANY_SMB_MNT: mnt });
  await relay.ready();
  try {
    let r = await post(port, { path: '\\\\tdharness.local\\dsh-company\\emp-a\\a.png' }, H(port));
    assert.strictEqual(r.json.ok, true, 'mac file');
    r = await post(port, { path: '\\\\tdharness.local\\dsh-company\\emp-a\\gone.png' }, H(port));
    assert.strictEqual(r.json.ok, true, 'mac gone file');
    await settle();
    assert.deepStrictEqual(spawns(relay), [
      { cmd: '/usr/bin/open', args: ['-R', path.join(mnt, 'emp-a', 'a.png')], verbatim: false },
      { cmd: '/usr/bin/open', args: [path.join(mnt, 'emp-a')], verbatim: false },
    ], 'open calls');
  } finally { relay.stop(); }
  const off = startRelay('darwin', port + 1, { COMPANY_SMB_MNT: path.join(tmp, 'not-mounted') });
  await off.ready();
  try {
    const r = await post(port + 1, { path: '\\\\tdharness.local\\dsh-company\\emp-a\\a.png' }, H(port + 1));
    assert.deepStrictEqual(r.json, { tdhLocal: true, ok: false, why: 'share-unreachable' }, 'share not mounted');
  } finally { off.stop(); }
}

function serverSharePath() {
  const py = process.env.PROVE_PY || (process.platform === 'win32' ? 'python' : 'python3');
  const src = [
    'function requireAbsolute(path) {',
    '\tif (!isAbsolute(path)) throw new Error("not absolute " + path);',
    '\treturn path;',
    '}',
    'module.exports = requireAbsolute;',
    '',
  ].join('\n');
  const dir = path.join(tmp, 'dsh-better-sidebar', 'lib');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'index.js');
  fs.writeFileSync(f, 'const isAbsolute = require("path").win32.isAbsolute;\n' + src);
  const code = [
    'import sys',
    'sys.path.insert(0, sys.argv[1])',
    'import patch_media_download as m',
    'from pathlib import Path',
    'p = Path(sys.argv[2]); t = p.read_text(encoding="utf-8")',
    't1, h1 = m.patch_sidebar_unc(t)',
    't2, h2 = m.patch_sidebar_unc(t1)',
    'assert h1 == "patched" and h2 == "already" and t2 == t1, (h1, h2)',
    'p.write_text(t1, encoding="utf-8")',
  ].join('\n');
  const r = spawnSync(py, ['-c', code, path.join(ROOT, 'server', 'site-patches'), f], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'patch run: ' + r.stdout + r.stderr);
  delete require.cache[f];
  const saved = process.env.TDH_COMPANY_LOCAL;
  try {
    delete process.env.TDH_COMPANY_LOCAL;
    const req = require(f);
    assert.strictEqual(req('\\\\tdharness.local\\dsh-company\\emp-a\\x.png'), '\\\\tdharness.local\\dsh-company\\emp-a\\x.png', 'no env: unchanged');
    process.env.TDH_COMPANY_LOCAL = 'D:\\dsh\\company';
    assert.strictEqual(req('\\\\tdharness.local\\dsh-company\\emp-a\\x.png'), 'D:\\dsh\\company\\emp-a\\x.png', 'share name');
    assert.strictEqual(req('//tdharness.local/dsh-company/emp-a/x.png'), 'D:\\dsh\\company\\emp-a\\x.png', 'forward slashes');
    assert.strictEqual(req('\\\\TDHARNESS.LOCAL\\DSH-COMPANY'), 'D:\\dsh\\company', 'the share itself');
    assert.strictEqual(req('\\\\tdharness.local\\dsh-companyx\\a'), '\\\\tdharness.local\\dsh-companyx\\a', 'another share');
    assert.strictEqual(req('D:\\dsh\\company\\emp-a\\x.png'), 'D:\\dsh\\company\\emp-a\\x.png', 'server path unchanged');
  } finally {
    if (saved === undefined) delete process.env.TDH_COMPANY_LOCAL; else process.env.TDH_COMPANY_LOCAL = saved;
  }
}

(async () => {
  try {
    await windows();
    await mac();
    serverSharePath();
    console.log('LOCAL_REVEAL_PROVE_OK=1');
  } catch (e) {
    console.log('LOCAL_REVEAL_PROVE_FAIL ' + (e && e.message));
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
