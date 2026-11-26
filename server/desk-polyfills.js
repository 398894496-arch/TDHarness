// company-old-webview-v1 (the user's Huawei phone, 2026-11-26: Android WebView Chrome 114): the desk's page uses what
// came to Chrome after 114 — Promise.withResolvers in its very first boot line, AbortSignal.any, iterator helpers
// (map.entries().some(...)), Set methods, Symbol.dispose. On such a WebView the boot stopped at its first line: the
// computers' start page (「选择一个工作区开始」), no conversations, no live connection. desk_hub.js puts this in
// front of the page's own scripts; each piece is defined only where the browser lacks it.
(function () {
  "use strict";
  var def = function (obj, name, value) {
    if (obj && !(name in obj)) Object.defineProperty(obj, name, { value: value, writable: true, configurable: true, enumerable: false });
  };

  def(Promise, "withResolvers", function () {
    var resolve, reject;
    var promise = new this(function (a, b) { resolve = a; reject = b; });
    return { promise: promise, resolve: resolve, reject: reject };
  });
  def(Promise, "try", function (fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new this(function (resolve) { resolve(fn.apply(undefined, args)); });
  });

  if (typeof AbortSignal !== "undefined") {
    def(AbortSignal, "any", function (signals) {
      var controller = new AbortController();
      var list = Array.from(signals || []);
      for (var i = 0; i < list.length; i++) {
        if (list[i].aborted) { controller.abort(list[i].reason); return controller.signal; }
      }
      var onAbort = function () {
        for (var j = 0; j < list.length; j++) list[j].removeEventListener("abort", onAbort);
        controller.abort(this.reason);
      };
      for (var k = 0; k < list.length; k++) list[k].addEventListener("abort", onAbort);
      return controller.signal;
    });
    def(AbortSignal, "timeout", function (ms) {
      var controller = new AbortController();
      setTimeout(function () { controller.abort(new DOMException("signal timed out", "TimeoutError")); }, ms);
      return controller.signal;
    });
  }

  if (typeof Symbol === "function") {
    if (!Symbol.dispose) def(Symbol, "dispose", Symbol("Symbol.dispose"));
    if (!Symbol.asyncDispose) def(Symbol, "asyncDispose", Symbol("Symbol.asyncDispose"));
  }

  // Iterator helpers on every built-in iterator (arrays, maps, sets, strings, generators).
  var IteratorProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  var helper = function (src, step) {
    var it = { done: false };
    var out = Object.create(IteratorProto);
    out.next = function () {
      while (!it.done) {
        var r = src.next();
        if (r.done) { it.done = true; break; }
        var v = step(r.value);
        if (v !== helper.SKIP) return { value: v, done: false };
      }
      return { value: undefined, done: true };
    };
    out["return"] = function (value) {
      it.done = true;
      if (typeof src["return"] === "function") src["return"]();
      return { value: value, done: true };
    };
    return out;
  };
  helper.SKIP = {};
  def(IteratorProto, "map", function (fn) { var i = 0; return helper(this, function (v) { return fn(v, i++); }); });
  def(IteratorProto, "filter", function (fn) { var i = 0; return helper(this, function (v) { return fn(v, i++) ? v : helper.SKIP; }); });
  def(IteratorProto, "take", function (n) {
    var src = this, left = Number(n);
    var out = Object.create(IteratorProto);
    out.next = function () {
      if (left <= 0) { if (typeof src["return"] === "function") src["return"](); return { value: undefined, done: true }; }
      left--;
      return src.next();
    };
    return out;
  });
  def(IteratorProto, "drop", function (n) {
    var src = this, left = Number(n);
    var out = Object.create(IteratorProto);
    out.next = function () {
      while (left > 0) { left--; var r = src.next(); if (r.done) return r; }
      return src.next();
    };
    return out;
  });
  def(IteratorProto, "flatMap", function (fn) {
    var src = this, inner = null, i = 0;
    var out = Object.create(IteratorProto);
    out.next = function () {
      for (;;) {
        if (inner) { var r = inner.next(); if (!r.done) return r; inner = null; }
        var o = src.next();
        if (o.done) return o;
        inner = fn(o.value, i++)[Symbol.iterator]();
      }
    };
    return out;
  });
  def(IteratorProto, "toArray", function () { var a = []; for (var r = this.next(); !r.done; r = this.next()) a.push(r.value); return a; });
  def(IteratorProto, "forEach", function (fn) { var i = 0; for (var r = this.next(); !r.done; r = this.next()) fn(r.value, i++); });
  def(IteratorProto, "some", function (fn) {
    var i = 0;
    for (var r = this.next(); !r.done; r = this.next()) if (fn(r.value, i++)) { if (typeof this["return"] === "function") this["return"](); return true; }
    return false;
  });
  def(IteratorProto, "every", function (fn) {
    var i = 0;
    for (var r = this.next(); !r.done; r = this.next()) if (!fn(r.value, i++)) { if (typeof this["return"] === "function") this["return"](); return false; }
    return true;
  });
  def(IteratorProto, "find", function (fn) {
    var i = 0;
    for (var r = this.next(); !r.done; r = this.next()) if (fn(r.value, i++)) { if (typeof this["return"] === "function") this["return"](); return r.value; }
    return undefined;
  });
  def(IteratorProto, "reduce", function (fn, init) {
    var i = 0, acc = init, r = this.next();
    if (arguments.length < 2) { if (r.done) throw new TypeError("Reduce of empty iterator with no initial value"); acc = r.value; i = 1; r = this.next(); }
    for (; !r.done; r = this.next()) acc = fn(acc, r.value, i++);
    return acc;
  });
  if (typeof globalThis.Iterator === "undefined") {
    var Iter = function Iterator() {};
    Iter.prototype = IteratorProto;
    def(globalThis, "Iterator", Iter);
  }
  def(globalThis.Iterator, "from", function (o) {
    var it = typeof o[Symbol.iterator] === "function" ? o[Symbol.iterator]() : o;
    if (IteratorProto.isPrototypeOf(it)) return it;
    var out = Object.create(IteratorProto);
    out.next = function () { return it.next(); };
    return out;
  });

  // Set methods (Chrome 122).
  var keysOf = function (other) { return other && typeof other.keys === "function" ? other.keys() : new Set(other).keys(); };
  var hasIn = function (other, v) { return other && typeof other.has === "function" ? other.has(v) : new Set(other).has(v); };
  def(Set.prototype, "union", function (other) { var s = new Set(this); for (var r = keysOf(other), x = r.next(); !x.done; x = r.next()) s.add(x.value); return s; });
  def(Set.prototype, "intersection", function (other) { var s = new Set(); this.forEach(function (v) { if (hasIn(other, v)) s.add(v); }); return s; });
  def(Set.prototype, "difference", function (other) { var s = new Set(); this.forEach(function (v) { if (!hasIn(other, v)) s.add(v); }); return s; });
  def(Set.prototype, "symmetricDifference", function (other) {
    var s = new Set(this);
    for (var r = keysOf(other), x = r.next(); !x.done; x = r.next()) { if (this.has(x.value)) s["delete"](x.value); else s.add(x.value); }
    return s;
  });
  def(Set.prototype, "isSubsetOf", function (other) { var ok = true; this.forEach(function (v) { if (!hasIn(other, v)) ok = false; }); return ok; });
  def(Set.prototype, "isSupersetOf", function (other) { for (var r = keysOf(other), x = r.next(); !x.done; x = r.next()) if (!this.has(x.value)) return false; return true; });
  def(Set.prototype, "isDisjointFrom", function (other) { var ok = true; this.forEach(function (v) { if (hasIn(other, v)) ok = false; }); return ok; });

  // Grouping, async arrays and URL helpers (Chrome 117-126).
  def(Object, "groupBy", function (items, fn) {
    var out = Object.create(null), i = 0;
    for (var r = items[Symbol.iterator](), x = r.next(); !x.done; x = r.next()) { var k = fn(x.value, i++); (out[k] || (out[k] = [])).push(x.value); }
    return out;
  });
  def(Map, "groupBy", function (items, fn) {
    var out = new Map(), i = 0;
    for (var r = items[Symbol.iterator](), x = r.next(); !x.done; x = r.next()) { var k = fn(x.value, i++); if (!out.has(k)) out.set(k, []); out.get(k).push(x.value); }
    return out;
  });
  def(Array, "fromAsync", function (items, fn) {
    var self = this;
    return (async function () {
      var out = [], i = 0;
      if (items && typeof items[Symbol.asyncIterator] === "function") { for await (var v of items) out.push(fn ? await fn(v, i++) : v); }
      else { for (var w of items) { var x = await w; out.push(fn ? await fn(x, i++) : x); } }
      return self === Array ? out : Array.from(out);
    })();
  });
  if (typeof URL === "function") {
    def(URL, "canParse", function (u, base) { try { new URL(u, base); return true; } catch (e) { return false; } });
    def(URL, "parse", function (u, base) { try { return new URL(u, base); } catch (e) { return null; } });
  }
})();
