#!/usr/bin/env node
// company-mac-offlan-resolve-v1: a Mac desk finds the company server away from the office too.
//
// macOS answers names that end in .local by multicast DNS only, so away from the office {{TDH_HOST}} is not
// found: the company tailnet's split DNS route for it (Tailscale, 100.100.100.100) is not used for a .local name
// on a Mac (scutil --dns has no resolver for it), while Windows follows the route. Every desk request then failed
// before it left the Mac, and the login said the password was wrong (2026-11-20, 田总).
//
// start.command preloads this into every node of the desk (NODE_OPTIONS=--require). For the site's name only:
// the system lookup as before (the office LAN, multicast DNS, /etc/hosts) when it answers within LAN_WAIT_MS;
// otherwise the address Tailscale's own resolver gives for the same name; otherwise the tailnet address in
// vendor/company-tailnet.txt. Other names are untouched. The answer is kept KEEP_MS; after that it is still given
// while the next one is looked up in the background, so a Mac that leaves the office switches within a minute.
// It is also written to ~/.dsh-company-rc8/site-addr.json, and a node of the desk started within FILE_FRESH_MS
// takes it from there without asking: away from the office the system lookup takes 5 s to fail, and a short script
// (the login, the update check) cannot exit before it does.
//
//   NODE_OPTIONS= node mac-resolve.js --addr      the address the desk would use now (for curl); --how adds lan|tailnet|vendor
//   NODE_OPTIONS= node mac-resolve.js --tailnet   the server's tailnet address (Tailscale's resolver, then vendor/)
// (NODE_OPTIONS cleared: run as a script, not preloaded.)
"use strict";

const dns = require("dns");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const MARK = Symbol.for("company-mac-offlan-resolve-v1");
const SITE = String(process.env.TDH_RESOLVE_SITE || "{{TDH_HOST}}").toLowerCase().replace(/\.$/, "");
const TS_DNS = process.env.TDH_TS_DNS || "100.100.100.100";
const LAN_WAIT_MS = Number(process.env.TDH_RESOLVE_LAN_MS || 1500);
const KEEP_MS = Number(process.env.TDH_RESOLVE_KEEP_MS || 60000);
const FILE_FRESH_MS = 120000;
const STATE_FILE = process.env.TDH_RESOLVE_STATE || path.join(os.homedir(), ".dsh-company-rc8", "site-addr.json");
const state = global[MARK] || (global[MARK] = { orig: dns.lookup, installed: false, cache: null, waiters: [], refreshing: false });

function vendorIp() {
  if (process.env.TDH_TS_IP) return String(process.env.TDH_TS_IP).trim();
  try {
    const m = fs.readFileSync(path.join(__dirname, "vendor", "company-tailnet.txt"), "utf8").match(/^ip=(100\.\d+\.\d+\.\d+)\s*$/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function askTailscale(cb) {
  let r;
  try {
    r = new dns.Resolver({ timeout: 1500, tries: 1 });
    r.setServers([TS_DNS]);
  } catch {
    cb("");
    return;
  }
  r.resolve4(SITE, (err, addrs) => cb(!err && Array.isArray(addrs) && addrs[0] ? addrs[0] : ""));
}

// The system lookup (LAN, multicast DNS, /etc/hosts), in a child process that is ended once the answer is settled:
// away from the office getaddrinfo waits 5 s for multicast DNS, and a node with one still pending cannot even exit
// before it returns (process.exit waits for the thread pool).
const CHILD = 'require("dns").lookup(process.argv[1],{family:4},(e,a)=>{if(!e&&a)process.stdout.write(String(a));process.exit(0)})';
function systemLookup(host, opts, cb) {
  if (!/^node(\.exe)?$/i.test(path.basename(process.execPath))) {
    state.orig.call(dns, host, opts, cb);
    return null;
  }
  let c;
  try {
    c = require("child_process").spawn(process.execPath, ["-e", CHILD, host], {
      env: Object.assign({}, process.env, { NODE_OPTIONS: "" }), stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
  } catch {
    state.orig.call(dns, host, opts, cb);
    return null;
  }
  let out = "";
  let done = false;
  const end = (addr) => {
    if (done) return;
    done = true;
    if (addr) cb(null, addr, 4);
    else cb(Object.assign(new Error("getaddrinfo ENOTFOUND " + host), { code: "ENOTFOUND" }));
  };
  c.stdout.on("data", (d) => { out += d; });
  c.on("error", () => end(""));
  c.on("close", () => end(/^\d+\.\d+\.\d+\.\d+$/.test(out.trim()) ? out.trim() : ""));
  return () => {
    if (done) return;
    done = true;
    try { c.kill(); } catch { /* gone */ }
  };
}

// company-wg-desk-v1 (tdh-tunnel, mac-tunnel.sh): the company's own tunnel, when this Mac has it and it is up, is how
// the server is reached away from the office (before Tailscale, which it replaces). Up: the service's status and a
// route to the server through a utun interface.
const TUNNEL_DIR = process.env.TDH_TUNNEL_DIR || "/Library/Application Support/TDHarness/tunnel";
const TUNNEL_SERVER = process.env.TDH_TUNNEL_SERVER || "10.66.0.2";
function tunnelUp() {
  try {
    if (!fs.existsSync(path.join(TUNNEL_DIR, "status.json"))) return false;
    const r = require("child_process").spawnSync("/sbin/route", ["-n", "get", "-inet", TUNNEL_SERVER], { encoding: "utf8", timeout: 1500 });
    return r.status === 0 && /interface: utun\d+/.test(String(r.stdout || ""));
  } catch {
    return false;
  }
}
// cb(address, how): how is lan | tunnel | tailnet | vendor, or "" with no address. lookup may return a function that ends it.
function find(lookup, cb) {
  let done = false;
  let waited = false;
  let lan = "";
  let ts = "";
  let lanDone = false;
  let tsDone = false;
  let cancel = null;
  const finish = (addr, how) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (typeof cancel === "function") cancel();
    cb(addr, addr ? how : "");
  };
  const settle = () => {
    if (lan) return finish(lan, "lan");
    if ((waited || lanDone) && tunnelUp()) return finish(TUNNEL_SERVER, "tunnel");
    if (ts && (waited || lanDone)) return finish(ts, "tailnet");
    if (lanDone && tsDone) {
      const v = vendorIp();
      return finish(v, "vendor");
    }
  };
  const timer = setTimeout(() => { waited = true; settle(); }, LAN_WAIT_MS);
  cancel = lookup.call(dns, SITE, { family: 4 }, (err, addr) => {
    lanDone = true;
    if (!err && typeof addr === "string" && addr) lan = addr;
    settle();
  });
  if (done && typeof cancel === "function") cancel();
  askTailscale((a) => {
    tsDone = true;
    ts = a;
    settle();
  });
}

function readFile() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const age = Date.now() - Number(j.at || 0);
    if (j.site === SITE && /^\d+\.\d+\.\d+\.\d+$/.test(String(j.addr || "")) && age >= 0 && age < FILE_FRESH_MS) {
      return { addr: j.addr, how: String(j.how || ""), at: Number(j.at), file: true };
    }
  } catch { /* none yet */ }
  return null;
}

function remember(addr, how) {
  state.cache = { addr, how, at: Date.now() };
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ site: SITE, addr, how, at: state.cache.at }));
    fs.renameSync(tmp, STATE_FILE);
  } catch { /* the answer still holds in this process */ }
}

function current(cb) {
  const now = Date.now();
  if (!state.cache) state.cache = readFile();
  const c = state.cache;
  if (c && c.file) {
    // Another node of this desk found it a moment ago: take it, no lookup of our own (see FILE_FRESH_MS).
    if (now - c.at < FILE_FRESH_MS) return cb(c.addr, c.how);
    state.cache = null;
    return current(cb);
  }
  if (c && now - c.at < KEEP_MS) return cb(c.addr, c.how);
  if (c && c.addr) {
    cb(c.addr, c.how);
    if (!state.refreshing) {
      state.refreshing = true;
      find(systemLookup, (a, h) => {
        state.refreshing = false;
        if (a) remember(a, h);
      });
    }
    return;
  }
  state.waiters.push(cb);
  if (state.waiters.length > 1) return;
  find(systemLookup, (a, h) => {
    if (a) remember(a, h);
    for (const w of state.waiters.splice(0)) w(a, h);
  });
}

function isSite(hostname) {
  return String(hostname || "").toLowerCase().replace(/\.$/, "") === SITE;
}

function install() {
  if (state.installed || !/\.local$/.test(SITE) || SITE.indexOf("{{") >= 0) return false;
  state.installed = true;
  const orig = state.orig;
  function lookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (!isSite(hostname) || typeof callback !== "function") return orig.apply(dns, arguments);
    const all = !!(options && typeof options === "object" && options.all);
    current((addr) => {
      if (!addr) {
        const e = new Error("getaddrinfo ENOTFOUND " + hostname);
        Object.assign(e, { code: "ENOTFOUND", errno: -3008, syscall: "getaddrinfo", hostname });
        callback(e);
        return;
      }
      if (all) callback(null, [{ address: addr, family: 4 }]);
      else callback(null, addr, 4);
    });
  }
  lookup[util.promisify.custom] = (hostname, options) => new Promise((resolve, reject) => {
    lookup(hostname, options || {}, (err, address, family) => {
      if (err) reject(err);
      else resolve(Array.isArray(address) ? address : { address, family });
    });
  });
  dns.lookup = lookup;
  const plookup = dns.promises.lookup;
  dns.promises.lookup = function (hostname, options) {
    if (!isSite(hostname)) return plookup.apply(dns.promises, arguments);
    return lookup[util.promisify.custom](hostname, options);
  };
  return true;
}

module.exports = { install, find, vendorIp, askTailscale, SITE };

if (require.main === module) {
  const mode = process.argv[2] || "--addr";
  if (mode === "--tailnet") {
    askTailscale((a) => {
      const ip = a || vendorIp();
      if (ip) process.stdout.write(ip + "\n");
      process.exit(ip ? 0 : 1);
    });
  } else {
    // The same answer the desk's nodes use (and share): the file when it is fresh, else a lookup now. Exit at once:
    // a system lookup still waiting for multicast DNS would hold the process 5 s.
    current((addr, how) => {
      if (addr) process.stdout.write(addr + (mode === "--how" ? " " + how : "") + "\n");
      process.exit(addr ? 0 : 1);
    });
  }
} else {
  install();
}
