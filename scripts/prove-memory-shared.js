#!/usr/bin/env node
// Proof for company-memory-shared-v1: memory is one company memory, written by the server. What an
// employee asks to remember lands in _shared/_memory and everyone's search finds it; someone in a
// department kept apart (财务, runtime/kb-zones.json "private") writes into _handbook/<dept>/_memory,
// which their department finds and nobody else does; a bad layer or name is refused; nobody writes
// without a login. Ends with MEMORY_SHARED_PROVE_OK=1.
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
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function post(port, token, pathname, body) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    const headers = { 'content-type': 'application/json', 'content-length': raw.length };
    if (token) headers.authorization = 'Bearer ' + token;
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ code: res.statusCode, j: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
    });
    req.on('error', reject);
    req.end(raw);
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-memshare-'));
  const company = path.join(root, 'company');
  fs.mkdirSync(path.join(company, '_handbook', '_company'), { recursive: true });
  fs.writeFileSync(path.join(company, '_handbook', '_company', 'rules.md'), '# 规章\n\n上班九点。\n');
  const T = { amy: tok(), bob: tok(), fay: tok() };
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ depts: [{ id: 'sales', name: '销售' }, { id: 'fin', name: '行政财务' }], people: [
    { pid: 'p1', login: 'amy', role: 'employee', dept: 'sales', status: 'active', personal: path.join(company, 'content', 'emp-amy') },
    { pid: 'p2', login: 'bob', role: 'employee', dept: 'sales', status: 'active', personal: path.join(company, 'content', 'emp-bob') },
    { pid: 'p3', login: 'fay', role: 'employee', dept: 'fin', status: 'active', personal: path.join(company, 'content', 'emp-fay') },
  ] }));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [
    { pid: 'p1', token: T.amy, revoked_at: '' }, { pid: 'p2', token: T.bob, revoked_at: '' }, { pid: 'p3', token: T.fay, revoked_at: '' },
  ] }));
  fs.writeFileSync(path.join(root, 'kb-zones.json'), JSON.stringify({ private: ['fin'] }));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'knowledge-search.js')], {
    env: { ...process.env, TDH_ROOT: root, TDH_BRAIN: path.join(root, 'brain'), TDH_COMPANY: company, TDH_KNOW_PORT: String(port),
      TDH_ROSTER: path.join(root, 'roster.json'), TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'), TDH_KNOW_LOG: path.join(root, 'know.log'),
      TDH_KB_CACHE: path.join(root, 'kb-cache'), TDH_KROUTER_CACHE: path.join(root, 'krouter-cache'), TDH_KB_ZONES: path.join(root, 'kb-zones.json'), TDH_KROUTER: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('LISTEN=')) resolve(); });
    child.on('exit', (c) => reject(new Error('server-exit ' + c)));
  });
  try {
    const W = (who, body) => post(port, T[who], '/v1/memory-write', body);
    const S = (who, query) => post(port, T[who], '/v1/search', { route: 'search', query }).then((r) => r.j.hits || []);

    let r = await W('amy', { zone: 'personal', layer: '02-methods', name: 'Big Client Quote', content: '大客户报价打九折，起订量一千件。' });
    assert.strictEqual(r.code, 200, JSON.stringify(r.j));
    assert.strictEqual(r.j.zone, 'shared', 'an employee asking for "personal" still writes the shared memory');
    const amyFile = path.join(company, '_shared', '_memory', '02-methods', 'big-client-quote.md');
    assert.ok(fs.existsSync(amyFile), 'written into _shared/_memory: ' + r.j.path);
    assert.ok(/author: amy/.test(fs.readFileSync(amyFile, 'utf8')), 'the page says who wrote it');
    assert.ok((await S('bob', '大客户报价')).some((h) => /big-client-quote\.md$/.test(h.path)), 'a colleague finds what amy remembered');
    assert.ok((await S('fay', '大客户报价')).some((h) => /big-client-quote\.md$/.test(h.path)), 'the kept-apart department reads the company memory too');

    r = await W('fay', { layer: '02-methods', name: 'reimburse', content: '报销单每月五号前交到财务，超期下月处理。' });
    assert.strictEqual(r.j.zone, 'dept', 'finance writes into its own department memory: ' + JSON.stringify(r.j));
    assert.ok(fs.existsSync(path.join(company, '_handbook', 'fin', '_memory', '02-methods', 'reimburse.md')), 'written into _handbook/fin/_memory');
    assert.ok(!fs.existsSync(path.join(company, '_shared', '_memory', '02-methods', 'reimburse.md')), 'not into the company memory');
    assert.ok(!(await S('amy', '报销单')).some((h) => /reimburse\.md$/.test(h.path)), 'another department does not find finance memory');

    r = await W('amy', { layer: '05-logs', name: '2026-11-19', content: '整理了样品。', mode: 'append' });
    r = await W('bob', { layer: '05-logs', name: '2026-11-19', content: '寄了样品。', mode: 'append' });
    const log = fs.readFileSync(path.join(company, '_shared', '_memory', '05-logs', '2026-11-19.md'), 'utf8');
    assert.ok(/整理了样品/.test(log) && /寄了样品/.test(log) && /amy/.test(log) && /bob/.test(log), 'appends from two people keep both, with who: ' + log);

    assert.strictEqual((await W('amy', { layer: '../etc', name: 'x', content: 'x' })).j.status, 'bad-layer');
    assert.strictEqual((await W('amy', { layer: '02-methods', name: '../../x', content: 'x' })).j.path.indexOf('..'), -1, 'a name cannot climb out');
    assert.strictEqual((await W('amy', { layer: '02-methods', name: '中文', content: 'x' })).j.status, 'bad-name', 'non-ASCII names refused');
    assert.strictEqual((await W('amy', { layer: '02-methods', name: 'x', content: '  ' })).j.status, 'empty');
    assert.strictEqual((await post(port, '', '/v1/memory-write', { layer: '02-methods', name: 'x', content: 'x' })).code, 401, 'no login, no write');
    console.log('MEMORY_SHARED_PROVE_OK=1');
  } finally {
    child.kill();
  }
})().catch((e) => { console.error('MEMORY_SHARED_PROVE_FAIL ' + (e && e.message ? e.message : e)); process.exit(1); });
