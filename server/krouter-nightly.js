#!/usr/bin/env node
// company-krouter-nightly-v1: KRouter's own nightly upkeep for the TDH company memory, every night (TDH-Brain-Daily).
// KRouter does the work, unchanged (server/vendor/krouter); this only feeds it what a TDH server has.
//
//  1. Yesterday's conversations of every active person, read from their folder on the company share
//     (.dsh-desk/sessions, zstd JSONL), written as Claude Code transcripts, the format KRouter imports.
//  2. KRouter imports each person's into that person's own memory (personal/_memory): the session excerpts
//     stay private, like the conversations. It distils each session through the GPT subscription (the
//     gateway on this server) and writes experience cards (KROUTER_EXPERIENCE=1).
//  3. The new experience cards (lessons without the subject, KRouter's own rule) go into the company memory
//     (_shared/_memory), or for a department kept apart (行政财务) into its own; a card already there stays.
//  4. What the day's sessions did with the company's cards (adopted, seen again) is recorded on the company
//     memory (experience.record_uses). With the prompt hook's record (recalled.jsonl) that is the hot cycle's input.
//  5. The alias table keeps itself (company-krouter-auto-alias-v1): KRouter's alias drafts, the model's short nouns for
//     the pages in force that no alias names yet, applied through KRouter's own re-check; no one ticks (krouter_tdh.py).
//  6. KRouter's nightly on each company memory: standing index and trigger words, learned mentions,
//     reconsolidate, checkup; its report also runs the hot cycle (60 days unused: weighed down).
//
//   node krouter-nightly.js [--target yyyy-mm-dd] [--company-root D:\dsh\company] [--runtime-root D:\dsh\runtime]
//        [--python <python.exe>] [--local] [--dry-run]
//   --local: no model call (excerpts only, no distilling, no cards; the shared memories' model steps skipped).
//   --dry-run: convert and say what would be imported; nothing written into a memory.
// Prints KROUTER_NIGHTLY_OK=1, or KROUTER_NIGHTLY_PARTIAL=<n failed steps>.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./brain/lib');

const HERE = __dirname;
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const has = (n) => argv.indexOf('--' + n) >= 0;

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const COMPANY = arg('company-root', process.env.TDH_COMPANY || path.join(ROOT, 'company'));
const RUNTIME = arg('runtime-root', path.join(ROOT, 'runtime'));
const ROSTER = arg('people-roster', path.join(RUNTIME, 'roster.json'));
const PY = arg('python', process.env.TDH_PYTHON || (process.platform === 'win32' ? 'C:\\Program Files\\Python312\\python.exe' : 'python3'));
const TARGET = arg('target', lib.previousShanghaiDay());
const LOCAL = has('local');
const DRY = has('dry-run');
const MODEL = process.env.TDH_KROUTER_MODEL || 'gpt-6.2-sol';
const CARDS = path.join('02-methods', '经验卡'); // zones: 02 经验与方法/经验卡

function serviceKey() {
  try { return fs.readFileSync(path.join(RUNTIME, 'gw-service.token'), 'utf8').trim(); } catch (e) { return ''; }
}

function privateDepts(roster) {
  try {
    const z = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'kb-zones.json'), 'utf8'));
    if (z && Array.isArray(z.private)) return new Set(z.private.map(String));
  } catch (e) { /* by name */ }
  return new Set(((roster && roster.depts) || []).filter((d) => d && /财务/.test(String(d.name || ''))).map((d) => String(d.id)));
}

function zoneOf(person, apart) {
  const dept = String(person.dept || '');
  if (dept && apart.has(dept) && /^[A-Za-z0-9._-]+$/.test(dept)) return { key: 'dept:' + dept, dir: path.join(COMPANY, '_handbook', dept, '_memory') };
  return { key: 'shared', dir: path.join(COMPANY, '_shared', '_memory') };
}

const ZONES = '01 项目|01-projects\n02 经验与方法|02-methods\n03 资料与证据|03-evidence\n04 已完成与复盘|04-reviews\n05 时间日志|05-logs\n90 系统文件|90-system\nAgent第二大脑.md|README.md\n';
function ensureBank(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const d of ['01-projects', '02-methods', '03-evidence', '04-reviews', '05-logs', '90-system']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const z = path.join(dir, 'krouter-zones.psv');
  if (!fs.existsSync(z)) fs.writeFileSync(z, '# KRouter layer names -> this memory\'s folders\n' + ZONES, 'utf8');
}

// One person's conversations of the day as Claude Code transcripts (type user / assistant, origin human).
function transcripts(home, ymd, outDir) {
  const files = [];
  for (const root of [path.join(home, '.dsh-desk', 'sessions'), path.join(home, 'sessions')]) {
    for (const f of lib.walkNamed(root, 'session.jsonl.zstd').concat(lib.walkNamed(root, 'session.v4.jsonl.zstd'))) {
      let parsed;
      try { parsed = lib.parseSessionJsonl(lib.zstdToUtf8(f)); } catch (e) { continue; }
      if (!parsed || parsed.error || lib.activeDays(parsed.header, parsed.events).indexOf(ymd) < 0) continue;
      // KRouter names a page after the first 8 characters of the session id; DSH ids all start with "session-".
      const sid = String((parsed.header && parsed.header.id) || path.basename(path.dirname(f))).replace(/^session-/, '').replace(/[^A-Za-z0-9._-]/g, '-');
      const lines = [];
      if (parsed.header && parsed.header.title) lines.push({ type: 'custom-title', customTitle: String(parsed.header.title) });
      for (const ev of parsed.events) {
        if (!ev || typeof ev.time !== 'number' || lib.shanghaiParts(ev.time).ymd !== ymd) continue;
        const ts = new Date(ev.time).toISOString();
        if (ev.type === 'user/message' && !lib.isMachineNote(ev)) {
          const t = lib.eventText(ev).trim();
          if (t) lines.push({ type: 'user', timestamp: ts, cwd: home, sessionId: sid, origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: t }] } });
        } else if (ev.type === 'assistant/message') {
          const t = lib.eventText(ev).trim();
          if (t) lines.push({ type: 'assistant', timestamp: ts, sessionId: sid, message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
        }
      }
      if (!lines.some((l) => l.type === 'user')) continue;
      const out = path.join(outDir, 'tdh-desk', sid + '.jsonl');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
      files.push(out);
    }
  }
  return files;
}

function py(bank, args, env) {
  const r = spawnSync(PY, [path.join(HERE, 'krouter-run.py'), bank].concat(args), {
    encoding: 'utf8', windowsHide: true, timeout: 3 * 3600 * 1000, env: Object.assign({}, process.env, env),
  });
  return { rc: r.status, out: String(r.stdout || ''), err: String(r.stderr || '').trim().split(/\r?\n/).slice(-3).join(' | ') };
}

function laneEnv(transcriptDir) {
  const none = path.join(os.tmpdir(), 'tdh-krouter-none');
  const env = {
    PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_PROXY: '*',
    KROUTER_STATE_ROOT: path.join(RUNTIME, 'krouter-state'),
    KROUTER_CACHE_DIR: process.env.TDH_KROUTER_CACHE || path.join(RUNTIME, 'krouter-cache'),
    KROUTER_CLAUDE_PROJECTS: transcriptDir || none, KROUTER_CODEX_SESSIONS: none, KROUTER_CURSOR_PROJECTS: none,
    KROUTER_EXPERIENCE: LOCAL ? '0' : '1', KROUTER_HOT_DAYS: process.env.KROUTER_HOT_DAYS || '60',
  };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) env[k] = '';
  if (!LOCAL) {
    // KRouter's model lane, pointed at this server's gateway (the GPT subscription), with the gateway's service token.
    env.OPENAI_API_KEY = serviceKey();
    env.OPENAI_BASE_URL = 'http://127.0.0.1:8450/v1';
    env.KROUTER_DISTILL_MODEL = MODEL;
    env.KROUTER_LEARN_MODEL = MODEL;
  }
  return env;
}

function main() {
  const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8').replace(/^\uFEFF/, ''));
  const apart = privateDepts(roster);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-krouter-nightly-'));
  const started = Date.now();
  let failed = 0;
  const zones = new Map();
  const say = (s) => process.stdout.write(s + '\n');
  say('TARGET=' + TARGET + ' LOCAL=' + (LOCAL ? 1 : 0) + ' DRY=' + (DRY ? 1 : 0) + ' MODEL=' + (LOCAL ? '-' : MODEL));
  try {
    for (const p of roster.people || []) {
      if (!p || !p.login || (p.status && p.status !== 'active')) continue;
      const home = p.personal || p.workspace;
      if (!home || !fs.existsSync(home)) continue;
      const zone = zoneOf(p, apart);
      if (!zones.has(zone.key)) zones.set(zone.key, { zone, files: [] });
      const dir = path.join(work, String(p.login).replace(/[^A-Za-z0-9._-]/g, '-'));
      const files = transcripts(home, TARGET, dir);
      zones.get(zone.key).files.push(...files);
      if (!files.length) continue;
      const bank = path.join(home, '_memory');
      ensureBank(bank); // folders only: KRouter needs the bank to exist even to say what it would import
      // KRouter imports nothing before a yes. On a TDH server the yes is the company's (2026-11-19: every
      // conversation's experience is distilled into the company memory every day). It is recorded in that
      // person's own KRouter state the KRouter way (--consent, pointed at an empty folder: nothing imported).
      if (!DRY) {
        const c = py(bank, ['import_sessions.py', '--vault', bank, '--consent', '--local', '--days', '1'].concat(LOCAL ? [] : ['--distill']), laneEnv(path.join(work, '.none')));
        if (c.rc) { say('CONSENT|' + p.login + '|rc=' + c.rc + '|' + c.err); failed += 1; continue; }
      }
      const args = ['import_sessions.py', '--vault', bank].concat(...files.map((f) => ['--file', f]));
      if (DRY) args.push('--dry-run');
      else if (LOCAL) args.push('--local');
      else args.push('--distill');
      const r = py(bank, args, laneEnv(dir));
      say('IMPORT|' + p.login + '|sessions=' + files.length + '|rc=' + r.rc + (r.rc ? '|' + r.err : ''));
      if (r.rc) { failed += 1; continue; }
      if (DRY) continue;
      // 3. the person's new cards into the company memory (or the department's own)
      const mine = path.join(bank, CARDS);
      let moved = 0;
      let kept = 0;
      for (const f of lib.listMd(mine)) {
        if (fs.statSync(f).mtimeMs < started) continue;
        const to = path.join(zone.dir, CARDS, path.basename(f));
        if (fs.existsSync(to)) { kept += 1; continue; }
        ensureBank(zone.dir);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(f, to);
        moved += 1;
      }
      say('CARDS|' + p.login + '|to=' + zone.key + '|new=' + moved + '|already=' + kept);
    }
    // 4 and 5, for each company memory
    for (const { zone, files } of zones.values()) {
      if (DRY) { say('ZONE|' + zone.key + '|sessions=' + files.length + '|dry-run'); continue; }
      ensureBank(zone.dir);
      if (files.length) {
        const u = py(zone.dir, ['--record-uses'].concat(files), laneEnv(''));
        say('USES|' + zone.key + '|' + (u.out.match(/RECORD_USES=\d+/) || ['rc=' + u.rc])[0]);
        if (u.rc) failed += 1;
      }
      // company-krouter-auto-alias-v1: the alias table keeps itself (no one ticks); before the standing index is compiled.
      if (!LOCAL) {
        const a = py(zone.dir, ['--auto-aliases'], laneEnv(''));
        say('ALIASES|' + zone.key + '|' + (a.out.match(/AUTO_ALIASES=\d+ REFUSED=\d+/) || ['rc=' + a.rc + '|' + a.err])[0]);
        if (a.rc) failed += 1;
      }
      const steps = LOCAL ? 'compile_subconscious,learn_mentions,checkup' : 'compile_subconscious,learn_mentions,reconsolidate,checkup';
      const n = py(zone.dir, ['nightly.py', '--vault', zone.dir, '--steps', steps], laneEnv(''));
      const state = (n.out.match(/"nightly":\s*"([a-z-]+)"/) || [])[1] || 'unknown';
      say('NIGHTLY|' + zone.key + '|' + state + '|rc=' + n.rc + (n.rc ? '|' + n.err : ''));
      if (n.rc) failed += 1;
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  say(failed ? 'KROUTER_NIGHTLY_PARTIAL=' + failed : 'KROUTER_NIGHTLY_OK=1');
  return failed ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write('KROUTER_NIGHTLY_FAIL ' + String((e && e.stack) || e).slice(0, 400) + '\n');
  process.exitCode = 2;
}
