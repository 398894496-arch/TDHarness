#!/usr/bin/env node
'use strict';

// Proof for desk/plugins/company-shell/lib/mcp-one.cjs: a desktop MCP server behind it shows the model one
// tool, a call to that tool reaches the server as the chosen action with its args, and hidden
// or unknown actions are refused without reaching the server. A stand-in server, no desktop.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ONE = path.join(__dirname, '..', 'desk', 'plugins', 'company-shell', 'lib', 'mcp-one.cjs');

const SERVER = `
const tools = [
  { name: 'see', description: 'Capture the screen and list its elements. Use it first.', inputSchema: { type: 'object', properties: { app: { type: 'string' } } } },
  { name: 'click', description: 'Clicks on UI elements or coordinates. Long text.', inputSchema: { type: 'object', properties: { on: { type: 'string' }, button: { type: 'string', enum: ['left', 'right'] } }, required: ['on'] } },
  { name: 'agent', description: 'Runs a nested agent.', inputSchema: { type: 'object', properties: {} } }
];
let buf = '';
process.stdin.on('data', (c) => {
  buf += c; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools } }) + '\\n');
    else if (m.method === 'tools/call') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'got ' + m.params.name + ' ' + JSON.stringify(m.params.arguments) }] } }) + '\\n');
    else if (m.method === 'resources/templates/list') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Unknown method: resources/templates/list' } }) + '\\n');
    else if (m.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { ok: m.method } }) + '\\n');
  }
});
`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-mcp-one-'));
  const server = path.join(dir, 'server.js');
  fs.writeFileSync(server, SERVER);
  const p = spawn(process.execPath, [ONE, '--name', 'desktop', '--label', 'Mac 桌面', '--hide', 'agent', '--', process.execPath, server], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let buf = '';
  p.stdout.on('data', (c) => {
    buf += c; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); }
    }
  });
  let id = 0;
  const ask = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  try {
    let r = await ask('initialize', {});
    assert.equal(r.result.ok, 'initialize', 'other methods pass through');
    r = await ask('tools/list', {});
    assert.equal(r.result.tools.length, 1, 'one tool');
    const t = r.result.tools[0];
    assert.equal(t.name, 'desktop');
    assert.deepEqual(t.inputSchema.properties.action.enum, ['see', 'click'], 'hidden actions are not offered');
    assert.match(t.description, /- click\(on, button\[left\|right\]\?\): Clicks on UI elements or coordinates\./);
    assert.match(t.description, /- see\(app\?\): Capture the screen and list its elements\./);
    assert.ok(!/agent/.test(t.description));
    r = await ask('tools/call', { name: 'desktop', arguments: { action: 'click', args: { on: 'B3' } } });
    assert.equal(r.result.content[0].text, 'got click {"on":"B3"}', 'the call reaches the server as the action');
    r = await ask('tools/call', { name: 'desktop', arguments: { action: 'see' } });
    assert.equal(r.result.content[0].text, 'got see {}', 'args may be left out');
    r = await ask('tools/call', { name: 'desktop', arguments: { action: 'agent', args: {} } });
    assert.match(r.error.message, /unknown action: agent/, 'a hidden action is refused');
    r = await ask('tools/call', { name: 'desktop', arguments: { action: 'format_disk' } });
    assert.match(r.error.message, /unknown action/, 'an action the server never listed is refused');
    r = await ask('resources/templates/list', {});
    assert.deepEqual(r.result, { resourceTemplates: [] }, 'a server without templates answers an empty list, not an error');
    assert.equal(r.error, undefined);
    r = await ask('tools/call', { name: 'agent', arguments: {} });
    assert.match(r.error.message, /not available/, 'the hidden tool by its own name is refused');
  } finally {
    p.kill();
  }
  // --only: an allowlist. A tool the server adds later stays off until it is named.
  const q = spawn(process.execPath, [ONE, '--name', 'desktop', '--only', 'see,agent', '--hide', 'agent', '--', process.execPath, server], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting2 = new Map();
  let buf2 = '';
  q.stdout.on('data', (c) => {
    buf2 += c; let i;
    while ((i = buf2.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf2.slice(0, i)); buf2 = buf2.slice(i + 1);
      const w = waiting2.get(m.id); if (w) { waiting2.delete(m.id); w(m); }
    }
  });
  const ask2 = (method, params) => new Promise((resolve) => { const n = ++id; waiting2.set(n, resolve); q.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  try {
    let r = await ask2('tools/list', {});
    assert.deepEqual(r.result.tools[0].inputSchema.properties.action.enum, ['see'], 'only the allowlisted, minus hidden');
    r = await ask2('tools/call', { name: 'desktop', arguments: { action: 'click', args: { on: 'B3' } } });
    assert.match(r.error.message, /unknown action: click/, 'a tool outside the allowlist is refused');
    r = await ask2('tools/call', { name: 'click', arguments: { on: 'B3' } });
    assert.match(r.error.message, /not available/, 'and by its own name too');
    r = await ask2('tools/call', { name: 'desktop', arguments: { action: 'see' } });
    assert.equal(r.result.content[0].text, 'got see {}');
  } finally {
    q.kill();
  }
  console.log('MCP_ONE_PROVE_OK=1');
}

main().catch((e) => { console.error(e); process.exit(1); });
