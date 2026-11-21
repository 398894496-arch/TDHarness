'use strict';
// company-evening-report-v1: the day so far in a scratch brain, for the evening report (server/daily_report.py).
// The real brain writes a day's evidence (L0) only at 00:15 the night after; the 17:00 report needs today's. This writes
// today's L0 into another folder: the real brain's ledger is copied in first, so only what the real one does not have yet
// (today) is written, and the real brain is never touched.
//
//   node day-so-far.js --brain-root <scratch> --source-brain D:\dsh\brain --company-root D:\dsh\company --people-roster D:\dsh\runtime\roster.json
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const homes = require('./homes-from-share');
const l0 = require('./l0-ingest');

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  if (!args.brainRoot) throw new Error('--brain-root missing');
  if (lib.isProdBrain(roots.brain) || (args.sourceBrain && path.resolve(args.sourceBrain) === path.resolve(roots.brain))) throw new Error('scratch brain only');
  const ledger = path.join(roots.brain, '90-system', 'l0-ledger.jsonl');
  lib.mkdirp(path.dirname(ledger));
  if (args.sourceBrain) {
    const src = path.join(args.sourceBrain, '90-system', 'l0-ledger.jsonl');
    if (fs.existsSync(src)) fs.copyFileSync(src, ledger);
  }
  const homesFile = path.join(roots.brain, '90-system', 'homes.json');
  const a = Object.assign({}, args, { write: true, homesFile });
  homes.writeHomes(roots, a);
  const r = l0.ingestFromHomesFile(roots, a);
  process.stdout.write('DAY_SO_FAR_ADDED=' + r.added + ' SCANNED=' + r.scanned + '\n');
}

try { main(); } catch (e) {
  process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
  process.exit(2);
}
