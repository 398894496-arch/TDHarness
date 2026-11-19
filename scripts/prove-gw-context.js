#!/usr/bin/env node
// Prove the model list carries each model's window (company-context-v1): DeepSeek gets its
// documented 1M, and after the vendor refuses a prompt for length the list carries the limit it
// named instead. Fake vendor on loopback only. Ends with GW_CONTEXT_PROVE_OK=1.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const GW = path.join(__dirname, '..', 'server', 'gw-lite.js');
const fail = (w) => { console.error('GW_CONTEXT_PROVE_FAIL ' + w); process.exit(1); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-ctx-'));
  const vendor = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }));
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "This model's maximum context length is 131,072 tokens. However, you requested 140000 tokens (139000 in the messages, 1000 in the completion).", type: 'invalid_request_error' } }));
    });
  });
  await new Promise((r) => vendor.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [] }));
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [] }));
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
      TDH_GW_LEGACY: path.join(root, 'legacy.json'), CLIPROXY_AUTH_DIR: path.join(root, 'no-auths')
    }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve, reject) => {
    gw.stdout.on('data', (c) => { if (String(c).indexOf('LISTEN=') >= 0) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway-exited-' + code)));
  });
  const svc = fs.readFileSync(path.join(root, 'gw-service.token'), 'utf8').trim();
  const call = (method, p, obj) => new Promise((resolve, reject) => {
    const b = obj ? Buffer.from(JSON.stringify(obj)) : null;
    const h = { authorization: 'Bearer ' + svc };
    if (b) { h['content-type'] = 'application/json'; h['content-length'] = b.length; }
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: h }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(b || undefined);
  });
  const ctxOf = async (id) => {
    const j = JSON.parse((await call('GET', '/v1/company-models')).text);
    const m = (j.models || []).find((x) => x.id === id);
    if (!m) fail('model missing from the list: ' + id + ' ' + JSON.stringify(j));
    return m.context;
  };
  if (await ctxOf('deepseek-chat') !== 1000000) fail('documented DeepSeek window not carried');
  const refused = await call('POST', '/v1/chat/completions', { model: 'deepseek-chat', messages: [{ role: 'user', content: 'x' }] });
  if (refused.status !== 400 || !/maximum context length/.test(refused.text)) fail('refusal not relayed as is: ' + refused.status);
  await new Promise((r) => setTimeout(r, 100));
  if (await ctxOf('deepseek-chat') !== 131072) fail('limit named in the refusal not learned');
  if (await ctxOf('deepseek-reasoner') !== 1000000) fail('learned limit leaked to another model');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'runtime', 'context-learned.json'), 'utf8'));
  if (saved['deepseek-chat'] !== 131072) fail('learned limit not saved');
  gw.kill(); vendor.close();
  console.log('GW_CONTEXT_PROVE_OK=1');
})().catch((e) => fail(String(e && e.message || e)));
