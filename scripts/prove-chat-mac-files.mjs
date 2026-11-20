// Proof for company-chat-mac-files-v1 in real WebKit (the Mac desk's engine; macOS with Xcode's command line tools
// only, no CI runner has it): scripts/mac/wkload.swift loads, off screen, a page that downloads the way the chat does
// (a blob, link.click(), revoke at once), has a download link the person clicks (an image preview's), and opens its
// file input through its label. Through the desk's chat relay (file bridge on, a stand-in chooser), both downloads
// land in Downloads and the chosen file reaches the page's input with a change event.
//   node scripts/prove-chat-mac-files.mjs   → CHAT_MAC_FILES_PROVE_OK=1 (or _SKIP off a Mac)
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
if (process.platform !== "darwin") { console.log("CHAT_MAC_FILES_PROVE_SKIP=not-a-mac"); process.exit(0); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { startChatRelay } = await import(pathToFileURL(path.join(HERE, "..", "desk", "plugins", "company-shell", "lib", "chat-relay.js")).href);
const build = fs.mkdtempSync(path.join(os.tmpdir(), "tdh-wkload-"));
const wkload = path.join(build, "wkload");
execFileSync("swiftc", ["-O", "-o", wkload, path.join(HERE, "mac", "wkload.swift")], { stdio: "inherit" });
const reports = [];
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input type="file" id="f" style="display:none"><label for="f" id="lab">attach</label>
<a id="img" href="/v0/file/s/pic.png" download="图片.png">download image</a>
<script>
function rep(q){ fetch('/v0/report?' + q); }
window.onerror = function(m){ rep('what=error&m=' + encodeURIComponent(String(m))); };
function tinodeDownload(){
  var link = document.createElement('a');
  link.href = window.URL.createObjectURL(new Blob(['下载内容 ok'], {type: 'text/plain'}));
  link.style.display = 'none';
  link.setAttribute('download', '附件.txt');
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  window.URL.revokeObjectURL(link.href);
}
document.getElementById('f').addEventListener('change', function(e){
  var f = e.target.files[0];
  f.text().then(function(s){ rep('what=picked&n=' + e.target.files.length + '&name=' + encodeURIComponent(f.name) + '&size=' + f.size + '&body=' + encodeURIComponent(s)); });
});
setTimeout(function(){ tinodeDownload(); }, 300);
setTimeout(function(){ document.getElementById('img').dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})); }, 900);
setTimeout(function(){ document.getElementById('lab').click(); }, 1500);
setTimeout(function(){ rep('what=done'); }, 3500);
</script></body></html>`;
const site = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/chat/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
  if (u.pathname === "/v0/file/s/pic.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(Buffer.from("PNGDATA")); return; }
  if (u.pathname === "/v0/report") { reports.push(Object.fromEntries(u.searchParams)); res.writeHead(204); res.end(); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const box = fs.mkdtempSync(path.join(os.tmpdir(), "tdh-wk-"));
const downloads = path.join(box, "Downloads"); fs.mkdirSync(downloads);
const chosen = path.join(box, "测试文件.txt"); fs.writeFileSync(chosen, "选中的文件内容");
const revealed = [];
const relay = startChatRelay({ site: () => "http://127.0.0.1:" + site.address().port, deskToken: () => "", login: () => "lfh",
  files: { choose: async () => [chosen], downloads, reveal: (p) => revealed.push(path.basename(p)) } });
await relay.ready;
await new Promise((r) => execFile(wkload, [relay.url(), "7"], () => r()));
const saved = Object.fromEntries(fs.readdirSync(downloads).map((n) => [n, fs.readFileSync(path.join(downloads, n), "utf8")]));
console.log("saved", JSON.stringify(saved));
console.log("revealed", JSON.stringify(revealed));
console.log("reports", JSON.stringify(reports));
const ok = saved["附件.txt"] === "下载内容 ok" && saved["图片.png"] === "PNGDATA" &&
  reports.some((r) => r.what === "picked" && r.name === "测试文件.txt" && r.body === "选中的文件内容" && r.n === "1") &&
  !reports.some((r) => r.what === "error");
console.log(ok ? "CHAT_MAC_FILES_PROVE_OK=1" : "CHAT_MAC_FILES_PROVE_FAIL");
await relay.close(); site.close(); fs.rmSync(box, { recursive: true, force: true }); fs.rmSync(build, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
