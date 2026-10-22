// Mirrors the host's client-loader path. The real crash was "web boot: 1 entry did not activate /
// dsh-local-computer: import failed", caused by ESM `export` in a file the host loads as a classic
// script. This test fails if that ever comes back.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'D:/111/dsh-local-computer';
const src = fs.readFileSync(ROOT + '/lib/client.js', 'utf8');
const React = (await import('react')).default ?? await import('react');

// 1. no ESM syntax at all: the host evaluates this as a plain script
assert.ok(!/^\s*export[\s{*]/m.test(src), 'client.js must contain no ESM export statements');
assert.ok(!/^\s*import[\s{*]/m.test(src), 'client.js must contain no ESM import statements');
assert.ok(/__ModuleLoader__\.load\(/.test(src), 'client.js must self-register with the module loader');
console.log('PASS  no ESM syntax; self-registers via window.__ModuleLoader__.load');

// 2. evaluate it exactly as the loader does
const registered = [];
globalThis.window = {
  __ModuleLoader__: { load: (def) => registered.push(def) },
  document: undefined,
  navigator: { language: 'zh-CN' },
};
globalThis.document = { head: { appendChild() { } }, getElementById: () => null, createElement: () => ({ id: '', textContent: '', setAttribute() { } }) };
(0, eval)(src);

assert.equal(registered.length, 1, 'exactly one module registered');
assert.equal(registered[0].id, 'dsh-local-computer', 'the registration id equals the package name');
console.log(`PASS  registered as id="${registered[0].id}"`);

// 3. the factory must take `require`, return { inject, apply }, and survive React coming from it
const factory = registered[0].factory;
assert.equal(typeof factory, 'function', 'factory is a function');
assert.equal(factory.length, 1, 'factory takes the require argument');
const fakeRequire = (name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
};
const mod = factory(fakeRequire);
assert.ok(mod && typeof mod.apply === 'function', 'factory returns an object with apply(ctx)');
assert.ok(Array.isArray(mod.inject) && mod.inject.includes('slots'),
  'factory must declare inject: ["slots"], or ctx.slots is not provided and cordis throws');
console.log(`PASS  factory(require) → { inject: ${JSON.stringify(mod.inject)}, apply }`);

// 4. apply() with a host-like ctx registers both slots and does not throw
const calls = [];
const registeredViews = [];
const ctx = {
  slots: {
    inject: (name, fn) => { calls.push(name); fn(); },     // the host calls the factory when the slot renders
    register: (cfg, Component) => { registeredViews.push({ cfg, Component }); return { cfg, Component }; },
  },
  locale: { register() { } },
};
mod.apply(ctx);
assert.deepEqual(calls.slice(0, 2), ['sidebar.panellist', 'main'], 'registers the rail entry then the full view');
assert.equal(registeredViews.length, 2, 'both registrations ran');
assert.equal(registeredViews[0].cfg.id, 'world');
assert.equal(registeredViews[0].cfg.label(), '世界', 'the rail entry is labelled 世界');
assert.equal(registeredViews[1].cfg.key, 'world', 'the main takeover view is keyed world');
console.log('PASS  apply(ctx) registers sidebar.panellist(世界) + main(world) without throwing');

// 5. a host ctx that throws on undeclared services, the way cordis actually behaves:
//    reading ctx.remote / ctx.locale without declaring them must NOT take the page down.
const hostile = new Proxy({ slots: ctx.slots }, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'then' || typeof k === 'symbol') return undefined;
    throw new Error(`cannot get property without inject: ${String(k)}`);
  },
});
let threw = null;
try { mod.apply(hostile); } catch (e) { threw = e; }
assert.equal(threw, null, `apply() must survive a cordis ctx that throws for uninjected services, got: ${threw && threw.message}`);
console.log('PASS  survives a throwing ctx (proxy that raises on any undeclared service, not just undefined)');

// 6. worst case: even a ctx whose declared slots service throws must not propagate — this module
//    may never be the reason web boot fails again.
const broken = new Proxy({}, {
  get(t, k) { if (typeof k === 'symbol' || k === 'then') return undefined; throw new Error('host exploded at ' + String(k)); },
});
let worst = null;
try { mod.apply(broken); } catch (e) { worst = e; }
assert.equal(worst, null, 'apply() must swallow every host-side failure and report it instead');
console.log('PASS  worst-case ctx (everything throws) is swallowed; the plugin cannot break web boot');

console.log('\n5 loader-conformance checks passed — this is the path that crashed web boot');
