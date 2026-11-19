#!/usr/bin/env node
// Prove the gateway ends a chat-completions stream at "data: [DONE]" even when the vendor keeps
// the connection open afterwards (the desk used to wait for the idle timeout), and still relays
// every byte before it. Fake vendor on loopback only. Ends with GW_SSE_DONE_PROVE_OK=1.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const GW = path.join(__dirname, '..', 'server', 'gw-lite.js');
const fail = (w) => { console.error('GW_SSE_DONE_PROVE_FAIL ' + w); process.exit(1); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-sse-'));
  const held = [];
  const vendor = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n');
      res.write('data: [DO');            // split across chunks on purpose
      setTimeout(() => res.write('NE]\n\n'), 30);
      held.push(res);                     // never ended: the vendor keeps the socket open
    });
  });
  await new Promise((r) => vendor.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [] }));
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [] }));
  fs.writeFileSync(path.join(root, 'gateway.env'), 'DEEPSEEK_API_KEY=stand-in-key\nDEEPSEEK_BASE_URL=http://127.0.0.1:' + vendor.address().port + '/v1\n');
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
      TDH_GW_LEGACY: path.join(root, 'legacy.json')
    }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve, reject) => {
    gw.stdout.on('data', (c) => { if (String(c).indexOf('LISTEN=') >= 0) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway-exited-' + code)));
  });
  const svc = fs.readFileSync(path.join(root, 'gw-service.token'), 'utf8').trim();   // the gateway writes it at start
  const started = Date.now();
  const body = Buffer.from(JSON.stringify({ model: 'deepseek-chat', stream: true, messages: [{ role: 'user', content: 'hi' }] }));
  const got = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('client still waiting after 5 s')), 5000);
    const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
      headers: { authorization: 'Bearer ' + svc, 'content-type': 'application/json', 'content-length': body.length } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => { clearTimeout(t); resolve(Buffer.concat(chunks).toString('utf8')); });
    });
    req.on('error', reject);
    req.end(body);
  }).catch((e) => fail(e.message));
  if (!/你好/.test(got) || !/data: \[DONE\]/.test(got)) fail('stream not relayed whole: ' + JSON.stringify(got));
  if (Date.now() - started > 3000) fail('ended late');
  gw.kill(); held.forEach((r) => r.destroy()); vendor.close();
  console.log('GW_SSE_DONE_PROVE_OK=1');
})().catch((e) => fail(String(e && e.message || e)));
