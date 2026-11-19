#!/usr/bin/env node
// company-krouter-hooks-v1: KRouter's own hooks on a TDH desk. The kernel's Claude-Code hook bridge
// (@deepseek-ai/dsh-hooks-claude-code, configured in overlay.yml) runs this with the hook's JSON on stdin:
//   start   (SessionStart)      the experience digest and standing index (下意识) of the company memory, and of the department's own
//                               for a department kept apart
//   prompt  (UserPromptSubmit)  the pages this message names by KRouter's trigger words and aliases; bringing
//                               one is what keeps a phrase in the hot cycle (60 days)
// KRouter runs on the company server (this desk has no Python), behind the knowledge service (route=hook).
// It never holds up or fails a turn: on any problem it prints nothing and exits 0.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const which = process.argv[2] === 'start' ? 'start' : 'prompt';
const EVENT = which === 'start' ? 'SessionStart' : 'UserPromptSubmit';
const HOST = '{{TDH_HOST}}';

function token() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.dsh-company-rc8', 'gw.token'), 'utf8').split(/\r?\n/)[0].trim();
  } catch (e) {
    return '';
  }
}

function readStdin(ms) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    const t = setTimeout(done, ms);
    process.stdin.on('data', (c) => { size += c.length; if (size <= 1 << 20) chunks.push(c); });
    process.stdin.on('end', () => { clearTimeout(t); done(); });
    process.stdin.on('error', () => { clearTimeout(t); done(); });
  });
}

function ask(body, ms) {
  return new Promise((resolve) => {
    const raw = Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: HOST, port: 8443, path: '/company/knowledge/v1/search', method: 'POST', rejectUnauthorized: false, timeout: ms,
      headers: { 'content-type': 'application/json', 'content-length': raw.length, authorization: 'Bearer ' + token() },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(raw);
  });
}

(async () => {
  if (HOST.indexOf('{{') === 0 || !token()) return;
  let payload = {};
  try { payload = JSON.parse((await readStdin(3000)) || '{}') || {}; } catch (e) { payload = {}; }
  const text = String(payload.prompt || '');
  if (which === 'prompt' && (!text.trim() || text.length > 1500)) return;
  const got = await ask({ route: 'hook', hook: which, text, session: String(payload.session_id || '') }, which === 'start' ? 10000 : 8000);
  const add = got && got.ok && got.text ? String(got.text) : '';
  if (!add) return;
  const context = which === 'start'
    ? '公司知识库（KRouter 每天夜里从大家的对话里编出的经验和已定的事；各段末尾写了怎么用）：\n\n' + add
    : add;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT, additionalContext: context } }) + '\n');
})().catch(() => {}).finally(() => { process.exitCode = 0; });
