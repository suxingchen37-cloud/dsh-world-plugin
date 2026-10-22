// Handshake + authorization test for the dsh-local-computer MCP stdio server.
// Speaks real newline-delimited JSON-RPC to a spawned child, exactly like dsh's MCP client would.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/111/dsh-local-computer');
const STATE = path.join(ROOT, 'state', 'test-run');
fs.rmSync(STATE, { recursive: true, force: true });
const SANDBOX = path.join(STATE, 'workspace');

const child = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.mjs')], {
  cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, DSH_LOCAL_COMPUTER_STATE: STATE, DSH_LOCAL_COMPUTER_ROOT: SANDBOX },
});

let buf = ''; const waiters = [];
child.stdout.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const w = waiters.shift(); if (w) w(msg);
  }
});
const stderr = [];
child.stderr.on('data', d => stderr.push(String(d)));

let id = 0;
function rpc(method, params) {
  const mine = ++id;
  const p = new Promise(res => waiters.push(res));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mine, method, params }) + '\n');
  return p;
}
const note = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
const text = (r) => JSON.parse(r.result.content[0].text);

const out = [];
const say = t => { out.push(t); console.log(t); };

// 1. initialize
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
assert.ok(init.result.serverInfo.name === 'dsh-local-computer', 'serverInfo');
assert.ok(init.result.capabilities.tools, 'tools capability');
note('notifications/initialized', {});
say(`PASS  MCP initialize: ${init.result.serverInfo.name} v${init.result.serverInfo.version}; instructions present=${!!init.result.instructions}`);

// 2. tools/list
const list = await rpc('tools/list', {});
const names = list.result.tools.map(t => t.name);
assert.equal(names.length, 9, 'expected 9 tools, got ' + names.join(','));
for (const need of ['computer_status', 'computer_shell', 'computer_read_file', 'computer_write_file', 'computer_respond', 'computer_retire_approval', 'computer_capabilities', 'computer_pending', 'computer_list_dir']) {
  assert.ok(names.includes(need), 'missing tool ' + need);
}
assert.ok(list.result.tools.every(t => t.inputSchema?.type === 'object'), 'every tool declares an input schema');
say(`PASS  tools/list: ${names.join(', ')}`);

// 3. capability probe
const caps = text(await rpc('tools/call', { name: 'computer_capabilities', arguments: {} }));
assert.equal(caps.kind, 'user-computer');
assert.equal(caps.actions['read-messages'], 'setting', 'scope table must come from the reconstructed model');
assert.equal(caps.serverAuthoritative, undefined, 'the server-side authorization shortcut is gone');
assert.equal(caps.autonomy, true, 'autonomy is advertised so the agent knows it may self-answer');
say(`PASS  capabilities: kind=${caps.kind}, run-command=${caps.actions['run-command']}, read-messages=${caps.actions['read-messages']}`);

// 4. default permission = ask -> shell must NOT execute, must return an approval ticket
const denied = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log("SHOULD-NOT-RUN")'] } }));
assert.equal(denied.status, 'permission_pending', 'shell without permission must be held: ' + JSON.stringify(denied));
assert.ok(/^ap_/.test(denied.approvalId), 'approval ticket issued');
const pend = text(await rpc('tools/call', { name: 'computer_pending', arguments: {} }));
assert.equal(pend.pending.length, 1);
assert.equal(pend.pending[0].action, 'run-command');
say(`PASS  gate holds the call: status=${denied.status} approvalId=${denied.approvalId} queued=${pend.pending.length}`);

// 5. approve with always -> retry with the ticket -> it runs
const resp = text(await rpc('tools/call', { name: 'computer_respond', arguments: { approvalId: denied.approvalId, verdict: 'allow-once' } }));
assert.equal(resp.ok, true);
const ran = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log("RAN-OK")'], approvalId: denied.approvalId } }));
assert.equal(ran.status, 'ok', 'approved call must execute: ' + JSON.stringify(ran));
assert.match(String(ran.stdout), /RAN-OK/);
assert.equal(ran.exitCode, 0);
say(`PASS  approval flow: allow-once -> executed, exit=${ran.exitCode} stdout=${String(ran.stdout).trim()}`);

// 6. the same ticket is single-use (mirrors local-exec-daemon semantics)
const reuse = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log(2)'], approvalId: denied.approvalId } }));
assert.notEqual(reuse.status, 'ok', 'a consumed ticket must not run again: ' + JSON.stringify(reuse));
say(`PASS  ticket is single-use: second attempt -> ${reuse.status}`);

// 7. `always` grants exactly one action, not the whole tool surface
async function grantAlways(tool, args) {
  const first = text(await rpc('tools/call', { name: tool, arguments: args }));
  assert.equal(first.status, 'permission_pending', tool + ' should be held first: ' + JSON.stringify(first));
  const r = text(await rpc('tools/call', { name: 'computer_respond', arguments: { approvalId: first.approvalId, verdict: 'always' } }));
  assert.equal(r.ok, true);
  const again = text(await rpc('tools/call', { name: tool, arguments: args }));
  assert.equal(again.status, 'ok', tool + ' must run after an always grant: ' + JSON.stringify(again));
  return again;
}
await grantAlways('computer_shell', { command: process.execPath, args: ['-e', 'console.log("always-granted")'] });
const w = await grantAlways('computer_write_file', { path: path.join(SANDBOX, 'note.txt'), content: 'from-plugin' });
assert.equal(w.bytes, 'from-plugin'.length);
const r = text(await rpc('tools/call', { name: 'computer_read_file', arguments: { path: path.join(SANDBOX, 'note.txt') } }));
assert.equal(r.status, 'permission_pending', 'read-file must still be gated after write-file was granted');
const rGranted = await grantAlways('computer_read_file', { path: path.join(SANDBOX, 'note.txt') });
assert.equal(rGranted.content, 'from-plugin');
const escaped = text(await rpc('tools/call', { name: 'computer_read_file', arguments: { path: 'C:/Windows/win.ini' } }));
assert.ok(escaped.status === 'refused' || escaped.error, 'out-of-root read must be refused: ' + JSON.stringify(escaped));
say(`PASS  always grants are per-action (write allowed, read still held then granted); out-of-root read refused (${escaped.status ?? escaped.error})`);

// 8. retire_approval removes the ticket
const newTicket = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: 'y', args: [] } }));
if (newTicket.approvalId) {
  const ret = text(await rpc('tools/call', { name: 'computer_retire_approval', arguments: { approvalId: newTicket.approvalId } }));
  assert.equal(ret.ok, true);
  const after = text(await rpc('tools/call', { name: 'computer_pending', arguments: {} }));
  assert.ok(!after.pending.some(p => p.approvalId === newTicket.approvalId), 'retired ticket must leave the queue');
  say(`PASS  retire_approval removes it from the queue (pending=${after.pending.length})`);
}

const st = text(await rpc('tools/call', { name: 'computer_status', arguments: {} }));
assert.ok(st.audit === undefined || Array.isArray(st.lastAudit));
assert.ok(st.lastAudit.some(a => a.kind === 'executed'), 'audit trail records executions');
say(`PASS  audit trail: ${st.lastAudit.map(a => a.kind).join('>')}`);

// 9. the page's autonomy switch is the enforcement point, not decoration. With it off, the agent
// may not answer its own ticket — the state file is re-read on every call, exactly like the real
// handoff where the 世界 page writes it.
{
  const stFile = path.join(STATE, 'computer.json');
  const s = JSON.parse(fs.readFileSync(stFile, 'utf8'));
  const was = s.autonomy;
  // earlier checks granted some actions "always"; take them back so this call really is held,
  // the same way the page's revoke does
  s.autonomy = false;
  s.permissions = {};
  fs.writeFileSync(stFile, JSON.stringify(s, null, 2));
  const held = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log("MUST-NOT-RUN")'] } }));
  assert.equal(held.status, 'permission_pending', 'with autonomy off a fresh call must be held: ' + JSON.stringify(held));
  const self = text(await rpc('tools/call', { name: 'computer_respond', arguments: { approvalId: held.approvalId, verdict: 'allow-once' } }));
  assert.equal(self.status, 'refused', 'with autonomy off the agent cannot answer its own ticket: ' + JSON.stringify(self));
  assert.equal(self.reason, 'autonomy-off');
  const capsOff = text(await rpc('tools/call', { name: 'computer_capabilities', arguments: {} }));
  assert.equal(capsOff.autonomy, false, 'the agent is told the switch is off');
  const queue = text(await rpc('tools/call', { name: 'computer_pending', arguments: {} }));
  assert.ok(queue.pending.some(p => p.approvalId === held.approvalId), 'the ticket must still be waiting for the human');
  const retry = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log(1)'], approvalId: held.approvalId } }));
  assert.notEqual(retry.status, 'ok', 'nothing may execute while autonomy is off: ' + JSON.stringify(retry));
  s.autonomy = was === undefined ? true : was;
  fs.writeFileSync(stFile, JSON.stringify(s, null, 2));
  // turning it back on must be the only thing that changed: a new call is still held, then the
  // agent is allowed to answer that ticket itself
  const again = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log("AFTER-ON")'] } }));
  assert.equal(again.status, 'permission_pending', 'the ask-gate still holds a fresh call: ' + JSON.stringify(again));
  const afterOn = text(await rpc('tools/call', { name: 'computer_respond', arguments: { approvalId: again.approvalId, verdict: 'allow-once' } }));
  assert.equal(afterOn.ok, true, 'back on: the agent may answer its own ticket again: ' + JSON.stringify(afterOn));
  const ranAfterOn = text(await rpc('tools/call', { name: 'computer_shell', arguments: { command: process.execPath, args: ['-e', 'console.log("AFTER-ON")'], approvalId: again.approvalId } }));
  assert.equal(ranAfterOn.status, 'ok', 'and the approved call then executes: ' + JSON.stringify(ranAfterOn));
  say('PASS  autonomy off (written by the page) -> self-answer refused and nothing runs; on again -> the same path works');
}

child.stdin.end();
child.kill();
console.log(`\n${out.length} checks passed; server stderr: ${stderr.join('').trim().slice(0, 120)}`);
