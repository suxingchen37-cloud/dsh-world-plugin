// Verifies the two halves that do NOT need a running dsh:
//   1) host side (lib/index.js): loopback endpoint, token guard, snapshot/respond/revoke, state file
//   2) client side (lib/client.js): the 共振 entry + the full-view page actually render
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const ROOT = path.resolve('D:/111/dsh-local-computer');
const STATE = path.join(ROOT, 'state', 'ui-test');
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(STATE, { recursive: true });
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
process.env.DSH_LOCAL_COMPUTER_ROOT = STATE;
const out = []; const say = t => { out.push(t); console.log(t); };
// react escapes these five in text nodes; an assertion about rendered text has to compare in kind
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// seed a pending approval exactly the way the MCP server would
fs.writeFileSync(path.join(STATE, 'computer.json'), JSON.stringify({
  machineId: 'dsh-test', permissions: {}, grants: {},
  pending: [{ approvalId: 'ap_seed1', action: 'run-command', args: { command: 'node', args: ['-e', 'console.log(1)'] }, createdAt: 'now' }],
  audit: [{ kind: 'executed', at: 'now', action: 'run-command', command: 'whoami', exitCode: 0 }],
}, null, 2));

// ---- host side ----
const { apply, name } = await import('../lib/index.js');
assert.equal(name, 'dsh-local-computer');
const disposers = [];
const fakeCtx = { logger: { info() { } } };
const dispose = apply(fakeCtx);
if (typeof dispose === 'function') disposers.push(dispose);
const t0 = Date.now();
let ep;
while (Date.now() - t0 < 3000) {
  if (fs.existsSync(path.join(STATE, 'ui-endpoint.json'))) { ep = JSON.parse(fs.readFileSync(path.join(STATE, 'ui-endpoint.json'), 'utf8')); break; }
  await new Promise(r => setTimeout(r, 50));
}
assert.ok(ep?.url && ep?.token, 'host must publish a loopback endpoint file');
assert.ok(ep.url.startsWith('http://127.0.0.1:'), 'loopback only: ' + ep.url);
const get = (p, token = ep.token, init) => fetch(ep.url + p, { ...(init ?? {}), headers: { 'x-local-computer-token': token, ...(init?.headers ?? {}) } });

const noToken = await fetch(ep.url + '/snapshot');
assert.equal(noToken.status, 401, 'snapshot without the token must be refused');
assert.equal((await get('/snapshot', 'wrong')).status, 401);
const snap = await (await get('/snapshot')).json();
assert.equal(snap.pending.length, 1);
assert.equal(snap.pending[0].action, 'run-command');
assert.equal(snap.audit.length, 1);
say(`PASS  host endpoint: loopback ${ep.url}, token guard 401 on missing/wrong, snapshot shows 1 pending + 1 audit`);

// a verdict must carry a nonce that this very server just handed out
const fresh = async () => (await (await get('/snapshot')).json()).nonce;
const noNonce = await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'ap_seed1', verdict: 'always' }) });
assert.equal(noNonce.status, 403, 'a verdict without a nonce must be refused');
const n1 = await fresh();
const replay = await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'ap_seed1', verdict: 'always', nonce: 'deadbeef' }) });
assert.equal(replay.status, 403);
const second = await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'ap_seed1', verdict: 'always', nonce: n1 }) });
assert.equal(second.status, 200);
const reuse = await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'ap_seed1', verdict: 'always', nonce: n1 }) });
assert.equal(reuse.status, 403, 'a nonce is single-use, even a valid one');
say('PASS  verdict nonce: missing 403, unknown 403, fresh 200, replayed 403');

const resp = await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'ap_seed1', verdict: 'always', nonce: await fresh() }) });
assert.equal(resp.status, 200);
const after = await (await get('/snapshot')).json();
assert.equal(after.pending.length, 0, 'a resolved ticket leaves the queue');
assert.equal(after.permissions['run-command'], 'always');
const revoked = await get('/revoke', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run-command', nonce: await fresh() }) });
assert.equal(revoked.status, 200);
const after2 = await (await get('/snapshot')).json();
assert.equal(after2.permissions['run-command'], undefined, 'revoke drops the always grant');
const unknown = await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'nope', verdict: 'always', nonce: await fresh() }) });
assert.equal(unknown.status, 404);
const badVerdict = await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'ap_seed1', verdict: 'yolo', nonce: await fresh() }) });
assert.equal(badVerdict.status, 400);
say('PASS  host mutation: respond(always) grants per action, revoke removes it, unknown id 404, bad verdict 400');

// origin model: the app's own renderer may read without the token, a foreign page may not, and a
// nonce is only ever minted for the app — so a page that guesses the port can look at nothing and
// change nothing.
const appRes = await fetch(ep.url + '/snapshot', { headers: { origin: 'dsh-app://app' } });
assert.equal(appRes.status, 200, 'the app origin reads without a token');
assert.equal(appRes.headers.get('access-control-allow-origin'), 'dsh-app://app', 'CORS echoes only that origin');
const appSnap = await appRes.json();
assert.ok(appSnap.nonce, 'the app origin receives a nonce');
const evilRes = await fetch(ep.url + '/snapshot', { headers: { origin: 'https://evil.example' } });
assert.equal(evilRes.status, 401, 'a foreign page cannot read');
assert.equal(evilRes.headers.get('access-control-allow-origin'), null, 'and gets no CORS grant');
const evilPost = await fetch(ep.url + '/respond', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'ap_seed1', verdict: 'always', nonce: appSnap.nonce }) });
assert.equal(evilPost.status, 401, 'a foreign page cannot present a nonce');
const appPost = await fetch(ep.url + '/respond', { method: 'POST', headers: { origin: 'dsh-app://app', 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: 'no-such-ticket', verdict: 'always', nonce: (await (await fetch(ep.url + '/snapshot', { headers: { origin: 'dsh-app://app' } })).json()).nonce }) });
assert.equal(appPost.status, 404, 'the app origin passes auth and reaches the handler, got ' + appPost.status + ' ' + (await appPost.clone().text()).slice(0,80));
say('PASS  origin gate: app reads + acts by nonce, foreign pages get 401 and no CORS');

// the MCP server must observe the same grant through the shared state file
const mcpHandles = [];
const mcp = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.mjs')], {
  cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DSH_LOCAL_COMPUTER_STATE: STATE, DSH_LOCAL_COMPUTER_ROOT: STATE },
});
let buf = ''; const waiters = []; let mid = 0;
mcp.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { const w = waiters.shift(); if (w) w(JSON.parse(l)); } } });
const rpc = (method, params) => new Promise(res => { waiters.push(res); const id = ++mid; mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
// the MCP server reads the same state file: after the UI revoked the grant, a shell call must be held
const held = JSON.parse((await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log(1)'] } })).result.content[0].text);
assert.equal(held.status, 'permission_pending', 'MCP side must honour the revoked grant: ' + JSON.stringify(held));
// grant it from the UI side, then the same MCP call runs
await get('/respond', ep.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: held.approvalId, verdict: 'allow-once', nonce: await fresh() }) });
const ran = JSON.parse((await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log("via-ui")'], approvalId: held.approvalId } })).result.content[0].text);
assert.equal(ran.status, 'ok', 'UI approval must unblock the MCP call: ' + JSON.stringify(ran));
say('PASS  shared state: UI grant unblocks the MCP tool call end-to-end (stdout=' + String(ran.stdout).trim() + ')');
mcp.stdin.end(); mcp.kill();

// ---- client side: render the real components ----
const listeners = [];
globalThis.window = { __LOCAL_COMPUTER__: { url: ep.url, token: ep.token } };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
const head = { appendChild() { } };
globalThis.document = {
  head, getElementById: () => null,
  createElement: (tag) => ({ id: '', textContent: '', setAttribute() { }, tagName: tag }),
};
globalThis.window.__ModuleLoader__ = { load: ({ id, factory }) => { listeners.push(id); } };

const React = (await import('react')).default ?? (await import('react'));
globalThis.__DSH_REACT__ = React;
// the shipped client is a classic script (no ESM): evaluate it the way the host module loader does
(0, eval)(fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8'));
const CLIENT_API = globalThis.window.__DSH_LOCAL_COMPUTER__ ?? globalThis.__DSH_LOCAL_COMPUTER__;
assert.ok(CLIENT_API, "the client script must publish its API when evaluated");
const { WorldPage, WorldEntry, apply: applyClient, endpoint, api } = CLIENT_API;
assert.equal(endpoint().url, ep.url, 'client reads its endpoint from the injected global');
const ReactDOMServer = await import('react-dom/server');

// the default view is the swarm; the local-computer console is reached explicitly, so the
// console assertions render with initialFocus to exercise that view on purpose.
const html = ReactDOMServer.renderToStaticMarkup(React.createElement(WorldPage, { initialFocus: 'machine', snapshot: {
  machineId: 'dsh-test', pending: [{ approvalId: 'ap_seed1', action: 'run-command', args: { command: 'node' }, createdAt: 'now' }],
  permissions: { 'read-file': 'always' }, grants: {}, audit: [{ kind: 'executed', action: 'run-command', command: 'whoami', exitCode: 0 }],
} }));
assert.ok(/共振/.test(html), 'page title renders in Chinese when navigator says zh-CN');
assert.ok(/run-command · ap_seed1|ap_seed1/.test(html) || /待审批/.test(html), 'pending section renders');
assert.ok(/总是允许/.test(html) && /拒绝/.test(html) && /允许一次/.test(html), 'all three verdict buttons render');
assert.ok(/执行记录/.test(html) && /whoami/.test(html), 'audit trail renders with the executed command');
const entryHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(WorldEntry));
assert.ok(/wc-globe/.test(entryHtml), 'the rail entry supplies the globe glyph');
assert.ok(!/共振/.test(entryHtml), 'the entry must NOT repeat the label: the host renders the registered label itself (it showed 世界 世界 once)');
say('PASS  client renders: 共振 entry + full page with pending row, 3 verdict buttons, grant row, audit row');

// disconnected state must be explicit AND must name the real cause. The check that used to live
// here passed by accident: react-dom/server never runs useEffect, so `data` was null in every server
// render and the banner appeared even against a perfectly live host. Now the endpoint points at a
// loopback port that was just released, the request really fails, and the banner must carry the
// failure's own words instead of the generic offline_body copy.
const deadServer = net.createServer();
await new Promise(r => deadServer.listen(0, '127.0.0.1', r));
const deadPort = deadServer.address().port;
await new Promise(r => deadServer.close(r));
globalThis.window.__LOCAL_COMPUTER__ = { url: 'http://127.0.0.1:' + deadPort, token: 'dead-port' };
let realErr = null;
try { await api('/snapshot'); } catch (e) { realErr = String(e?.message || e); }
assert.ok(realErr, 'a request to the released port ' + deadPort + ' must fail: nothing listens there');
assert.ok(!/^http 2/.test(realErr), 'and it must be a transport failure, not an answer: ' + realErr);
const off = ReactDOMServer.renderToStaticMarkup(React.createElement(WorldPage));
assert.ok(/未连接本机执行服务/.test(off), 'shows a disconnected state');
assert.ok(/重试/.test(off), 'offers retry');
const body = (off.match(/wc-banner-body[^>]*>([\s\S]{0,200})/) ?? [, '(no banner)'])[1];
assert.ok(off.includes(esc(realErr)), 'banner carries the real reason (' + realErr + '); body: ' + body);
say('PASS  client degrades to an explicit 未连接 + 重试 state naming the real cause: ' + realErr);

// the autonomy marker has to be visible and has to follow the snapshot in both directions
globalThis.window.__LOCAL_COMPUTER__ = { url: ep.url, token: ep.token };
await api('/health');   // clears the recorded transport error, so these renders start connected
const pageWith = (autonomy) => ReactDOMServer.renderToStaticMarkup(React.createElement(WorldPage, {
  initialFocus: 'machine',
  snapshot: { machineId: 'dsh-test', autonomy, pending: [], permissions: {}, grants: {}, audit: [] },
}));
const autoOn = pageWith(true);
const autoOff = pageWith(false);
assert.ok(/自主运行/.test(autoOn), 'autonomy=true renders the 自主运行 marker');
assert.ok(!/等你批准/.test(autoOn), 'and not the waiting label');
assert.ok(/等你批准/.test(autoOff), 'autonomy=false renders the 等你批准 marker');
assert.ok(!/自主运行/.test(autoOff), 'and not the autonomous label');
assert.ok(/data-autonomy="on"/.test(autoOn) && /data-autonomy="off"/.test(autoOff), 'the switch mirrors the state');
say('PASS  autonomy marker follows the snapshot: true -> 自主运行, false -> 等你批准');

// apply() must register both slots defensively
const calls = [];
const slots = {
  // a faithful fake of the host: inject(name, factory) runs the factory, which registers a view
  inject: (name, factory) => calls.push(['inject', name, factory()]),
  register: (cfg, Component) => { registered.push({ cfg, Component }); return { cfg, Component }; },
};
const registered = [];
applyClient({ locale: { register() { } }, slots });
assert.deepEqual(calls.map(c => c[1]).sort(), ['main', 'sidebar.panellist']);
const entry = registered.find(r => r.cfg.name === 'sidebar.panellist');
const view = registered.find(r => r.cfg.name === 'main');
assert.equal(entry.cfg.id, 'world', 'the rail entry is keyed "world"');
assert.equal(entry.cfg.order, 10, 'the rail entry carries an order');
assert.equal(entry.cfg.label(), '共振', 'the rail entry is labelled 共振 (this is what the host renders)');
assert.equal(entry.Component.name, 'Guarded', 'a slot crash boundary wraps the entry');
assert.notEqual(entry.Component, WorldEntry);
assert.equal(view.cfg.key, 'world', 'the main takeover view is keyed "world"');
assert.equal(view.Component.name, 'Guarded', 'a slot crash boundary wraps the main view');
assert.notEqual(view.Component, WorldPage);
// the wrapper is transparent when nothing throws
const guardedHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(view.Component));
assert.ok(/共振/.test(guardedHtml), 'the guarded view still renders the page');
assert.ok(calls.every(c => c[2]), 'both slot registrations returned a value');
say('PASS  apply() registers sidebar.panellist (共振, order 10) and main (the takeover view keyed world)');

for (const d of disposers) { try { await d?.(); } catch { } }
try { mcp.kill(); } catch { }
await new Promise(r => setTimeout(r, 120));
fs.rmSync(STATE, { recursive: true, force: true });
console.log(`\n${out.length} checks passed`);
