'use strict';
// Search/fetch door for the gateway. Desk clients only POST here.
// The route is Agent Reach (company-search-reach-v1; server\install-agent-reach.ps1 puts it in
// D:\dsh\tools): its web search (Exa) first, with 360 and Bing China beside it for Chinese
// questions (Agent Reach has no engine inside China), and its own channel for GitHub, Bilibili
// and YouTube questions; links on those sites are read through it too. Where it is not
// installed, or a channel of it fails, the gateway's own calls to the same services stand in. Deep search (the ChatGPT subscription searches and reads the pages
// itself) is the slow, thorough path. It runs
// when the query starts with 深搜, when the question asks for an authority (a standard, a
// regulation, a paper, an official source: lists of links are weakest there), and as the last
// resort when nothing else finds anything.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const cn = require('./web-search.js');
const dns = require('dns');
const net = require('net');

const SEARXNG = process.env.GW_SEARXNG_URL || 'http://127.0.0.1:8888';
const EXA_MCP = 'https://mcp.exa.ai/mcp';
const JINA = 'https://r.jina.ai/';
const MAX_FETCH = 120000;
const ENGINE_MS = 5000;
const EXA_MS = 12000;
const SEARCH_BUDGET_MS = 16000;
const FETCH_MS = 15000;
const YT_MS = 8000;
const REACH_MS = 8000;
const REACH = process.env.TDH_AGENT_REACH || 'D:\\dsh\\tools\\bin\\agent-reach.exe';
const REACH_HOME = process.env.TDH_AGENT_REACH_HOME || 'D:\\dsh\\runtime\\agent-reach-home';
// yt-dlp: the one Agent Reach installed (D:\\dsh\\tools\\uv-tools\\agent-reach\\Scripts), else PATH.
const YT_DLP = process.env.TDH_YT_DLP || 'D:\\dsh\\tools\\uv-tools\\agent-reach\\Scripts\\yt-dlp.exe';
// company-search-youtube-proxy-v1: youtube.com does not resolve to YouTube from inside China, and a
// direct connect hangs. Agent Reach sets NO_PROXY for its own loopback calls, and with any *_PROXY
// variable set Python stops reading the system proxy, so yt-dlp went direct. YouTube calls get the
// proxy named here; sites inside China stay direct.
const OUT_PROXY_CHANNELS = new Set(['youtube', 'twitter', 'reddit']);
const OUT_PROXY_HOSTS = /(?:^|\.)(?:youtube\.com|youtu\.be|x\.com|twitter\.com|reddit\.com)$/i;
function outProxy(ctx) {
  const p = ctx && typeof ctx.searchProxy === 'function' ? ctx.searchProxy() : '';
  return p && /^https?:\/\/[^\s]+$/i.test(p) ? p : '';
}

function mergeSignal(parent, ms) {
  const t = AbortSignal.timeout(ms);
  return parent ? AbortSignal.any([parent, t]) : t;
}

function asTimeout(e) {
  return e && (e.name === 'AbortError' || /aborted|timeout/i.test(String(e && e.message ? e.message : e)));
}

function asText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isGithubQuery(query) {
  return /github|site:github|stargazer|仓库|星标/i.test(String(query || ''));
}

function isCnPolicyQuery(query) {
  return /政策|扶持|补贴|工信|粤府|穗府|人民政府|\.gov\.cn/i.test(String(query || ''));
}

function isBiliQuery(query) {
  return /bilibili|b站|哔哩/i.test(String(query || ''));
}

function isYoutubeQuery(query) {
  return /youtube|youtu\.be/i.test(String(query || ''));
}

function hasChinese(query) {
  return /[\u4e00-\u9fff]/.test(String(query || ''));
}

function pickChannels(query, asked) {
  const q = String(query || '');
  if (asked && asked.length) {
    return [...new Set(asked.map((c) => String(c).toLowerCase()))];
  }
  // Agent Reach first; the gateway's own call to the same service behind it.
  if (isGithubQuery(q)) {
    return ['reach:github', 'github', 'bing'];
  }
  if (isBiliQuery(q)) {
    return ['reach:bilibili', 'bilibili', 'reach:web', 'exa'];
  }
  if (isYoutubeQuery(q)) {
    return ['reach:youtube', 'youtube', 'reach:web', 'exa'];
  }
  // A question in Chinese is mostly answered by pages inside China, which 360 and Bing (China)
  // find best: asked together with Agent Reach's web search (Exa), results woven.
  if (hasChinese(q)) return ['reach:web', 'so360', 'bingcn'];
  return ['reach:web', 'exa', 'bing'];
}

function pushSrc(out, seen, item) {
  const url = item && item.url ? String(item.url) : '';
  if (!url || seen.has(url)) return;
  seen.add(url);
  out.push({
    url,
    title: item.title ? String(item.title) : undefined,
    snippet: item.snippet ? String(item.snippet) : undefined,
    publishedAt: item.publishedAt ? String(item.publishedAt) : undefined
  });
}

async function doorFetch(upFetch, url, init, ms) {
  const next = Object.assign({}, init || {}, {
    signal: mergeSignal(init && init.signal, ms || ENGINE_MS)
  });
  try {
    try {
      const u = new URL(url);
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return await fetch(url, next);
    } catch {}
    return await upFetch(url, next);
  } catch (e) {
    if (asTimeout(e)) throw new Error('engine-timeout');
    throw e;
  }
}

async function jsonGet(upFetch, url, headers, signal) {
  const r = await doorFetch(upFetch, url, {
    headers: Object.assign({ accept: 'application/json' }, headers || {}),
    signal
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, body, text };
}

async function bingSearch(upFetch, query, n, signal) {
  const u = 'https://www.bing.com/search?q=' + encodeURIComponent(query)
    + '&setmkt=zh-CN&setlang=zh-Hans&count=' + n;
  const r = await doorFetch(upFetch, u, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      accept: 'text/html'
    },
    signal
  });
  const html = await r.text();
  if (!r.ok) throw new Error('bing-' + r.status);
  const sources = [];
  const seen = new Set();
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;
  let m;
  while ((m = re.exec(html)) && sources.length < n) {
    pushSrc(sources, seen, { url: m[1], title: asText(m[2]), snippet: asText(m[3] || '') });
  }
  if (!sources.length) throw new Error('bing-empty');
  return sources;
}

async function searxSearch(upFetch, query, n, signal) {
  const u = SEARXNG.replace(/\/$/, '') + '/search?q=' + encodeURIComponent(query)
    + '&format=json&language=zh-CN';
  const { ok, status, body } = await jsonGet(upFetch, u, null, signal);
  if (!ok || !body) throw new Error('searxng-' + status);
  const rows = Array.isArray(body.results) ? body.results : [];
  const sources = [];
  const seen = new Set();
  for (const row of rows) {
    if (sources.length >= n) break;
    pushSrc(sources, seen, {
      url: row.url,
      title: row.title,
      snippet: row.content || row.snippet
    });
  }
  if (!sources.length) throw new Error('searxng-empty');
  return sources;
}

function parseMcpSse(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (line.indexOf('data: ') === 0) {
      try { return JSON.parse(line.slice(6)); } catch {}
    }
  }
  try { return JSON.parse(text); } catch { return null; }
}

function mcpTextParts(msg) {
  const content = msg && msg.result && msg.result.content;
  const out = [];
  if (!Array.isArray(content)) return out;
  for (const part of content) {
    if (part && part.type === 'text' && part.text) out.push(String(part.text));
  }
  return out;
}

function parseExaSources(text, n, seen) {
  const sources = [];
  const bag = seen || new Set();
  const raw = String(text || '').trim();
  if (!raw) return sources;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  const rows = (parsed && parsed.results) || (parsed && parsed.data) || [];
  if (Array.isArray(rows) && rows.length) {
    for (const row of rows) {
      if (sources.length >= n) break;
      pushSrc(sources, bag, {
        url: row.url || row.id,
        title: row.title,
        snippet: row.text || row.snippet || row.summary
      });
    }
    return sources;
  }
  const chunks = raw.split(/\n(?=Title:\s)/);
  for (const chunk of chunks) {
    if (sources.length >= n) break;
    const url = ((chunk.match(/^URL:\s*(.+)$/m) || [])[1] || '').trim();
    const title = ((chunk.match(/^Title:\s*(.+)$/m) || [])[1] || '').trim();
    const hi = chunk.split(/Highlights:\s*/i)[1] || '';
    if (!url) continue;
    pushSrc(sources, bag, { url, title, snippet: asText(hi).slice(0, 400) });
  }
  return sources;
}

async function exaMcpCall(upFetch, tool, args, signal, ms) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  const init = await doorFetch(upFetch, EXA_MCP, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'company-gw-search', version: '1' }
      }
    })
  }, ms);
  if (!init.ok) throw new Error('exa-init-' + init.status);
  await init.text();
  await doorFetch(upFetch, EXA_MCP, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }, ms).catch(() => {});
  const call = await doorFetch(upFetch, EXA_MCP, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: tool, arguments: args }
    })
  }, ms);
  const callText = await call.text();
  if (!call.ok) throw new Error('exa-call-' + call.status);
  return mcpTextParts(parseMcpSse(callText)).join('\n');
}

async function exaSearch(upFetch, query, n, signal) {
  const text = await exaMcpCall(upFetch, 'web_search_exa', { query, numResults: n }, signal, EXA_MS);
  const sources = parseExaSources(text, n, new Set());
  if (!sources.length) throw new Error('exa-empty');
  return sources;
}

function githubQueryText(query) {
  const cleaned = String(query || '')
    .replace(/github|site:github\.com|stargazer|仓库|星标|stars?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(query || '');
}

async function githubSearch(upFetch, query, n, signal) {
  const u = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(githubQueryText(query))
    + '&per_page=' + n;
  const { ok, status, body } = await jsonGet(upFetch, u, { 'user-agent': 'company-gw-search' }, signal);
  if (!ok || !body) throw new Error('github-' + status);
  const sources = [];
  const seen = new Set();
  for (const row of body.items || []) {
    const descRaw = String(row.description || '');
    if (/<!DOCTYPE|<html[\s>]/i.test(descRaw)) continue;
    if (!row.html_url || !row.full_name) continue;
    pushSrc(sources, seen, {
      url: row.html_url,
      title: row.full_name,
      snippet: 'stars=' + (row.stargazers_count || 0)
        + ' lang=' + (row.language || '')
        + ' ' + asText(descRaw).slice(0, 160)
    });
  }
  if (!sources.length) throw new Error('github-empty');
  return sources;
}

async function biliSearch(upFetch, query, n, signal) {
  const u = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword='
    + encodeURIComponent(query) + '&page=1';
  const { ok, status, body } = await jsonGet(upFetch, u, { 'user-agent': 'company-gw-search' }, signal);
  if (!ok || !body) throw new Error('bilibili-' + status);
  const rows = (((body || {}).data || {}).result) || [];
  const sources = [];
  const seen = new Set();
  for (const row of rows) {
    if (sources.length >= n) break;
    const bvid = row.bvid || '';
    pushSrc(sources, seen, {
      url: bvid ? ('https://www.bilibili.com/video/' + bvid) : row.arcurl,
      title: asText(row.title || ''),
      snippet: asText(row.description || '')
    });
  }
  if (!sources.length) throw new Error('bilibili-empty');
  return sources;
}

async function wikiSearch(upFetch, query, n, signal) {
  const u = 'https://zh.wikipedia.org/w/api.php?action=opensearch&search='
    + encodeURIComponent(query) + '&limit=' + n + '&format=json';
  const { ok, status, body } = await jsonGet(upFetch, u, { 'user-agent': 'company-gw-search' }, signal);
  if (!ok || !Array.isArray(body)) throw new Error('wikipedia-' + status);
  const titles = body[1] || [];
  const descs = body[2] || [];
  const urls = body[3] || [];
  const sources = [];
  const seen = new Set();
  for (let i = 0; i < urls.length && sources.length < n; i++) {
    pushSrc(sources, seen, { url: urls[i], title: titles[i], snippet: descs[i] });
  }
  if (!sources.length) throw new Error('wikipedia-empty');
  return sources;
}

function ytSearch(query, n, signal, proxy) {
  return new Promise((resolve, reject) => {
    let bin = 'yt-dlp';
    try { if (fs.statSync(YT_DLP).isFile()) bin = YT_DLP; } catch {}
    const child = spawn(bin, [
      '--flat-playlist', '--no-warnings', '-J', '--socket-timeout', '6'
    ].concat(proxy ? ['--proxy', proxy] : []).concat(['ytsearch' + n + ':' + query]), { windowsHide: true });
    let out = '';
    let err = '';
    const fail = (msg) => {
      try { child.kill(); } catch {}
      reject(new Error(msg));
    };
    const t = setTimeout(() => fail('youtube-timeout'), YT_MS);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        fail('youtube-timeout');
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => {
      clearTimeout(t);
      reject(new Error('youtube-missing'));
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error('youtube-' + (code || err.slice(0, 40))));
      let j;
      try { j = JSON.parse(out); } catch (e) { return reject(new Error('youtube-parse')); }
      const rows = j.entries || [];
      const sources = [];
      const seen = new Set();
      for (const row of rows) {
        pushSrc(sources, seen, {
          url: row.url || row.webpage_url || (row.id ? ('https://www.youtube.com/watch?v=' + row.id) : ''),
          title: row.title,
          snippet: row.description || ''
        });
      }
      if (!sources.length) return reject(new Error('youtube-empty'));
      resolve(sources);
    });
  });
}

// One Agent Reach call: `agent-reach <channel> <action> ...`, JSON on stdout. HOME keeps its
// config out of the service account's profile.
function reachOn() {
  try { return fs.statSync(REACH).isFile(); } catch { return false; }
}

function reachCall(args, ms, signal, proxy) {
  return new Promise((resolve, reject) => {
    if (!reachOn()) return reject(new Error('reach-missing'));
    const env = Object.assign({}, process.env, { HOME: REACH_HOME, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    if (proxy) { env.HTTPS_PROXY = proxy; env.HTTP_PROXY = proxy; }
    // A .js stand-in (the proof) runs under this Node: Windows will not exec a .cmd without a shell.
    const js = /\.js$/i.test(REACH);
    const child = execFile(js ? process.execPath : REACH, js ? [REACH].concat(args) : args, { env, timeout: ms, maxBuffer: 8 << 20, windowsHide: true, encoding: 'utf8' }, (e, out) => {
      if (signal) signal.removeEventListener('abort', stop);
      let j = null;
      try { j = JSON.parse(String(out || '')); } catch {}
      if (j && j.ok === true) return resolve(j);
      const why = j && j.error ? (j.error.code || 'error') + ' ' + (j.error.message || '') : (e && e.killed ? 'reach-timeout' : String(e && e.message ? e.message : 'reach-bad-output'));
      reject(new Error('reach ' + why.slice(0, 100)));
    });
    const stop = () => { try { child.kill(); } catch {} };
    if (signal) signal.addEventListener('abort', stop, { once: true });
  });
}

function reachSearch(channel) {
  return async (upFetch, q, n, signal, ctx) => {
    const proxy = OUT_PROXY_CHANNELS.has(channel) ? outProxy(ctx) : '';
    const j = await reachCall([channel, 'search', q, '--limit', String(n)], REACH_MS, signal, proxy);
    const out = [];
    for (const it of Array.isArray(j.items) ? j.items : []) {
      if (!it || !it.url) continue;
      out.push({ url: String(it.url), title: it.title ? String(it.title) : undefined,
        snippet: it.text ? asText(String(it.text)).slice(0, 400) : (it.author ? String(it.author) : undefined),
        publishedAt: it.published_at ? String(it.published_at) : undefined });
    }
    if (!out.length) throw new Error('reach-empty');
    return out;
  };
}

// Links Agent Reach reads by their site (it knows how to get the content out of these).
const REACH_READ = /^(?:www\.)?(?:github\.com|bilibili\.com|b23\.tv|youtube\.com|youtu\.be|v2ex\.com|x\.com|twitter\.com|reddit\.com|xiaohongshu\.com|xueqiu\.com)$/i;

async function reachRead(url, ctx) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  if (!REACH_READ.test(host) || !reachOn()) return null;
  try {
    const j = await reachCall(['read', url], FETCH_MS, null, OUT_PROXY_HOSTS.test(host) ? outProxy(ctx) : '');
    const it = Array.isArray(j.items) && j.items[0];
    const text = it && (it.text || it.title) ? [it.title, it.author, it.text].filter(Boolean).join('\n\n') : '';
    if (!text) return null;
    const content = text.slice(0, MAX_FETCH);
    return { url: (it && it.url) || url, statusCode: 200, body: { kind: 'text', content }, truncated: text.length > MAX_FETCH };
  } catch {
    return null;
  }
}

const RUNNERS = {
  'reach:web': reachSearch('web'),
  'reach:github': reachSearch('github'),
  'reach:bilibili': reachSearch('bilibili'),
  'reach:youtube': reachSearch('youtube'),
  so360: (upFetch, q, n) => cn.engines.so360(q, n),
  bingcn: (upFetch, q, n) => cn.engines.bing(q, n),
  baidu: (upFetch, q, n) => cn.engines.baidu(q, n),
  bing: bingSearch,
  searxng: searxSearch,
  exa: exaSearch,
  github: githubSearch,
  bilibili: biliSearch,
  wikipedia: wikiSearch,
  youtube: (upFetch, q, n, signal, ctx) => ytSearch(q, n, signal, outProxy(ctx))
};

function msOf(id) {
  if (id.indexOf('reach:') === 0) return REACH_MS;
  return id === 'exa' ? EXA_MS : ENGINE_MS;
}

async function runOne(id, ctx, query, n, signal) {
  if (signal && signal.aborted) throw new Error('engine-timeout');
  const run = RUNNERS[id];
  if (!run) throw new Error('unknown');
  return run(ctx.upFetch, query, n, signal, ctx);
}

async function runChannels(ctx, channels, query, n) {
  const engines = [];
  const sources = [];
  const seen = new Set();
  const started = Date.now();
  for (const id of channels) {
    if (Date.now() - started >= SEARCH_BUDGET_MS) {
      engines.push({ id, ok: 0, n: 0, err: 'budget' });
      continue;
    }
    const ac = new AbortController();
    const ms = msOf(id);
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const rows = await Promise.race([
        runOne(id, ctx, query, n, ac.signal),
        new Promise((_, rej) => {
          setTimeout(() => {
            ac.abort();
            rej(new Error('engine-timeout'));
          }, ms);
        })
      ]);
      for (const row of rows) pushSrc(sources, seen, row);
      engines.push({ id, ok: 1, n: rows.length });
    } catch (e) {
      engines.push({ id, ok: 0, n: 0, err: String(e && e.message ? e.message : e).slice(0, 80) });
    } finally {
      clearTimeout(t);
    }
    if (sources.length) break;
  }
  return { engines, sources };
}

// Ask several channels at once and weave their results, best of each first.
async function runTogether(ctx, channels, query, n) {
  const got = await Promise.all(channels.map(async (id) => {
    const ac = new AbortController();
    const ms = msOf(id);
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const rows = await Promise.race([
        runOne(id, ctx, query, n, ac.signal),
        new Promise((_, rej) => setTimeout(() => rej(new Error('engine-timeout')), ms))
      ]);
      return { id, rows, engine: { id, ok: 1, n: rows.length } };
    } catch (e) {
      return { id, rows: [], engine: { id, ok: 0, n: 0, err: String(e && e.message ? e.message : e).slice(0, 80) } };
    } finally {
      clearTimeout(t);
    }
  }));
  const sources = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) for (const g of got) if (g.rows[i]) pushSrc(sources, seen, g.rows[i]);
  return { engines: got.map((g) => g.engine), sources: cn.clean(sources.map((x) => ({ url: x.url, title: x.title || x.url, snippet: x.snippet || '' })), n) };
}

const deepJobs = new Map();  // deep searches under way or finished: query -> { at, out, failed, run }

const DEEP_ASKED = /^(深搜|深度搜索|深度检索|deep)[\s:：]+/i;
// Questions whose answer is one authoritative page, which a list of links rarely puts first.
const DEEP_WORTH = /国家标准|行业标准|团体标准|标准号|标准编号|\bGB\s*\/?\s*T?\s*\d|\bISO\s*\d|\bASTM\b|\bDIN\s*\d|法规|条例|实施细则|管理办法|司法解释|官方出处|权威出处|原文出处|论文|文献|白皮书|指南原文|研究报告/i;

// Deep search needs the ChatGPT subscription on this site.
function deepOn(ctx) {
  return !!(ctx && typeof ctx.hasGptSearch === 'function' && ctx.hasGptSearch());
}

function wantsDeep(query) {
  const q = String(query || '');
  if (DEEP_ASKED.test(q)) return 'asked';
  if (DEEP_WORTH.test(q)) return 'auto';
  return '';
}

async function runSearch(ctx, query, maxResults, asked) {
  const n = Math.max(1, Math.min(Number(maxResults) || 8, 12));
  const via = deepOn(ctx);
  const deepTag = 'gpt-deep';
  const deep = !(asked && asked.length) ? wantsDeep(query) : '';
  query = String(query || '').replace(DEEP_ASKED, '').trim();
  let deepMissed = deep === 'asked' && !via ? '这台服务器没有接 GPT 订阅，深搜做不了，下面是普通搜索的结果。' : '';
  if (deep && via && ctx.port) {
    // The model reads the pages and answers with its sources, which can take
    // most of a minute, and the desk ends a tool call after one minute. So the work
    // goes on in the background: this call waits 40 seconds for it, and if it
    // is not done the everyday engines answer now and the same query asked
    // again picks the finished answer up.
    const key = query + '|' + n;
    let job = deepJobs.get(key);
    if (!job || (job.failed && Date.now() - job.at > 5000) || Date.now() - job.at > 20 * 60000) {
      job = { at: Date.now(), out: null, failed: false };
      job.run = cn.engines.deep(query, n, ctx.port, 150000).then((out) => { job.out = out; }, () => { job.failed = true; });
      deepJobs.set(key, job);
      if (deepJobs.size > 60) deepJobs.delete(deepJobs.keys().next().value);
    }
    if (!job.out && !job.failed) await Promise.race([job.run, new Promise((r) => setTimeout(r, 40000))]);
    if (job.out) return { content: job.out.content, sources: job.out.sources, truncated: false, engines: [{ id: deepTag, ok: 1, n: job.out.sources.length }] };
    deepMissed = job.failed
      ? '深搜这次没有成功，下面是普通搜索的结果。'
      : '深搜还在查（通常再等二三十秒）。下面先给普通搜索的结果；要深搜的权威出处，用一模一样的查询再搜一次就能取到。';
  }
  let channels = pickChannels(query, asked);
  if (!(asked && asked.length) && !reachOn()) channels = channels.map((c) => (c === 'reach:web' ? 'exa' : c)).filter((c) => c.indexOf('reach:') !== 0);
  channels = [...new Set(channels)];
  const together = !(asked && asked.length) && hasChinese(query) && channels.indexOf('so360') >= 0 && !isGithubQuery(query) && !isBiliQuery(query) && !isYoutubeQuery(query);
  let { engines, sources } = together ? await runTogether(ctx, channels, query, n) : await runChannels(ctx, channels, query, n);
  if (!sources.length && !(asked && asked.length)) {
    const need = [];
    if (channels.indexOf('exa') < 0) need.push('exa');
    if (channels.indexOf('bing') < 0) need.push('bing');
    if (need.length) {
      const second = await runChannels(ctx, need, query, n);
      engines = engines.concat(second.engines);
      sources = second.sources;
    }
    if (!sources.length && via && ctx.port && !deepMissed) {
      try {
        const out = await cn.engines.deep(query, n, ctx.port, 36000);
        return { content: out.content, sources: out.sources, truncated: false, engines: engines.concat([{ id: deepTag, ok: 1, n: out.sources.length }]) };
      } catch (e) {
        engines.push({ id: deepTag, ok: 0, n: 0, err: String(e && e.message ? e.message : e).slice(0, 80) });
      }
    }
  }
  const live = engines.filter((e) => e.ok).map((e) => e.id);
  if (!sources.length) {
    const err = engines.map((e) => e.id + ':' + (e.err || 'ok')).join(',');
    const fail = new Error('search-empty ' + err);
    fail.engines = engines;
    throw fail;
  }
  return {
    content: (deepMissed ? deepMissed + ' ' : '') + 'engines: ' + live.join(',')
      + '. snippets are page highlights. answer now. do not web_fetch unless one URL is still missing a number.'
      + (via ? ' 要查权威出处、论文、指南、要多个来源互相核对的，把查询改成以「深搜 」开头再搜一次（模型联网检索，约 20–40 秒）。' : ''),
    sources,
    truncated: sources.length > n,
    engines
  };
}

// /fetch reads public pages only. privateUrl() looks at the address as written; the
// guard below looks at where the name really resolves, at connect time and on every
// redirect hop, so a public-looking name that points inside, or a redirect to an
// office address, is refused too. fetchGuardTest lets the proof map names and
// mark addresses as public without real DNS.
const fetchGuardTest = { allow: new Set(), resolve: {} };
// Eight 16-bit groups of an IPv6 address (handles "::" and a dotted IPv4 tail).
function ip6Groups(s) {
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const p = dotted.slice(1).map(Number);
    s = s.slice(0, -dotted[0].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const parse = (part) => (part ? part.split(':').map((x) => parseInt(x, 16)) : []);
  if (!s.includes('::')) return parse(s);
  const [head, rest] = s.split('::');
  const a = parse(head);
  const b = parse(rest);
  return a.concat(new Array(Math.max(0, 8 - a.length - b.length)).fill(0), b);
}
function v4Of(hi, lo) {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}
function privateIp(ip) {
  if (fetchGuardTest.allow.has(ip)) return false;
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    // 198.18.0.0/15 is left out on purpose: a proxy's fake-ip DNS (Clash TUN on the
    // server) answers every public name from it, so blocking it blocks every page.
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
      || (a === 192 && b === 0 && c === 0);
  }
  if (v === 6) {
    const g = ip6Groups(ip.toLowerCase());
    if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
    const zero = (from, to) => g.slice(from, to).every((x) => x === 0);
    if (zero(0, 8) || (zero(0, 7) && g[7] === 1)) return true;                   // :: and ::1
    if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return privateIp(v4Of(g[6], g[7])); // v4-mapped / v4-compatible
    if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return privateIp(v4Of(g[6], g[7])); // NAT64 64:ff9b::/96
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;              // local-use NAT64 64:ff9b:1::/48
    if (g[0] === 0x2002) return privateIp(v4Of(g[1], g[2]));                        // 6to4 2002::/16
    const top = g[0] >> 8;
    return top === 0xfc || top === 0xfd || top === 0xff || (g[0] & 0xffc0) === 0xfe80;
  }
  return true;
}
function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  const done = (err, addrs) => {
    if (err) return cb(err);
    if (!addrs || !addrs.length || addrs.some((a) => privateIp(a.address))) {
      const e = new Error('fetch-blocked');
      e.statusCode = 400;
      return cb(e);
    }
    if (options && options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  };
  const fixed = fetchGuardTest.resolve[hostname];
  if (fixed) return done(null, [{ address: fixed, family: net.isIP(fixed) }]);
  dns.lookup(hostname, Object.assign({}, options, { all: true }), done);
}
const GUARD = { lookup: guardedLookup, guardIp: privateIp };

function privateUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (h === '::1' || h === '[::1]') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function isGithubApiUrl(raw) {
  try {
    return new URL(String(raw || '')).hostname.toLowerCase() === 'api.github.com';
  } catch {
    return false;
  }
}

function isCnGovUrl(raw) {
  try {
    return /(^|\.)gov\.cn$/i.test(new URL(String(raw || '')).hostname);
  } catch {
    return false;
  }
}

async function readFetched(r) {
  let text = await r.text();
  let truncated = false;
  if (text.length > MAX_FETCH) {
    text = text.slice(0, MAX_FETCH);
    truncated = true;
  }
  return { text, truncated, status: r.status };
}

async function runFetch(upFetch, url) {
  if (privateUrl(url)) {
    const err = new Error('fetch-blocked');
    err.statusCode = 400;
    throw err;
  }
  if (isGithubApiUrl(url)) {
    const r = await doorFetch(upFetch, url, {
      headers: { accept: 'application/json', 'user-agent': 'company-gw-search' }
    }, FETCH_MS);
    const got = await readFetched(r);
    return {
      url,
      statusCode: got.status,
      body: { kind: 'text', content: got.text },
      truncated: got.truncated
    };
  }
  const ua = { 'user-agent': 'company-gw-search', accept: 'text/html,text/plain' };
  // Agent Reach's order for reading a page: Exa's reader, then the page itself, then Jina's reader
  const order = isCnGovUrl(url) ? ['direct', 'exa', 'jina'] : ['exa', 'direct', 'jina'];
  let lastErr = null;
  for (let i = 0; i < order.length; i++) {
    try {
      if (order[i] === 'jina') {
        const r = await doorFetch(upFetch, JINA + url, { headers: { accept: 'text/plain', 'user-agent': 'company-gw-search' } }, FETCH_MS);
        const got = await readFetched(r);
        if (got.status >= 200 && got.status < 300 && got.text) {
          return { url, statusCode: 200, body: { kind: 'text', content: got.text }, truncated: got.truncated };
        }
        continue;
      }
      if (order[i] === 'exa') {
        const text = await exaMcpCall(upFetch, 'web_fetch_exa', { urls: [url], maxCharacters: 8000 }, null, EXA_MS);
        if (text && text.trim()) {
          let out = text;
          let truncated = false;
          if (out.length > MAX_FETCH) {
            out = out.slice(0, MAX_FETCH);
            truncated = true;
          }
          return { url, statusCode: 200, body: { kind: 'text', content: out }, truncated };
        }
        continue;
      }
      if (hasChinese(url) || /\.cn(\/|$)|baidu\.|sohu\.|sina\.|163\.|qq\.com|zhihu\.|toutiao\.|so\.com/.test(url)) {
        // many sites inside China still send GBK; this reader knows
        const page = await cn.fetchPage(url, GUARD);
        if (page.statusCode >= 200 && page.statusCode < 500 && page.body.content) {
          const txt = page.body.kind === 'html' ? cn.text(page.body.content) : page.body.content;
          return { url: page.url, statusCode: page.statusCode, body: { kind: 'text', content: txt.slice(0, MAX_FETCH) }, truncated: txt.length > MAX_FETCH };
        }
      }
      const page = await cn.get(url, Object.assign({ timeout: ENGINE_MS, maxBytes: 4e6, headers: ua }, GUARD));
      const text = cn.decode(page);
      if (page.status >= 200 && page.status < 500 && text) {
        return {
          url,
          statusCode: page.status,
          body: { kind: 'text', content: text.slice(0, MAX_FETCH) },
          truncated: text.length > MAX_FETCH
        };
      }
    } catch (e) {
      if (e && e.message === 'fetch-blocked') throw e;
      lastErr = e;
    }
  }
  return {
    url,
    statusCode: 504,
    body: {
      kind: 'text',
      content: 'fetch-timeout. web_fetch the next web_search result URL. do not open ego-browser or baidu.com/s for public pages.'
    },
    truncated: false,
    error: lastErr ? String(lastErr.message || lastErr).slice(0, 80) : 'fetch-timeout'
  };
}

async function handleSearch(res, body, ctx) {
  let q = '';
  let maxResults = 8;
  let asked = [];
  try {
    const j = JSON.parse(body.toString('utf8') || '{}');
    q = String(j.query || j.q || '').trim();
    maxResults = j.maxResults || j.max_results || 8;
    if (Array.isArray(j.channels)) asked = j.channels;
  } catch {}
  if (!q) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'query-missing' } }));
    return;
  }
  ctx.note('GW_SEARCH pid=' + ctx.caller + ' qlen=' + q.length);
  try {
    const out = await runSearch(ctx, q, maxResults, asked);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out));
  } catch (e) {
    ctx.note('GW_SEARCH_ERR pid=' + ctx.caller + ' err=' + String(e && e.message ? e.message : e).slice(0, 160));
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'search-failed' }, engines: e.engines || [] }));
  }
}

async function handleFetch(res, body, ctx) {
  let url = '';
  try {
    const j = JSON.parse(body.toString('utf8') || '{}');
    url = String(j.url || '').trim();
  } catch {}
  if (!url) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'url-missing' } }));
    return;
  }
  ctx.note('GW_FETCH pid=' + ctx.caller);
  try {
    // A link on GitHub, Bilibili, YouTube and the like: Agent Reach reads it by its site. Those
    // hosts are public by name, so the private-address guard below has nothing to add for them.
    const out = (await reachRead(url, ctx)) || await runFetch(ctx.upFetch, url);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out));
  } catch (e) {
    const code = e && e.statusCode === 400 ? 400 : 502;
    ctx.note('GW_FETCH_ERR pid=' + ctx.caller + ' err=' + String(e && e.message ? e.message : e).slice(0, 80));
    res.statusCode = code;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: e && e.message ? e.message : 'fetch-failed' } }));
  }
}

module.exports = {
  fetchGuardTest,
  fetchGuard: GUARD,
  privateIp,
  handleSearch,
  handleFetch,
  pickChannels,
  runSearch,
  runFetch,
  reachRead,
  parseExaSources,
  ENGINE_MS,
  EXA_MS,
  SEARCH_BUDGET_MS,
  FETCH_MS
};
