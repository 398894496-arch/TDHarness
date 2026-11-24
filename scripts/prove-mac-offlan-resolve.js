#!/usr/bin/env node
// Proof for company-mac-offlan-resolve-v1 (desk/pack/mac/mac-resolve.js and its callers), on this machine:
// a .local site name the system cannot find (as on a Mac away from the office) is answered with the address a
// stand-in for Tailscale's resolver gives (a UDP DNS server here), for http, fetch and dns.promises alike; other
// names are untouched; the answer is kept (one DNS question for many requests); the system lookup wins when it
// answers in time (the office LAN); the tailnet address in vendor/company-tailnet.txt when Tailscale does not
// answer; the login helper's exit code says why it failed (not reached 3, wrong password 4, too many tries 5,
// anything else 6); start.command, tree-restore.sh and mac-mount-company.sh use it. Needs openssl (a test cert).
// Ends with MAC_OFFLAN_RESOLVE_PROVE_OK=1.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAC = path.join(ROOT, 'desk', 'pack', 'mac');
const RESOLVE = path.join(MAC, 'mac-resolve.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-offlan-'));
const SITE = 'tdh-proof-' + crypto.randomBytes(4).toString('hex') + '.local';

// A stand-in for Tailscale's resolver: A records for SITE -> 127.0.0.1, NXDOMAIN otherwise; counts questions.
let questions = 0;
function dnsServer() {
  const s = dgram.createSocket('udp4');
  s.on('message', (q, rinfo) => {
    questions += 1;
    let i = 12;
    const labels = [];
    while (q[i]) { labels.push(q.slice(i + 1, i + 1 + q[i]).toString()); i += q[i] + 1; }
    const qEnd = i + 5;
    const qtype = q.readUInt16BE(i + 1);
    const hit = labels.join('.').toLowerCase() === SITE && qtype === 1;
    const head = Buffer.alloc(12);
    q.copy(head, 0, 0, 2);
    head.writeUInt16BE(hit ? 0x8180 : 0x8183, 2);
    head.writeUInt16BE(1, 4);
    head.writeUInt16BE(hit ? 1 : 0, 6);
    const parts = [head, q.slice(12, qEnd)];
    if (hit) parts.push(Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]));
    s.send(Buffer.concat(parts), rinfo.port, rinfo.address);
  });
  return new Promise((resolve) => s.bind(0, '127.0.0.1', () => resolve(s)));
}
function closedUdpPort() {
  return new Promise((resolve) => { const s = dgram.createSocket('udp4'); s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function run(cmd, args, env, input) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: Object.assign({}, process.env, env), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (rc) => resolve({ rc, out, err }));
    c.stdin.end(input || '');
  });
}

(async () => {
  const dnsS = await dnsServer();
  const DNS = '127.0.0.1:' + dnsS.address().port;
  const closed = '127.0.0.1:' + (await closedUdpPort());
  const web = http.createServer((q, r) => r.end('desk-ok')).listen(0, '127.0.0.1');
  await new Promise((r) => web.on('listening', r));
  const WEB = web.address().port;
  const STATE = path.join(T, 'site-addr.json');
  const base = { TDH_RESOLVE_SITE: SITE, TDH_TS_DNS: DNS, TDH_RESOLVE_LAN_MS: '300', TDH_RESOLVE_STATE: STATE, NODE_OPTIONS: '--require "' + RESOLVE + '"' };
  try {
    // 1. Preloaded: the site name reaches the server over the "tailnet" for http, fetch and the promise APIs.
    const child = `
      const dns = require('dns'), http = require('http'), util = require('util');
      const url = 'http://${SITE}:${WEB}/';
      const get = () => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res(b)); }).on('error', rej));
      (async () => {
        const out = {};
        out.http = await get();
        out.http2 = await get();
        out.fetch = await (await fetch(url)).text();
        out.promises = await dns.promises.lookup('${SITE}');
        out.promisify = await util.promisify(dns.lookup)('${SITE}', { all: true });
        out.other = (await dns.promises.lookup('localhost')).address;
        console.log(JSON.stringify(out));
      })().catch((e) => { console.log(JSON.stringify({ err: e.code || e.message })); });`;
    const a = await run(process.execPath, ['-e', child], base);
    const o = JSON.parse(a.out.trim().split('\n').pop() || '{}');
    assert.strictEqual(o.http, 'desk-ok', 'http reaches the server: ' + a.out + a.err);
    assert.strictEqual(o.http2, 'desk-ok');
    assert.strictEqual(o.fetch, 'desk-ok', 'fetch reaches the server: ' + a.out);
    assert.deepStrictEqual(o.promises, { address: '127.0.0.1', family: 4 }, 'dns.promises.lookup');
    assert.deepStrictEqual(o.promisify, [{ address: '127.0.0.1', family: 4 }], 'util.promisify(dns.lookup) keeps its shape');
    assert.ok(/^(127\.0\.0\.1|::1)$/.test(o.other), 'other names are untouched: ' + o.other);
    assert.strictEqual(questions, 1, 'one DNS question for all of them (the answer is kept): ' + questions);
    const shared = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    assert.ok(shared.addr === '127.0.0.1' && shared.how === 'tailnet' && shared.site === SITE, 'the answer is shared with the next node: ' + JSON.stringify(shared));
    const t0 = Date.now();
    const again = await run(process.execPath, ['-e', child], base);
    assert.ok(/desk-ok/.test(again.out) && questions === 1 && Date.now() - t0 < 4000, 'a node started right after takes it from there, no lookup, no wait: ' + (Date.now() - t0) + 'ms ' + again.out);
    fs.rmSync(STATE);

    // 2. The CLI the shell scripts use.
    const t1 = Date.now();
    const how = await run(process.execPath, [RESOLVE, '--how'], Object.assign({}, base, { NODE_OPTIONS: '' }));
    assert.strictEqual(how.out.trim(), '127.0.0.1 tailnet', '--how: ' + how.out + how.err);
    assert.ok(Date.now() - t1 < 4000, '--how exits at once, not after the system lookup: ' + (Date.now() - t1) + 'ms');
    fs.rmSync(STATE);
    const vdir = path.join(T, 'pack');
    fs.mkdirSync(path.join(vdir, 'vendor'), { recursive: true });
    fs.copyFileSync(RESOLVE, path.join(vdir, 'mac-resolve.js'));
    fs.writeFileSync(path.join(vdir, 'vendor', 'company-tailnet.txt'), 'ip=100.64.0.9\nnode=tdharness\n');
    const tn = await run(process.execPath, [path.join(vdir, 'mac-resolve.js'), '--tailnet'], Object.assign({}, base, { NODE_OPTIONS: '', TDH_TS_DNS: closed }));
    assert.strictEqual(tn.out.trim(), '100.64.0.9', 'Tailscale silent: the tailnet address from vendor/: ' + tn.out + tn.err);
    const tn2 = await run(process.execPath, [path.join(vdir, 'mac-resolve.js'), '--tailnet'], Object.assign({}, base, { NODE_OPTIONS: '' }));
    assert.strictEqual(tn2.out.trim(), '127.0.0.1', 'Tailscale answers first: ' + tn2.out);

    // 3. Which answer wins (find, with a stand-in for the system lookup).
    process.env.TDH_RESOLVE_SITE = SITE;
    process.env.TDH_TS_DNS = DNS;
    process.env.TDH_RESOLVE_LAN_MS = '300';
    const R = require(RESOLVE);
    const find = (lookup) => new Promise((res) => R.find(lookup, (addr, h) => res(addr + ' ' + h)));
    const lan = (ms, addr) => (h, o, cb) => setTimeout(() => (addr ? cb(null, addr, 4) : cb(Object.assign(new Error('nf'), { code: 'ENOTFOUND' }))), ms);
    assert.strictEqual(await find(lan(50, '192.168.1.80')), '192.168.1.80 lan', 'the office LAN answers in time: LAN');
    assert.strictEqual(await find(lan(1200, '192.168.1.80')), '127.0.0.1 tailnet', 'the system lookup hangs (multicast DNS away from the office): tailnet');
    assert.strictEqual(await find(lan(10, '')), '127.0.0.1 tailnet', 'the system lookup fails: tailnet');

    // 4. The login helper says why.
    const key = path.join(T, 'k.pem');
    const crt = path.join(T, 'c.pem');
    const ossl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=' + SITE], { encoding: 'utf8' });
    assert.strictEqual(ossl.status, 0, 'openssl: ' + ossl.stderr);
    const login = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (q, r) => {
      let b = '';
      q.on('data', (d) => { b += d; });
      q.on('end', () => {
        const u = (JSON.parse(b || '{}').username || '');
        const send = (code, obj) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(obj)); };
        if (u === 'ok') send(200, { ok: true, gw_token: 'tok-test', login: 'ok' });
        else if (u === 'many') send(429, { ok: false, error: 'too-many-attempts' });
        else if (u === 'odd') send(502, { ok: false });
        else send(401, { ok: false, error: 'bad-login' });
      });
    }).listen(0, '127.0.0.1');
    await new Promise((r) => login.on('listening', r));
    const LP = login.address().port;
    const tok = path.join(T, 'rc8', 'gw.token');
    const tryLogin = (user, extra) => run(process.execPath, [path.join(MAC, 'mac-company-login.js')], Object.assign({}, base, {
      HOME: T, LOGIN_USER: user, LOGIN_PASS: 'pw', LOGIN_URL: 'https://' + SITE + ':' + LP + '/company/login', TOKFILE: tok,
    }, extra || {}));
    const ok = await tryLogin('ok');
    assert.strictEqual(ok.rc, 0, 'login over the "tailnet": ' + ok.out + ok.err);
    assert.strictEqual(fs.readFileSync(tok, 'utf8').trim(), 'tok-test');
    assert.strictEqual((await tryLogin('bad')).rc, 4, 'wrong password: 4');
    assert.strictEqual((await tryLogin('many')).rc, 5, 'too many tries: 5');
    assert.strictEqual((await tryLogin('odd')).rc, 6, 'the server answered something else: 6');
    fs.rmSync(STATE, { force: true });
    const nowhere = await tryLogin('ok', { TDH_TS_DNS: closed, TDH_TS_IP: '', TDH_RESOLVE_STATE: path.join(T, 'none.json') });
    assert.strictEqual(nowhere.rc, 3, 'the name not found at all: 3 (not "wrong password"): ' + nowhere.err);
    const refused = await tryLogin('ok', { LOGIN_URL: 'https://' + SITE + ':1/company/login' });
    assert.strictEqual(refused.rc, 3, 'no connection: 3: ' + refused.err);
    login.close();

    // 5. The shell side.
    const sc = fs.readFileSync(path.join(MAC, 'start.command'), 'utf8');
    assert.ok(sc.indexOf('export NODE_OPTIONS="--require') > 0 && sc.indexOf('export NODE_OPTIONS="--require') < sc.indexOf('pack-update-check.js'), 'start.command preloads it before the update check');
    // company-login-sms-v1: login_why says it, for a password and a text code alike.
    assert.ok(/3\) LOGIN_WHY="连不上公司服务器/.test(sc) && /login_why "账号或密码不对/.test(sc) && /5\) LOGIN_WHY="\$\{LOGIN_HINT:-登录失败次数太多/.test(sc), 'start.command says why');
    assert.ok(!/display dialog "账号或密码不对，再试一次。"/.test(sc), 'no more fixed "wrong password" after every failure');
    const tr = fs.readFileSync(path.join(MAC, 'tree-restore.sh'), 'utf8');
    assert.ok(/curl --resolve "\{\{TDH_HOST\}\}:8443:\$SITE_ADDR"/.test(tr) && (tr.match(/mac-resolve\.js/g) || []).length >= 4, 'tree-restore.sh: curl gets the address, and the file is updated');
    const mm = fs.readFileSync(path.join(MAC, 'mac-mount-company.sh'), 'utf8');
    assert.ok(/mac-resolve\.js" --tailnet/.test(mm) && /mac-resolve\.js" --how/.test(mm) && !/\*'\{\{TDH_HOST\}\}'\*/.test(mm), 'mac-mount-company.sh: the tailnet address, asked once');
    for (const f of ['start.command', 'tree-restore.sh', 'mac-mount-company.sh']) {
      assert.strictEqual(spawnSync('bash', ['-n', path.join(MAC, f)]).status, 0, f + ' parses');
    }
    console.log('MAC_OFFLAN_RESOLVE_PROVE_OK=1');
  } catch (e) {
    console.error('MAC_OFFLAN_RESOLVE_PROVE_FAIL ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    dnsS.close();
    web.close();
    fs.rmSync(T, { recursive: true, force: true });
    setTimeout(() => process.exit(process.exitCode || 0), 50);
  }
})();
