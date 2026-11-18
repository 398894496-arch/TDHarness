#!/usr/bin/env node
'use strict';

// Behavior proof: without a Grok login, the company image door uses the server's GPT route
// (OPENAI_API_KEY, OPENAI_BASE_URL), text-to-image as JSON and edits as multipart. gpt-6 and later are offered to desks as seeing
// pictures, and VISION_MODELS adds ids a site has checked itself. Stand-in vendor, no real key.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const GW = path.join(__dirname, '..', 'server', 'gw-lite.js');
const { gptSize } = require(path.join(__dirname, '..', 'server', 'gw-media.js'));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');

function listen(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}
async function freePort() { const s = await listen(() => {}); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }

function call(port, method, url, token, body) {
  return new Promise((resolve, reject) => {
    const raw = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = { authorization: 'Bearer ' + token };
    if (raw) { h['content-type'] = 'application/json'; h['content-length'] = raw.length; }
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: h }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let o = null; try { o = JSON.parse(t); } catch (e) { o = t; } resolve({ status: r.statusCode, obj: o }); });
    });
    req.on('error', reject);
    req.end(raw || undefined);
  });
}

async function main() {
  assert.equal(gptSize('16:9'), '1536x1024');
  assert.equal(gptSize('9:16'), '1024x1536');
  assert.equal(gptSize('1:1'), '1024x1024');
  assert.equal(gptSize(''), '1024x1024');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-gpt-media-'));
  const token = 'dsh_' + crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [{ pid: 'p1', login: 'amy', role: 'employee', status: 'active' }] }));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [{ pid: 'p1', token, revoked_at: '' }] }));

  const seen = [];
  const vendor = await listen((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      seen.push({ url: req.url, auth: req.headers.authorization || '', type: String(req.headers['content-type'] || ''), raw });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: ['gpt-6.2-sol', 'gpt-5.6-terra', 'gpt-image-2', 'site-checked-model', 'plain-text-model'].map((id) => ({ id })) }));
        return;
      }
      if (req.url === '/v1/images/generations' || req.url === '/v1/images/edits') {
        res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  const base = 'http://127.0.0.1:' + vendor.address().port + '/v1';
  fs.writeFileSync(path.join(root, 'gateway.env'),
    'OPENAI_API_KEY=stand-in-sub-key\nOPENAI_BASE_URL=' + base + '\nVISION_MODELS=site-checked-model\n');

  const port = await freePort();
  const gw = spawn(process.execPath, [GW], {
    env: Object.assign({}, process.env, {
      TDH_ROOT: root,
      TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'),
      TDH_ROSTER: path.join(root, 'roster.json'),
      TDH_USAGE_DIR: path.join(root, 'usage'),
      TDH_GW_ENV: path.join(root, 'gateway.env'),
      TDH_CHANNELS: path.join(root, 'channels.json'),
      TDH_XAI_OAUTH: path.join(root, 'no-xai-login.json'),
      TDH_GROK_FAST: path.join(root, 'grok-fast.json'),
      TDH_GW_PORT: String(port),
      TDH_GW_SERVICE_TOKEN_FILE: path.join(root, 'gw-service.token'),
      TDH_COMPANY_CA: path.join(root, 'company-ca.crt'),
      TDH_GW_LEGACY: path.join(root, 'gw-legacy.json')
    }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve, reject) => {
    gw.stdout.on('data', (c) => { if (String(c).indexOf('LISTEN=') >= 0) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway-exited-' + code)));
  });
  try {
    // Which models desks may pick, and which of them take pictures.
    let r = await call(port, 'GET', '/v1/company-models', token);
    assert.equal(r.status, 200, JSON.stringify(r.obj));
    const by = Object.fromEntries(r.obj.models.map((m) => [m.id, m]));
    assert.equal(by['gpt-6.2-sol'].image, true, 'gpt-6 takes pictures');
    assert.equal(by['gpt-5.6-terra'].image, true, 'gpt-5 takes pictures');
    assert.equal(by['site-checked-model'].image, true, 'VISION_MODELS adds a model');
    assert.equal(by['plain-text-model'].image, false, 'an unknown model stays text only');
    assert.equal(by['gpt-image-2'], undefined, 'the image model is not offered as a chat model');

    // Text to image through the GPT route.
    seen.length = 0;
    r = await call(port, 'POST', '/images', token, { prompt: 'a cat', n: 1, aspect_ratio: '16:9' });
    assert.equal(r.status, 200, JSON.stringify(r.obj));
    assert.equal(r.obj.model, 'gpt-image-2');
    assert.equal(r.obj.files.length, 1);
    assert.equal(r.obj.files[0].mime, 'image/png');
    const gen = seen.find((s) => s.url === '/v1/images/generations');
    assert.ok(gen, 'generation reached the GPT route');
    assert.equal(gen.auth, 'Bearer stand-in-sub-key', 'the server key is used, never the desk token');
    const gj = JSON.parse(gen.raw.toString('utf8'));
    assert.equal(gj.model, 'gpt-image-2');
    assert.equal(gj.size, '1536x1024');

    // Edit an existing picture: multipart with the image as a file.
    seen.length = 0;
    r = await call(port, 'POST', '/images', token, { prompt: 'add a hat', image: { url: 'data:image/png;base64,' + PNG.toString('base64') } });
    assert.equal(r.status, 200, JSON.stringify(r.obj));
    const ed = seen.find((s) => s.url === '/v1/images/edits');
    assert.ok(ed, 'edit reached the GPT route');
    assert.match(ed.type, /^multipart\/form-data/);
    const text = ed.raw.toString('latin1');
    assert.match(text, /name="prompt"\r\n\r\nadd a hat/);
    assert.match(text, /name="image"; filename="image\.png"/);
    assert.ok(ed.raw.indexOf(PNG) >= 0, 'the picture travels as bytes');

    // Settings > 模型: the key row names the route really used; the GPT subscription card stays
    // unbound until the site says the route is a subscription login (GPT_SUBSCRIPTION=1).
    r = await call(port, 'GET', '/channels', token);
    assert.equal(r.status, 200, JSON.stringify(r.obj));
    assert.equal(r.obj.models.find((m) => m.id === 'gpt').up, base);
    assert.equal(r.obj.subscriptions.find((m) => m.id === 'gpt').bound, false);
    fs.appendFileSync(path.join(root, 'gateway.env'), 'GPT_SUBSCRIPTION=1\n');
    r = await call(port, 'GET', '/channels', token);
    assert.equal(r.obj.subscriptions.find((m) => m.id === 'gpt').bound, true, 'GPT_SUBSCRIPTION=1 shows the subscription signed in');

    // No token, no picture.
    r = await call(port, 'POST', '/images', 'dsh_wrong', { prompt: 'a cat' });
    assert.equal(r.status, 401);
  } finally {
    gw.kill();
    vendor.close();
  }
  console.log('GPT_MEDIA_PROVE_OK=1');
}

main().catch((e) => { console.error(e); process.exit(1); });
