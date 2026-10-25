// Dev-only smoke harness (NOT part of the shipped plugin).
//
// 旧版在这里起浏览器挂真 client；前端移除后，这份冒烟只验证后端两端：
//   1) 宿主半区 apply(ctx)（mock 的 agentCommunity）：能力挂载、org/brain 工具注册并可用
//   2) MCP 半区（真子进程）：握手、tools/list 来自 manifest 聚合、
//      computer_shell 走完整审批闭环（permission_pending → respond → 执行）
//
//   node test/live.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'state', 'live');
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(STATE, { recursive: true });
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
process.env.DSH_LOCAL_COMPUTER_ROOT = STATE;
process.env.DSH_LOCAL_COMPUTER_MACHINE_ID = 'live-machine';

// ---- mock 的 agent-community 服务（自足的 fixture，不碰真实状态）--------------
const file = path.join(STATE, 'community.json');
const nowIso = () => new Date().toISOString();
fs.writeFileSync(file, JSON.stringify({
  bots: [{ id: 'b1', name: '验收员', description: '回归测试用 bot', avatar: { seed: '🧪' }, provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high', permission: 'read-only', mentionOnly: false, workspace: 'C:/tmp/mock', profile: { profileId: 'bot-mock', memoryNamespace: 'bot-mock' }, systemPrompt: '你是回归测试机器人。' }],
  rooms: [{ id: 'r1', name: '回归测试群', memberIds: ['b1'], connection: { kind: 'group' }, sequence: 1, updatedAt: nowIso(), taskState: { assignments: [] } }],
  messages: [], runs: [], roomReadAt: {},
}, null, 2));
process.env.DSH_AGENT_COMMUNITY_STATE = file;
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (s) => fs.writeFileSync(file, JSON.stringify(s, null, 2));
const mockSvc = {
  listBots: () => read().bots.map(b => ({ id: b.id, name: b.name, provider: b.provider, model: b.model, systemPrompt: b.systemPrompt ?? '' })),
  listRooms: () => read().rooms,
  async createRoom(arg) {
    const s = read();
    const id = 'r-' + Date.now();
    s.rooms.push({ id, name: arg.name, memberIds: arg.memberIds ?? [], connection: 'disconnected', sequence: 0, updatedAt: nowIso(), taskState: { assignments: [] } });
    write(s);
    return { id };
  },
  async createBot(arg) {
    const s = read();
    const id = 'b-' + Date.now();
    s.bots.push({ id, name: arg.name, description: arg.description ?? '', avatar: { seed: '🤖' }, provider: arg.provider, model: arg.model, reasoningEffort: arg.reasoningEffort, permission: arg.permission, mentionOnly: !!arg.mentionOnly, workspace: 'C:/tmp/mock/' + id, profile: { profileId: 'bot-' + arg.name, memoryNamespace: 'bot-' + arg.name }, systemPrompt: arg.systemPrompt ?? '' });
    write(s);
    return { id };
  },
  async updateBot(arg) {
    const s = read();
    const b = s.bots.find(x => x.id === arg.id);
    if (!b) return { ok: false };
    if (arg.systemPrompt !== undefined) b.systemPrompt = arg.systemPrompt;
    write(s);
    return b;
  },
  async inviteBot(arg) {
    const s = read();
    const r = s.rooms.find(x => x.id === arg.roomId);
    if (r && !(r.memberIds ?? []).includes(arg.botId)) { r.memberIds = [...(r.memberIds ?? []), arg.botId]; write(s); }
    return { ok: true };
  },
  async postTeamMessage(arg) {
    const s = read();
    const msg = { id: 'm-' + Date.now(), roomId: arg.roomId, sender: arg.sender, text: arg.text, createdAt: nowIso() };
    s.messages.push(msg);
    write(s);
    return { message: msg };
  },
  queueRoomRun(roomId, botId, prompt, origin) {
    const s = read();
    const run = { id: 'run-' + Date.now(), botId, roomId, sessionId: 'ac:' + roomId + ':' + botId, origin, prompt, status: 'queued', controlRevision: 0 };
    s.runs.push(run);
    write(s);
    return run;
  },
  executor: { nudge() { } },
};

// ---- 1) 宿主半区 -------------------------------------------------------------
const registered = [];
const { apply } = await import(pathToFileURL(path.join(ROOT, 'host', 'index.js')).href);
const stop = apply({
  logger: { info: (...a) => console.log('[host]', ...a), error: (...a) => console.log('[host!]', ...a) },
  get: (name) => (name === 'agentCommunity' ? mockSvc : undefined),
  tools: { register(definition) { registered.push(definition); return () => { }; } },
});
await new Promise(r => setTimeout(r, 300));   // 等异步能力加载
const names = registered.map(t => t.name).sort();
assert.deepEqual(names, [
  'apply_new_bot', 'brain_archive', 'brain_ledger', 'brain_recall', 'brain_remember',
  'brain_rule', 'computer_capabilities', 'computer_list_dir', 'computer_pending',
  'computer_read_file', 'computer_respond', 'computer_retire_approval', 'computer_shell',
  'computer_status', 'computer_write_file', 'org_appoint', 'org_control', 'org_plan',
  'org_rank', 'org_roster', 'spawn_bot',
], 'org 7 + brain 5 + computer 9 个工具全部注册');
console.log('host tools:', names.length, '个（org 7 + brain 5 + computer 9）');

// brain_remember 走一遍：写进独立 brain.json，并触发总理的规则注入同步（mock 服务接得住）
const brainTool = registered.find(t => t.name === 'brain_remember');
const out = await brainTool.execute({ text: '回归测试：交付前先跑 live.mjs', tags: ['交付'] }, { agent: { session: { id: 'ac:r1:b1' } } });
assert.ok(out.ok && out.entry.id, 'brain_remember 写入成功');
const brainState = JSON.parse(fs.readFileSync(path.join(STATE, 'brain.json'), 'utf8'));
assert.equal(brainState.entries.length, 1, 'brain.json 落盘');

// org 的总理守卫：无授权的 createBot 必须被拒（服务层守卫，不靠提示词）
await assert.rejects(
  () => mockSvc.createBot({ name: '越权者' }),
  /只有「总理」可以新建 Bot/,
  'createBot 守卫生效',
);

// ---- 2) MCP 半区 -------------------------------------------------------------
const mcp = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.mjs')], {
  cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});
let buf = '';
const pending = new Map();
mcp.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const w = pending.get(msg.id);
    if (w) { pending.delete(msg.id); w(msg); }
  }
});
let mid = 0;
const rpc = (method, params) => new Promise((res, rej) => {
  const id = ++mid;
  pending.set(id, msg => (msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)));
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live-harness', version: '1' } });
const tools = (await rpc('tools/list', {})).tools.map(t => t.name).sort();
assert.deepEqual(tools, ['computer_capabilities', 'computer_list_dir', 'computer_pending', 'computer_read_file', 'computer_respond', 'computer_retire_approval', 'computer_shell', 'computer_status', 'computer_write_file'], 'MCP tools/list 来自 computer 能力');
console.log('mcp tools:', tools.join(', '));

// 完整闭环（两档都验）：全自动直接执行 → 清空常驻授权切审批模式 → 票据 → 批准 → 执行 → 重放拒绝
const callTool = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).content[0].text);
const auto = await callTool('computer_shell', { command: process.execPath, args: ['-e', 'console.log("auto")'], cwd: STATE });
assert.equal(auto.status, 'ok', '全自动模式：直接执行不需要审批');
{
  const stFile = path.join(STATE, 'computer.json');
  const cur = JSON.parse(fs.readFileSync(stFile, 'utf8'));
  cur.permissions = {};
  fs.writeFileSync(stFile, JSON.stringify(cur, null, 2));
}
const p1 = await callTool('computer_shell', { command: process.execPath, args: ['-e', 'console.log("hi from live")'], cwd: STATE });
assert.equal(p1.status, 'permission_pending', '审批模式：shell 返回待审批');
const resp = await callTool('computer_respond', { approvalId: p1.approvalId, verdict: 'allow-once' });
assert.ok(resp.ok, 'autonomy 默认开：agent 可自答审批');
const p2 = await callTool('computer_shell', { command: process.execPath, args: ['-e', 'console.log("hi from live")'], cwd: STATE, approvalId: p1.approvalId });
assert.equal(p2.status, 'ok', '批准后执行成功');
assert.equal(p2.exitCode, 0);
const replay = await callTool('computer_shell', { command: process.execPath, args: ['-e', 'console.log("x")'], cwd: STATE, approvalId: p1.approvalId });
assert.equal(replay.status, 'refused', '同一票据不可重放');
// 沙箱围栏：读账本必须被拒
const fence = await callTool('computer_read_file', { path: path.join(STATE, 'computer.json') });
assert.notEqual(fence.status, 'ok', '账本文件不可读（fail-closed）');

mcp.kill();
stop();
fs.rmSync(STATE, { recursive: true, force: true });
console.log('\nlive smoke passed: host 21 tools (org7+brain5+computer9), mcp 9 tools, 审批闭环与围栏全部符合预期');
