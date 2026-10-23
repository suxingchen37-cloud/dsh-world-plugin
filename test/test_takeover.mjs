import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const sandbox = { window: {}, __DSH_REACT__: React, console: { log() {}, error() {} },
  navigator: { language: 'zh-CN' }, setTimeout, clearTimeout,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  document: { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ setAttribute() {} }) } };
vm.runInNewContext(source, sandbox);
const api = sandbox.window.__DSH_LOCAL_COMPUTER__;

class Element {
  constructor(tag, attrs = {}, css = {}) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.parentElement = null;
    this.css = { ...css };
    this.style = {
      getPropertyValue: key => this.css[key]?.value || '',
      getPropertyPriority: key => this.css[key]?.priority || '',
      setProperty: (key, value, priority = '') => { this.css[key] = { value, priority }; },
      removeProperty: key => { delete this.css[key]; },
    };
  }
  getAttribute(key) { return this.attrs[key] ?? null; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; n.ownerDocument = this.ownerDocument; this.children.push(n); } }
}
const body = new Element('body'); body.ownerDocument = { body };
const host = new Element('div', { 'aria-hidden': 'false' }, { visibility: { value: 'visible', priority: '' } });
const menu = new Element('div', { inert: '', 'aria-hidden': 'true' });
const style = new Element('style');
const portal = new Element('div');
body.append(host, menu, style, portal);
for (let n = 0; n < 3; n++) {
  const restore = api.isolateHostContent(portal);
  assert.equal(host.getAttribute('inert'), '');
  assert.equal(host.getAttribute('aria-hidden'), 'true');
  assert.equal(host.style.getPropertyValue('visibility'), 'hidden');
  assert.equal(host.style.getPropertyPriority('visibility'), 'important');
  assert.equal(portal.getAttribute('inert'), null);
  assert.equal(style.getAttribute('inert'), null);
  restore(); restore();
  assert.equal(host.getAttribute('inert'), null);
  assert.equal(host.getAttribute('aria-hidden'), 'false');
  assert.equal(host.style.getPropertyValue('visibility'), 'visible');
  assert.equal(host.style.getPropertyPriority('visibility'), '');
  assert.equal(menu.getAttribute('inert'), '');
  assert.equal(menu.getAttribute('aria-hidden'), 'true');
  assert.equal(menu.style.getPropertyValue('visibility'), '');
}
console.log('PASS repeated enter/leave preserves pre-existing visibility, accessibility and inert state');

const sidebar = new Element('aside'), center = new Element('main'), rightbar = new Element('aside');
host.append(sidebar, center, rightbar);
const embedded = new Element('section'); center.append(embedded);
const restoreEmbedded = api.isolateHostContent(embedded);
assert.equal(sidebar.getAttribute('inert'), '');
assert.equal(rightbar.getAttribute('inert'), '');
assert.equal(host.getAttribute('inert'), null);
assert.equal(center.getAttribute('inert'), null);
restoreEmbedded();
assert.equal(sidebar.getAttribute('inert'), null);
console.log('PASS fallback isolation hides siblings without disabling the containing host or plugin');

const views = [], selections = [];
api.apply({
  slots: { inject(name, cb) { return cb(); }, register(options, Component) { views.push({ options, Component }); } },
  layout: { selectPanel(id) { selections.push(id); } },
});
assert.equal(api.returnToHost(), true);
assert.deepEqual(selections, [null]);
const main = views.find(v => v.options.name === 'main');
const html = renderToStaticMarkup(React.createElement(main.Component));
assert.ok(html.includes('rs-shell'));
assert.ok(html.includes('返回 DeepSeek'));
assert.ok(html.includes('AI 协作空间'));
assert.equal((html.match(/class="rs-nav-button"/g) || []).length, 8, 'the shell shows the eight places of the design');
assert.ok(html.includes('共振'));
for (const view of ['bots', 'notebook', 'home', 'sessions', 'projects', 'caps']) {
  const page = renderToStaticMarkup(React.createElement(api.WorldPage, { initialFocus: view }));
  assert.ok(page.includes('rs-view-heading'));
  assert.ok(!/undefined|NaN/.test(page));
}
console.log('PASS actual registered main view renders the independent shell, return entry and eight real feature routes');

for (const [name, css] of [['prototype', api.RS_CSS], ['shell', api.RESONANCE_SHELL_CSS]]) {
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, name + ' stylesheet braces');
}
assert.ok(api.RESONANCE_SHELL_CSS.includes('html[data-windows-titlebar]'));
assert.ok(api.RESONANCE_SHELL_CSS.includes('prefers-reduced-motion'));
console.log('PASS stylesheet boundaries, native Windows titlebar clearance and reduced motion');
