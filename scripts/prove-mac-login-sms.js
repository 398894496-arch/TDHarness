#!/usr/bin/env node
// Proof for the Mac side of company-login-sms-v1 and company-login-remember-v1 (desk/pack/mac/mac-company-login.js,
// start.command, the desk's 退出登录 in company-shell), against the real people service (server/people-api.py on a
// throwaway folder, codes to a test outbox) behind a stand-in HTTPS front (as Caddy is):
// - a password sign-in asks to be remembered: the desk token and remember.token (0600) are written, with this Mac's
//   device.id (made once, kept);
// - resume with remember.token signs in again with nothing typed; after 退出登录 (forget) the file is gone, the
//   server has forgotten it, and resume says so (exit 8);
// - 获取验证码 (sms-code) then the code (sms): signed in, last.phone kept; a wrong code: exit 4 with the server's
//   words (HINT=); LOGIN_REMEMBER=0: no remember.token;
// - start.command tries the remembered sign-in first, then offers 手机验证码 / 账号密码; the desk's 退出登录 calls
//   forgetRemembered before it clears the sign-in files.
// Needs python3 and openssl. Ends with MAC_LOGIN_SMS_PROVE_OK=1.
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
    const base = { HOME: path.join(T, 'home'), LOGIN_URL: 'https://127.0.0.1:' + front.address().port + '/company/login', TOKFILE: tok };
    const login = (extra) => run(process.execPath, [path.join(MAC, 'mac-company-login.js')], Object.assign({}, base, extra));
    const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);

    // A password sign-in, remembered.
    let r = await login({ LOGIN_MODE: 'password', LOGIN_USER: 'lfh', LOGIN_PASS: 'lfh-pass-123' });
    assert.strictEqual(r.rc, 0, 'password: ' + r.out + r.err);
    assert.ok(/^tdhr_[0-9a-f]{32}$/.test(fs.readFileSync(remember, 'utf8').trim()) && mode(remember) === '600', 'remember.token, 0600');
    const dev = fs.readFileSync(path.join(rc8, 'device.id'), 'utf8').trim();
    assert.ok(/^dev-[0-9a-f]{16}$/.test(dev) && mode(path.join(rc8, 'device.id')) === '600', 'this Mac\'s device id: ' + dev);
    const gw = fs.readFileSync(tok, 'utf8').trim();

    // The next open: nothing typed.
    fs.unlinkSync(tok);
    r = await login({ LOGIN_MODE: 'resume' });
    assert.strictEqual(r.rc, 0, 'resume: ' + r.out + r.err);
    assert.strictEqual(fs.readFileSync(tok, 'utf8').trim(), gw, 'the same desk token');
    assert.strictEqual(fs.readFileSync(path.join(rc8, 'device.id'), 'utf8').trim(), dev, 'the same device id');
    const kept = fs.readFileSync(remember, 'utf8').trim();

    // 退出登录 through the desk's own code (company-shell forgetRemembered), then resume: over.
    const shell = await import(path.join(ROOT, 'desk', 'plugins', 'company-shell', 'lib', 'index.js'));
    const forgot = await shell.forgetRemembered('https://127.0.0.1:' + front.address().port, rc8);
    assert.ok(forgot === true && !fs.existsSync(remember), '退出登录: forgotten on the server, the file gone');
    fs.writeFileSync(remember, kept + '\n', { mode: 0o600 });
    r = await login({ LOGIN_MODE: 'resume' });
    assert.strictEqual(r.rc, 8, 'a forgotten token: 8 (sign in again): ' + r.out + r.err);
    assert.ok(!fs.existsSync(remember), 'and the file goes');
    r = await login({ LOGIN_MODE: 'resume' });
    assert.strictEqual(r.rc, 8, 'no token at all: 8');

    // A text code.
    r = await login({ LOGIN_MODE: 'sms-code', LOGIN_PHONE: '138 0013 8000' });
    assert.ok(r.rc === 0 && /SMS_SENT=1/.test(r.out), 'sms-code: ' + r.out + r.err);
    const code = fs.readFileSync(outbox, 'utf8').trim().split(/\s+/)[1];
    r = await login({ LOGIN_MODE: 'sms', LOGIN_PHONE: '13800138000', LOGIN_CODE: code === '000000' ? '111111' : '000000' });
    assert.ok(r.rc === 4 && /HINT=验证码不对或已过期/.test(r.out), 'a wrong code: 4 with the server\'s words: ' + r.out);
    r = await login({ LOGIN_MODE: 'sms', LOGIN_PHONE: '13800138000', LOGIN_CODE: code });
    assert.ok(r.rc === 0 && /LOGIN_OK=lfh/.test(r.out), 'the code: signed in: ' + r.out + r.err);
    assert.ok(fs.existsSync(remember) && fs.readFileSync(path.join(rc8, 'last.phone'), 'utf8').trim() === '13800138000', 'remembered; the phone kept for next time');
    fs.unlinkSync(remember);
    r = await login({ LOGIN_MODE: 'password', LOGIN_USER: 'lfh', LOGIN_PASS: 'lfh-pass-123', LOGIN_REMEMBER: '0' });
    assert.ok(r.rc === 0 && !fs.existsSync(remember), 'LOGIN_REMEMBER=0: not remembered');
    assert.ok(seen.includes('/company/login/sms-code') && seen.includes('/company/login/sms') && seen.includes('/company/login/resume') && seen.includes('/company/login/forget'),
      'the routes under /company/login: ' + seen.join(' '));
    front.close();
  } finally {
    api.kill();
  }

  // The shell side.
  const sc = fs.readFileSync(path.join(MAC, 'start.command'), 'utf8');
  const i = sc.indexOf('if [ -f "$HOME/.dsh-company-rc8/remember.token" ]; then');
  assert.ok(i > 0 && i < sc.indexOf('buttons {"取消", "账号密码", "手机验证码"} default button "手机验证码"'), 'start.command: the remembered sign-in first, then 手机验证码 / 账号密码');
  assert.ok(sc.indexOf('export LOGIN_MODE=sms-code LOGIN_PHONE=') > 0 && sc.indexOf('export LOGIN_MODE=sms LOGIN_CODE=') > 0 && sc.indexOf('export LOGIN_MODE=password LOGIN_USER=') > 0,
    'start.command: the three ways in');
  const idx = fs.readFileSync(path.join(ROOT, 'desk', 'plugins', 'company-shell', 'lib', 'index.js'), 'utf8');
  assert.ok(/await forgetRemembered\(\);\s*clearLoginFiles\(\);/.test(idx), 'the desk\'s 退出登录 forgets the remembered sign-in first');
  const swift = fs.readFileSync(path.join(ROOT, 'desk', 'mac-app', 'src', 'CompanyDesk.release.swift'), 'utf8');
  assert.ok(/for name in \["gw.token", "smb.pass", "smb.user", "login.role", "login.name"\]/.test(swift), 'quitting the app keeps remember.token (only the sign-in files go)');
  const cs = fs.readFileSync(path.join(ROOT, 'server', 'AppHost.cs'), 'utf8');
  assert.ok(/ProtectedData\.Protect\(Encoding\.UTF8\.GetBytes\(token\), RememberSalt, DataProtectionScope\.CurrentUser\)/.test(cs)
    && /AppHost\.ForgetRemember\(true\);\s*AppHost\.ClearLogin\(\);/.test(cs) && /if \(!IsDisposed && _web == null\) AutoResume\(\);/.test(cs),
    'Windows: the token encrypted for this account, forgotten on 退出登录, used at open');
  fs.rmSync(T, { recursive: true, force: true });
  console.log('MAC_LOGIN_SMS_PROVE_OK=1');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
