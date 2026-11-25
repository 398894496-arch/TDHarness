// company-phone-push-v1: sends notifications to Apple's push service (APNs) for people-api (server/push.py).
//
// APNs speaks HTTP/2 only and signs with ES256; this machine's Python has neither, its Node has both (node:http2,
// node:crypto), so the sending is here and nothing is installed. One run: a JSON on stdin
//   {"key_file", "key_id", "team_id", "topic", "items": [{"token", "env": "sandbox"|"production", "payload",
//     "type": "alert"|"background", "collapse"?}]}
// and one JSON line on stdout: {"ok": true, "results": [{"token", "status", "reason"}]}. The key's contents never
// leave this process; nothing about a notification is logged here.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http2 = require("node:http2");

const HOSTS = { sandbox: "https://api.sandbox.push.apple.com", production: "https://api.push.apple.com" };

function b64url(buf) {
	return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** The provider token: ES256 over {iss: team, iat: now}, kid: the key's id (Apple takes one for up to an hour). */
function providerToken(keyPem, keyId, teamId) {
	const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
	const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
	const sig = crypto.sign("sha256", Buffer.from(head + "." + claims), { key: keyPem, dsaEncoding: "ieee-p1363" });
	return head + "." + claims + "." + b64url(sig);
}

function sendOne(session, jwt, topic, item) {
	return new Promise((resolve) => {
		const background = item.type === "background";
		const headers = {
			":method": "POST",
			":path": "/3/device/" + item.token,
			authorization: "bearer " + jwt,
			"apns-topic": topic,
			"apns-push-type": background ? "background" : "alert",
			"apns-priority": background ? "5" : "10",
			"content-type": "application/json",
		};
		if (item.collapse) headers["apns-collapse-id"] = String(item.collapse).slice(0, 64);
		let req;
		try {
			req = session.request(headers);
		} catch (err) {
			resolve({ token: item.token, status: 0, reason: "request-" + (err && err.code || "failed") });
			return;
		}
		let status = 0;
		let body = "";
		req.setEncoding("utf8");
		req.on("response", (h) => { status = h[":status"] || 0; });
		req.on("data", (c) => { body += c; });
		req.on("end", () => {
			let reason = "";
			try { reason = body ? (JSON.parse(body).reason || "") : ""; } catch { reason = ""; }
			resolve({ token: item.token, status, reason });
		});
		req.on("error", (err) => resolve({ token: item.token, status: 0, reason: "stream-" + (err && err.code || "error") }));
		req.setTimeout(15000, () => { req.close(); resolve({ token: item.token, status: 0, reason: "timeout" }); });
		req.end(JSON.stringify(item.payload || {}));
	});
}

async function main() {
	let raw = "";
	for await (const chunk of process.stdin) raw += chunk;
	const job = JSON.parse(raw || "{}");
	const keyPem = fs.readFileSync(job.key_file, "utf8");
	const jwt = providerToken(keyPem, job.key_id, job.team_id);
	const results = [];
	const byEnv = {};
	for (const it of job.items || []) (byEnv[it.env === "production" ? "production" : "sandbox"] ||= []).push(it);
	for (const env of Object.keys(byEnv)) {
		const session = http2.connect(HOSTS[env]);
		session.on("error", () => {});
		try {
			const got = await Promise.all(byEnv[env].map((it) => sendOne(session, jwt, job.topic, it)));
			results.push(...got);
		} finally {
			session.close();
		}
	}
	process.stdout.write(JSON.stringify({ ok: true, results }) + "\n");
}

main().catch((err) => {
	process.stdout.write(JSON.stringify({ ok: false, why: String(err && err.code || err && err.name || "failed") }) + "\n");
	process.exitCode = 1;
});
