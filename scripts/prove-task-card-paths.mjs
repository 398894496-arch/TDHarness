#!/usr/bin/env node
// The task card names folders by the server's own path (D:/dsh/company/...).
// A Windows desk sees the same tree as \\server\dsh-company, a Mac as
// ~/company. Prove the desk maps between them both ways: what the agent and
// the card show is a path this desk can open, and a path the agent hands back
// reaches the server as a path inside the company folder.
// Ends with TASK_CARD_PATHS_PROVE_OK=1.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = pathToFileURL(path.join(here, "..", "desk", "plugins", "company-shell", "lib", "index.js")).href;
const m = await import(lib);

function check(cond, what) {
	if (!cond) {
		console.error("TASK_CARD_PATHS_PROVE_FAIL " + what);
		process.exit(1);
	}
}

const server = "D:/dsh/company/emp-amy/tasks/tk-1";
const win = m.deskCompanyRoot("\\\\10.9.8.7\\dsh-company\\emp-amy");
const mac = m.deskCompanyRoot("/Users/amy/company/emp-amy");
check(win === "//10.9.8.7/dsh-company", "windows root " + win);
check(mac === "/Users/amy/company", "mac root " + mac);
check(m.deskCompanyRoot("") === "", "no personal folder, no root");

// Server path -> this desk.
check(m.deskPath(server, win) === "//10.9.8.7/dsh-company/emp-amy/tasks/tk-1", "server path on windows");
check(m.deskPath(server, mac) === "/Users/amy/company/emp-amy/tasks/tk-1", "server path on mac");
check(m.deskPath(m.deskPath(server, win), win) === m.deskPath(server, win), "mapping twice changes nothing");
check(m.deskPath(server, "") === server, "unknown root leaves the path alone");

// This desk -> the server (attach). The UNC share name used to be passed through whole.
check(m.companyRel("\\\\10.9.8.7\\dsh-company\\emp-amy\\tasks\\tk-1\\报价.xlsx") === "emp-amy/tasks/tk-1/报价.xlsx", "windows share path");
check(m.companyRel("/Users/amy/company/emp-amy/a.txt") === "emp-amy/a.txt", "mac path");
check(m.companyRel("D:\\dsh\\company\\emp-amy\\a.txt") === "emp-amy/a.txt", "server drive path");
check(m.companyRel("emp-amy/a.txt") === "emp-amy/a.txt", "already relative");
check(m.companyRel("/Users/a/companyX/y") === "/Users/a/companyX/y", "a folder that only starts with company is not the share");

// The card the person sees (and copies) gets the desk path too.
const body = Buffer.from(JSON.stringify({ ok: true, tickets: [{ id: "tk-1", folder: server }], card: { id: "tk-1", folder: server } }));
const out = JSON.parse(m.localizeMailbox(body, win).toString("utf8"));
check(out.tickets[0].folder === "//10.9.8.7/dsh-company/emp-amy/tasks/tk-1" && out.card.folder === out.tickets[0].folder, "card folders localized");
check(m.localizeMailbox(Buffer.from("not json"), win).toString() === "not json", "non-JSON passes through");

console.log("TASK_CARD_PATHS_PROVE_OK=1");
