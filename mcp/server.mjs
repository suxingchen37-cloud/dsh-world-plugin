// dsh-local-computer —— MCP stdio server.
// Exposes the reconstructed "user computer" capability as agent tools, with the shipped
// authorization model applied locally (permission_gate). Approval tickets mirror
// GrokBotUserComputerExec.approval_id / authorized_by_* semantics.
//
// State lives in ./state/computer.json so the plugin's server side and the new UI can read it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDaemon } from '../core/daemon.mjs';
import { decide, REASON, ACTION_SCOPE } from '../core/permission_gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STATE_DIR = process.env.DSH_LOCAL_COMPUTER_STATE || path.join(ROOT, 'state');
const STATE_FILE = path.join(STATE_DIR, 'computer.json');
const SANDBOX = process.env.DSH_LOCAL_COMPUTER_ROOT || path.join(STATE_DIR, 'workspace');
// Two different boundaries. The agent may READ its own plugin directory (that is how it inspects
// the code it runs) but may only WRITE inside its sandbox. The ledger — tickets, permissions,
// audit — is readable by neither: reading it would let the agent learn or rewrite consent.
const READ_ROOTS = [path.resolve(SANDBOX), path.resolve(ROOT)];
const WRITE_ROOTS = [path.resolve(SANDBOX)];

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(SANDBOX, { recursive: true });

const now = () => new Date().toISOString();
// Both halves of the plugin must name this machine the same way, or a ticket granted on one side
// belongs to a different account scope on the other.
const MACHINE_ID = process.env.DSH_LOCAL_COMPUTER_MACHINE_ID || ('dsh-' + os.hostname());

// realpath both the target and the roots so a symlink or a ".." cannot step outside; a path that
// does not exist yet is resolved through its parent, which is the part that has to be real.
// realpathSync.native reports the on-disk casing and the comparison stays case-sensitive.
const realOr = (p) => {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { }
  try { return path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs)); } catch { }
  return abs;
};
const within = (root, p) => p === root || p.startsWith(root + path.sep);
const insideAny = (roots, p) => { const rp = realOr(p); return roots.some(r => within(realOr(r), rp)); };
// the live ledger, plus the plugin's default ledger location (still on disk when the state dir is
// overridden, e.g. by a test) are both off-limits; the sandbox inside them stays usable.
const PROTECTED_DIRS = [...new Set([realOr(STATE_DIR), realOr(path.join(ROOT, 'state'))])];
const insideRead = (p) => {
  if (!insideAny(READ_ROOTS, p)) return false;
  const rp = realOr(p);
  if (within(realOr(SANDBOX), rp)) return true;
  return !PROTECTED_DIRS.some(d => within(d, rp));
};
const insideWrite = (p) => insideAny(WRITE_ROOTS, p);

// Every audit row carries the same small shape, so the page and computer_status can render any of
// them without guessing: who approved, how long it took, how it ended, and the command itself.
const AUDIT_LIMIT = 500;
function audit(s, entry) {
  const e = { at: now(), ...entry };
  if (typeof e.command === 'string' && e.command.length > 240) e.command = e.command.slice(0, 240);
  s.audit = [...(s.audit ?? []), e].slice(-AUDIT_LIMIT);
  return e;
}
function emptyState() {
  return { machineId: MACHINE_ID, grants: {}, pending: [], audit: [], permissions: {}, autonomy: false };
}
// A tmp file plus a rename: the host route never reads a half-written ledger, and a crash between
// truncate and write cannot leave a truncated state file for the next reader.
function save(s) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { }
  if (Array.isArray(s.audit) && s.audit.length > AUDIT_LIMIT) s.audit = s.audit.slice(-AUDIT_LIMIT);
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  return s;
}
function load() {
  let raw;
  try { raw = fs.readFileSync(STATE_FILE, 'utf8'); }
  catch { return emptyState(); }
  let s;
  try { s = JSON.parse(raw); }
  catch (e) {
    // keep the evidence, say why, and only then start clean — never silently overwrite the file
    // the other half may be writing
    const at = now();
    const bad = STATE_FILE + '.corrupt-' + at.replace(/[:.]/g, '-');
    try { fs.renameSync(STATE_FILE, bad); } catch { }
    const fresh = emptyState();
    audit(fresh, { kind: 'corrupt-state', file: bad, error: String((e && e.message) || e) });
    try { save(fresh); } catch { }
    return fresh;
  }
  s.machineId ??= MACHINE_ID;
  s.pending = Array.isArray(s.pending) ? s.pending : [];
  s.audit = Array.isArray(s.audit) ? s.audit : [];
  s.permissions = s.permissions && typeof s.permissions === 'object' ? s.permissions : {};
  s.grants = s.grants && typeof s.grants === 'object' ? s.grants : {};
  return s;
}

// The daemon shares this process's state file as its consent authority: a verdict the human made
// in the 世界 page (or that another MCP call wrote) is re-read from disk at exec time, so the two
// halves can never drift into "approved here, denied there".
const daemon = createDaemon({
  verifyConsent: async (consent) => {
    const s = load();
    if (consent.kind === 'standing') return s.permissions?.[consent.action] === 'always';
    const t = s.pending?.find(p => p.approvalId === consent.approvalId);
    return !!t && !t.consumed && (t.resolved === 'allow-once' || t.resolved === 'always') && t.granted !== false;
  },
});

async function gateFor(action, state, extra = {}) {
  const permission = state.permissions?.[action] ?? 'ask';
  const ceiling = state.grants?.ceiling;
  return decide({
    describes: { action, resourcePath: extra.resourcePath },
    permission, ceiling,
    messagesEnabled: state.messagesEnabled ?? true,
    authorization: { kind: extra.authorization ?? 'none' },
    approvalId: extra.approvalId,
    accountScope: state.machineId,
    approvalStore: async () => new Map(state.pending.filter(p => p.granted).map(p => [p.approvalId, { action: p.action, accountScope: p.machineId }])),
    retired: new Set(state.audit.filter(a => a.kind === 'retired').map(a => a.approvalId)),
    channelAvailable: true,
  });
}

function newApproval(state, action, args) {
  const approvalId = 'ap_' + Math.random().toString(36).slice(2, 10);
  state.pending.push({ approvalId, action, args: redact(args), createdAt: now(), machineId: state.machineId, granted: false });
  save(state);
  return approvalId;
}
// a ticket is spent the moment it authorizes anything; mirrors the daemon's single-use approvalId
function consumeTicket(state, approvalId, action) {
  if (!approvalId) return;
  const t = state.pending.find(p => p.approvalId === approvalId);
  if (t) { t.consumed = true; t.consumedAt = now(); t.actionUsed = action; }
}

function redact(a) {
  const out = { ...a };
  if (typeof out.content === 'string' && out.content.length > 240) out.content = out.content.slice(0, 240) + '...[truncated]';
  return out;
}

export const TOOLS = [
  { name: 'computer_status', description: '查看本机执行器状态：机器 id、已启用能力、待审批数、最近审计。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_capabilities', description: '声明本机能做什么（对应握手里的 capabilities）与每个动作的作用域(global/setting/subject)。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_shell', description: '在本机执行一条命令（不经 shell，参数数组直传）。受授权闸门约束：可能返回 permission_pending + approvalId。', inputSchema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' }, maxItems: 32 }, cwd: { type: 'string', description: '工作目录，必须位于可写根内' }, timeoutMs: { type: 'number', description: '超时毫秒，默认 120000，上限 600000；超时先 SIGTERM，3 秒后 SIGKILL' }, approvalId: { type: 'string' } }, required: ['command'], additionalProperties: false } },
  { name: 'computer_read_file', description: '读取工作区内的文件。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, approvalId: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'computer_write_file', description: '写入工作区内的文件（原子写）。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, approvalId: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'computer_list_dir', description: '列工作区目录。', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_pending', description: '列出待用户审批的请求（新 UI 用的同一份队列）。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_respond', description: '对某个 approvalId 表态：allow-once / always / deny。always 会写入该动作的本地权限。', inputSchema: { type: 'object', properties: { approvalId: { type: 'string' }, verdict: { type: 'string', enum: ['allow-once', 'always', 'deny'] } }, required: ['approvalId', 'verdict'], additionalProperties: false } },
  { name: 'computer_retire_approval', description: '撤销一个已发放的审批票据（对应 retire_approval）。', inputSchema: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'], additionalProperties: false } },
];

// who approved this call: a ticket the page answered is the human, a ticket the agent answered is
// the agent, and no ticket at all means a standing local grant.
function approvedBy(state, args) {
  if (!args || !args.approvalId) return 'standing';
  const t = state.pending.find(p => p.approvalId === args.approvalId);
  return t && t.resolvedBy === 'agent' ? 'agent' : 'user';
}
const refuseAudit = (state, action, reason, args, extra = {}) => {
  audit(state, { kind: 'refused', action, reason, approvedBy: approvedBy(state, args ?? {}), ...extra });
  save(state);
};

export async function call(name, args) {
  const state = load();
  switch (name) {
    case 'computer_status':
      return { machineId: state.machineId, autonomy: state.autonomy === true, pending: state.pending.filter(p => !p.granted).length, granted: state.grants, permissions: state.permissions, lastAudit: state.audit.slice(-5), sandbox: path.resolve(SANDBOX) };
    case 'computer_capabilities':
      return { machineId: state.machineId, label: state.label ?? 'dsh-local-computer', kind: 'user-computer', variant: 'plugin', supervised: false, autonomy: state.autonomy === true, actions: ACTION_SCOPE, readRoots: READ_ROOTS, writeRoots: WRITE_ROOTS, allowedRoots: READ_ROOTS };
    case 'computer_list_dir': {
      const p = path.resolve(args.path);
      if (!insideRead(p)) return { error: 'outside allowed roots' };
      return { entries: fs.readdirSync(p, { withFileTypes: true }).map(d => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' })) };
    }
    case 'computer_shell': case 'computer_read_file': case 'computer_write_file': {
      const action = name === 'computer_shell' ? 'run-command' : name === 'computer_read_file' ? 'read-file' : 'write-file';
      const commandArg = name === 'computer_shell' ? { command: args.command } : {};
      // tickets are single-use, exactly like the daemon's approvalIds: once spent (or retired)
      // they can never authorize anything again, not even if permissions later widen.
      if (args.approvalId) {
        const ticket = state.pending.find(p => p.approvalId === args.approvalId);
        if (!ticket) return { status: 'permission_pending', approvalId: args.approvalId, hint: 'unknown or retired approvalId' };
        if (ticket.consumed) {
          refuseAudit(state, action, REASON.alreadyAsked, args, { approvalId: args.approvalId, ...commandArg });
          return { status: 'refused', reason: REASON.alreadyAsked, approvalId: args.approvalId };
        }
        if (ticket.resolved === 'deny') {
          refuseAudit(state, action, REASON.declined, args, { approvalId: args.approvalId, ...commandArg });
          return { status: 'refused', reason: REASON.declined, approvalId: args.approvalId };
        }
      }
      const g = await gateFor(action, state, {
        resourcePath: args.path ?? args.command,
        approvalId: args.approvalId,
        authorization: args.approvalId ? 'approval' : 'none',
      });
      if (g.kind === 'refused') { refuseAudit(state, action, g.reason, args, commandArg); return { status: 'refused', reason: g.reason }; }
      if (g.kind === 'ask') {
        if (!args.approvalId) {
          const id = newApproval(state, action, args);
          return { status: 'permission_pending', approvalId: id, hint: '把 approvalId 交给用户在审批 UI 里表态，再带 approvalId 重试' };
        }
        return { status: 'permission_pending', approvalId: args.approvalId, hint: '该审批尚未通过' };
      }
      if (name === 'computer_read_file') {
        const p = path.resolve(args.path);
        if (!insideRead(p)) { refuseAudit(state, action, 'outside allowed roots', args, { target: p }); return { status: 'refused', reason: 'outside allowed roots' }; }
        const data = fs.readFileSync(p, 'utf8');
        consumeTicket(state, args.approvalId, action);
        audit(state, { kind: 'executed', action, target: p, approvedBy: approvedBy(state, args) }); save(state);
        return { status: 'ok', content: data };
      }
      if (name === 'computer_write_file') {
        const p = path.resolve(args.path);
        if (!insideWrite(p)) { refuseAudit(state, action, 'outside allowed roots', args, { target: p }); return { status: 'refused', reason: 'outside allowed roots' }; }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, args.content);
        fs.renameSync(tmp, p);
        consumeTicket(state, args.approvalId, action);
        audit(state, { kind: 'executed', action, target: p, bytes: args.content.length, approvedBy: approvedBy(state, args) }); save(state);
        return { status: 'ok', written: p, bytes: args.content.length };
      }
      // a cwd outside the writable roots would let a command's relative writes land anywhere on
      // the disk; the shell may only start inside the sandbox.
      if (args.cwd && !insideWrite(path.resolve(args.cwd))) {
        refuseAudit(state, action, 'cwd-outside-write-roots', args, { ...commandArg, cwd: args.cwd });
        return { status: 'refused', reason: 'cwd-outside-write-roots' };
      }
      // consent is stated explicitly to the daemon: a spent ticket, or a local standing grant.
      // Nothing reaches runCommand without one of the two, whatever the sandbox policy says.
      const consent = args.approvalId
        ? { kind: 'approval', approvalId: args.approvalId }
        : { kind: 'standing', action, reason: 'local-permission' };
      const out = await daemon.send({ kind: 'exec', requestId: 'mcp-' + Date.now(), command: args.command, args: args.args ?? [], cwd: args.cwd, timeoutMs: args.timeoutMs, consent }, {});
      consumeTicket(state, args.approvalId, action);
      audit(state, {
        kind: 'executed', action, command: args.command, exitCode: out.code ?? null,
        timedOut: !!out.timedOut, durationMs: out.durationMs ?? null, approvedBy: approvedBy(state, args),
      });
      save(state);
      return { status: out.kind === 'exit' ? 'ok' : String(out.kind), stdout: out.stdout ?? '', stderr: out.stderr ?? '', exitCode: out.code ?? null, timedOut: !!out.timedOut, durationMs: out.durationMs ?? null };
    }
    case 'computer_pending':
      return { pending: state.pending.filter(p => !p.granted && !p.resolved) };
    case 'computer_respond': {
      // Manual mode: the agent may not answer its own ticket. Only the human, on the 世界 page,
      // can; the page writes resolvedBy:'user', this path writes 'agent'.
      if (state.autonomy !== true) {
        return { status: 'refused', reason: 'autonomy-off', hint: '请在「世界」页面表态' };
      }
      const item = state.pending.find(p => p.approvalId === args.approvalId);
      if (!item) return { error: 'unknown approvalId' };
      item.resolved = args.verdict; item.resolvedAt = now(); item.resolvedBy = 'agent';
      if (args.verdict === 'always') state.permissions[item.action] = 'always';
      if (args.verdict === 'allow-once') item.granted = true;
      audit(state, { kind: 'responded', action: item.action, approvalId: item.approvalId, verdict: args.verdict, approvedBy: 'agent', resolvedBy: 'agent' });
      save(state);
      return { ok: true, effect: args.verdict === 'always' ? `action ${item.action} now always-allowed` : args.verdict };
    }
    case 'computer_retire_approval': {
      if (state.autonomy !== true) {
        return { status: 'refused', reason: 'autonomy-off', hint: '请在「世界」页面表态' };
      }
      const had = state.pending.some(p => p.approvalId === args.approvalId);
      state.pending = state.pending.filter(p => p.approvalId !== args.approvalId);
      audit(state, { kind: 'retired', approvalId: args.approvalId, approvedBy: 'agent' });
      save(state);
      return { ok: true, existed: had };
    }
    default:
      return { error: 'unknown tool ' + name };
  }
}

// ---- MCP stdio transport: newline-delimited JSON-RPC 2.0 ----
// Only when this file is the entry point. The host plugin imports `call` above and registers the
// same tools through ctx.tools, in which case there is no stdin to serve.
const asStdioServer = !!process.argv[1] && /server\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (asStdioServer) {
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  if (msg.id === undefined) return;                      // notifications need no reply
  const p = msg.params ?? {};
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, {
        protocolVersion: p.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dsh-local-computer', version: '0.1.0', title: '本机执行 (Grok Bot 能力复刻)' },
        instructions: '本机执行能力：所有动作先过授权闸门。遇到 permission_pending 就把 approvalId 交给用户，在审批 UI 里表态后带 id 重试。',
      });
    case 'tools/list':
      return reply(msg.id, { tools: TOOLS });
    case 'tools/call': {
      if (!TOOLS.some(t => t.name === p.name)) return replyErr(msg.id, -32602, 'unknown tool');
      try {
        const r = await call(p.name, p.arguments ?? {});
        return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }], isError: !!r.error || r.status === 'refused' });
      } catch (e) {
        return reply(msg.id, { content: [{ type: 'text', text: 'tool failed: ' + (e?.message ?? String(e)) }], isError: true });
      }
    }
    case 'ping': return reply(msg.id, {});
    default: return replyErr(msg.id, -32601, 'method not found: ' + msg.method);
  }
}
process.stderr.write(`[dsh-local-computer] mcp stdio up; state=${STATE_FILE}; read=${READ_ROOTS.join(',')}; write=${WRITE_ROOTS.join(',')}\n`);

}
