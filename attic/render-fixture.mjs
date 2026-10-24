// Renders the 世界 page to standalone HTML fixtures so the design can be inspected in a real
// browser without a bundler. SSR markup + the plugin's own injected CSS = exactly what the host
// webview paints; interactivity is covered by test_ui.mjs, this covers look and layout.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);
globalThis.window = { __LOCAL_COMPUTER__: { url: 'http://127.0.0.1:59001', token: 'fixture-only' } };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
const headEl = { appendChild() { } };
globalThis.document = {
  head: headEl, getElementById: () => null,
  createElement: () => ({ id: '', textContent: '', setAttribute() { } }),
};

const CLIENT = path.resolve(R('lib/client.js'));
const React = (await import('react')).default ?? await import('react');
globalThis.__DSH_REACT__ = React;
(0, eval)(fs.readFileSync(CLIENT, 'utf8'));
const { WorldPage, CSS } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const { renderToStaticMarkup } = await import('react-dom/server');

const NOW = Date.now();
const at = m => new Date(NOW - m * 1000).toISOString();
const rich = {
  machineId: 'ZHANGD-PC',
  pending: [
    {
      approvalId: 'ap_9f2c41', action: 'run-command', createdAt: at(24),
      args: { command: 'pnpm', args: ['build', '--filter', '@deepseek/harness'], cwd: 'D:/work/harness', timeoutMs: 120000 },
    },
    {
      approvalId: 'ap_71ba08', action: 'write-file', createdAt: at(190),
      args: { path: 'D:/work/harness/src/nodes/registry.ts', content: "export const NODES = { crop: 'v2' };\n" },
    },
  ],
  permissions: { 'read-file': 'always', 'list-dir': 'always' },
  grants: { 'run-command': 3, 'read-file': 11 },
  audit: [
    { kind: 'responded', at: at(40), action: 'run-command', approvalId: 'ap_5d10', verdict: 'allow-once' },
    { kind: 'executed', at: at(41), action: 'run-command', command: 'ffprobe -v error -show_streams 03_final.mp4', exitCode: 0 },
    { kind: 'executed', at: at(96), action: 'read-file', command: 'D:/work/harness/package.json', exitCode: 0 },
    { kind: 'denied', at: at(300), action: 'run-command', command: 'del /S /Q D:\\work\\cache', exitCode: null },
    { kind: 'revoked', at: at(1400), action: 'write-file' },
    { kind: 'executed', at: at(3600), action: 'list-dir', command: 'D:/Apps', exitCode: 0 },
  ],
};

const views = {
  'fixture.html': React.createElement(WorldPage, { snapshot: rich }),
  'fixture-empty.html': React.createElement(WorldPage, {
    snapshot: { machineId: 'ZHANGD-PC', pending: [], permissions: {}, grants: {}, audit: [] },
  }),
  'fixture-off.html': (() => {
    globalThis.window.__LOCAL_COMPUTER__ = null;
    const el = React.createElement(WorldPage);
    globalThis.window.__LOCAL_COMPUTER__ = { url: 'http://127.0.0.1:59001', token: 'fixture-only' };
    return el;
  })(),
  'fixture-entry.html': React.createElement('div', { className: 'wc-rail', style: { width: 236, height: 84 } },
    React.createElement('a', { className: 'wc-row-link', href: '#', 'data-live': '1' },
      React.createElement('span', { className: 'wc-entry' },
        React.createElement('svg', { className: 'wc-ico wc-globe', width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
          React.createElement('path', { d: 'M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
          React.createElement('path', { d: 'M1.75 8h12.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 })),
        React.createElement('span', null, '共振')))),
};

const HOST = `
/* the dsh host, approximated just enough to judge the takeover in context */
html,body{margin:0;height:100%;background:#f2f2f4;font-family:"SF Pro",-apple-system,"Segoe UI",system-ui,sans-serif}
:host,#host{display:block;height:100%}
#host{display:grid;grid-template-rows:34px minmax(0,1fr);height:100vh}
#titlebar{display:flex;align-items:center;gap:8px;padding:0 12px;background:#e9e9ec;
  border-bottom:1px solid #dcdcdf;font-size:12px;color:#4b4b52}
#titlebar .dot{width:11px;height:11px;border-radius:9999px;background:#cfcfd4}
#body{display:grid;grid-template-columns:212px minmax(0,1fr);min-height:0}
#hostnav{background:#f6f6f8;border-right:1px solid #e2e2e6;padding:10px 8px}
#hostnav a{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border-radius:6px;
  text-decoration:none;color:#1c1c1c;font-size:13px}
#hostnav a[data-on="1"]{background:#e4e4e9;font-weight:500}
#stage{min-width:0;min-height:0}
.wc-scope{height:100%}
`;

for (const [file, el] of Object.entries(views)) {
  const body = renderToStaticMarkup(el);
  const nav = file === 'fixture-entry.html' ? '' : `<div id="hostnav"><a href="#">深度对话</a><a href="#" data-on="1">共振</a><a href="#">插件市场</a></div>`;
  const stage = file === 'fixture-entry.html' ? body : `<div id="stage">${body}</div>`;
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>共振 fixture</title>
<style>${CSS}</style><style>${HOST}</style></head>
<body><div id="host">
  <div id="titlebar"><span class="dot"></span><span>DeepSeek Harness — desktop</span></div>
  <div id="body">${nav}${stage}</div>
</div></body></html>`;
  const out = path.join(R('test'), file);
  fs.writeFileSync(out, html);
  console.log('wrote', out, html.length, 'bytes');
}
