'use strict';

// Company knowledge search. Listens on loopback only; the LAN reaches it
// through the login site at /company/knowledge (Caddy strips that prefix).
//
// Every search needs the gateway token a person got at login (Authorization:
// Bearer dsh_... or X-Company-Gw-Token). The token must be live in
// gw-tokens.json and belong to an active person on the roster, so revoking a
// token or disabling a person cuts search off at once. Name headers such as
// X-Auth-Request-User are ignored: anyone can type a name into a header.
//
// What a person can find is decided by where a file sits, then narrowed by its
// frontmatter; frontmatter never widens it. visibility: self = the owner, the
// director of the owner's department and admins; dept = that department; boss =
// admins; company = no narrowing. By folder:
//   everyone   company/_handbook/_company     documents for the whole company
//              company/_shared/_memory        company memory (admins and directors write it)
//              brain/30-lessons, 00-company   corrections, company facts
//              their own personal _memory and their own daily pages (11-l1, 10-logs)
//   department company/_handbook/<dept> of a department kept apart (runtime/kb-zones.json, below),
//              brain/20-l2/<dept>
//   everyone   company/_handbook/<dept> of every other department: the shared knowledge base
//   director   + the daily pages and inbox of their department
//   admin      every handbook, every daily page and lesson, the boss inbox
// Raw conversations (brain/10-l0) never come up in a search; they are read one
// file at a time by path (evidence), by their owner, the director of that
// department, or an admin. brain/90-system is never served.
//
// Ranking, passages and office files: kb-index.js.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { createIndex } = require('./kb-index');

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const BRAIN = process.env.TDH_BRAIN || path.join(ROOT, 'brain');
const COMPANY = process.env.TDH_COMPANY || path.join(ROOT, 'company');
const PORT = Number(process.env.TDH_KNOW_PORT || 4182);
const TOKENS = process.env.TDH_GW_TOKENS || path.join(ROOT, 'runtime', 'gw-tokens.json');
const ROSTER = process.env.TDH_ROSTER || path.join(ROOT, 'runtime', 'roster.json');
const LOG = process.env.TDH_KNOW_LOG || path.join(ROOT, 'logs', 'knowledge-search.log');
const LIMIT = 24;
// Text already pulled out of PDFs, so a restart does not read them again. Safe to delete.
const CACHE = process.env.TDH_KB_CACHE || path.join(ROOT, 'runtime', 'kb-cache');

// OCR for scanned PDFs and pictures, and old Office files (.doc .xls .ppt .wps .et .dps):
// on once server\install-ocr.ps1 has set up its venv and written runtime\ocr.json (it does
// so only after reading a test image correctly). Both run from that venv.
function venvTool(envExe, envArgs, script) {
  if (process.env[envExe]) return { exe: process.env[envExe], args: JSON.parse(process.env[envArgs] || '[]') };
  const j = readJson(path.join(ROOT, 'runtime', 'ocr.json'));
  if (j && j.python && fs.existsSync(j.python)) return { exe: j.python, args: ['-I', path.join(__dirname, script)] };
  return null;
}

const index = createIndex({
  skipDir: (name) => name.charAt(0) === '.' || name === 'node_modules' || name === '90-system',
  cacheDir: CACHE,
  ocr: venvTool('TDH_OCR_EXE', 'TDH_OCR_ARGS', 'ocr.py'),
  legacy: venvTool('TDH_LEGACY_EXE', 'TDH_LEGACY_ARGS', 'legacy-office.py'),
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}

function tokenOf(req) {
  const h = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  return String(req.headers['x-company-gw-token'] || '').trim();
}

// The person behind a live token, or null when there is none.
function personOf(token) {
  if (!token || token.indexOf('dsh_') !== 0) return null;
  const store = readJson(TOKENS);
  const rows = store && Array.isArray(store.tokens) ? store.tokens : [];
  const hit = rows.find((r) => r && !r.revoked_at && String(r.token || '') === token);
  if (!hit || !hit.pid) return null;
  const roster = readJson(ROSTER);
  const people = roster && Array.isArray(roster.people) ? roster.people : [];
  const who = people.find((p) => p && String(p.pid || '') === String(hit.pid));
  if (!who || !who.login || (who.status || 'active') !== 'active') return null;
  const login = String(who.login);
  const role = ['admin', 'director'].indexOf(String(who.role || '')) >= 0 ? String(who.role) : 'employee';
  const dept = String(who.dept || '');
  // The brain files admins (and anyone without a department) under "boss" (homes-from-share.js).
  const bdept = role === 'admin' || !dept || dept === '*' || dept === 'company' ? 'boss' : dept;
  return { login, role, dept, bdept };
}

function audit(login, route, hits) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), login, route, hits }) + '\n');
  } catch (e) { /* the search still answers */ }
}

const safe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]/g, '');
const B = (...p) => path.join(BRAIN, ...p);
const C = (...p) => path.join(COMPANY, ...p);

// <brain>/<layer>/<any dept>/<login>: a person's own pages stay theirs when they change department.
function ownDirs(layer, login) {
  let depts = [];
  try { depts = fs.readdirSync(B(layer), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return []; }
  return depts.map((d) => B(layer, d, login));
}

function personalMemory(person) {
  return person.role === 'admin' ? C('_office', '_memory') : C('content', 'emp-' + safe(person.login), '_memory');
}

// company-kb-zones-v1: the company knowledge base is one shared base, except the departments
// listed in runtime/kb-zones.json { "private": ["<dept id>", ...] } (行政财务), whose handbook only
// that department and admins open. No file: a department whose name has 财务 in it is kept apart.
// secure-folders.ps1 reads the same file, so the share's folder rights agree with the search.
const ZONES = process.env.TDH_KB_ZONES || path.join(ROOT, 'runtime', 'kb-zones.json');
function privateDepts() {
  const z = readJson(ZONES);
  if (z && Array.isArray(z.private)) return new Set(z.private.map((d) => safe(d)).filter(Boolean));
  const roster = readJson(ROSTER);
  const depts = roster && Array.isArray(roster.depts) ? roster.depts : [];
  return new Set(depts.filter((d) => d && /财务/.test(String(d.name || ''))).map((d) => safe(d.id)).filter(Boolean));
}
function handbookDepts() {
  let names = [];
  try { names = fs.readdirSync(C('_handbook'), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '_company').map((d) => d.name); } catch (e) { return []; }
  return names;
}

function roots(person) {
  const out = [
    C('_handbook', '_company'),
    C('_shared', '_memory'),
    B('30-lessons'),
    B('00-company'),
    personalMemory(person),
  ].concat(ownDirs('11-l1', person.login), ownDirs('10-logs', person.login));
  if (person.role === 'admin') {
    return out.concat([C('_handbook'), B('20-l2'), B('11-l1'), B('10-logs'), B('_inbox')]);
  }
  const d = safe(person.dept);
  const bd = safe(person.bdept);
  const apart = privateDepts();
  for (const h of handbookDepts()) if (!apart.has(h) && h !== d) out.push(C('_handbook', h));
  if (d) out.push(C('_handbook', d));
  if (bd) out.push(B('20-l2', bd));
  if (person.role === 'director' && bd) out.push(B('11-l1', bd), B('10-logs', bd), B('_inbox', 'director', bd));
  return out;
}

function under(root, full) {
  const a = path.resolve(root).toLowerCase();
  const b = path.resolve(full).toLowerCase();
  return b === a || b.indexOf(a.endsWith(path.sep) ? a : a + path.sep) === 0;
}

// Frontmatter can only narrow what the folder already allows.
function fmAllows(person, fm) {
  const vis = String((fm && fm.visibility) || '').trim();
  if (person.role === 'admin' || !vis || vis === 'company') return true;
  if (fm.owner && String(fm.owner) === person.login) return true;
  const sameDept = [person.dept, person.bdept].indexOf(String(fm.dept || '')) >= 0;
  // self: the owner, the director of the owner's department, admins.
  if (vis === 'self') return person.role === 'director' && sameDept;
  if (vis === 'boss') return false;
  if (vis === 'dept') return sameDept;
  return true;
}

// Raw conversations and daily pages, one file by path: owner, their director, admin.
function evidenceAllows(person, full) {
  if (!under(BRAIN, full) || under(B('90-system'), full)) return false;
  const rel = path.relative(BRAIN, full).split(path.sep);
  if (rel[0] !== '10-l0' && rel[0] !== '11-l1' && rel[0] !== '10-logs') {
    return roots(person).some((r) => under(r, full));
  }
  if (person.role === 'admin') return true;
  if (rel[2] === person.login) return true;
  return person.role === 'director' && rel[1] === person.bdept;
}

function relName(full) {
  if (under(COMPANY, full)) return 'company/' + path.relative(COMPANY, full).split(path.sep).join('/');
  return path.relative(BRAIN, full).split(path.sep).join('/');
}

function layerOf(full) {
  const r = relName(full);
  if (/^10-l0\//.test(r)) return 'evidence';
  if (/^company\/_handbook\//.test(r)) return 'handbook';
  if (/\/_memory\//.test(r)) return 'memory';
  if (/^(11-l1|10-logs)\//.test(r)) return 'daily';
  if (/^(20-l2|30-lessons|00-company)\//.test(r)) return 'lesson';
  if (/^_inbox\//.test(r)) return 'inbox';
  return 'lookup';
}

// A hit in a PDF, deck or workbook says which page or sheet: line numbers of extracted text
// mean nothing to the person who opens the file.
function hit(h) {
  const doc = h.section && !/\.(md|txt)$/i.test(h.full);
  // The page heading is in the passage too; once it is in front, drop the copy.
  let text = h.text;
  if (doc) {
    const head = text.match(/^#{1,6} /);
    if (head && text.slice(head[0].length).startsWith(h.section)) text = text.slice(head[0].length + h.section.length).trim();
    text = '〔' + h.section + '〕 ' + text;
  }
  return { layer: layerOf(h.full), path: relName(h.full), line: h.line, text, title: h.title };
}

function resolveNamed(named) {
  let p = String(named || '').trim().replace(/\\/g, '/');
  if (!p) return '';
  if (/^[A-Za-z]:\//.test(p) || p.charAt(0) === '/') {
    const abs = path.resolve(p);
    return under(BRAIN, abs) || under(COMPANY, abs) ? abs : '';
  }
  p = p.replace(/^\/+/, '');
  if (p.indexOf('company/') === 0) return path.resolve(COMPANY, p.slice('company/'.length));
  return path.resolve(BRAIN, p);
}

// company-krouter-memory-v1: the memory layer (this person's own memory and the company memory) is
// also asked of KRouter (server/krouter-recall.py, pinned in server/vendor/krouter), one bank per
// folder, so its ranking and refusal never draw on a page the person cannot open. What KRouter is
// sure of goes first; the handbook search below still answers everything and stands in when
// KRouter is not there. Off with TDH_KROUTER=0.
const KR_ON = process.env.TDH_KROUTER !== '0';
const KR_SCRIPT = path.join(__dirname, 'krouter-recall.py');
const KR_CACHE = process.env.TDH_KROUTER_CACHE || path.join(ROOT, 'runtime', 'krouter-cache');
const KR_MS = Number(process.env.TDH_KROUTER_MS || 6000);
function krPython() {
  if (process.env.TDH_KROUTER_PYTHON) return process.env.TDH_KROUTER_PYTHON;
  if (process.platform === 'win32') {
    const p = 'C:\\Program Files\\Python312\\python.exe';
    return fs.existsSync(p) ? p : 'python';
  }
  return 'python3';
}
let kr = null;       // { child, buf, waiting: [resolve] }
let krChain = Promise.resolve();
let krVersion = '';
function krStart() {
  if (kr || !KR_ON || !fs.existsSync(KR_SCRIPT)) return kr;
  let child;
  try {
    child = spawn(krPython(), ['-u', KR_SCRIPT], {
      env: { ...process.env, KROUTER_CACHE_DIR: KR_CACHE, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch (e) { return null; }
  const me = { child, buf: '', waiting: [] };
  child.stdout.on('data', (c) => {
    me.buf += c.toString('utf8');
    let i;
    while ((i = me.buf.indexOf('\n')) >= 0) {
      const line = me.buf.slice(0, i);
      me.buf = me.buf.slice(i + 1);
      const w = me.waiting.shift();
      if (w) { let j = null; try { j = JSON.parse(line); } catch (e) { j = null; } w(j); }
    }
  });
  const gone = () => { if (kr === me) kr = null; for (const w of me.waiting.splice(0)) w(null); };
  child.on('exit', gone);
  child.on('error', gone);
  kr = me;
  return kr;
}
// One question at a time on the one process; a slow or dead one is replaced.
function krAsk(req) {
  const run = () => new Promise((resolve) => {
    const k = krStart();
    if (!k) return resolve(null);
    const t = setTimeout(() => { try { k.child.kill(); } catch (e) { /* gone */ } resolve(null); }, KR_MS);
    k.waiting.push((j) => { clearTimeout(t); resolve(j); });
    try { k.child.stdin.write(JSON.stringify(req) + '\n'); } catch (e) { clearTimeout(t); resolve(null); }
  });
  const p = krChain.then(run, run);
  krChain = p.then(() => null, () => null);
  return p;
}
function memoryBanks(person) {
  return [{ name: 'personal', dir: personalMemory(person) }, { name: 'company', dir: C('_shared', '_memory') }];
}
// How many of a bank's hits to take, by how sure KRouter is. A small bank (a new person's memory)
// often says "none" with the right page first; one strong match of the question's words lets that
// first page through.
function krTake(bank) {
  const c = String(bank.confidence || 'none');
  if (c === 'high' || c === 'medium') return 3;
  if (c === 'low') return 2;
  return Number(bank.strong) >= 1 ? 1 : 0;
}
async function krouterHits(person, query) {
  if (!KR_ON || !query) return [];
  const banks = memoryBanks(person).filter((b) => fs.existsSync(b.dir));
  if (!banks.length) return [];
  const got = await krAsk({ query, limit: 6, banks });
  if (!got || !got.ok || !Array.isArray(got.banks)) return [];
  const out = [];
  for (const b of got.banks) {
    const dir = (banks.find((x) => x.name === b.name) || {}).dir;
    if (!dir) continue;
    for (const h of (b.hits || []).slice(0, krTake(b))) {
      const full = path.resolve(dir, String(h.rel || ''));
      if (!under(dir, full) || !fs.existsSync(full)) continue;
      const doc = index.docs([full])[0];
      if (doc && !fmAllows(person, doc.doc.fm)) continue;
      if (String(h.status || '') === 'superseded') continue;
      // KRouter picks the page; the passage shown is the one in it that answers the question
      // (its own `how` line is the page's first rule, which may be about something else).
      // A passage that is only the page's heading says nothing; then the page's first rule is shown.
      const passage = index.search([full], [query], { limit: 1, perFile: 1 })[0];
      const shown = passage ? hit(passage) : null;
      if (shown && !/^#{1,6} [^\n]*$/.test(String(shown.text || '').trim())) out.push(Object.assign(shown, { via: 'krouter' }));
      else out.push({ layer: 'memory', path: relName(full), line: Number(h.line) || 1, text: String(h.how || (shown && shown.text) || ''), title: path.basename(full, path.extname(full)), via: 'krouter' });
    }
  }
  return out;
}

async function search(person, body) {
  const route = String(body.route || 'search');
  const query = String(body.query || '').trim();
  const who = { account: person.login, role: person.role, dept: person.dept };
  if (route === 'status') {
    if (!krVersion && KR_ON) { const p = await krAsk({ ping: true }); krVersion = (p && p.version) || ''; }
    return { ok: true, status: 'ok', ...who, layer: 'lookup', hits: [], index: index.stats(), krouter: krVersion ? { version: krVersion, banks: memoryBanks(person).map((b) => b.name) } : null };
  }
  const named = String(body.path || body.evidence_path || '').trim();
  if (body.evidence && !named) return { ok: false, status: 'evidence-need-path', ...who, hits: [] };
  if (named) {
    const full = resolveNamed(named);
    const doc = full && fs.existsSync(full) ? index.docs([full])[0] : null;
    if (!doc || !evidenceAllows(person, full) || !fmAllows(person, doc.doc.fm)) {
      return { ok: true, status: 'not-found', ...who, evidence: true, layer: 'evidence', hits: [] };
    }
    let found = query ? index.search([full], [query], { limit: 6, perFile: 6 }) : [];
    if (!found.length) found = index.preview(full, 6);
    return { ok: true, status: found.length ? 'ok' : 'not-found', ...who, evidence: true, layer: 'evidence', hits: found.map(hit) };
  }
  if (!query) return { ok: false, status: 'bad-request', ...who, hits: [] };
  // The company's synonyms, and the department's own (同义词.txt in its handbook).
  const syn = index.synonyms([C('_handbook', '_company')].concat(person.dept && person.role !== 'admin' ? [C('_handbook', safe(person.dept))] : []));
  const found = index.search(roots(person), [query], { limit: LIMIT, perFile: 3, allow: (full, fm) => fmAllows(person, fm), synonyms: syn });
  const mem = await krouterHits(person, query);
  const hits = mem.concat(found.map(hit)).slice(0, LIMIT + mem.length);
  return { ok: true, status: hits.length ? 'ok' : 'not-found', ...who, layer: 'lookup', hits };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, obj) => {
    const raw = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(raw + '\n');
  };
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  if (req.method === 'POST' && (url.pathname === '/v1/search' || url.pathname === '/v1/prior-work')) {
    const person = personOf(tokenOf(req));
    if (!person) {
      audit('', url.pathname, -1);
      json(401, { ok: false, status: 'login-required', hits: [] });
      return;
    }
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
      json(400, { ok: false, status: 'bad-request', hits: [] });
      return;
    }
    let out;
    try { out = await search(person, body || {}); } catch (e) {
      out = { ok: false, status: 'search-failed', hits: [] };
    }
    audit(person.login, url.pathname, out.hits.length);
    json(200, { ...out, login: person.login });
    return;
  }
  json(404, { status: 'not-found' });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('LISTEN=127.0.0.1:' + PORT + '\n');
  // Read everything once in the background so the first question is not the slow one.
  setTimeout(() => { try { index.docs([BRAIN, C('_handbook'), C('_shared', '_memory'), C('_office', '_memory')]); } catch (e) { /* lazily then */ } }, 50);
});
