#!/usr/bin/env node
// Prove the search route (company-search-route-v2): deep search is the ChatGPT subscription's own
// web search (no Grok anywhere), it runs when the query starts with 深搜 and when the question
// asks for an authority (a standard number, a regulation, a paper), an everyday question stays on
// the engines, and a site without the subscription says deep search is not available instead of
// pretending. Engines and the model door are stand-ins on loopback. Ends with SEARCH_ROUTE_PROVE_OK=1.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server');
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
  const ctx = (sub) => ({ upFetch: async () => { throw new Error('offline'); }, port: door.address().port, note() {}, caller: 'proof', hasGptSearch: () => sub });

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

  door.close();
  console.log('SEARCH_ROUTE_PROVE_OK=1');
})().catch((e) => fail(String(e && e.stack || e)));
