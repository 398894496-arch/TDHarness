#!/usr/bin/env node
// Proof for company-kb-save-v1: an agent saves a file into the company knowledge base through the knowledge service
// (server/knowledge-search.js /v1/kb-write; the desk tool company_kb_save in desk/plugins/company-shell). Anyone saves
// into the shared knowledge; customers / floor prices / costs only sales, finance and admins; a department's private
// knowledge only its people and admins. Only an existing category folder; no path tricks, no 说明.md, known file
// types; an existing file only with overwrite=true, the old one kept in kb-history; what is saved is found by those who
// may see it and nobody else. The desk reads a local file into the request. Ends with KB_SAVE_PROVE_OK=1.
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
function post(port, token, route, body) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    const headers = { 'content-type': 'application/json', 'content-length': raw.length };
    if (token) headers.authorization = 'Bearer ' + token;
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Object.assign(JSON.parse(Buffer.concat(chunks).toString('utf8')), { http: res.statusCode })));
    });
    req.on('error', reject);
    req.end(raw);
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-kbsave-'));
  const company = path.join(root, 'company');
  for (const f of ['01 公司介绍', '03 销售流程与政策']) put(company, '_handbook/_company/' + f + '/说明.md', '# 说明\n');
  for (const f of ['01 客户信息', '02 底价与成本']) put(company, '_handbook/_sales-finance/' + f + '/说明.md', '# 说明\n');
  for (const f of ['03 人事与薪酬']) put(company, '_handbook/d-fin/' + f + '/说明.md', '# 说明\n');
  put(company, '_handbook/d-fin/_memory/02-methods/x.md', '# x\n');
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
  fs.writeFileSync(path.join(root, 'kb-zones.json'), JSON.stringify({ private: ['d-fin'], groups: [{ dir: '_sales-finance', depts: ['d-sales', 'd-fin'] }] }));
  const history = path.join(root, 'kb-history');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'knowledge-search.js')], {
    env: { ...process.env, TDH_ROOT: root, TDH_BRAIN: path.join(root, 'brain'), TDH_COMPANY: company, TDH_KNOW_PORT: String(port),
      TDH_ROSTER: path.join(root, 'roster.json'), TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'), TDH_KNOW_LOG: path.join(root, 'know.log'),
      TDH_KB_CACHE: path.join(root, 'kb-cache'), TDH_KB_ZONES: path.join(root, 'kb-zones.json'), TDH_KROUTER: '0', TDH_KB_HISTORY: history },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => { if (String(d).includes('LISTEN=')) resolve(); });
      child.on('exit', (c) => reject(new Error('server-exit ' + c)));
    });
    const S = (who, body) => post(port, T[who], '/v1/kb-write', body);
    const found = async (who, q, re) => ((await post(port, T[who], '/v1/search', { route: 'search', query: q })).hits || []).some((h) => re.test(h.path));

    // Shared knowledge: anyone.
    let r = await S('olly', { zone: 'company', folder: '03 销售流程与政策', name: '发货规则.md', content: '# 发货规则\n\n发货规则：订单确认后七天内发货，周日不发。\n' });
    assert.ok(r.ok && r.zone === 'company' && r.path === 'company/_handbook/_company/03 销售流程与政策/发货规则.md', 'anyone saves into the shared knowledge: ' + JSON.stringify(r));
    assert.ok(/七天内发货/.test(fs.readFileSync(path.join(company, '_handbook/_company/03 销售流程与政策/发货规则.md'), 'utf8')));
    assert.ok(await found('sam', '发货规则 七天内发货', /发货规则\.md$/), 'and everyone finds it');

    // Customers and prices: sales, finance, admins.
    for (const z of ['customers', 'private']) {
      r = await S('olly', { zone: z, folder: '01 客户信息', name: 'a.md', content: 'x' });
      assert.ok(!r.ok && r.status === 'not-in-zone', 'another department cannot save into ' + z + ': ' + JSON.stringify(r));
    }
    r = await S('sam', { zone: 'customers', folder: '02 底价与成本', name: '底价表.md', content: '# 底价表\n\n紫檀筛板底价每公斤八元。\n' });
    assert.ok(r.ok && r.zone === 'group:_sales-finance' && /_handbook\/_sales-finance\/02 底价与成本\/底价表\.md$/.test(r.path), 'sales saves a floor price list: ' + JSON.stringify(r));
    assert.ok(await found('fay', '紫檀筛板底价', /底价表\.md$/) && !(await found('olly', '紫檀筛板底价', /底价表\.md$/)), 'finance finds it, another department does not');
    const xlsx = crypto.randomBytes(5000);
    r = await S('sam', { zone: 'customers', folder: '01 客户信息', name: '客户清单.xlsx', data: xlsx.toString('base64') });
    assert.ok(r.ok && r.bytes === 5000 && fs.readFileSync(path.join(company, '_handbook/_sales-finance/01 客户信息/客户清单.xlsx')).equals(xlsx), 'a binary file arrives byte for byte');

    // Finance's own: its people and admins.
    r = await S('fay', { zone: 'private', folder: '03 人事与薪酬', name: '社保标准.md', content: '# 社保标准\n\n按当地最低基数缴纳。\n' });
    assert.ok(r.ok && r.zone === 'dept:d-fin', 'finance saves into its own: ' + JSON.stringify(r));
    // company-kb-audience-v1: the answer says who reads that zone (its department; admins apart), by name.
    assert.deepEqual(r.audience.readers, ['fay'], 'who reads 行政财务\'s zone: ' + JSON.stringify(r.audience));
    assert.deepEqual(r.audience.admins, ['boss']);
    assert.ok(/能看到的人：fay；管理员（boss）能看所有区/.test(r.hint), r.hint);
    r = await S('boss', { zone: 'private', folder: '03 人事与薪酬', name: '年终奖.md', content: '# 年终奖\n\n按考核发。\n' });
    assert.ok(r.ok && r.zone === 'dept:d-fin', 'an admin too (one department kept apart): ' + JSON.stringify(r));
    r = await S('sam', { zone: 'private', folder: '03 人事与薪酬', name: 'a.md', content: 'x' });
    assert.ok(!r.ok && r.status === 'not-in-zone', 'sales cannot');

    // Only existing category folders, safe names, known types.
    r = await S('olly', { zone: 'company', folder: '99 随便', name: 'a.md', content: 'x' });
    assert.ok(!r.ok && r.status === 'bad-folder' && r.folders.join('|') === '01 公司介绍|03 销售流程与政策', 'a wrong folder returns the list: ' + JSON.stringify(r));
    r = await S('fay', { zone: 'private', folder: '_memory', name: 'a.md', content: 'x' });
    assert.ok(!r.ok && r.status === 'bad-folder', 'not the memory folder');
    for (const bad of ['../逃出去.md', '..\\逃出去.md', 'a/b.md', '说明.md', '病毒.exe', '.隐藏.md', '没有扩展名']) {
      r = await S('olly', { zone: 'company', folder: '01 公司介绍', name: bad, content: 'x' });
      assert.ok(!r.ok && r.status === 'bad-name', 'refused name ' + bad + ': ' + JSON.stringify(r));
    }
    r = await S('olly', { zone: 'company', folder: '01 公司介绍', name: '表.xlsx', content: '文字' });
    assert.ok(!r.ok && r.status === 'bad-name', 'text content needs .md / .txt / .csv');
    r = await S('olly', { zone: 'company', folder: '01 公司介绍', name: 'a.md' });
    assert.ok(!r.ok && r.status === 'empty', 'nothing to save');
    assert.strictEqual(fs.readFileSync(path.join(company, '_handbook/_company/01 公司介绍/说明.md'), 'utf8'), '# 说明\n', 'the guide page is untouched');

    // An existing file: only with overwrite, the old one kept.
    r = await S('sam', { zone: 'company', folder: '03 销售流程与政策', name: '发货规则.md', content: '新版' });
    assert.ok(!r.ok && r.status === 'exists' && /发货规则\.md$/.test(r.path), 'not replaced without overwrite: ' + JSON.stringify(r));
    r = await S('sam', { zone: 'company', folder: '03 销售流程与政策', name: '发货规则.md', content: '# 发货规则\n\n改成五天内发货。\n', overwrite: true });
    assert.ok(r.ok && r.replaced === true, 'replaced with overwrite: ' + JSON.stringify(r));
    const kept = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else kept.push(f); } })(history);
    assert.ok(kept.length === 1 && /sam/.test(kept[0]) && /七天内发货/.test(fs.readFileSync(kept[0], 'utf8')), 'the old one is kept, with who replaced it: ' + kept.join(','));

    r = await post(port, '', '/v1/kb-write', { zone: 'company', folder: '01 公司介绍', name: 'a.md', content: 'x' });
    assert.strictEqual(r.http, 401, 'no login, no write');

    // The desk reads a local file into the request.
    const desk = await import(path.join(ROOT, 'desk', 'plugins', 'company-shell', 'lib', 'index.js'));
    const local = path.join(root, 'desk-file 价目表.xlsx');
    fs.writeFileSync(local, xlsx);
    const made = desk.kbSaveBody({ zone: 'company', folder: '01 公司介绍', path: local });
    assert.ok(made.body && made.body.name === 'desk-file 价目表.xlsx' && Buffer.from(made.body.data, 'base64').equals(xlsx), 'the desk sends the file and its name');
    assert.ok(/absolute/.test(desk.kbSaveBody({ zone: 'company', folder: 'x', path: 'relative.xlsx' }).error), 'a relative path is refused');
    assert.ok(/no such file/.test(desk.kbSaveBody({ zone: 'company', folder: 'x', path: path.join(root, 'nope.xlsx') }).error), 'a missing file is refused');
    r = await S('olly', made.body);
    assert.ok(r.ok && fs.readFileSync(path.join(company, '_handbook/_company/01 公司介绍/desk-file 价目表.xlsx')).equals(xlsx), 'and the server stores it as sent');
    console.log('KB_SAVE_PROVE_OK=1');
  } catch (e) {
    console.error('KB_SAVE_PROVE_FAIL ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
