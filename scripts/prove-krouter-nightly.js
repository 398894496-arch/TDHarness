#!/usr/bin/env node
// Proof for company-krouter-nightly-v1 (server/krouter-nightly.js), offline (--local: no model call):
// yesterday's DSH conversations become KRouter session excerpts in each person's own memory only; nothing of a
// conversation reaches the company memory; a department kept apart gets its own KRouter upkeep (standing
// index, nightly report) and its own state; two sessions with the same title the same day do not share a page.
// Needs python3 (KRouter is standard-library Python). Ends with KROUTER_NIGHTLY_PROVE_OK=1.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

if (typeof zlib.zstdCompressSync !== 'function') { console.log('KROUTER_NIGHTLY_PROVE_SKIP=no-zstd'); process.exit(0); }
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-krnightly-'));
const C = path.join(T, 'company');
const R = path.join(T, 'runtime');
fs.mkdirSync(R, { recursive: true });
// noon in Shanghai, so the local day is the same wherever the proof runs
const at = Date.parse('2026-11-18T12:00:00+08:00');
const ymd = '2026-11-18'; // the nightly picks the day in Shanghai time
function sess(home, id, title, evs) {
  const d = path.join(home, '.dsh-desk', 'sessions', '--x--', id);
  fs.mkdirSync(d, { recursive: true });
  const lines = [JSON.stringify({ type: 'session', id, createdAt: at, cwd: home, title })].concat(evs.map((e) => JSON.stringify(e))).join('\n') + '\n';
  fs.writeFileSync(path.join(d, 'session.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(lines)));
}
const u = (t) => ({ type: 'user/message', time: at, data: { content: t } });
const a = (t) => ({ type: 'assistant/message', time: at + 1000, data: { content: t } });
const amy = path.join(C, 'content', 'emp-amy');
const fay = path.join(C, 'content', 'emp-fay');
sess(amy, 'session-aaaa1111-0000-0000-0000-000000000001', '样品怎么寄', [u('客户要样品，样品寄送流程是什么？'), a('先填寄样单，主管批了再寄。')]);
sess(amy, 'session-bbbb2222-0000-0000-0000-000000000002', '样品怎么寄', [u('第二个客户也要样品'), a('同样走寄样单。')]);
sess(fay, 'session-cccc3333-0000-0000-0000-000000000003', '报销', [u('报销单几号前交？'), a('每月五号前交到财务。')]);
fs.writeFileSync(path.join(R, 'roster.json'), JSON.stringify({ depts: [{ id: 'sales', name: '销售' }, { id: 'fin', name: '行政财务' }], people: [
  { login: 'amy', dept: 'sales', status: 'active', personal: amy }, { login: 'fay', dept: 'fin', status: 'active', personal: fay }] }));
fs.writeFileSync(path.join(R, 'kb-zones.json'), JSON.stringify({ private: ['fin'] }));

const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'krouter-nightly.js'), '--company-root', C, '--runtime-root', R, '--target', ymd, '--local', '--python', process.env.TDH_PYTHON || 'python3'],
  { encoding: 'utf8', env: { ...process.env, TDH_ROOT: T } });
try {
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/KROUTER_NIGHTLY_OK=1/.test(r.stdout), r.stdout);
  const find = (dir, re) => { const out = []; const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (re.test(f)) out.push(f); } }; walk(dir); return out; };
  const amyPages = find(path.join(amy, '_memory'), /会话摘录.*\.md$/);
  assert.strictEqual(amyPages.length, 2, 'two sessions, two excerpt pages (same title, same day): ' + amyPages.map((f) => path.basename(f)).join(', '));
  assert.ok(find(path.join(fay, '_memory'), /会话摘录.*\.md$/).length === 1, 'finance person\'s own excerpt');
  const shared = path.join(C, '_shared', '_memory');
  assert.ok(!find(shared, /\.md$/).some((f) => /寄样单|报销/.test(fs.readFileSync(f, 'utf8'))), 'no conversation in the company memory');
  assert.ok(fs.existsSync(path.join(shared, '90-system', '自动化', '夜间维护.md')), 'KRouter upkeep ran on the company memory');
  const fin = path.join(C, '_handbook', 'fin', '_memory');
  assert.ok(fs.existsSync(path.join(fin, '90-system', '自动化', '夜间维护.md')), 'and on the kept-apart department\'s own');
  assert.ok(fs.existsSync(path.join(shared, '90-system', 'canonical_sources.psv')), 'a bank gets its own (empty) alias table, not KRouter\'s sample');
  assert.ok(fs.readdirSync(path.join(R, 'krouter-state')).length >= 4, 'each bank its own KRouter state (two people, two company memories)');
  console.log('KROUTER_NIGHTLY_PROVE_OK=1');
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
