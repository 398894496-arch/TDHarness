#!/usr/bin/env node
// Proof for company-own-memory-v1: a person's own memory is the _memory in their own folder (the roster's
// `personal`), an admin's too. Two admins: the seed admin (folder _office) and a second one (folder emp-pan). The
// second admin's search, prior-work lookup and session start bring his own session excerpts and never the seed
// admin's, and naming the seed admin's page by path gets not-found; the seed admin keeps his; an employee whose
// folder is emp-<login> (no content/) finds her own. On the desk, a hit's `company/...` path becomes the path this
// desk opens (Windows share, Mac ~/company), and a desk path handed back becomes `company/...` again.
// Needs python3 (KRouter). Ends with OWN_MEMORY_PROVE_OK=1.
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
function ask(port, token, body, route) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port, path: route || '/v1/search', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': raw.length, authorization: 'Bearer ' + token } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end(raw);
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-ownmem-'));
  const company = path.join(root, 'company');
  const zones = '01 项目|01-projects\n02 经验与方法|02-methods\n03 资料与证据|03-evidence\n04 已完成与复盘|04-reviews\n05 时间日志|05-logs\n90 系统文件|90-system\n';
  const excerpt = (title, body) => '---\ntitle: "' + title + '"\ntype: session-excerpt\nstatus: imported\n---\n\n# ' + title + '\n\n' + body + '\n';
  for (const home of ['_office', 'emp-pan', 'emp-amy']) put(company, home + '/_memory/krouter-zones.psv', zones);
  put(company, '_office/_memory/05-logs/会话摘录/2026-11-19｜帮我看一下这个怎么报价 (cff5e197).md',
    excerpt('帮我看一下这个怎么报价', 'tdh 的对话：聚氨酯筛板报价按图纸逐项重算，PU SCREEN 模板底价只给老板看。'));
  put(company, 'emp-pan/_memory/05-logs/会话摘录/2026-11-20｜塞尔维亚客户报价单 (aa11bb22).md',
    excerpt('塞尔维亚客户报价单', '小潘的对话：塞尔维亚 Ivan 的报价单用 PU SCREEN Excel 模板，按尺寸填数量。'));
  put(company, 'emp-amy/_memory/02-methods/样品快递.md', '# 样品快递\n\namy 自己记的：样品快递用顺丰到付。\n');
  put(company, '_handbook/_company/rules.md', '# 规章\n\n上班九点打卡。\n');
  const T = { tdh: tok(), pan: tok(), amy: tok() };
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [
    { pid: 'p0', login: 'tdh', role: 'admin', dept: 'company', status: 'active', personal: path.join(company, '_office') },
    { pid: 'p1', login: 'pan', role: 'admin', dept: 'd-fin', status: 'active', personal: path.join(company, 'emp-pan') },
    { pid: 'p2', login: 'amy', role: 'employee', dept: 'sales', status: 'active', personal: path.join(company, 'emp-amy') },
  ] }));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: Object.entries({ p0: T.tdh, p1: T.pan, p2: T.amy }).map(([pid, token]) => ({ pid, token, revoked_at: '' })) }));
  fs.writeFileSync(path.join(root, 'kb-zones.json'), JSON.stringify({ private: [] }));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'knowledge-search.js')], {
    env: { ...process.env, TDH_ROOT: root, TDH_BRAIN: path.join(root, 'brain'), TDH_COMPANY: company, TDH_KNOW_PORT: String(port),
      TDH_ROSTER: path.join(root, 'roster.json'), TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'), TDH_KNOW_LOG: path.join(root, 'know.log'),
      TDH_KB_CACHE: path.join(root, 'kb-cache'), TDH_KROUTER_CACHE: path.join(root, 'krouter-cache'), TDH_KB_ZONES: path.join(root, 'kb-zones.json'),
      KROUTER_STATE_ROOT: path.join(root, 'krouter-state') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => { if (String(d).includes('LISTEN=')) resolve(); });
      child.on('exit', (c) => reject(new Error('server-exit ' + c)));
    });
    const paths = (r) => (r.hits || []).map((h) => h.path).join(' | ');
    const office = /_office\/_memory/;
    const pan = await ask(port, T.pan, { route: 'search', query: 'PU SCREEN 报价' });
    assert.ok(/company\/emp-pan\/_memory\/05-logs\/会话摘录\/2026-11-20｜塞尔维亚客户报价单/.test(paths(pan)), 'the second admin finds his own excerpt: ' + paths(pan));
    assert.ok(!office.test(paths(pan)) && !/底价只给老板看/.test(JSON.stringify(pan)), 'and never the seed admin\'s: ' + paths(pan));
    const prior = await ask(port, T.pan, { query: 'PU SCREEN Excel 模板 报价单' }, '/v1/prior-work');
    assert.ok(!office.test(paths(prior)) && !/底价只给老板看/.test(JSON.stringify(prior)), 'prior-work neither (what happened on 2026-11-20): ' + paths(prior));
    const named = await ask(port, T.pan, { route: 'search', query: '报价', evidence: true, path: 'company/_office/_memory/05-logs/会话摘录/2026-11-19｜帮我看一下这个怎么报价 (cff5e197).md' });
    assert.strictEqual(named.status, 'not-found', 'naming the seed admin\'s page by path: not-found: ' + JSON.stringify(named));
    const start = await ask(port, T.pan, { route: 'hook', hook: 'start', session: 's1' });
    assert.ok(!/底价只给老板看|帮我看一下这个怎么报价/.test(start.text || ''), 'session start neither: ' + (start.text || ''));
    const seed = await ask(port, T.tdh, { route: 'search', query: '聚氨酯筛板 报价' });
    assert.ok(office.test(paths(seed)), 'the seed admin keeps his own: ' + paths(seed));
    assert.ok(!/emp-pan/.test(paths(seed)), 'and does not get the second admin\'s: ' + paths(seed));
    const amy = await ask(port, T.amy, { route: 'search', query: '样品快递' });
    assert.ok(/company\/emp-amy\/_memory\/02-methods\/样品快递\.md/.test(paths(amy)), 'an employee in emp-<login> (no content/) finds her own: ' + paths(amy));

    // The desk side: a hit's path as this desk opens it, and back.
    // A file URL: on Windows an absolute path (d:\\...) is not something import() takes.
    const desk = await import(require('url').pathToFileURL(path.join(ROOT, 'desk', 'plugins', 'company-shell', 'lib', 'index.js')).href);
    const win = '//tdharness.local/dsh-company';
    const mac = '/Users/pan/company';
    const hit = 'company/emp-pan/_memory/05-logs/会话摘录/2026-11-20｜塞尔维亚客户报价单 (aa11bb22).md';
    assert.strictEqual(desk.deskHitPath(hit, win), win + '/emp-pan/_memory/05-logs/会话摘录/2026-11-20｜塞尔维亚客户报价单 (aa11bb22).md', 'Windows: the share path, not one under the workspace');
    assert.strictEqual(desk.deskHitPath(hit, mac), mac + '/emp-pan/_memory/05-logs/会话摘录/2026-11-20｜塞尔维亚客户报价单 (aa11bb22).md', 'Mac: ~/company');
    assert.strictEqual(desk.deskHitPath('30-lessons/a.md', win), '30-lessons/a.md', 'a brain path stays as it is');
    assert.strictEqual(desk.deskHitPath(hit, ''), hit, 'no company root known: as it is');
    assert.strictEqual(desk.serverHitPath(win + '/emp-pan/_memory/a.md'), 'company/emp-pan/_memory/a.md', 'a Windows desk path back to the server\'s');
    assert.strictEqual(desk.serverHitPath('\\\\tdharness.local\\dsh-company\\emp-pan\\_memory\\a.md'), 'company/emp-pan/_memory/a.md', 'with backslashes too');
    assert.strictEqual(desk.serverHitPath(mac + '/_shared/_memory/b.md'), 'company/_shared/_memory/b.md', 'a Mac desk path back');
    assert.strictEqual(desk.serverHitPath('company/_handbook/x.md'), 'company/_handbook/x.md', 'the server\'s own form stays');
    assert.strictEqual(desk.serverHitPath(desk.deskHitPath(hit, win)), hit, 'there and back: the same page');
    console.log('OWN_MEMORY_PROVE_OK=1');
  } catch (e) {
    console.error('OWN_MEMORY_PROVE_FAIL ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
