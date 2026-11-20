#!/usr/bin/env node
// Proof for company-krouter-auto-alias-v1 (server/krouter_tdh.py auto_aliases, run by krouter-run.py --auto-aliases
// from the nightly): the alias table of a TDH memory keeps itself, no one ticks. A page in force that no alias names
// gets the model's short nouns, applied through KRouter's own re-check; an experience card gets none; a generic word,
// a noun another page's title also holds, or an alias already taken is not applied; a second night adds nothing;
// the standing index then lists the new rows. The model lane is a fake OpenAI-compatible endpoint on this machine.
// Needs python3. Ends with KROUTER_AUTO_ALIAS_PROVE_OK=1.
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-autoalias-'));
const bank = path.join(T, 'company', '_shared', '_memory');
const put = (rel, text) => { const f = path.join(bank, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const page = (title, body) => '---\ntitle: ' + title + '\nstatus: active\n---\n\n# ' + title + '\n\n' + body + '\n';

put('krouter-zones.psv', '01 项目|01-projects\n02 经验与方法|02-methods\n03 资料与证据|03-evidence\n04 已完成与复盘|04-reviews\n05 时间日志|05-logs\n90 系统文件|90-system\n');
put('90-system/canonical_sources.psv', '# id|aliases separated by ;|Vault-relative source|evidence anchor\nQ01|报价单|02-methods/报价规则.md|报价单要主管签字\n');
put('02-methods/报价规则.md', page('报价规则', '报价单要主管签字，大客户打九折。'));
put('02-methods/样品寄送规则.md', page('样品寄送规则', '先填寄样单，主管批了再寄，运费公司出。'));
put('02-methods/出差报销.md', page('出差报销', '差旅费凭发票实报实销，每月五号前交。'));
put('02-methods/报销说明.md', page('报销说明', '报销单交到财务。'));
put('02-methods/经验卡/经验｜发货前先核对地址.md', '---\ntitle: "经验｜发货前先核对地址"\ntype: experience-card\nstatus: provisional\nsource: krouter-capture\n---\n\n# 经验｜发货前先核对地址\n\n- 做法：发货前先打电话核对地址。\n');

// What the model answers, per page: good nouns, a generic word, a taken alias, a noun another title holds.
const NOUNS = {
  '02-methods/样品寄送规则.md': ['寄样', '样品寄送', '规则', '报价单'],
  '02-methods/出差报销.md': ['差旅费', '报销'],
  '02-methods/报销说明.md': ['报销单'],
  '02-methods/经验卡/经验｜发货前先核对地址.md': ['核对地址'],
};
let calls = 0;
let sawCard = false;
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    calls += 1;
    const prompt = JSON.stringify(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
    if (/经验卡/.test(prompt)) sawCard = true;
    const answer = {};
    for (const [rel, words] of Object.entries(NOUNS)) if (prompt.includes(rel)) answer[rel] = words;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
});

function run(args) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/_(API_KEY|BASE_URL|MODEL)$/.test(k) && !/^KROUTER_/.test(k)) env[k] = v;
  Object.assign(env, {
    PYTHONUTF8: '1', NO_PROXY: '*', OPENAI_API_KEY: 'test-only', OPENAI_BASE_URL: 'http://127.0.0.1:' + srv.address().port + '/v1',
    KROUTER_LEARN_MODEL: 'fake', KROUTER_KEYS_ENV: path.join(T, 'no-keys.env'), KROUTER_HOST_CLI: '0',
    KROUTER_CACHE_DIR: path.join(T, 'cache'), KROUTER_STATE_ROOT: path.join(T, 'state'), KROUTER_USAGE_LOG: path.join(T, 'usage.jsonl'),
  });
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) env[k] = '';
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const c = spawn('python3', [path.join(ROOT, 'server', 'krouter-run.py'), bank].concat(args), { env });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (rc) => resolve({ rc, out, err }));
  });
}

srv.listen(0, '127.0.0.1', async () => {
  try {
    const first = await run(['--auto-aliases']);
    assert.strictEqual(first.rc, 0, first.out + first.err);
    assert.ok(/AUTO_ALIASES=3 REFUSED=0/.test(first.out), 'three pages get aliases: ' + first.out + first.err);
    assert.ok(calls >= 1 && !sawCard, 'the model is asked, and never about an experience card');
    const table = fs.readFileSync(path.join(bank, '90-system', 'canonical_sources.psv'), 'utf8');
    const rows = table.split('\n').filter((l) => /^Q\d+\|/.test(l));
    assert.ok(rows[0] === 'Q01|报价单|02-methods/报价规则.md|报价单要主管签字', 'the row already there is kept: ' + table);
    assert.ok(rows.some((r) => /^Q0\d\|寄样;样品寄送\|02-methods\/样品寄送规则\.md\|/.test(r)), 'the sample page is named, without 规则 or the taken 报价单: ' + table);
    assert.ok(rows.some((r) => /^Q0\d\|差旅费\|02-methods\/出差报销\.md\|/.test(r)), '报销 is in another page\'s title, so only 差旅费: ' + table);
    assert.ok(rows.some((r) => /^Q0\d\|报销单\|02-methods\/报销说明\.md\|/.test(r)), 'and 报销单 (no other title holds it): ' + table);
    assert.ok(!/\|报销[;|]|核对地址|经验卡/.test(table), 'no alias another title holds, none for a card: ' + table);
    assert.strictEqual(new Set(rows.map((r) => r.split('|')[0])).size, rows.length, 'ids are unique');
    const list = fs.readFileSync(path.join(bank, '90-system', '自动化', '别名候选.md'), 'utf8');
    assert.ok(/自动核对后写进别名表，不用人工打勾/.test(list) && /status: generated/.test(list), 'the checklist says no one ticks, and is not a page in force');

    const second = await run(['--auto-aliases']);
    assert.ok(/AUTO_ALIASES=0 REFUSED=0/.test(second.out), 'a second night adds nothing: ' + second.out + second.err);
    assert.strictEqual(fs.readFileSync(path.join(bank, '90-system', 'canonical_sources.psv'), 'utf8'), table, 'and leaves the table as it was');

    const night = await run(['nightly.py', '--vault', bank, '--steps', 'compile_subconscious']);
    assert.strictEqual(night.rc, 0, night.out + night.err);
    const idx = fs.readFileSync(path.join(bank, '90-system', '自动化', '下意识.md'), 'utf8');
    assert.ok(/row_count: 4/.test(idx) && /\|寄样;样品寄送\|/.test(idx) && /\|差旅费\|/.test(idx), 'the standing index lists the new rows: ' + idx);
    // and the session start of a desk (session_hook.index_text, what krouter-recall.py sends) names them
    const hook = spawnSync('python3', ['-c', 'import sys; from pathlib import Path; sys.path[:0] = [sys.argv[1]]; import session_hook; print(session_hook.index_text(Path(sys.argv[2]), 9000))',
      path.join(ROOT, 'server', 'vendor', 'krouter', 'scripts'), bank], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONUTF8: '1', KROUTER_CACHE_DIR: path.join(T, 'cache') }) });
    assert.ok(/寄样／样品寄送：.*〔02-methods\/样品寄送规则\.md〕/.test(hook.stdout) && /差旅费：/.test(hook.stdout), 'session start names them: ' + hook.stdout + hook.stderr);
    console.log('KROUTER_AUTO_ALIAS_PROVE_OK=1');
  } catch (e) {
    console.error('KROUTER_AUTO_ALIAS_PROVE_FAIL ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    srv.close();
    fs.rmSync(T, { recursive: true, force: true });
  }
});
