#!/usr/bin/env node
// Prove company-key-models-v1: a vendor reached with a key (DeepSeek here) shows desks its whole
// live list until the admin picks; then exactly the picks, in that order, even after the vendor adds
// a model; picking none again follows the vendor's list, the new model included. Picking needs an
// admin's token. Fake vendor on loopback only. Ends with GW_KEY_MODELS_PROVE_OK=1.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const GW = path.join(__dirname, '..', 'server', 'gw-lite.js');
const fail = (w) => { console.error('GW_KEY_MODELS_PROVE_FAIL ' + w); process.exit(1); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-keymodels-'));
  let ids = ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-embedding'];
  const vendor = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
    });
  });
  await new Promise((r) => vendor.listen(0, '127.0.0.1', r));
  const admin = 'dsh_' + crypto.randomBytes(12).toString('hex');
  const staff = 'dsh_' + crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [{ token: admin, pid: 'p1' }, { token: staff, pid: 'p2' }] }));
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [{ pid: 'p1', login: 'boss', role: 'admin' }, { pid: 'p2', login: 'liu', role: 'employee', dept: 'sales' }] }));
  fs.writeFileSync(path.join(root, 'gateway.env'), 'DEEPSEEK_API_KEY=stand-in-key-0123456789\nDEEPSEEK_BASE_URL=http://127.0.0.1:' + vendor.address().port + '/v1\n');
  const probe = http.createServer(() => {});
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const gw = spawn(process.execPath, [GW], {
    env: Object.assign({}, process.env, {
      TDH_ROOT: root, TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'), TDH_ROSTER: path.join(root, 'roster.json'),
      TDH_USAGE_DIR: path.join(root, 'usage'), TDH_GW_ENV: path.join(root, 'gateway.env'), TDH_CHANNELS: path.join(root, 'channels.json'),
      TDH_XAI_OAUTH: path.join(root, 'none.json'), TDH_GROK_FAST: path.join(root, 'fast.json'), TDH_GW_PORT: String(port),
      TDH_GW_SERVICE_TOKEN_FILE: path.join(root, 'gw-service.token'), TDH_COMPANY_CA: path.join(root, 'ca.crt'),
      TDH_GW_LEGACY: path.join(root, 'legacy.json'), CLIPROXY_AUTH_DIR: path.join(root, 'no-auths'),
      TDH_MODEL_OFFER: path.join(root, 'model-offer.json'), TDH_GW_TRUST_LOOPBACK: '0'
    }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  process.on('exit', () => { try { gw.kill(); } catch {} }); // a failed check (process.exit) still stops the gateway
  await new Promise((resolve, reject) => {
    gw.stdout.on('data', (c) => { if (String(c).indexOf('LISTEN=') >= 0) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway-exited-' + code)));
  });
  const call = (method, p, obj, tok) => new Promise((resolve, reject) => {
    const b = obj ? Buffer.from(JSON.stringify(obj)) : null;
    const h = { authorization: 'Bearer ' + (tok || admin) };
    if (b) { h['content-type'] = 'application/json'; h['content-length'] = b.length; }
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: h }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} resolve({ status: r.statusCode, j }); });
    });
    req.on('error', reject);
    req.end(b || undefined);
  });
  const listed = async () => ((await call('GET', '/v1/company-models')).j.models || []).filter((m) => m.vendor === 'deepseek').map((m) => m.id);
  let got = await listed();
  if (got.join(',') !== 'deepseek-flash,deepseek-v4-pro') fail('before any pick, desks should see every chat model: ' + got);
  let r = await call('POST', '/channels', { action: 'list-models', vendor: 'deepseek' });
  if (r.status !== 200 || r.j.models.map((m) => m.id).join(',') !== 'deepseek-flash,deepseek-v4-pro') fail('list-models: ' + JSON.stringify(r.j));
  r = await call('POST', '/channels', { action: 'apply-models', vendor: 'deepseek', models: ['deepseek-v4-pro', 'not-a-model'] }, staff);
  if (r.status !== 403) fail('an employee could pick the company models');
  r = await call('POST', '/channels', { action: 'apply-models', vendor: 'deepseek', models: ['deepseek-v4-pro', 'not-a-model'] });
  if (r.status !== 200 || r.j.models.map((m) => m.id).join(',') !== 'deepseek-v4-pro') fail('apply-models: ' + JSON.stringify(r.j));
  if ((await call('POST', '/channels', { action: 'picked-models', vendor: 'deepseek' })).j.models.map((m) => m.id).join(',') !== 'deepseek-v4-pro') fail('picked-models');
  got = await listed();
  if (got.join(',') !== 'deepseek-v4-pro') fail('after the pick desks should see only it: ' + got);
  ids = ids.concat(['deepseek-v5']);
  r = await call('POST', '/channels', { action: 'apply-models', vendor: 'deepseek', models: ['deepseek-v4-pro'] });
  got = await listed();
  if (got.join(',') !== 'deepseek-v4-pro') fail('a model the vendor added slipped past the pick: ' + got);
  r = await call('POST', '/channels', { action: 'apply-models', vendor: 'deepseek', models: [] });
  if (r.status !== 200 || r.j.all !== true) fail('clearing the pick: ' + JSON.stringify(r.j));
  got = await listed();
  if (got.join(',') !== 'deepseek-flash,deepseek-v4-pro,deepseek-v5') fail('with no pick the new model should show by itself: ' + got);
  gw.kill(); vendor.close();
  console.log('GW_KEY_MODELS_PROVE_OK=1');
})().catch((e) => fail(String(e && e.message || e)));
