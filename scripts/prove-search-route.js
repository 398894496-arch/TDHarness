#!/usr/bin/env node
// Prove the search route (company-search-route-v2): deep search is the ChatGPT subscription's own
// web search (no Grok anywhere), it runs when the query starts with 深搜 and when the question
// asks for an authority (a standard number, a regulation, a paper), an everyday question stays on
// the engines, and a site without the subscription says deep search is not available instead of
// pretending. Standard search goes through Agent Reach (company-search-reach-v1) with the
// gateway's own calls behind it, and a link on GitHub and the like is read through it.
// Engines, Agent Reach and the model door are stand-ins. Ends with SEARCH_ROUTE_PROVE_OK=1.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const os = require('node:os');
const SERVER = path.join(__dirname, '..', 'server');
// A stand-in agent-reach: logs each call, answers like the real one (JSON, ok/items).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-reach-'));
const LOG = path.join(tmp, 'calls.jsonl');
const FAKE = path.join(tmp, 'agent-reach.js');
const REACH = FAKE;
fs.writeFileSync(FAKE, `
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ a, home: process.env.HOME, proxy: process.env.HTTPS_PROXY || '' }) + '\\n');
const say = (o) => process.stdout.write(JSON.stringify(Object.assign({ schema_version: 1 }, o)));
if (a[0] === 'bilibili') say({ ok: false, items: [], error: { code: 'NEED_SETUP', message: 'bili is not installed' } });
else if (a[0] === 'github' && /ratelimitcase/.test(a[2] || '')) say({ ok: false, items: [], error: { code: 'RATE_LIMITED', message: 'GitHub API rate limit (60/hour without a token)' } });
else if (a[0] === 'web' && /ratelimitcase/.test(a[2] || '')) say({ ok: true, items: [] });
else if (a[0] === 'read') say({ ok: true, items: [{ title: 'gumyr/build123d', url: a[1], text: 'A python CAD library.' }] });
else say({ ok: true, channel: a[0], items: [{ title: a[0] + ' hit', url: 'https://reach.example/' + a[0], text: 'from ' + a[0] + ': ' + a[2] }] });
`);
process.env.TDH_AGENT_REACH = REACH;
process.env.TDH_AGENT_REACH_HOME = path.join(tmp, 'home');
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cn = require(path.join(SERVER, 'web-search.js'));
const gw = require(path.join(SERVER, 'gw-search.js'));
const fail = (w) => { console.error('SEARCH_ROUTE_PROVE_FAIL ' + w); process.exit(1); };

(async () => {
  for (const f of ['gw-search.js', 'web-search.js']) {
    if (/grok/i.test(fs.readFileSync(path.join(SERVER, f), 'utf8'))) fail(f + ' still mentions Grok');
  }
  const asked = [];
  const door = http.createServer((req, res) => {
    const b = [];
    req.on('data', (c) => b.push(c));
    req.on('end', () => {
      const j = JSON.parse(Buffer.concat(b).toString('utf8'));
      asked.push({ path: req.url, body: j });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: '结论：GB/T 33091-2016。', annotations: [{ url: 'https://openstd.samr.gov.cn/bzgk/std/x', title: '聚氨酯筛板' }] }] }] }));
    });
  });
  await new Promise((r) => door.listen(0, '127.0.0.1', r));
  const row = (q) => [{ url: 'https://example.cn/' + encodeURIComponent(q), title: q, snippet: q }];
  cn.engines.so360 = async (q) => row('so360 ' + q);
  cn.engines.bing = async (q) => row('bing ' + q);
  cn.engines.baidu = async () => [];
  const ctx = (sub) => ({ upFetch: async () => { throw new Error('offline'); }, port: door.address().port, note() {}, caller: 'proof', hasGptSearch: () => sub, searchProxy: () => 'http://127.0.0.1:7999' });

  let out = await gw.runSearch(ctx(true), '深搜 聚氨酯筛板标准', 5);
  if (!out.engines.length || out.engines[0].id !== 'gpt-deep') fail('深搜 did not go to deep search: ' + JSON.stringify(out.engines));
  const call = asked.pop();
  if (!call || call.path !== '/v1/responses' || !/^gpt-/.test(call.body.model)) fail('deep search did not ask a GPT model at the model door');
  if (!call.body.tools || call.body.tools[0].type !== 'web_search' || call.body.reasoning.effort !== 'low') fail('deep search request shape');
  if (/深搜/.test(call.body.input.split('问题：')[1])) fail('prefix not stripped from the question');
  if (out.sources[0].url.indexOf('openstd.samr.gov.cn') < 0) fail('deep search sources lost');

  out = await gw.runSearch(ctx(true), '聚氨酯筛板 国家标准编号是多少', 5);
  if (out.engines[0].id !== 'gpt-deep') fail('a standard-number question did not go deep by itself');

  const before = asked.length;
  out = await gw.runSearch(ctx(true), '烟台 聚氨酯 筛板 厂家', 5);
  if (asked.length !== before) fail('an everyday question went to deep search');
  if (!out.engines.some((e) => e.id === 'so360' && e.ok)) fail('everyday Chinese question did not use the engines: ' + JSON.stringify(out.engines));
  if (!/深搜/.test(out.content)) fail('everyday answer does not say how to ask for deep search');

  out = await gw.runSearch(ctx(false), '深搜 聚氨酯筛板标准', 5);
  if (asked.length !== before) fail('deep search ran without the subscription');
  if (!/没有接 GPT 订阅/.test(out.content)) fail('missing subscription not said: ' + out.content.slice(0, 80));
  if (/深搜」开头/.test(out.content)) fail('offers deep search on a site that has none');

  // Agent Reach is the route for standard search.
  out = await gw.runSearch(ctx(true), 'polyurethane screen panel supplier', 5);
  if (out.engines[0].id !== 'reach:web' || !out.engines[0].ok) fail('English question did not go to Agent Reach web: ' + JSON.stringify(out.engines));
  if (out.sources[0].url !== 'https://reach.example/web') fail('Agent Reach results lost');
  let c = calls().pop();
  if (c.a.join(' ') !== 'web search polyurethane screen panel supplier --limit 5') fail('Agent Reach called as ' + c.a.join(' '));
  if (c.home !== process.env.TDH_AGENT_REACH_HOME) fail('HOME not pointed at the Agent Reach home');
  out = await gw.runSearch(ctx(true), '烟台 聚氨酯 筛板 厂家', 5);
  const ids = out.engines.map((e) => e.id).join(',');
  if (ids !== 'reach:web,so360,bingcn') fail('Chinese question not asked of Agent Reach and the engines in China together: ' + ids);
  if (!out.sources.some((x) => x.url === 'https://reach.example/web') || !out.sources.some((x) => /so360/.test(x.url))) fail('Chinese results not woven');
  if (c.proxy && c.proxy !== process.env.HTTPS_PROXY) fail('web search was sent through the outbound proxy');
  // YouTube is blocked from inside China: its calls carry the outbound proxy.
  out = await gw.runSearch(ctx(true), 'youtube polyurethane screen panel', 5);
  c = calls().pop();
  if (c.a[0] !== 'youtube' || c.proxy !== 'http://127.0.0.1:7999') fail('YouTube search not sent through the outbound proxy: ' + JSON.stringify(c));
  out = await gw.runSearch(ctx(true), 'github build123d', 5);
  if (out.engines[0].id !== 'reach:web-github' || !out.engines[0].ok) fail('GitHub question not on Agent Reach web kept to github.com: ' + JSON.stringify(out.engines));
  const gh = calls().filter((x) => x.a[0] === 'web').pop();
  if (!gh || gh.a.join(' ') !== 'web search build123d site:github.com --limit 5') fail('GitHub question asked as ' + JSON.stringify(gh && gh.a));
  // Rate-limited: the GitHub channel rests instead of being asked again on the next search.
  await gw.runSearch(ctx(true), 'github ratelimitcase', 5);
  const ghCalls = () => calls().filter((x) => x.a[0] === 'github' && /ratelimitcase/.test(x.a[2])).length;
  if (ghCalls() !== 1) fail('rate-limited GitHub channel not asked once: ' + ghCalls());
  out = await gw.runSearch(ctx(true), 'github ratelimitcase', 5);
  const rest = out.engines.find((e) => e.id === 'reach:github');
  if (ghCalls() !== 1 || !rest || !/resting/.test(rest.err || '')) fail('rate-limited GitHub channel asked again: ' + JSON.stringify(out.engines));
  out = await gw.runSearch(ctx(true), 'bilibili 聚氨酯筛板', 5);
  const bili = out.engines.map((e) => e.id + ':' + e.ok).join(',');
  if (!/^reach:bilibili:0,bilibili:0,reach:web:1/.test(bili)) fail('a failing Agent Reach channel does not fall back in order: ' + bili);
  // Reading a link on a site Agent Reach knows; other links are not its business.
  const page = await gw.reachRead('https://github.com/gumyr/build123d');
  if (!page || page.statusCode !== 200 || !/python CAD library/.test(page.body.content)) fail('GitHub link not read through Agent Reach');
  if (calls().pop().a[0] !== 'read') fail('read not asked of Agent Reach');
  if (await gw.reachRead('https://www.example.com/x') !== null) fail('a plain page went to Agent Reach');
  // Not installed: the gateway's own calls answer, nothing breaks.
  fs.unlinkSync(REACH);
  const n0 = calls().length;
  out = await gw.runSearch(ctx(true), '烟台 聚氨酯 筛板 厂家', 5);
  if (calls().length !== n0) fail('called a missing Agent Reach');
  if (out.engines.map((e) => e.id).join(',') !== 'exa,so360,bingcn') fail('without Agent Reach the Chinese route is not Exa + engines: ' + out.engines.map((e) => e.id).join(','));
  if (await gw.reachRead('https://github.com/gumyr/build123d') !== null) fail('reading through a missing Agent Reach');

  door.close();
  console.log('SEARCH_ROUTE_PROVE_OK=1');
})().catch((e) => fail(String(e && e.stack || e)));
