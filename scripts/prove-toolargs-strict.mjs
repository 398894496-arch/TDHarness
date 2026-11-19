#!/usr/bin/env node
// Proof for company-toolargs-strict-v1 (server/site-patches/patch_toolargs_strict.py) against the
// real kernel adapter: a copy of @earendil-works/pi-ai from KERNEL_PREFIX (an `npm install -g
// @deepseek-ai/dsh --prefix` tree) gets the patch, and a stand-in vendor streams one tool call.
// Complete arguments run; a raw newline inside a string still passes (the vendor's own repair);
// a call with no arguments is {}; arguments cut off mid-way (finish_reason length) end the turn
// as an error naming the tool, with nothing handed on. Unpatched, the cut-off call was handed on
// with half its content. Ends with TOOLARGS_STRICT_PROVE_OK=1.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const fail = (w) => { console.log("TOOLARGS_STRICT_PROVE_FAIL " + w); process.exit(1); };
const here = path.dirname(fileURLToPath(import.meta.url));
const prefix = process.env.KERNEL_PREFIX;
if (!prefix) fail("set KERNEL_PREFIX to an npm prefix holding @deepseek-ai/dsh");
const roots = [path.join(prefix, "lib", "node_modules", "@deepseek-ai", "dsh", "node_modules"), path.join(prefix, "node_modules", "@deepseek-ai", "dsh", "node_modules")];
const nm = roots.find((r) => fs.existsSync(path.join(r, "@earendil-works", "pi-ai")));
if (!nm) fail("no @earendil-works/pi-ai under " + prefix);

// A private node_modules: everything linked from the kernel, pi-ai copied so the patch lands on the copy.
const box = fs.mkdtempSync(path.join(os.tmpdir(), "tdh-toolargs-"));
const out = path.join(box, "node_modules");
fs.mkdirSync(path.join(out, "@earendil-works"), { recursive: true });
for (const e of fs.readdirSync(nm)) if (e !== "@earendil-works") fs.symlinkSync(path.join(nm, e), path.join(out, e), "junction");
for (const e of fs.readdirSync(path.join(nm, "@earendil-works"))) {
  if (e !== "pi-ai") fs.symlinkSync(path.join(nm, "@earendil-works", e), path.join(out, "@earendil-works", e), "junction");
}
fs.cpSync(path.join(nm, "@earendil-works", "pi-ai"), path.join(out, "@earendil-works", "pi-ai"), { recursive: true });
const target = path.join(out, "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js");
const py = process.platform === "win32" ? "python" : "python3";
const patchDir = path.join(here, "..", "server", "site-patches");
const how = execFileSync(py, ["-c", "import sys; sys.path.insert(0, sys.argv[1]); import patch_toolargs_strict as m; p = sys.argv[2]; t = open(p, encoding='utf-8').read(); t2, h = m.patch(t); open(p, 'w', encoding='utf-8').write(t2); t3, h2 = m.patch(t2); print(h, h2)", patchDir, target], { encoding: "utf8" }).trim();
// "already already": the kernel came patched (an installed desk carries the site patch); the
// behaviour below is what is being proven either way.
if (how !== "patched already" && how !== "already already") fail("patch did not apply once and only once: " + how);
const { stream } = await import(pathToFileURL(target).href);

function serve(pieces, finish) {
  return http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
      send({ id: "c1", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "write", arguments: "" } }] } }] });
      for (const p of pieces) send({ id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: p } }] } }] });
      send({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 5, completion_tokens: 9 } });
      res.end("data: [DONE]\n\n");
    });
  });
}
async function run(pieces, finish) {
  const srv = serve(pieces, finish);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const model = { id: "m", name: "m", api: "openai-completions", provider: "office", baseUrl: "http://127.0.0.1:" + srv.address().port + "/v1", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000, reasoning: false, compat: {} };
  const ctx = { messages: [{ role: "user", content: "hi", timestamp: Date.now() }], tools: [{ name: "write", description: "w", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } }] };
  const events = [];
  for await (const e of stream(model, ctx, { apiKey: "k" })) events.push(e);
  srv.close();
  const last = events[events.length - 1];
  return { type: last.type, reason: last.reason, err: last.error && last.error.errorMessage, args: events.filter((e) => e.type === "toolcall_end").map((e) => e.toolCall.arguments), leaked: JSON.stringify(last.message || last.error).includes("companyArgsCut") };
}
let r = await run(['{"path":"a.txt",', '"content":"hello"}'], "tool_calls");
if (r.type !== "done" || r.reason !== "toolUse" || r.args[0].content !== "hello") fail("complete arguments: " + JSON.stringify(r));
r = await run(['{"path":"a.txt","content":"line1\nline2"}'], "tool_calls");
if (r.type !== "done" || r.args[0].content !== "line1\nline2") fail("a raw newline inside a string must still pass: " + JSON.stringify(r));
r = await run([], "tool_calls");
if (r.type !== "done" || JSON.stringify(r.args[0]) !== "{}") fail("a call with no arguments: " + JSON.stringify(r));
r = await run(['{"path":"a.txt","content":"half of the fi'], "length");
if (r.type !== "error" || !/cut off/.test(r.err || "") || !/write/.test(r.err)) fail("cut-off arguments must end the turn as an error: " + JSON.stringify(r));
if (r.leaked) fail("the scratch flag leaked into the message");
console.log("TOOLARGS_STRICT_PROVE_OK=1");
