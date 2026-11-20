#!/usr/bin/env node
// Proof for company-kb-groups-v1 (server/knowledge-search.js): the company knowledge base in three zones.
//   _handbook/_company          everyone
//   _handbook/_sales-finance    a zone two departments share (kb-zones.json groups): sales and finance, and admins
//   _handbook/<finance>         a department kept apart (kb-zones.json private): finance, and admins
// A sales employee finds the shared pages and the sales-and-finance zone, not finance's own; a finance employee
// finds all three; someone in another department finds the shared pages only; an admin finds everything. Without
// the groups list the _sales-finance folder is nobody's but admins' (not everyone's). Ends with KB_GROUPS_PROVE_OK=1.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tok = () => 'dsh_' + crypto.randomBytes(16).toString('hex');
const put = (base, rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
function freePort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function ask(port, token, query) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify({ route: 'search', query }));
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

async function serve(root, zones) {
  const company = path.join(root, 'company');
  fs.writeFileSync(path.join(root, 'kb-zones.json'), JSON.stringify(zones));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'knowledge-search.js')], {
    env: { ...process.env, TDH_ROOT: root, TDH_BRAIN: path.join(root, 'brain'), TDH_COMPANY: company, TDH_KNOW_PORT: String(port),
      TDH_ROSTER: path.join(root, 'roster.json'), TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'), TDH_KNOW_LOG: path.join(root, 'know.log'),
      TDH_KB_CACHE: path.join(root, 'kb-cache-' + port), TDH_KB_ZONES: path.join(root, 'kb-zones.json'), TDH_KROUTER: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('LISTEN=')) resolve(); });
    child.on('exit', (c) => reject(new Error('server-exit ' + c)));
  });
  return { port, stop: () => child.kill() };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-kbgroups-'));
  const company = path.join(root, 'company');
  put(company, '_handbook/_company/03 销售流程与政策/报价流程.md', '# 报价流程\n\n报价流程：先问清规格和数量，三个工作日内给客户回复。\n');
  put(company, '_handbook/_sales-finance/02 底价与成本/底价表.md', '# 底价表\n\n聚氨酯筛板底价每公斤八元，低于底价要老板批。\n');
  put(company, '_handbook/_sales-finance/01 客户信息/塞尔维亚客户.md', '# 塞尔维亚客户\n\n塞尔维亚客户 Ivan，采购聚氨酯筛板，付款方式电汇。\n');
  put(company, '_handbook/d-fin/03 人事与薪酬/工资发放.md', '# 工资发放\n\n工资每月十日发放，个税由财务代扣。\n');
  const T = { boss: tok(), sam: tok(), fay: tok(), olly: tok() };
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({
    depts: [{ id: 'd-sales', name: '销售' }, { id: 'd-fin', name: '行政财务' }, { id: 'd-ops', name: '内勤' }],
    people: [
      { pid: 'p0', login: 'boss', role: 'admin', dept: 'company', status: 'active', personal: path.join(company, '_office') },
      { pid: 'p1', login: 'sam', role: 'employee', dept: 'd-sales', status: 'active', personal: path.join(company, 'emp-sam') },
      { pid: 'p2', login: 'fay', role: 'employee', dept: 'd-fin', status: 'active', personal: path.join(company, 'emp-fay') },
      { pid: 'p3', login: 'olly', role: 'employee', dept: 'd-ops', status: 'active', personal: path.join(company, 'emp-olly') },
    ] }));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: Object.entries({ p0: T.boss, p1: T.sam, p2: T.fay, p3: T.olly }).map(([pid, token]) => ({ pid, token, revoked_at: '' })) }));
  const zones = { private: ['d-fin'], groups: [{ dir: '_sales-finance', depts: ['d-sales', 'd-fin'] }] };
  let srv = null;
  try {
    srv = await serve(root, zones);
    const sees = async (who) => {
      const out = {};
      for (const [k, q] of [['shared', '报价流程'], ['floor', '聚氨酯筛板底价'], ['customer', '塞尔维亚客户 Ivan'], ['finance', '工资发放']]) {
        const r = await ask(srv.port, T[who], q);
        out[k] = (r.hits || []).some((h) => ({ shared: /报价流程\.md$/, floor: /底价表\.md$/, customer: /塞尔维亚客户\.md$/, finance: /工资发放\.md$/ })[k].test(h.path));
      }
      return out;
    };
    assert.deepStrictEqual(await sees('sam'), { shared: true, floor: true, customer: true, finance: false }, 'sales: shared, customers and floor prices, not finance\'s own');
    assert.deepStrictEqual(await sees('fay'), { shared: true, floor: true, customer: true, finance: true }, 'finance: all three zones');
    assert.deepStrictEqual(await sees('olly'), { shared: true, floor: false, customer: false, finance: false }, 'another department: the shared knowledge only');
    assert.deepStrictEqual(await sees('boss'), { shared: true, floor: true, customer: true, finance: true }, 'an admin: everything');
    srv.stop();
    // A _ folder no groups entry names is not everyone's.
    srv = await serve(root, { private: ['d-fin'] });
    assert.deepStrictEqual(await sees('olly'), { shared: true, floor: false, customer: false, finance: false }, 'no groups entry: still not another department\'s');
    assert.strictEqual((await sees('sam')).floor, false, 'no groups entry: the zone is admins\' only');
    console.log('KB_GROUPS_PROVE_OK=1');
  } catch (e) {
    console.error('KB_GROUPS_PROVE_FAIL ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    if (srv) srv.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
