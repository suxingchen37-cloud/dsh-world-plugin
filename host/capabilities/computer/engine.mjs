// 本机执行的引擎：状态账本 + 授权闸门 + daemon 调度的全部实现。
// mcp.mjs 只是把这里的 tools/call 暴露成 MCP 协议；宿主侧（将来若需要在聊天内注册
// 同一套工具）也应复用本文件，而不是复制逻辑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDaemon } from '../../../core/daemon.mjs';
import { decide, REASON, ACTION_SCOPE } from './gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const STATE_DIR = process.env.DSH_LOCAL_COMPUTER_STATE || path.join(ROOT, 'state');
const STATE_FILE = path.join(STATE_DIR, 'computer.json');
const SANDBOX = process.env.DSH_LOCAL_COMPUTER_ROOT || path.join(STATE_DIR, 'workspace');
// 两条不同的边界。agent 可以读自己的插件目录（这样它才能检查自己要跑的代码），
// 但只能写沙箱。账本——票据、权限、审计——两边都不可读：读到它就能学走或改写授权。
const READ_ROOTS = [path.resolve(SANDBOX), path.resolve(ROOT)];
const WRITE_ROOTS = [path.resolve(SANDBOX)];

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(SANDBOX, { recursive: true });

const now = () => new Date().toISOString();
// 插件的两半必须用同一个名字称呼这台机器，否则一边批的票据属于另一边的账户范围。
const MACHINE_ID = process.env.DSH_LOCAL_COMPUTER_MACHINE_ID || ('dsh-' + os.hostname());

// realpath 目标与根：符号链接和 ".." 都跳不出去；尚不存在的路径经由其父目录解析，
// 父目录才是必须为真的那一段。realpathSync.native 报告磁盘上的真实大小写，比较保持敏感。
const realOr = (p) => {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { }
  try { return path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs)); } catch { }
  return abs;
};
const within = (root, p) => p === root || p.startsWith(root + path.sep);
const insideAny = (roots, p) => { const rp = realOr(p); return roots.some(r => within(realOr(r), rp)); };
// 活着的账本，加上插件的默认账本位置（state 目录被测试覆盖时它仍在盘上）都不可读；
// 位于其中的沙箱工作区保持可用。
const PROTECTED_DIRS = [...new Set([realOr(STATE_DIR), realOr(path.join(ROOT, 'state'))])];
const insideRead = (p) => {
  if (!insideAny(READ_ROOTS, p)) return false;
  const rp = realOr(p);
  if (within(realOr(SANDBOX), rp)) return true;
  return !PROTECTED_DIRS.some(d => within(d, rp));
};
const insideWrite = (p) => insideAny(WRITE_ROOTS, p);

// 每行审计都是同一个小结构，渲染任何一行都不用猜：谁批的、多久、怎么结束、命令是什么。
const AUDIT_LIMIT = 500;
function audit(s, entry) {
  const e = { at: now(), ...entry };
  if (typeof e.command === 'string' && e.command.length > 240) e.command = e.command.slice(0, 240);
  s.audit = [...(s.audit ?? []), e].slice(-AUDIT_LIMIT);
  return e;
}
function emptyState() {
  return { machineId: MACHINE_ID, grants: {}, pending: [], audit: [], permissions: {}, autonomy: true };
}
// tmp + rename：读账本的一方永远看不到半个文件，进程死在截断与写入之间也不会留下残废账本。
function save(s) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { }
  if (Array.isArray(s.audit) && s.audit.length > AUDIT_LIMIT) s.audit = s.audit.slice(-AUDIT_LIMIT);
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  return s;
}
// 旧版从不清理已处理完的票据，pending 只增不减；这里完成 7 天后清走，并封顶。
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_CAP = 200;
function prunePending(s) {
  const cutoff = Date.now() - PENDING_TTL_MS;
  const before = s.pending.length;
  s.pending = s.pending.filter(p => {
    if (!p.consumed && !p.resolved) return true;
    const at = Date.parse(p.resolvedAt || p.consumedAt || p.createdAt || '') || 0;
    return at >= cutoff;
  });
  if (s.pending.length > PENDING_CAP) s.pending = s.pending.slice(-PENDING_CAP);
  return s.pending.length !== before;
}
function load() {
  let raw;
  try { raw = fs.readFileSync(STATE_FILE, 'utf8'); }
  catch { return emptyState(); }
  let s;
  try { s = JSON.parse(raw); }
  catch (e) {
    // 留住证据、说明原因，然后才从干净账本开始——绝不悄悄覆盖另一半可能正在写的文件
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
  if (prunePending(s)) { try { save(s); } catch { } }
  return s;
}

// daemon 与本引擎共享同一份账本作为授权权威：人在审批（或另一次 MCP 调用）写下的结论
// 在 exec 时从盘上重读，两半永远不可能漂移成"这里批了、那里没批"。
const daemon = createDaemon({
  verifyConsent: async (consent) => {
    const s = load();
    if (consent.kind === 'standing') return s.permissions?.[consent.action] === 'always';
    const t = s.pending?.find(p => p.approvalId === consent.approvalId);
    return !!t && !t.consumed && (t.resolved === 'allow-once' || t.resolved === 'always') && t.granted !== false;
  },
});
// 旧版 replay 表只进不出；上限 200，最旧的先走（sendKey 重放本来就是短窗口行为）。
const REPLAY_CAP = 200;
function pruneReplay() {
  while (daemon.replay.size > REPLAY_CAP) {
    daemon.replay.delete(daemon.replay.keys().next().value);
  }
}

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
// 票据一旦授权过任何动作即作废，和 daemon 的单次 approvalId 完全一致
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

export const tools = [
  { name: 'computer_status', description: '查看本机执行器状态：机器 id、已启用能力、待审批数、最近审计。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_capabilities', description: '声明本机能做什么（对应握手里的 capabilities）与每个动作的作用域(global/setting/subject)。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_shell', description: '在本机执行一条命令（不经 shell，参数数组直传）。受授权闸门约束：可能返回 permission_pending + approvalId。', inputSchema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' }, maxItems: 32 }, cwd: { type: 'string', description: '工作目录，必须位于可写根内' }, timeoutMs: { type: 'number', description: '超时毫秒，默认 120000，上限 600000；超时先 SIGTERM，3 秒后 SIGKILL' }, approvalId: { type: 'string' } }, required: ['command'], additionalProperties: false } },
  { name: 'computer_read_file', description: '读取工作区内的文件（超过 2MB 截断）。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, approvalId: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'computer_write_file', description: '写入工作区内的文件（原子写）。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, approvalId: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'computer_list_dir', description: '列工作区目录。', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_pending', description: '列出待用户审批的请求。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'computer_respond', description: '对某个 approvalId 表态：allow-once / always / deny。always 会写入该动作的本地权限。', inputSchema: { type: 'object', properties: { approvalId: { type: 'string' }, verdict: { type: 'string', enum: ['allow-once', 'always', 'deny'] } }, required: ['approvalId', 'verdict'], additionalProperties: false } },
  { name: 'computer_retire_approval', description: '撤销一个已发放的审批票据（对应 retire_approval）。', inputSchema: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'], additionalProperties: false } },
];

// 这次调用是谁批的：页面（将来是前端能力）答的票据是人，agent 答的是 agent，
// 没有票据则说明走的是本地常驻授权。
function approvedBy(state, args) {
  if (!args || !args.approvalId) return 'standing';
  const t = state.pending.find(p => p.approvalId === args.approvalId);
  return t && t.resolvedBy === 'agent' ? 'agent' : 'user';
}
const refuseAudit = (state, action, reason, args, extra = {}) => {
  audit(state, { kind: 'refused', action, reason, approvedBy: approvedBy(state, args ?? {}), ...extra });
  save(state);
};

// 读取上限：一条 read 不许把整个进程的内存吃掉。
const READ_CAP = 2 * 1024 * 1024;
function readCapped(p) {
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.alloc(READ_CAP);
    const bytes = fs.readSync(fd, buf, 0, READ_CAP, 0);
    return { text: buf.subarray(0, bytes).toString('utf8'), truncated: bytes >= READ_CAP };
  } finally { fs.closeSync(fd); }
}

// 冻结开关的唯一切换入口（console 面的审批页调用它；agent 侧没有这个工具，
// 所以 agent 无法自行解冻）。记审计，approvedBy 是 'user'。
export function setAutonomy(value) {
  const s = load();
  s.autonomy = !!value;
  s.audit = [...(s.audit ?? []), { at: now(), kind: 'autonomy', autonomy: s.autonomy, approvedBy: 'user' }].slice(-AUDIT_LIMIT);
  save(s);
  return { ok: true, autonomy: s.autonomy };
}

export async function call(name, args) {
  const state = load();
  switch (name) {
    case 'computer_status':
      return { machineId: state.machineId, autonomy: state.autonomy !== false, pending: state.pending.filter(p => !p.granted).length, granted: state.grants, permissions: state.permissions, lastAudit: state.audit.slice(-5), sandbox: path.resolve(SANDBOX) };
    case 'computer_capabilities':
      return { machineId: state.machineId, label: state.label ?? 'dsh-local-computer', kind: 'user-computer', variant: 'plugin', supervised: false, autonomy: state.autonomy !== false, actions: ACTION_SCOPE, readRoots: READ_ROOTS, writeRoots: WRITE_ROOTS, allowedRoots: READ_ROOTS };
    case 'computer_list_dir': {
      const p = path.resolve(args.path);
      if (!insideRead(p)) return { error: 'outside allowed roots' };
      return { entries: fs.readdirSync(p, { withFileTypes: true }).map(d => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' })) };
    }
    case 'computer_shell': case 'computer_read_file': case 'computer_write_file': {
      const action = name === 'computer_shell' ? 'run-command' : name === 'computer_read_file' ? 'read-file' : 'write-file';
      const commandArg = name === 'computer_shell' ? { command: args.command } : {};
      // 票据单次有效，和 daemon 的 approvalId 完全一致：花掉（或撤销）之后永远不能再
      // 授权任何东西，哪怕权限后来放宽了。
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
          return { status: 'permission_pending', approvalId: id, hint: '把 approvalId 交给用户，用户在对话里表态后，带 approvalId 用 computer_respond 记录结论再重试' };
        }
        return { status: 'permission_pending', approvalId: args.approvalId, hint: '该审批尚未通过' };
      }
      if (name === 'computer_read_file') {
        const p = path.resolve(args.path);
        if (!insideRead(p)) { refuseAudit(state, action, 'outside allowed roots', args, { target: p }); return { status: 'refused', reason: 'outside allowed roots' }; }
        const { text, truncated } = readCapped(p);
        consumeTicket(state, args.approvalId, action);
        audit(state, { kind: 'executed', action, target: p, approvedBy: approvedBy(state, args) }); save(state);
        return { status: 'ok', content: text, ...(truncated ? { truncated: true, note: '文件超过 2MB，已截断' } : {}) };
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
      // cwd 落在可写根之外，会让命令的相对写入落到盘上任何地方；shell 只能从沙箱里启动。
      if (args.cwd && !insideWrite(path.resolve(args.cwd))) {
        refuseAudit(state, action, 'cwd-outside-write-roots', args, { ...commandArg, cwd: args.cwd });
        return { status: 'refused', reason: 'cwd-outside-write-roots' };
      }
      // 向 daemon 明确声明授权：花掉的票据，或本地常驻授权。两者皆无时什么都到不了
      // runCommand，沙箱策略说什么都不算。
      const consent = args.approvalId
        ? { kind: 'approval', approvalId: args.approvalId }
        : { kind: 'standing', action, reason: 'local-permission' };
      const out = await daemon.send({ kind: 'exec', requestId: 'mcp-' + Date.now(), command: args.command, args: args.args ?? [], cwd: args.cwd, timeoutMs: args.timeoutMs, consent }, {});
      pruneReplay();
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
      // autonomy=false 是冻结开关：agent 不得自己答自己的票。前端回归前，解除冻结的
      // 办法是人手动把 state/computer.json 的 autonomy 改回 true（或删掉该字段）。
      if (state.autonomy === false) {
        return { status: 'refused', reason: 'autonomy-off', hint: '本机执行已冻结；请用户手动把 state/computer.json 的 autonomy 改回 true 后重试' };
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
      if (state.autonomy === false) {
        return { status: 'refused', reason: 'autonomy-off', hint: '本机执行已冻结；请用户手动把 state/computer.json 的 autonomy 改回 true 后重试' };
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
