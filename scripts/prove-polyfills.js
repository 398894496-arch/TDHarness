// Proof for company-old-webview-v1 (server/desk-polyfills.js): with what Chrome 114 lacks taken away, each polyfill
// behaves as the built-in does; where the built-in is there, nothing is replaced. Ends with POLYFILLS_OK.
const assert = require("assert");
const IP = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
for (const k of ["map","filter","take","drop","flatMap","toArray","forEach","some","every","find","reduce"]) delete IP[k];
delete Promise.withResolvers; delete Promise.try; delete AbortSignal.any;
for (const k of ["union","intersection","difference","symmetricDifference","isSubsetOf","isSupersetOf","isDisjointFrom"]) delete Set.prototype[k];
delete Object.groupBy; delete Map.groupBy; delete Array.fromAsync; delete URL.canParse; delete URL.parse;
const savedIter = globalThis.Iterator; delete globalThis.Iterator;
assert.strictEqual(typeof Promise.withResolvers, "undefined");
const FILE = require("path").join(__dirname, "..", "server", "desk-polyfills.js");
require(FILE);
(async () => {
  const w = Promise.withResolvers(); w.resolve(5); assert.strictEqual(await w.promise, 5);
  assert.strictEqual(await Promise.try(() => 7), 7);
  const a = new AbortController(), b = new AbortController(); const s = AbortSignal.any([a.signal, b.signal]);
  assert.ok(!s.aborted); b.abort("why"); assert.ok(s.aborted); assert.strictEqual(s.reason, "why");
  assert.ok(AbortSignal.any([AbortSignal.abort("x")]).aborted);
  const m = new Map([["a", 1], ["b", 2], ["c", 3]]);
  assert.ok(m.entries().some(([k]) => k === "b")); assert.ok(!m.values().some((v) => v > 9));
  assert.deepStrictEqual(m.entries().find(([, v]) => v === 2), ["b", 2]);
  assert.deepStrictEqual(m.values().filter((v) => v > 1).toArray(), [2, 3]);
  assert.deepStrictEqual(m.values().map((v) => v * 2).toArray(), [2, 4, 6]);
  assert.deepStrictEqual([1,2,3,4].values().drop(1).take(2).toArray(), [2, 3]);
  assert.deepStrictEqual([1,2].values().flatMap((v) => [v, v]).toArray(), [1,1,2,2]);
  assert.strictEqual([1,2,3].values().reduce((x, y) => x + y), 6);
  assert.ok([1,2].values().every((v) => v > 0));
  for (const x of m.values().map((v) => v)) assert.ok(x);
  assert.deepStrictEqual(Iterator.from([1, 2]).map((v) => v + 1).toArray(), [2, 3]);
  function* g() { yield 1; yield 2; yield 3; } assert.deepStrictEqual(g().filter((v) => v % 2).toArray(), [1, 3]);
  const A = new Set([1,2,3]), B = new Set([3,4]);
  assert.deepStrictEqual([...A.union(B)], [1,2,3,4]); assert.deepStrictEqual([...A.intersection(B)], [3]);
  assert.deepStrictEqual([...A.difference(B)], [1,2]); assert.deepStrictEqual([...A.symmetricDifference(B)].sort(), [1,2,4]);
  assert.ok(new Set([3]).isSubsetOf(B)); assert.ok(A.isSupersetOf(new Set([1]))); assert.ok(new Set([9]).isDisjointFrom(A));
  assert.deepStrictEqual(Object.groupBy([1,2,3], (v) => v % 2 ? "odd" : "even"), Object.assign(Object.create(null), { odd: [1,3], even: [2] }));
  assert.deepStrictEqual(Map.groupBy([1,2,3], (v) => v % 2).get(1), [1,3]);
  assert.deepStrictEqual(await Array.fromAsync([Promise.resolve(1), 2]), [1, 2]);
  assert.ok(URL.canParse("https://a.b/")); assert.ok(!URL.canParse("nope")); assert.strictEqual(URL.parse("nope"), null);
  assert.ok(typeof Symbol.dispose === "symbol");
  // Already there: nothing replaced.
  const before = Promise.withResolvers; require("vm").runInThisContext(require("fs").readFileSync(FILE, "utf8")); assert.strictEqual(Promise.withResolvers, before);
  console.log("POLYFILLS_OK");
})().catch((e) => { console.log("POLYFILLS_FAIL", e.message); process.exitCode = 1; });
