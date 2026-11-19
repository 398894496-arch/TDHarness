# KRouter (vendored)

The retrieval code of KRouter (https://github.com/398894496-arch/KRouter, MIT), pinned at commit
`3db52f6` (main after v2.1.2), copied as is from `skill/krouter/scripts/`. TDH uses it for the memory
layer of the company knowledge search (company-krouter-memory-v1): `server/krouter-recall.py` imports
`recall_index` and answers `server/knowledge-search.js`. Only its retrieval runs here; its model calls
(answer cards, nightly upkeep) are off.

To move to a newer KRouter: replace `scripts/` with that commit's `skill/krouter/scripts/`, change the
commit above, and run `node scripts/prove-krouter-memory.js` and `node scripts/prove-knowledge.js`.
