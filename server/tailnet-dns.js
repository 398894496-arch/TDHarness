'use strict';
// 只回答一个名字的 DNS：远程员工经 Tailscale 连进来时，把站点名（如 tdh.local）解析到这台服务器的 tailnet 地址。
// Tailscale 后台把这个名字设成分域 DNS 指向本机；别的名字一律 NXDOMAIN，不做转发。
// 用法：node tailnet-dns.js <站点名> [tailscale.exe 路径]（docs/SERVER.md「Remote use」；证明：scripts/prove-tailnet-dns.js）
//
// company-tailnet-dns-lan-v1：Windows 照这条分域 DNS 解析站点名，人在公司也拿到 tailnet 地址，桌面的全部流量（模型、
// 共享盘、心跳）都绕进加密隧道；隧道在 IPv6 / IPv4 / 中继之间换路时整条卡住几十秒（2026-11-20 小潘：一步等了 99 秒
// 才出第一个字，同一时段心跳断断续续）。现在看提问的这台电脑此刻和服务器怎么连着（tailscale status 的 CurAddr）：
// 走的是公司局域网（同一个私网 /24，或同一个 IPv6 /64），就答服务器的局域网地址，和公司里的 Mac（mDNS）一样直连；
// 别的情况（在外面、走中继、还没连上）照旧答 tailnet 地址。TTL 20 秒，进出公司很快换过来。
const dgram = require('dgram');
const net = require('net');
const { execFile, execFileSync } = require('child_process');
const NAME = String(process.argv[2] || 'tdh.local').toLowerCase().replace(/\.$/, '');
const TS = process.argv[3] || 'C:\\Program Files\\Tailscale\\tailscale.exe';
const TTL = 20;

function tsIp() {
  try { return execFileSync(TS, ['ip', '-4'], { encoding: 'utf8', timeout: 8000 }).trim().split(/\s+/)[0] || ''; } catch (e) { return ''; }
}

function qname(buf, off) {
  const labels = [];
  for (let i = 0; i < 64; i++) {
    const len = buf[off];
    if (len === undefined) return null;
    if (len === 0) return { name: labels.join('.').toLowerCase(), end: off + 1 };
    if (len & 0xc0) return null;
    labels.push(buf.toString('latin1', off + 1, off + 1 + len));
    off += 1 + len;
  }
  return null;
}

function answer(q, ip, name) {
  if (name === undefined) name = NAME;
  if (q.length < 12) return null;
  const id = q.readUInt16BE(0);
  const flags = q.readUInt16BE(2);
  if (flags & 0x8000) return null; // a response, not a query
  const qd = q.readUInt16BE(4);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  if (qd !== 1) { head.writeUInt16BE(0x8000 | (flags & 0x0100) | 0x0400 | 1, 2); return head; } // FORMERR
  const n = qname(q, 12);
  if (!n || n.end + 4 > q.length) return null;
  const qtype = q.readUInt16BE(n.end);
  const question = q.subarray(12, n.end + 4);
  const ours = n.name === name;
  let rcode = ours ? 0 : 3; // NXDOMAIN for anything else
  let an = Buffer.alloc(0);
  if (ours && qtype === 1 && net.isIPv4(ip)) {
    an = Buffer.alloc(16);
    an.writeUInt16BE(0xc00c, 0); an.writeUInt16BE(1, 2); an.writeUInt16BE(1, 4);
    an.writeUInt32BE(TTL, 6); an.writeUInt16BE(4, 10);
    ip.split('.').forEach((p, i) => { an[12 + i] = Number(p); });
  }
  // QR, AA, RD copied, RA
  head.writeUInt16BE(0x8000 | 0x0400 | (flags & 0x0100) | 0x0080 | rcode, 2);
  head.writeUInt16BE(1, 4); head.writeUInt16BE(an.length ? 1 : 0, 6);
  return Buffer.concat([head, question, an]);
}

function isPrivate4(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
function hostOf(addr) {
  const s = String(addr || '');
  const m = s.match(/^\[([^\]]+)\]:\d+$/) || s.match(/^([^:]+):\d+$/);
  return m ? m[1] : '';
}
function prefix64(ip6) {
  if (!net.isIPv6(ip6)) return '';
  const [a, b] = ip6.toLowerCase().split('::');
  const head = a ? a.split(':') : [];
  const tail = b !== undefined ? (b ? b.split(':') : []) : [];
  const full = b !== undefined ? head.concat(Array(8 - head.length - tail.length).fill('0'), tail) : head;
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}
// From `tailscale status --json`: this server's own LAN addresses and, per peer (by its tailnet IPv4), the address
// the server reaches it at right now.
function facts(status) {
  const self = (status && status.Self) || {};
  const own = (self.Addrs || []).map(hostOf);
  const peers = new Map();
  for (const p of Object.values((status && status.Peer) || {})) {
    const cur = hostOf(p && p.CurAddr);
    for (const t of (p && p.TailscaleIPs) || []) if (net.isIPv4(t) && cur) peers.set(t, cur);
  }
  return { v4: own.filter((h) => net.isIPv4(h) && isPrivate4(h)), v6: own.filter((h) => net.isIPv6(h) && !/^fe80/i.test(h)).map(prefix64), peers };
}
// The address to answer the peer at `src` (its tailnet IPv4) with.
function pick(src, f, tsip) {
  const cur = f && f.peers ? f.peers.get(src) : '';
  if (!cur || !f.v4.length) return tsip;
  if (net.isIPv4(cur) && isPrivate4(cur)) {
    const lan = f.v4.find((ip) => ip.split('.').slice(0, 3).join('.') === cur.split('.').slice(0, 3).join('.'));
    return lan || tsip;
  }
  if (net.isIPv6(cur) && f.v6.indexOf(prefix64(cur)) >= 0) return f.v4[0];
  return tsip;
}

function start() {
  const ip = tsIp();
  if (!net.isIPv4(ip)) { console.log('TDH_DNS_WAIT no-tailscale-ip'); return setTimeout(start, 15000); }
  let known = null;
  const refresh = () => execFile(TS, ['status', '--json'], { encoding: 'utf8', timeout: 8000, maxBuffer: 8 << 20, windowsHide: true }, (err, out) => {
    if (err) return;
    try { known = facts(JSON.parse(out)); } catch (e) { /* keep the last */ }
  });
  refresh();
  setInterval(refresh, 10000);
  const choose = (src) => pick(String(src || '').replace(/^::ffff:/, ''), known, ip);
  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg, rinfo) => { const r = answer(msg, choose(rinfo.address)); if (r) udp.send(r, rinfo.port, rinfo.address); });
  udp.on('error', (e) => { console.log('TDH_DNS_UDP_ERR ' + e.message); try { udp.close(); } catch (x) {} setTimeout(start, 15000); });
  udp.bind(53, ip, () => console.log('TDH_DNS_UP udp ' + ip + ':53 ' + NAME + ' -> ' + ip));
  const tcp = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        const len = buf.readUInt16BE(0);
        const r = answer(buf.subarray(2, 2 + len), choose(s.remoteAddress));
        buf = buf.subarray(2 + len);
        if (r) { const l = Buffer.alloc(2); l.writeUInt16BE(r.length, 0); s.write(Buffer.concat([l, r])); }
      }
    });
    s.on('error', () => {});
    s.setTimeout(10000, () => s.destroy());
  });
  tcp.on('error', (e) => console.log('TDH_DNS_TCP_ERR ' + e.message));
  tcp.listen(53, ip);
  // tailnet 地址变了（换网、重新登录）就重启自己，由计划任务拉起
  setInterval(() => { const now = tsIp(); if (now && now !== ip) { console.log('TDH_DNS_IP_CHANGED ' + now); process.exit(3); } }, 60000);
}
if (require.main === module) start();
module.exports = { answer, facts, pick, prefix64 };
