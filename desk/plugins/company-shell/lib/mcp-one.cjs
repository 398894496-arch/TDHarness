#!/usr/bin/env node
"use strict";
// One tool in front of an MCP server (stdio, one JSON message per line):
//   node mcp-one.cjs --name desktop --label "Mac 桌面" [--hide a,b] -- <server command> [args...]
// The kernel sends every tool's full definition with every model request. Peekaboo alone lists
// 24 desktop tools (about 55 KB, half of a desk's request), Windows-MCP 10. Through this
// wrapper the model sees a single tool, `<name>`, with { action, args }: the description lists
// each action with its parameter names, and a call is handed to the server as that action.
// Everything else (initialize, notifications, other methods) passes through untouched.

const { spawn } = require("node:child_process");

const argv = process.argv.slice(2);
const cut = argv.indexOf("--");
if (cut < 0 || cut === argv.length - 1) {
	process.stderr.write("usage: mcp-one.cjs --name desktop [--label text] [--hide a,b] -- <command> [args...]\n");
	process.exit(2);
}
let NAME = "desktop";
let LABEL = "桌面";
let hidden = new Set();
for (let i = 0; i < cut; i++) {
	if (argv[i] === "--name" && argv[i + 1]) NAME = argv[++i];
	else if (argv[i] === "--label" && argv[i + 1]) LABEL = argv[++i];
	else if (argv[i] === "--hide" && argv[i + 1]) hidden = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
}
const [cmd, ...cmdArgs] = argv.slice(cut + 1);

function firstSentence(text) {
	const t = String(text || "").replace(/\s+/g, " ").trim();
	const m = /^(.{1,160}?[.!?。！？])(\s|$)/.exec(t);
	return m ? m[1] : t.slice(0, 160);
}

function paramList(schema) {
	const props = (schema && typeof schema.properties === "object" && schema.properties) || {};
	const req = new Set(Array.isArray(schema && schema.required) ? schema.required : []);
	return Object.keys(props).map((k) => {
		const p = props[k] || {};
		const en = Array.isArray(p.enum) && p.enum.length && p.enum.length <= 8 ? "[" + p.enum.join("|") + "]" : "";
		return k + en + (req.has(k) ? "" : "?");
	}).join(", ");
}

/** The single tool standing for all of `tools`. Exported for the proof. */
function oneTool(tools) {
	const lines = tools.map((t) => "- " + t.name + "(" + paramList(t.inputSchema) + "): " + firstSentence(t.description));
	return {
		name: NAME,
		description: LABEL + "：一个工具做全部操作。action 选下面一个，args 填它的参数（带 ? 的可省，方括号里是可选值）。"
			+ "先用看屏幕的动作拿到界面，再点、输入、滚动。\n" + lines.join("\n"),
		inputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: { type: "string", enum: tools.map((t) => t.name), description: "要做的动作。" },
				args: { type: "object", additionalProperties: true, description: "这个动作的参数，名字见说明。" }
			},
			required: ["action"]
		}
	};
}

/** A tools/call for NAME as the server's own call, or an error message. Exported for the proof. */
function unwrapCall(params, known) {
	const a = (params && params.arguments) || {};
	const action = typeof a.action === "string" ? a.action : "";
	if (!action || hidden.has(action) || (known.size && !known.has(action))) return { error: "unknown action: " + (action || "(none)") };
	const args = a.args && typeof a.args === "object" && !Array.isArray(a.args) ? a.args : {};
	return { params: Object.assign({}, params, { name: action, arguments: args }) };
}

if (require.main !== module) {
	module.exports = { oneTool, unwrapCall, setOptions(o) { if (o.name) NAME = o.name; if (o.label) LABEL = o.label; if (o.hide) hidden = new Set(o.hide); } };
} else {
	const child = spawn(cmd, cmdArgs, { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
	const listIds = new Set();
	const known = new Set();
	const send = (stream, obj) => stream.write(JSON.stringify(obj) + "\n");
	const lines = (stream, onLine) => {
		let buf = "";
		stream.on("data", (c) => {
			buf += c.toString("utf8");
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				onLine(line);
			}
		});
	};
	lines(process.stdin, (line) => {
		let msg = null;
		try { msg = JSON.parse(line); } catch { msg = null; }
		if (!msg) { child.stdin.write(line + "\n"); return; }
		if (msg.method === "tools/list" && msg.id !== undefined) listIds.add(msg.id);
		if (msg.method === "tools/call" && msg.id !== undefined && msg.params) {
			if (msg.params.name === NAME) {
				const got = unwrapCall(msg.params, known);
				if (got.error) { send(process.stdout, { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: got.error } }); return; }
				msg.params = got.params;
			} else if (hidden.has(msg.params.name)) {
				send(process.stdout, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "tool not available on this desk: " + msg.params.name } });
				return;
			}
		}
		send(child.stdin, msg);
	});
	lines(child.stdout, (line) => {
		let msg = null;
		try { msg = JSON.parse(line); } catch { msg = null; }
		if (msg && msg.id !== undefined && listIds.has(msg.id)) {
			listIds.delete(msg.id);
			if (msg.result && Array.isArray(msg.result.tools)) {
				const tools = msg.result.tools.filter((t) => t && t.name && !hidden.has(t.name));
				known.clear();
				for (const t of tools) known.add(t.name);
				msg.result.tools = tools.length ? [oneTool(tools)] : [];
			}
		}
		if (msg) send(process.stdout, msg); else process.stdout.write(line + "\n");
	});
	process.stdin.on("end", () => { try { child.stdin.end(); } catch {} });
	child.on("exit", (code) => process.exit(code == null ? 1 : code));
}
