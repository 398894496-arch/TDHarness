// company-desk-hub-v1: each person's desk kernel on this server, shared by their computer and their phone.
//
// The user, 2026-11-25: 「要做成微信那样手机和电脑同步」「每个人用自己的账号」「直接做完整版」. One kernel per person
// runs here (the web profile, the same desk the computers run today); every window of that person — the computer's
// desk window, the phone — is a client of it, so a question asked on one shows on the other as it happens (the
// kernel's API gateway streams the same events to every connected window; tested 2026-11-25: 6 s).
//
//   window (127.0.0.1 page) -> that device's own relay -> https://<site>:8443/desk-hub/... (Caddy) -> this hub (4197)
//     -> the person's kernel on 127.0.0.1:<port>
//
// The relay adds `Authorization: Bearer <the person's sign-in token>`; the page never holds it. This hub:
//   - checks the token with the people service (/company/desk-hub/who, loopback + this hub's secret) and that the
//     person is switched to the server desk (runtime/desk-hub-users.json);
//   - starts the person's kernel when it is not running: as the person's own Windows account (their share account,
//     whose folder rights the share already sets), at most two starts at a time (a start is seconds of CPU on this
//     4-core server; 14 at once held ERP at 5 s, load test 2026-11-25), its home under D:\dsh\desks\<login>, its chats
//     in the person's .dsh-desk (where the computers' chats already are), the company gateway over loopback;
//   - passes requests and WebSockets on, as if from the kernel's own loopback page (Host and Origin rewritten), and
//     hands the kernel's start token on the page's first GET / so the kernel sets its own browser cookie;
//   - leaves a kernel running while any window is connected, and for 12 hours after the last one went (tasks keep
//     running with no window open: the computer off, the phone locked).
//
//   node desk_hub.js            serve (DESK_HUB_PORT, default 4197, loopback; 4190 is the manufacturing API's)
//   node desk_hub.js selftest   the routing, the start queue and the proxying against a fake people service and kernel
"use strict";
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const ROOT = process.env.TDH_ROOT || "D:\\dsh";
const runtimeDir = () => path.join(process.env.TDH_ROOT || ROOT, "runtime");
const CFG = {
  port: Number(process.env.DESK_HUB_PORT || 4197),
  people: process.env.DESK_HUB_PEOPLE || "http://127.0.0.1:4181",
  gateway: process.env.DESK_HUB_GATEWAY || "http://127.0.0.1:8450/v1",
  desks: process.env.DESK_HUB_DESKS || path.join(ROOT, "desks"),
  pack: process.env.DESK_HUB_PACK || "",
  runtimeRoot: path.join(ROOT, "desk-runtime"),
  dist: process.env.DESK_HUB_DIST || path.join(ROOT, "client-dist"),
  site: process.env.DESK_HUB_SITE || "https://tdharness.local:8443",
  skills: process.env.DESK_HUB_SKILLS || path.join(ROOT, "company", "_skills"),
  // The folder the dsh-company share is (setup-server.ps1). company-server-share-path-v1: the kernels here read the
  // share's own name (\\<host>\dsh-company\...) as this folder; the computers' relays map this folder back to the share.
  company: process.env.DESK_HUB_COMPANY || path.join(ROOT, "company"),
  prefix: "/desk-hub",
  firstPort: Number(process.env.DESK_HUB_FIRST_PORT || 17900),
  maxStarts: 2,
  startTimeoutMs: 180000,
  idleMs: 12 * 3600 * 1000,
  // company-desk-hub-warm-v1 (the user, 2026-11-25: 「手机APP启动的时候就缓存热进程」「电脑端打开APP进程也都保持热进程」):
  // the kernels of everyone switched over are started before the working day and kept through it; a kernel is only
  // stopped outside these hours, 12 h after its last window went. A first answer then costs the model's own time only.
  warmHour: Number(process.env.DESK_HUB_WARM_HOUR || 7),
  workEndHour: Number(process.env.DESK_HUB_WORK_END_HOUR || 20),
  whoCacheMs: 60000,
};

// Run as a scheduled task there is no console: the lines also go to D:\dsh\logs\desk-hub.log (DESK_HUB_LOG).
const LOG_FILE = process.env.DESK_HUB_LOG || (process.platform === "win32" ? path.join(ROOT, "logs", "desk-hub.log") : "");
function log(...a) {
  const line = new Date().toISOString() + " " + a.join(" ") + "\n";
  process.stdout.write(line);
  if (LOG_FILE) { try { fs.appendFileSync(LOG_FILE, line); } catch {} }
}
function secret() {
  try { return fs.readFileSync(path.join(runtimeDir(), "desk-hub.token"), "utf8").trim(); } catch { return ""; }
}

// ---- who is asking ------------------------------------------------------------------------------------------------
const whoCache = new Map(); // token -> {at, who}
function postJson(base, p, body, headers, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(p, base);
    const raw = Buffer.from(JSON.stringify(body || {}));
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", timeout: timeoutMs || 15000,
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": raw.length }, headers || {}) }, (res) => {
      const c = []; res.on("data", (d) => c.push(d));
      res.on("end", () => { let j = {}; try { j = JSON.parse(Buffer.concat(c).toString("utf8")); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on("error", () => resolve({ status: 0, json: {} }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: {} }); });
    req.end(raw);
  });
}
async function who(token, extra) {
  if (!/^dsh_[A-Za-z0-9_-]{16,200}$/.test(token || "")) return null;
  const hit = whoCache.get(token);
  if (!extra && hit && Date.now() - hit.at < CFG.whoCacheMs) return hit.who;
  const r = await postJson(CFG.people, "/company/desk-hub/who", Object.assign({ token }, extra || {}), { "X-Desk-Hub": secret() });
  const w = r.status === 200 && r.json && r.json.ok ? r.json : null;
  if (!extra) whoCache.set(token, { at: Date.now(), who: w });
  return w;
}
function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""));
  return m ? m[1] : "";
}

// ---- kernels ------------------------------------------------------------------------------------------------------
// login -> { state: "starting"|"up"|"down", port, token, pid, ready: Promise, clients, lastSeen, user }
const desks = new Map();
let starting = 0;
const startQueue = [];
function slot() {
  if (starting < CFG.maxStarts) { starting++; return Promise.resolve(); }
  return new Promise((r) => startQueue.push(r));
}
function release() {
  const next = startQueue.shift();
  if (next) next(); else starting--;
}
function usedPorts() { return new Set([...desks.values()].filter((d) => d.state !== "down").map((d) => d.port)); }
// A port no kernel of ours holds and nothing else on this server listens on.
function portFree(p) {
  return new Promise((resolve) => {
    const t = net.createServer();
    t.once("error", () => resolve(false));
    t.listen(p, "127.0.0.1", () => t.close(() => resolve(true)));
  });
}
async function freePort() {
  const used = usedPorts();
  for (let p = CFG.firstPort; p < CFG.firstPort + 400; p++) if (!used.has(p) && (await portFree(p))) return p;
  throw new Error("no-port");
}
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// The launcher seam: on the server, the person's own Windows account (desk-hub-launch.exe); in the selftest, a stand-in.
let launcher = launchAsUser;

async function ensureDesk(w) {
  const cur = desks.get(w.login);
  if (cur && cur.state === "up" && alive(cur.pid)) return cur;
  if (cur && cur.state === "starting") return cur.ready;
  const d = { state: "starting", port: 0, token: "", pid: 0, clients: 0, lastSeen: Date.now(), user: w.smb_user || "" };
  desks.set(w.login, d);
  d.ready = (async () => {
    await slot();
    const t0 = Date.now();
    try {
      d.port = await freePort();
      const started = await launcher(w, d.port);
      Object.assign(d, started, { state: "up" });
      await pinWorkspace(d.port, w.personal);
      log("DESK_UP", w.login, "port=" + d.port, "pid=" + d.pid, "ms=" + (Date.now() - t0));
      return d;
    } catch (e) {
      d.state = "down";
      log("DESK_START_FAIL", w.login, String((e && e.message) || e));
      throw e;
    } finally {
      release();
    }
  })();
  return d.ready;
}

// The desk's one workspace is the person's folder as THIS machine sees it. The computers wrote it as they see it
// (\\tdharness.local\dsh-company\emp-<login>, desk-lease.js ensureSeatWorkspaces); the kernel compares the row's path
// with the real path of its folder, so on the server that row matched nothing and the composer only said 「选择一个工作区
// 开始」. Rows for the same folder (by its last part) become one, its chats kept, the path the server's own.
function seatWorkspace(file, personal) {
  let ws = null;
  try { ws = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (!ws || typeof ws !== "object") ws = { unit: { name: "workspace", version: 2 } };
  if (!ws.global) ws.global = { initialized: true, workspaceIds: [], archivedSessionIds: [] };
  if (!Array.isArray(ws.global.workspaceIds)) ws.global.workspaceIds = [];
  if (!ws.tables) ws.tables = {};
  if (!ws.tables.workspaces) ws.tables.workspaces = {};
  const rows = ws.tables.workspaces;
  let real = personal;
  try { real = fs.realpathSync.native(personal); } catch {}
  const leaf = path.win32.basename(String(personal).replace(/[\\/]+$/, "")).toLowerCase();
  const mine = Object.keys(rows).filter((id) => {
    const p = String((rows[id] && rows[id].path) || "").replace(/[\\/]+$/, "");
    return p && path.win32.basename(p).toLowerCase() === leaf;
  });
  const now = new Date().toISOString();
  let keep = mine[0];
  if (!keep) {
    keep = "w-seat-" + Date.now().toString(36);
    rows[keep] = { path: real, title: "工作区", sessionIds: [], createdAt: now, updatedAt: now };
  }
  const sessions = new Set(rows[keep].sessionIds || []);
  for (const id of mine.slice(1)) {
    for (const sid of rows[id].sessionIds || []) sessions.add(sid);
    delete rows[id];
  }
  // One workspace only, the person's own folder (company-single-workspace-v1, as the computers' collapse-seats): any
  // other row (the old 团队 seat on the share's root) gives its chats to it and goes. With two, a new window (the
  // phone) asked 「选择一个工作区开始」 instead of opening the person's.
  for (const id of Object.keys(rows)) {
    if (id === keep) continue;
    for (const sid of (rows[id] && rows[id].sessionIds) || []) sessions.add(sid);
    delete rows[id];
  }
  Object.assign(rows[keep], { path: real, title: "工作区", sessionIds: [...sessions], updatedAt: now });
  ws.global.workspaceIds = [keep];
  const tmp = file + ".hub.tmp";
  fs.writeFileSync(tmp, JSON.stringify(ws, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// The person's folder as the desk's one workspace, named 工作区 (what the computers' shell does after its start:
// AppHost.PinWorkspaces, company-single-workspace-v1). Without it the composer only says 「选择一个工作区开始」.
function kernelRpc(port, method, payload) {
  return new Promise((resolve) => {
    const raw = Buffer.from(JSON.stringify({ type: "client-request", rpcId: crypto.randomUUID(), method, payload }));
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/" + method, method: "POST", timeout: 15000,
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": raw.length, Host: "127.0.0.1:" + port } }, (res) => {
      const c = []; res.on("data", (x) => c.push(x));
      res.on("end", () => { let j = null; try { j = JSON.parse(Buffer.concat(c).toString("utf8")); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on("error", () => resolve({ status: 0, json: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.end(raw);
  });
}
function findKey(o, key) {
  if (!o || typeof o !== "object") return "";
  if (typeof o[key] === "string") return o[key];
  for (const v of Object.values(o)) { const f = findKey(v, key); if (f) return f; }
  return "";
}
async function pinWorkspace(port, personal) {
  if (!personal) return;
  const r = await kernelRpc(port, "workspace.create", { path: personal });
  const id = findKey(r.json, "workspaceId");
  if (id) await kernelRpc(port, "workspace.rename", { workspaceId: id, title: "工作区" });
  log("WORKSPACE", "port=" + port, "status=" + r.status, id ? "pinned" : "no-id");
}

// Kernels a previous run of this hub started. company-desk-hub-adopt-v1 (the user's phone and Mac, 2026-11-26: every
// restart of this hub stopped everyone's desk under their hands — 「我又无法在手机端新建对话了」): a kernel that still
// answers is taken back as it is (its login from its folder, its port from its command line, its token from its
// out.log); only one that cannot be taken back, or a second one for the same person, is stopped.
function kernelAnswers(port) {
  return new Promise((resolve) => {
    const r = http.request({ hostname: "127.0.0.1", port, method: "GET", path: "/", headers: { host: "127.0.0.1:" + port }, timeout: 4000 }, (res) => { res.resume(); resolve(true); });
    r.on("error", () => resolve(false));
    r.on("timeout", () => { r.destroy(); resolve(false); });
    r.end();
  });
}
async function adoptOrphans() {
  if (process.platform !== "win32") return;
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*\\desks\\*\\home\\profiles\\web\\overlay.yml*' } | ForEach-Object { [string]$_.ProcessId + '|' + $_.CommandLine }";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  for (const line of String(r.stdout || "").split(/\r?\n/).filter(Boolean)) {
    const pid = Number(line.split("|")[0]);
    const cmd = line.slice(line.indexOf("|") + 1);
    const login = ((/[\\/]desks[\\/]([^\\/]+)[\\/]home[\\/]/i.exec(cmd) || [])[1] || "").toLowerCase();
    const port = Number((/--port\s+(\d+)/.exec(cmd) || [])[1] || 0);
    let token = "";
    if (login && port) {
      try {
        const t = fs.readFileSync(path.join(CFG.desks, login, "out.log"), "utf8");
        token = (new RegExp("dsh web: http://127\\.0\\.0\\.1:" + port + "/\\?token=([A-Za-z0-9_-]+)").exec(t) || [])[1] || "";
      } catch {}
    }
    if (pid && login && port && token && !desks.has(login) && await kernelAnswers(port)) {
      desks.set(login, { state: "up", port, token, pid, clients: 0, lastSeen: Date.now(), user: "" });
      log("DESK_ADOPTED", login, "port=" + port, "pid=" + pid);
      continue;
    }
    if (pid) {
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      log("ORPHAN_STOPPED", pid);
    }
  }
}

function stopDesk(login, why) {
  const d = desks.get(login);
  if (!d || d.state === "down") return;
  d.state = "down";
  if (d.pid) {
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(d.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else { try { process.kill(d.pid, "SIGTERM"); } catch {} }
  }
  log("DESK_STOP", login, why);
}

// ---- the desk program: the Windows pack this server publishes, unpacked once per release ---------------------------
function ensurePack() {
  if (process.env.DESK_HUB_PACK) return process.env.DESK_HUB_PACK;
  let mark = "";
  try { mark = String(JSON.parse(fs.readFileSync(path.join(CFG.dist, "version.json"), "utf8")).win.mark || ""); } catch {}
  if (!/^[0-9a-f]{8,64}$/.test(mark)) throw new Error("no-published-pack");
  const dir = path.join(CFG.runtimeRoot, mark);
  const pack = path.join(dir, "CompanyDesk");
  if (!fs.existsSync(path.join(pack, "node", "node.exe"))) {
    const tmp = dir + ".unpacking-" + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    const r = spawnSync(tar, ["-xf", path.join(CFG.dist, "CompanyDesk-win.zip"), "-C", tmp], { stdio: "ignore", windowsHide: true, timeout: 600000 });
    if (r.status !== 0) throw new Error("unpack-failed");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    log("PACK_UNPACKED", mark);
  }
  CFG.pack = pack;
  return pack;
}

// The site's models and default as the gateway gives them to this person (the computers' model sync does the same).
function fetchModels(token) {
  return new Promise((resolve) => {
    const u = new URL(CFG.gateway.replace(/\/$/, "") + "/company-models");
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 15000, headers: { Authorization: "Bearer " + token } }, (res) => {
      const c = []; res.on("data", (d) => c.push(d));
      res.on("end", () => {
        let j = {}; try { j = JSON.parse(Buffer.concat(c).toString("utf8")); } catch {}
        const models = (Array.isArray(j.models) ? j.models : []).filter((m) => m && /^[A-Za-z0-9._:-]{1,80}$/.test(m.id || ""))
          .map((m) => ({ id: m.id, efforts: (m.efforts || []).filter((e) => /^[a-z]{2,10}$/.test(e)), context: Number(m.context) || 256000 }));
        resolve({ models, def: j.default || {} });
      });
    });
    req.on("error", () => resolve({ models: [], def: {} }));
    req.on("timeout", () => { req.destroy(); resolve({ models: [], def: {} }); });
  });
}

// ---- the person's desk home on this server ----------------------------------------------------------------------
function yamlPath(p) { return JSON.stringify(String(p).replace(/\\/g, "/")); }
function prepareHome(w) {
  const base = path.join(CFG.desks, w.login);
  const home = path.join(base, "home");
  const profile = path.join(base, "profile");
  const work = w.personal;
  if (!work || !fs.existsSync(work)) throw new Error("no-personal-folder");
  const roam = path.join(work, ".dsh-desk");
  fs.mkdirSync(path.join(roam, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(roam, "storages"), { recursive: true });
  seatWorkspace(path.join(roam, "storages", "workspace.json"), work);
  if (!fs.existsSync(path.join(home, "profiles", "web", "overlay.yml"))) {
    fs.mkdirSync(base, { recursive: true });
    fs.cpSync(path.join(CFG.pack, "home"), home, { recursive: true });
  }
  // company-desk-home-refresh-v1 (2026-11-26): the person's home was copied from the pack once, the first time, and never
  // again, so every published fix to the desk's plugins (profiles/web/node_modules) stopped at the pack: the server desks
  // ran the plugins of their first day (the sidebar of 2026-10-07; 「无法下载」). On a new pack its plugins, their
  // package.json and the overlay template replace the person's (the overlay is rewritten below as on every start); the
  // person's own things there (cordis.yml, the attachments, the sign-in) stay.
  const packMark = path.basename(path.dirname(CFG.pack));
  const markFile = path.join(home, ".pack-mark");
  let hadMark = "";
  try { hadMark = fs.readFileSync(markFile, "utf8").trim(); } catch {}
  if (hadMark !== packMark) {
    const src = path.join(CFG.pack, "home", "profiles", "web");
    const dst = path.join(home, "profiles", "web");
    if (fs.existsSync(path.join(src, "node_modules"))) {
      const old = path.join(dst, "node_modules.old-" + Date.now().toString(36));
      try { fs.renameSync(path.join(dst, "node_modules"), old); } catch {}
      fs.cpSync(path.join(src, "node_modules"), path.join(dst, "node_modules"), { recursive: true });
      fs.rmSync(old, { recursive: true, force: true });
    }
    for (const f of ["package.json", "overlay.yml"]) {
      if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
    fs.writeFileSync(markFile, packMark);
    log("HOME_REFRESHED", w.login, (hadMark || "-") + "->" + packMark);
  }
  // The overlay: the chats where the computers keep them, the company skills on this server's own disk.
  const ov = path.join(home, "profiles", "web", "overlay.yml");
  let t = fs.readFileSync(ov, "utf8");
  t = t.replace(/__DESK_SKILLS__/g, String(CFG.skills).replace(/\\/g, "/"));
  t = t.replace(/(^|\n)- id: session-persistence-jsonl\n(?:  .*\n)*/m, "$1").replace(/(^|\n)- id: storage-json\n(?:  .*\n)*/m, "$1");
  const block = "- id: session-persistence-jsonl\n  config:\n    root: " + yamlPath(path.join(roam, "sessions")) + "\n" +
    "- id: storage-json\n  config:\n    root: " + yamlPath(path.join(roam, "storages")) + "\n";
  const i = t.indexOf("- id: ");
  if (i < 0) throw new Error("overlay-no-rows");
  fs.writeFileSync(ov, t.slice(0, i) + block + t.slice(i));
  // The person's own settings patch: the company gateway over loopback, the site's models and default, the preview
  // notice already acknowledged (a server desk has nobody to click it the first time).
  const patch = path.join(home, "profiles", "web", "cordis.patch.yml");
  fs.writeFileSync(patch, userPatch(w.models || [], w.default_model || {}));
  // What the company plugins read from the signed-in person's ~/.dsh-company-rc8 (USERPROFILE points here).
  const rc = path.join(profile, ".dsh-company-rc8");
  fs.mkdirSync(rc, { recursive: true });
  const put = (n, v) => fs.writeFileSync(path.join(rc, n), String(v || "") + "\n");
  put("gw.token", w.kernel_token);
  put("login.name", w.login);
  put("login.role", w.role);
  put("site.login", w.site || "");
  put("work.personal", w.personal);
  put("work.org", w.org || "");
  if (!fs.existsSync(path.join(rc, "device.id"))) put("device.id", "server-" + w.login);
  return { base, home, profile, work, overlay: ov };
}

function userPatch(models, def) {
  const list = (models.length ? models : [{ id: def.model || "gpt-6.2-sol", efforts: ["low", "medium", "high"] }]);
  const rows = list.map((m) => {
    const eff = (m.efforts && m.efforts.length ? m.efforts : ["high"]).map((e) => "              " + e + ": " + e).join("\n");
    return "          - id: " + m.id + "\n            name: " + m.id + "\n            contextWindow: " + (m.context || 256000) +
      "\n            input: [text]\n            reasoningEfforts:\n" + eff;
  }).join("\n");
  return "# company-desk-hub-v1: written by the hub at each start.\n" +
    "- id: llm-pi-ai\n  config:\n    providers:\n      office:\n        displayName: TDHarness\n        apiKeyEnv: GROK_API_KEY\n" +
    "        api: openai-completions\n        baseURL: " + CFG.gateway + "\n        reasoning: high\n        compat:\n" +
    "          supportsStore: false\n          supportsDeveloperRole: false\n          supportsReasoningEffort: true\n" +
    "          supportsUsageInStreaming: true\n        models:\n" + rows + "\n" +
    "- id: agent-default-model\n  name: \"@deepseek-ai/dsh-agent-default-model\"\n  config:\n    provider: office\n" +
    "    model: " + (def.model || list[0].id) + "\n    reasoningEffort: " + (def.effort || "high") + "\n" +
    "- id: ui-settings-general\n  name: \"@deepseek-ai/dsh-client-ui-settings-general\"\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n" +
    // The user, 2026-11-25: 「两边同时在一个会话里发消息，默认做成插话」. Enter while the agent runs steers the running turn
    // (the kernel's own default queues it as the next turn).
    "- id: ui-conversation\n  name: \"@deepseek-ai/dsh-client-ui-conversation\"\n  config:\n    busyEnter: steer\n";
}

// The kernel as the person: desk-hub-launch.exe (CreateProcessWithLogonW) with the password on stdin, never on a
// command line. It prints the started process id; the kernel's own lines go to out.log in the person's desk folder.
async function launchAsUser(w, port) {
  if (!w.smb_user || !w.smb_pass) throw new Error("no-account");
  ensurePack();
  const m = await fetchModels(w.kernel_token);
  const p = prepareHome(Object.assign({}, w, { models: m.models, default_model: m.def, site: CFG.site }));
  const node = path.join(CFG.pack, "node", "node.exe");
  let bin = path.join(CFG.pack, "prefix", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (!fs.existsSync(bin)) bin = path.join(CFG.pack, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const shim = path.join(CFG.pack, "win-junction-shim.cjs");
  const out = path.join(p.base, "out.log"), err = path.join(p.base, "err.log");
  for (const f of [out, err]) { try { fs.renameSync(f, f + ".prev"); } catch {} }
  // The person's account may write only its own desk folder here (and its folders on the share, as always).
  spawnSync("icacls.exe", [p.base, "/grant", w.smb_user + ":(OI)(CI)M", "/T", "/C", "/Q"], { stdio: "ignore", windowsHide: true });
  const env = {
    DSH_HOME: p.home, USERPROFILE: p.profile, HOME: p.profile, GROK_API_KEY: w.kernel_token,
    DSH_PERMISSION_MODE: "workspace-write", NODE_EXTRA_CA_CERTS: path.join(CFG.pack, "company-ca.crt"),
    NO_PROXY: "localhost,127.0.0.1", TDH_SERVER_DESK: "1", TDH_COMPANY_LOCAL: CFG.company,
  };
  const args = ["--require", shim, bin, "--profile", "web", "--patch", p.overlay, "--host", "127.0.0.1", "--port", String(port),
    "--no-open", "--trusted-host", "127.0.0.1", "--trusted-host", "localhost"];
  const job = { user: w.smb_user, password: w.smb_pass, exe: node, args, cwd: p.work, env, stdout: out, stderr: err };
  const r = spawnSync(path.join(__dirname, "desk-hub-launch.exe"), [], { input: JSON.stringify(job), encoding: "utf8", windowsHide: true, timeout: 60000 });
  const pid = Number((/PID=(\d+)/.exec(r.stdout || "") || [])[1] || 0);
  if (!pid) throw new Error("launch-failed " + String(r.stdout || "").trim() + " " + String(r.stderr || "").trim());
  const token = await waitToken(out, port, pid);
  return { pid, token };
}

async function waitToken(file, port, pid) {
  const end = Date.now() + CFG.startTimeoutMs;
  const re = new RegExp("dsh web: http://127\\.0\\.0\\.1:" + port + "/\\?token=([A-Za-z0-9_-]+)");
  while (Date.now() < end) {
    let t = "";
    try { t = fs.readFileSync(file, "utf8"); } catch {}
    const m = re.exec(t);
    if (m) return m[1];
    if (pid && !alive(pid)) throw new Error("kernel-exited");
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("kernel-start-timeout");
}

// ---- passing on ---------------------------------------------------------------------------------------------------
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "authorization", "host", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "via", "x-desk-device"]);
function upstreamHeaders(req, d) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) h[k] = v;
  h.host = "127.0.0.1:" + d.port;
  if (h.origin) h.origin = "http://127.0.0.1:" + d.port;
  if (h.referer) { try { const r = new URL(h.referer); h.referer = "http://127.0.0.1:" + d.port + r.pathname + r.search; } catch { delete h.referer; } }
  return h;
}
// company-desk-hub-chat-v1 (the user's Mac, 2026-11-26: 「电脑客户端的聊天界面我直接打不开了」): the chat column is a page
// the kernel's own chat relay serves on ITS loopback (http://127.0.0.1:<port>/chat/?k=…). With the kernel here, that
// address on the person's computer is nothing. So the hub tells the page a path instead (/chat/?k=…, beside the desk's
// own) and passes /chat/, /v0/ and /tdh/ — requests and the chat's WebSocket — to that relay as if from its own page.
const isChatPath = (p) => /^\/(chat|v0|tdh)(\/|$)/.test(p);
function chatHeaders(req, port) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) h[k] = v;
  h.host = "127.0.0.1:" + port;
  if (h.origin) h.origin = "http://127.0.0.1:" + port;
  if (h.referer) { try { const r = new URL(h.referer); h.referer = "http://127.0.0.1:" + port + r.pathname + r.search; } catch { delete h.referer; } }
  return h;
}
function kernelGet(d, pathName) {
  return new Promise((resolve) => {
    const r = http.request({ hostname: "127.0.0.1", port: d.port, method: "GET", path: withKernelToken(pathName, "", d, "GET"),
      headers: { host: "127.0.0.1:" + d.port, accept: "application/json" }, timeout: 20000 }, (res) => {
      const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
    });
    r.on("error", () => resolve({ status: 0, body: Buffer.alloc(0) }));
    r.on("timeout", () => { r.destroy(); resolve({ status: 0, body: Buffer.alloc(0) }); });
    r.end();
  });
}
async function chatWhere(d) {
  const r = await kernelGet(d, "/company/chat/where");
  let j = null;
  try { j = JSON.parse(r.body.toString("utf8")); } catch {}
  const m = j && j.ok && typeof j.url === "string" ? /^http:\/\/127\.0\.0\.1:(\d+)(\/.*)$/.exec(j.url) : null;
  if (m) d.chatPort = Number(m[1]);
  return { status: r.status || 502, json: m ? { ok: true, url: m[2] } : (j || { ok: false, error: "relay" }) };
}
async function chatPortOf(d) {
  if (!d.chatPort) await chatWhere(d);
  return d.chatPort || 0;
}

function innerPath(url) {
  const u = new URL(url, "http://x");
  let p = u.pathname;
  if (p === CFG.prefix) p = "/";
  else if (p.startsWith(CFG.prefix + "/")) p = p.slice(CFG.prefix.length);
  return { p, search: u.search };
}
function withKernelToken(p, search, d, method) {
  // The kernel takes its start token only on GET / and answers with its own browser cookie.
  if (method !== "GET" || p !== "/") return p + search;
  const q = new URLSearchParams(search);
  if (!q.has("token")) q.set("token", d.token);
  return "/?" + q.toString();
}

function fail(res, code, error, hint) {
  if (res.headersSent) { try { res.destroy(); } catch {} return; }
  const body = Buffer.from(JSON.stringify({ ok: false, error, hint: hint || "" }));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

const DENY = {
  "no-token": [401, "没有登录"],
  "bad-token": [401, "登录过期了，请重新登录"],
  "not-server-desk": [403, "这个账号还没切到服务器上的工作台"],
};
async function admit(req) {
  if (!bearer(req)) return { deny: "no-token" };
  const w = await who(bearer(req));
  if (!w) return { deny: "bad-token" };
  if (!w.server_desk) return { deny: "not-server-desk" };
  return { w };
}

async function onRequest(req, res) {
  const { p, search } = innerPath(req.url);
  if (p === "/_hub/health") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); return; }
  const a = await admit(req);
  if (a.deny) { const [c, h] = DENY[a.deny]; fail(res, c, a.deny, h); return; }
  if (p === "/_hub/warm") {
    // The app's launch and the computer's start ask for this: the kernel comes up while the person is still looking at
    // the screen, not when they send the first question.
    let state = "up";
    try {
      const d0 = desks.get(a.w.login);
      if (!d0 || d0.state !== "up" || !alive(d0.pid)) {
        const full = await who(bearer(req), { start: true });
        if (full) ensureDesk(full).catch(() => {});
        state = "starting";
      } else d0.lastSeen = Date.now();
    } catch { state = "down"; }
    const body = Buffer.from(JSON.stringify({ ok: true, login: a.w.login, state }));
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": body.length, "Cache-Control": "no-store" }); res.end(body);
    return;
  }
  if (p === "/_hub/status") {
    const d = desks.get(a.w.login);
    // boot: which start of the kernel this is — a page loaded from an earlier one must load again (the phone asks).
    // stream: whether the live connection the asker names (the phone's relay puts an id on its own, X-TDH-Stream) is
    // still open here (company-phone-stream-watch-v1: a connection the network dropped without a word looked open to
    // the phone, and the assistant's answers went nowhere — the user, 2026-11-26: 「对话没有响应了」).
    const sid = new URLSearchParams(search || "").get("stream") || "";
    // company: where the share is on this server (company-local-reveal-v1: the computer's relay shows a file the desk
    // names by this server's path in its own file manager, on the share).
    const out = { ok: true, login: a.w.login, state: d ? d.state : "down", clients: d ? d.clients : 0, boot: d && d.state === "up" ? String(d.pid) : "", company: CFG.company };
    if (sid) out.stream = liveStreams.has(a.w.login + " " + sid);
    const body = Buffer.from(JSON.stringify(out));
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": body.length, "Cache-Control": "no-store" }); res.end(body);
    return;
  }
  let d;
  try {
    // A start mints the kernel's own gateway token, once per start.
    d = desks.get(a.w.login);
    if (!d || d.state !== "up" || !alive(d.pid)) {
      const full = await who(bearer(req), { start: true });
      if (!full) { fail(res, 401, "bad-token", DENY["bad-token"][1]); return; }
      d = await ensureDesk(full);
    }
  } catch (e) {
    fail(res, 503, "desk-start-failed", "服务器上的工作台没能启动（" + String((e && e.message) || e).slice(0, 80) + "），请稍后重试");
    return;
  }
  d.lastSeen = Date.now();
  if (p === "/company/chat/where") {
    const w = await chatWhere(d);
    const body = Buffer.from(JSON.stringify(w.json));
    res.writeHead(w.json.ok ? 200 : 503, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
    res.end(body);
    return;
  }
  if (isChatPath(p)) {
    const cport = await chatPortOf(d);
    if (!cport) { fail(res, 503, "chat-relay", "聊天还没准备好，请稍后重试"); return; }
    const cu = http.request({ hostname: "127.0.0.1", port: cport, method: req.method, path: p + search, headers: chatHeaders(req, cport) }, (ures) => {
      res.writeHead(ures.statusCode || 502, ures.headers);
      ures.pipe(res);
    });
    cu.on("error", () => { d.chatPort = 0; fail(res, 502, "chat-relay", "聊天没有响应，请稍后重试"); });
    res.on("close", () => cu.destroy());
    req.pipe(cu);
    return;
  }
  const up = http.request({ hostname: "127.0.0.1", port: d.port, method: req.method, path: withKernelToken(p, search, d, req.method), headers: upstreamHeaders(req, d) }, (ures) => {
    const h = Object.assign({}, ures.headers);
    // company-desk-hub-cache-v1: the desk's own built files carry their content's hash in their names
    // (/assets/index-DjTxlw_T.js) but came without a word on caching, so a phone fetched them anew at every start.
    // The same word the plugin bundles already carry (their address has rev=<hash>).
    if (ures.statusCode === 200 && !h["cache-control"] && /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|svg|png)$/.test(p)) {
      h["cache-control"] = "public, max-age=31536000, immutable";
    }
    if (h.location) { try { const l = new URL(h.location, "http://127.0.0.1:" + d.port); if (l.host === "127.0.0.1:" + d.port) h.location = l.pathname + l.search; } catch {} }
    res.writeHead(ures.statusCode || 502, h);
    ures.pipe(res);
  });
  up.on("error", () => fail(res, 502, "desk-unreachable", "服务器上的工作台没有响应，请稍后重试"));
  res.on("close", () => up.destroy());
  req.pipe(up);
}

/// The live connections that carry an id (login + " " + id), while they are open.
const liveStreams = new Set();

async function onUpgrade(req, sock, head) {
  sock.on("error", () => {});
  const { p, search } = innerPath(req.url);
  const a = await admit(req);
  if (a.deny) { sock.end("HTTP/1.1 " + DENY[a.deny][0] + " Denied\r\nConnection: close\r\n\r\n"); return; }
  let d = desks.get(a.w.login);
  // A page's live connection coming back after the kernel stopped (the hub's restart, an idle stop) starts it again, as
  // a request does (the user's phone, 2026-11-26: 「我又无法在手机端新建对话了」 — only the WebSocket kept knocking).
  if (!d || d.state !== "up" || !alive(d.pid)) {
    try {
      const full = await who(bearer(req), { start: true });
      d = full ? await ensureDesk(full) : null;
    } catch { d = null; }
    if (!d || d.state !== "up") { sock.end("HTTP/1.1 503 Desk Not Started\r\nConnection: close\r\n\r\n"); return; }
  }
  const chat = isChatPath(p);
  const cport = chat ? await chatPortOf(d) : 0;
  if (chat && !cport) { sock.end("HTTP/1.1 503 Chat Not Ready\r\nConnection: close\r\n\r\n"); return; }
  const up = net.connect(chat ? cport : d.port, "127.0.0.1");
  up.on("error", () => { if (chat) d.chatPort = 0; sock.destroy(); });
  up.on("connect", () => {
    const h = chat ? chatHeaders(req, cport) : upstreamHeaders(req, d);
    h.connection = "Upgrade";
    h.upgrade = req.headers.upgrade || "websocket";
    let head2 = req.method + " " + (chat ? p + search : p + search) + " HTTP/1.1\r\n";
    for (const [k, v] of Object.entries(h)) for (const vv of [].concat(v)) head2 += k + ": " + vv + "\r\n";
    up.write(head2 + "\r\n");
    if (head && head.length) up.write(head);
    d.clients++;
    d.lastSeen = Date.now();
    let closed = false;
    // company-desk-hub-wslog-v1: how a live connection ended (which side first, how long, how much each way), so a
    // phone whose assistant cannot send can be read here; no content.
    const t0 = Date.now(); let toKernel = 0, toClient = 0;
    sock.on("data", (x) => { toKernel += x.length; }); up.on("data", (x) => { toClient += x.length; });
    const done = (by) => () => {
      if (closed) return; closed = true; d.clients = Math.max(0, d.clients - 1); d.lastSeen = Date.now();
      log("WS_CLOSE", a.w.login, p, "by=" + by, "ms=" + (Date.now() - t0), "toKernel=" + toKernel, "toClient=" + toClient);
    };
    sock.on("close", done("client")); up.on("close", done("kernel"));
    const sid = String(req.headers["x-tdh-stream"] || "").slice(0, 64);
    if (sid) {
      const key = a.w.login + " " + sid;
      liveStreams.add(key);
      const gone = () => liveStreams.delete(key);
      sock.on("close", gone); up.on("close", gone);
      // Either side gone ends the other too (a half-closed pair would keep the id alive).
      sock.on("close", () => up.destroy()); up.on("close", () => sock.destroy());
    }
    log("WS_OPEN", a.w.login, p);
    up.pipe(sock); sock.pipe(up);
  });
}

function idleSweep() {
  for (const [login, d] of desks) {
    if (d.state === "up" && !alive(d.pid)) { d.state = "down"; log("DESK_GONE", login); continue; }
    const h = new Date().getHours();
    const working = h >= CFG.warmHour && h < CFG.workEndHour;
    if (!working && d.state === "up" && d.clients === 0 && Date.now() - d.lastSeen > CFG.idleMs) stopDesk(login, "idle");
  }
}

// Before the working day (and at the hub's own start inside it), everyone switched over gets a running kernel.
let warmedOn = "";
async function warmAll(why) {
  let users = [];
  try { users = JSON.parse(fs.readFileSync(path.join(runtimeDir(), "desk-hub-users.json"), "utf8")); } catch {}
  if (!Array.isArray(users)) return;
  for (const login of users) {
    const d = desks.get(login);
    if (d && (d.state === "up" || d.state === "starting")) continue;
    const r = await postJson(CFG.people, "/company/desk-hub/who", { login, start: true }, { "X-Desk-Hub": secret() });
    const w = r.status === 200 && r.json && r.json.ok && r.json.server_desk ? r.json : null;
    if (!w) { log("WARM_SKIP", login, "status=" + r.status); continue; }
    try { await ensureDesk(w); } catch {}
  }
  log("WARM_ALL", why, users.length);
}
function warmTick() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const h = now.getHours();
  if (h >= CFG.warmHour && h < CFG.workEndHour && warmedOn !== day) { warmedOn = day; warmAll("day").catch(() => {}); }
}

function serve() {
  setTimeout(warmTick, 5000).unref();
  setInterval(warmTick, 60 * 1000).unref();
  const srv = http.createServer((req, res) => { onRequest(req, res).catch((e) => fail(res, 500, "hub-error", String(e && e.message))); });
  srv.on("upgrade", (req, sock, head) => { onUpgrade(req, sock, head).catch(() => sock.destroy()); });
  // The kernels still running are taken back before anything is served (no second kernel for the same person).
  adoptOrphans().catch((e) => log("ADOPT_FAIL", String(e && e.message))).then(() => {
    srv.listen(CFG.port, "127.0.0.1", () => log("DESK_HUB_LISTEN", "127.0.0.1:" + CFG.port));
  });
  setInterval(idleSweep, 5 * 60 * 1000).unref();
  return srv;
}

// ---- selftest -----------------------------------------------------------------------------------------------------
async function selftest() {
  const assert = require("assert");
  const sec = "hub-secret-" + crypto.randomBytes(4).toString("hex");
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "desk-hub-"));
  fs.mkdirSync(path.join(tmp, "runtime"));
  fs.writeFileSync(path.join(tmp, "runtime", "desk-hub.token"), sec);
  // fake people service
  const people = http.createServer((req, res) => {
    const c = []; req.on("data", (x) => c.push(x));
    req.on("end", () => {
      const b = JSON.parse(Buffer.concat(c).toString() || "{}");
      const ok = req.headers["x-desk-hub"] === sec;
      const map = { dsh_aliceToken0123456789: { login: "alice", server_desk: true, personal: "/tmp/alice" }, dsh_bobbyToken0123456789: { login: "bob", server_desk: false } };
      const w = ok ? map[b.token] : null;
      const body = JSON.stringify(w ? Object.assign({ ok: true, kernel_token: b.start ? "dsh_kernel" : undefined }, w) : { ok: false });
      res.writeHead(w ? 200 : 401, { "Content-Type": "application/json" }); res.end(body);
    });
  });
  await new Promise((r) => people.listen(0, "127.0.0.1", r));
  // fake kernel: answers with what it saw; echoes on a raw upgrade
  const seen = [];
  const kernel = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, origin: req.headers.origin, auth: req.headers.authorization, method: req.method });
    if (req.url === "/api/workspace.create") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ type: "result", result: { workspaceId: "ws-1" } })); return; }
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("kernel:" + req.url);
  });
  kernel.on("upgrade", (req, sock) => { seen.push({ ws: req.url, host: req.headers.host, origin: req.headers.origin }); sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"); sock.on("data", (d) => sock.write("echo:" + d)); });
  await new Promise((r) => kernel.listen(0, "127.0.0.1", r));
  const kport = kernel.address().port;
  Object.assign(CFG, { people: "http://127.0.0.1:" + people.address().port, port: 0, maxStarts: 2 });
  process.env.TDH_ROOT = tmp;
  let launches = 0;
  launcher = async (w) => { launches++; await new Promise((r) => setTimeout(r, 300)); return { pid: process.pid, token: "KTOK", port: kport }; };
  // the stand-in kernel listens on its own port: the fake launcher hands it back
  const realEnsure = ensureDesk;
  const srv = serve();
  await new Promise((r) => srv.on("listening", r));
  const hport = srv.address().port;
  const get = (p, tok, hdr) => new Promise((resolve) => {
    http.get({ hostname: "127.0.0.1", port: hport, path: p, headers: Object.assign(tok ? { Authorization: "Bearer " + tok } : {}, hdr || {}) }, (res) => {
      const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
    });
  });
  // secret from the test runtime
  const origSecret = secret;
  assert.strictEqual((await get("/desk-hub/_hub/health")).status, 200);
  assert.strictEqual((await get("/desk-hub/")).status, 401, "no token");
  assert.strictEqual((await get("/desk-hub/", "dsh_nobodyToken0123456789")).status, 401, "unknown token");
  assert.strictEqual((await get("/desk-hub/", "dsh_bobbyToken0123456789")).status, 403, "not on the server desk");
  // two windows at once: one start
  const [r1, r2] = await Promise.all([get("/desk-hub/", "dsh_aliceToken0123456789", { Origin: "http://127.0.0.1:17803" }), get("/desk-hub/api/x?y=1", "dsh_aliceToken0123456789")]);
  assert.strictEqual(r1.status, 200); assert.strictEqual(r2.status, 200);
  assert.strictEqual(launches, 1, "one start for two windows");
  const first = seen.find((s) => s.url.startsWith("/?"));
  assert.ok(first && /token=KTOK/.test(first.url), "GET / carries the kernel's start token");
  assert.strictEqual(first.host, "127.0.0.1:" + desks.get("alice").port);
  assert.strictEqual(first.origin, "http://127.0.0.1:" + desks.get("alice").port, "origin as the kernel's own page");
  assert.ok(!seen.some((s) => s.auth), "the sign-in token never reaches the kernel");
  assert.ok(seen.some((s) => s.url === "/api/workspace.rename"), "the workspace pinned and named");
  assert.ok(seen.some((s) => s.url === "/api/x?y=1"), "prefix taken off, query kept");
  // a WebSocket passes both ways
  const echoed = await new Promise((resolve) => {
    const s = net.connect(hport, "127.0.0.1", () => {
      s.write("GET /desk-hub/api/remote.mux HTTP/1.1\r\nHost: 127.0.0.1:17803\r\nOrigin: http://127.0.0.1:17803\r\nAuthorization: Bearer dsh_aliceToken0123456789\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n");
    });
    let buf = "";
    s.on("data", (d) => { buf += d.toString(); if (buf.includes("101") && !buf.includes("echo:")) s.write("ping1"); if (buf.includes("echo:ping1")) { s.end(); resolve(buf); } });
    setTimeout(() => resolve(buf), 3000);
  });
  assert.ok(/101 Switching/.test(echoed) && /echo:ping1/.test(echoed), "websocket both ways");
  const wsSeen = seen.find((s) => s.ws);
  assert.strictEqual(wsSeen.ws, "/api/remote.mux"); assert.strictEqual(wsSeen.origin, "http://127.0.0.1:" + desks.get("alice").port);
  // a WebSocket for someone without a running desk is refused
  void realEnsure; void origSecret;
  srv.close(); people.close(); kernel.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("DESK_HUB_SELFTEST_OK");
  process.exit(0);
}

if (require.main === module) {
  if (process.argv[2] === "selftest") {
    // The selftest's secret file lives in its own runtime folder.
    process.env.TDH_ROOT = process.env.TDH_ROOT || "";
    selftest().catch((e) => { console.error("DESK_HUB_SELFTEST_FAIL", e && e.stack || e); process.exit(1); });
  } else {
    serve();
  }
}
module.exports = { userPatch, innerPath, withKernelToken, seatWorkspace };
