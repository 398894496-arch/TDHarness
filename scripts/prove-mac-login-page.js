#!/usr/bin/env node
// Proof for company-login-page-v1 on the Mac (desk/pack/mac/mac-login-page.js, desk/pack/common/login.html,
// start.command, the shell's desk-boot.status "login"), against the real people service behind a stand-in HTTPS
// front (as prove-mac-login-sms.js):
// - the page starts on 127.0.0.1 at a random path, says where in desk-login.url (0600) and sets the status to "login";
//   another path or another Host name gets nothing;
// - hello offers the last account and phone; 获取验证码, a wrong code (the server's words), the right code: signed in
//   (gw.token, remember.token), the page exits 0, the status goes back to "starting", desk-login.url is gone;
// - a wrong password says so and stays; a number not in the roster gets the server's words, no code;
// - the window closing (status "quit") ends the page with 2;
// - start.command runs the page only for a shell that asks for it and keeps the dialogs for any other.
// Needs python3 and openssl. Ends with MAC_LOGIN_PAGE_PROVE_OK=1.
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAC = path.join(ROOT, 'desk', 'pack', 'mac');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-maclogin-'));

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (rc) => resolve({ rc, out, err }));
  });
}
function freePort() {
  return new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
}
function post(port, p, body, token) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const q = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'content-length': data.length },
      token ? { authorization: 'Bearer ' + token } : {}) }, (r) => {
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(Buffer.concat(c).toString() || '{}') }));
    });
    q.end(data);
  });
}

(async () => {
  // The people service.
  const root = path.join(T, 'srv');
  const rt = path.join(root, 'runtime');
  fs.mkdirSync(path.join(rt, 'caddy'), { recursive: true });
  fs.writeFileSync(path.join(rt, 'roster.json'), JSON.stringify({ owner: 'test', depts: [{ id: 'company', name: '公司' }], people: [
    { login: 'tdh', role: 'admin', dept: 'company', status: 'active', pid: 'p-seed' },
    { login: 'lfh', name: '梁风禾', role: 'employee', dept: 'company', status: 'active', pid: 'p-lfh', personal: path.join(root, 'company', 'emp-lfh'),
      org: 'D:\\dsh\\company' },
  ] }));
  fs.writeFileSync(path.join(rt, 'caddy', 'PASSWORDS.txt'), 'tdh:seed-pass-123\nlfh:lfh-pass-123\n');
  const outbox = path.join(T, 'outbox.txt');
  const port = await freePort();
  const api = spawn('python3', [path.join(ROOT, 'server', 'people-api.py')], { env: Object.assign({}, process.env, {
    TDH_ROOT: root, TDH_PEOPLE_PORT: String(port), DSH_LEASE_DIR: path.join(rt, 'lease'), TDH_SMB_LEDGER: path.join(T, 'smb.jsonl'),
    TDH_SMS_TEST_OUTBOX: outbox, TDH_CHAT_VOICE: '0', TDH_CHAT_CALL: '0' }), stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) {
      const up = await new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); r(true); }); s.on('error', () => r(false)); });
      if (up) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const admin = (await post(port, '/company/login', { username: 'tdh', password: 'seed-pass-123' })).body.gw_token;
    assert.ok(admin, 'the admin signs in');
    assert.strictEqual((await post(port, '/company/people', { action: 'set', login: 'lfh', phone: '13800138000' }, admin)).status, 200);

    // An HTTPS front, as Caddy is.
    const key = path.join(T, 'k.pem');
    const crt = path.join(T, 'c.pem');
    const ossl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=127.0.0.1'], { encoding: 'utf8' });
    assert.strictEqual(ossl.status, 0, 'openssl: ' + ossl.stderr);
    const seen = [];
    const front = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (q, r) => {
      const c = [];
      q.on('data', (d) => c.push(d));
      q.on('end', () => {
        seen.push(q.url);
        const body = Buffer.concat(c);
        const up = http.request({ host: '127.0.0.1', port, path: q.url, method: q.method, headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-forwarded-for': '10.1.1.1' } }, (u) => {
          r.writeHead(u.statusCode, { 'content-type': 'application/json' });
          u.pipe(r);
        });
        up.end(body);
      });
    }).listen(0, '127.0.0.1');
    await new Promise((r) => front.on('listening', r));
    const rc8 = path.join(T, 'home', '.dsh-company-rc8');
    const tok = path.join(rc8, 'gw.token');
    const remember = path.join(rc8, 'remember.token');
    const home = path.join(T, 'home');
    const base = { HOME: home, LOGIN_URL: 'https://127.0.0.1:' + front.address().port + '/company/login', TOKFILE: tok };
    fs.mkdirSync(rc8, { recursive: true });
    fs.writeFileSync(path.join(rc8, 'last.login'), 'lfh\n');
    const urlFile = path.join(rc8, 'desk-login.url');
    const statusFile = path.join(rc8, 'desk-boot.status');

    function startPage() {
      const c = spawn(process.execPath, [path.join(MAC, 'mac-login-page.js')], { env: Object.assign({}, process.env, base), stdio: ['ignore', 'pipe', 'pipe'] });
      const done = new Promise((r) => c.on('exit', (rc) => r(rc)));
      return { c, done };
    }
    async function waitFor(fn, what) {
      for (let i = 0; i < 100; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
      throw new Error('timed out: ' + what);
    }
    function ask(url, opts) {
      return new Promise((resolve) => {
        const u = new URL(url);
        const data = opts && opts.body ? Buffer.from(JSON.stringify(opts.body)) : null;
        const q = http.request({ host: '127.0.0.1', port: u.port, path: u.pathname, method: opts && opts.body ? 'POST' : 'GET',
          headers: Object.assign({ host: (opts && opts.host) || u.host }, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) }, (r) => {
          const c = [];
          r.on('data', (d) => c.push(d));
          r.on('end', () => resolve({ status: r.statusCode, text: Buffer.concat(c).toString(), headers: r.headers }));
        });
        q.end(data || undefined);
      });
    }
    const api = async (url, step, body) => { const r = await ask(url + 'api/' + step, { body: body || {} }); return JSON.parse(r.text); };

    // 1. Up, where the shell looks.
    let P = startPage();
    const url = await waitFor(() => { try { return fs.readFileSync(urlFile, 'utf8').trim(); } catch { return ''; } }, 'desk-login.url');
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/, 'a random path on loopback');
    assert.strictEqual(fs.statSync(urlFile).mode & 0o777, 0o600, 'only this account reads where');
    assert.strictEqual(fs.readFileSync(statusFile, 'utf8').trim(), 'login', 'the shell is told to show it');
    const pageRes = await ask(url);
    assert.strictEqual(pageRes.status, 200);
    assert.ok(pageRes.text.includes('company-login-page-v1') && pageRes.text.includes('手机验证码'), 'login.html');
    assert.match(String(pageRes.headers['content-security-policy']), /default-src 'none'/);
    const other = new URL(url);
    assert.strictEqual((await ask('http://127.0.0.1:' + other.port + '/')).status, 404, 'no page without the path');
    assert.strictEqual((await ask(url, { host: 'evil.example:' + other.port })).status, 404, 'no page by another name');

    // 2. hello, a code, a wrong code, the right one.
    const hello = await api(url, 'hello');
    assert.strictEqual(hello.lastLogin, 'lfh', 'the last account');
    assert.strictEqual(hello.mode, 'pwd', 'no phone kept yet: 账号密码 first');
    const notListed = await api(url, 'sms-code', { phone: '13900139000' });
    assert.strictEqual(notListed.ok, false);
    assert.ok(/花名册|登记/.test(notListed.msg), 'a number not in the roster: the server says so (' + notListed.msg + ')');
    const sent = await api(url, 'sms-code', { phone: '13800138000' });
    assert.deepStrictEqual(sent, { ok: true }, 'the code is sent');
    const code = fs.readFileSync(outbox, 'utf8').trim().split(/\n/).pop().split(/\s+/)[1];
    const wrong = await api(url, 'sms', { phone: '13800138000', code: code === '000000' ? '111111' : '000000', remember: true });
    assert.strictEqual(wrong.ok, false);
    assert.ok(wrong.msg, 'a wrong code: words to show');
    assert.ok(!fs.existsSync(tok), 'not signed in yet');
    const bad = await api(url, 'password', { user: 'lfh', pass: 'not-it', remember: true });
    assert.strictEqual(bad.ok, false);
    assert.ok(/不对/.test(bad.msg), 'a wrong password says so');
    const right = await api(url, 'sms', { phone: '13800138000', code, remember: true });
    assert.deepStrictEqual(right, { ok: true }, 'signed in');
    assert.strictEqual(await P.done, 0, 'the page ends: signed in');
    assert.ok(fs.readFileSync(tok, 'utf8').trim(), 'the desk token');
    assert.ok(/^tdhr_[0-9a-f]{32}$/.test(fs.readFileSync(remember, 'utf8').trim()), '30 days on this Mac');
    assert.strictEqual(fs.readFileSync(path.join(rc8, 'last.phone'), 'utf8').trim(), '13800138000');
    assert.ok(!fs.existsSync(urlFile), 'where it was is gone');
    assert.strictEqual(fs.readFileSync(statusFile, 'utf8').trim(), 'starting', 'back to the shell\'s own words');

    // 3. A password sign-in; then the window closing.
    fs.unlinkSync(tok);
    P = startPage();
    const url2 = await waitFor(() => { try { return fs.readFileSync(urlFile, 'utf8').trim(); } catch { return ''; } }, 'second page');
    assert.notStrictEqual(url2, url, 'a new path each time');
    assert.strictEqual((await api(url2, 'hello')).mode, 'sms', 'a phone kept: 手机验证码 first');
    assert.deepStrictEqual(await api(url2, 'password', { user: 'lfh', pass: 'lfh-pass-123', remember: false }), { ok: true });
    assert.strictEqual(await P.done, 0);
    assert.ok(fs.existsSync(tok), 'signed in with the password');
    P = startPage();
    await waitFor(() => fs.existsSync(urlFile), 'third page');
    fs.writeFileSync(statusFile, 'quit\n');
    assert.strictEqual(await P.done, 2, 'the window closed: the page ends with 2');
    assert.ok(!fs.existsSync(urlFile));

    // 4. start.command: the page for a shell that shows it, the dialogs for any other; the shell asks and shows.
    const sc = fs.readFileSync(path.join(MAC, 'start.command'), 'utf8');
    assert.match(sc, /if \[ "\$LOGIN_OK" != 1 \] && \[ "\$\{TDH_SHELL_LOGIN_PAGE:-\}" = 1 \] && \[ -f "\$ROOT\/mac-login-page\.js" \]/, 'the page only when the shell asks');
    assert.ok(sc.indexOf('mac-login-page.js" || PAGE_RC') < sc.indexOf('display dialog "登录 TDHarness"'), 'the dialogs stay, after it');
    const sw = fs.readFileSync(path.join(ROOT, 'desk', 'mac-app', 'src', 'CompanyDesk.release.swift'), 'utf8');
    assert.ok(sw.includes('env["TDH_SHELL_LOGIN_PAGE"] = "1"') && sw.includes('if boot == "login"') && sw.includes('desk-login.url'), 'the shell shows the page');
    assert.ok(/if Self\.readBootStatus\(\) == "login" \{ Self\.writeBootStatus\("quit"\) \}/.test(sw), 'closing the window ends the page');
    // 5. Windows: the same page in WebView2 over the native sign-in; every step is still the native one.
    const cs = fs.readFileSync(path.join(ROOT, 'server', 'AppHost.cs'), 'utf8');
    assert.ok(cs.includes('Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "login.html")') && cs.includes('NavigateToString(html)'), 'Win shows login.html');
    assert.ok(/if \(DeskPrereq\.WebView2Version\(\)\.Length == 0\) return;/.test(cs), 'no WebView2: the native sign-in stays');
    assert.ok(/SendCode\(\);[\s\S]{0,120}验证码已发送/.test(cs) && /_remember\.Checked = remember;[\s\S]{0,80}SignIn\(\);/.test(cs), 'the page presses the native steps');
    assert.ok(/_err\.TextChanged \+= delegate \{ PushLoginState\(\); \};/.test(cs), 'the native status line reaches the page');
    assert.strictEqual((cs.match(/_login\.BringToFront\(\);\n\s*ShowLoginSurface\(\);/g) || []).length, 2, 'seat lost and 退出登录: the page again');
    assert.ok(fs.existsSync(path.join(ROOT, 'desk', 'pack', 'common', 'login.html')), 'one page, in both packs');
    console.log('MAC_LOGIN_PAGE_PROVE_OK=1');
  } finally {
    try { api.kill(); } catch { /* gone */ }
  }
  fs.rmSync(T, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
