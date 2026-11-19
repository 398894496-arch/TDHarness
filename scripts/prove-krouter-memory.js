#!/usr/bin/env node
// Proof for company-krouter-memory-v1: the knowledge search asks KRouter (server/krouter-recall.py,
// pinned in server/vendor/krouter) for the memory layer, one bank per folder: a person's own memory
// and the company memory. A person gets pages from their own bank and the company bank only, never
// another person's; an off-topic question gets nothing from KRouter; status reports the pinned
// version; with TDH_KROUTER=0 the search answers as before, without KRouter. Needs python3 (KRouter
// uses the standard library only). Ends with KROUTER_MEMORY_PROVE_OK=1.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tok = () => 'dsh_' + crypto.randomBytes(16).toString('hex');
function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function ask(port, token, body) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/search', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': raw.length, authorization: 'Bearer ' + token } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end(raw);
  });
}
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

async function run(root, krouter) {
  const company = path.join(root, 'company');
  const brain = path.join(root, 'brain');
  const T = { amy: tok(), eve: tok() };
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [
    { pid: 'p1', login: 'amy', role: 'employee', dept: 'sales', status: 'active' },
    { pid: 'p2', login: 'eve', role: 'employee', dept: 'sales', status: 'active' },
  ] }));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [
    { pid: 'p1', token: T.amy, revoked_at: '' }, { pid: 'p2', token: T.eve, revoked_at: '' },
  ] }));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'knowledge-search.js')], {
    env: { ...process.env, TDH_ROOT: root, TDH_BRAIN: brain, TDH_COMPANY: company, TDH_KNOW_PORT: String(port),
      TDH_ROSTER: path.join(root, 'roster.json'), TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'),
      TDH_KNOW_LOG: path.join(root, 'know.log'), TDH_KB_CACHE: path.join(root, 'kb-cache'),
      TDH_KROUTER_CACHE: path.join(root, 'krouter-cache'), TDH_KB_ZONES: path.join(root, 'kb-zones.json'),
      TDH_KROUTER: krouter ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('LISTEN=')) resolve(); });
    child.on('exit', (c) => reject(new Error('server-exit ' + c)));
  });
  try {
    return { status: await ask(port, T.amy, { route: 'status' }),
      mine: await ask(port, T.amy, { route: 'search', query: '大客户怎么报价' }),
      theirs: await ask(port, T.amy, { route: 'search', query: '底价是多少' }),
      company: await ask(port, T.eve, { route: 'search', query: '样品寄送流程' }),
      off: await ask(port, T.amy, { route: 'search', query: '火星上的天气怎么样' }) };
  } finally {
    child.kill();
  }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-krmem-'));
  const company = path.join(root, 'company');
  put(company, 'content/emp-amy/_memory/02-methods/大客户报价.md', '# 大客户报价\n\n大客户（年采购超过 50 万）报价打九折，起订量 1000 件。\n');
  put(company, 'content/emp-amy/_memory/05-logs/2026-11-18.md', '# 11-18\n\n今天整理了仓库。\n');
  put(company, 'content/emp-eve/_memory/02-methods/私人底价.md', '# 私人底价\n\neve 自己记的：聚氨酯筛板底价 8 元一公斤，不要告诉别人。\n');
  put(company, '_shared/_memory/02-methods/样品寄送.md', '# 样品寄送流程\n\n样品寄送流程：先填寄样单，主管批了再寄，运费公司出。\n');
  put(company, '_handbook/_company/rules.md', '# 规章\n\n上班九点打卡。\n');

  const on = await run(root, true);
  assert.ok(on.status.krouter && /^[0-9a-f]{7}$/.test(on.status.krouter.version), 'status names the pinned KRouter: ' + JSON.stringify(on.status.krouter));
  const first = on.mine.hits[0] || {};
  assert.strictEqual(first.via, 'krouter', 'own memory page picked by KRouter: ' + JSON.stringify(on.mine.hits.slice(0, 2)));
  assert.strictEqual(first.path, 'company/content/emp-amy/_memory/02-methods/大客户报价.md');
  assert.ok(/九折/.test(first.text), 'the passage answers: ' + first.text);
  for (const r of [on.mine, on.theirs, on.off]) {
    assert.ok(!r.hits.some((h) => /emp-eve/.test(h.path)), 'amy got a page from eve\'s memory: ' + JSON.stringify(r.hits));
  }
  assert.ok(on.company.hits.some((h) => h.via === 'krouter' && /_shared\/_memory\/02-methods\/样品寄送\.md$/.test(h.path)), 'company memory reaches everyone: ' + JSON.stringify(on.company.hits));
  assert.ok(!on.off.hits.some((h) => h.via === 'krouter'), 'an off-topic question got KRouter hits: ' + JSON.stringify(on.off.hits));

  const off = await run(root, false);
  assert.strictEqual(off.status.krouter, null, 'TDH_KROUTER=0 still reported KRouter');
  assert.ok(!off.mine.hits.some((h) => h.via), 'TDH_KROUTER=0 still used KRouter');
  assert.ok(off.mine.hits.some((h) => /大客户报价\.md$/.test(h.path)), 'without KRouter the memory page is still found');
  console.log('KROUTER_MEMORY_PROVE_OK=1');
})().catch((e) => { console.error('KROUTER_MEMORY_PROVE_FAIL ' + (e && e.message ? e.message : e)); process.exit(1); });
