// Dev-only preview harness (NOT part of the shipped plugin).
//
// 把真实插件（含 console 能力）挂到 mock 的 agent-community 上，并且驱动 Bot 真的回消息：
//   - 环境里 DEEPSEEK_API_KEY 有效 → 每条消息由 deepseek-chat 以该 Bot 的人设真模型回复
//   - key 缺失或失效 → 自动降级为角色化演示回声，页面顶部亮「演示模式」徽章
//
//   node test/preview.mjs      → 打开它打印的 http://127.0.0.1:47941
//
// 会预置：两个 Bot（总理由插件自动引导创建）、各自的 1:1 私聊、公司大群、
// 一条 Bot 提问（在聊天流里直接回答）、一张本机执行待审批票。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'state', 'preview');
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(STATE, { recursive: true });
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
process.env.DSH_LOCAL_COMPUTER_ROOT = path.join(STATE, 'sandbox');
process.env.DSH_LOCAL_COMPUTER_MACHINE_ID = 'preview-machine';

// ---- 模型连通性探测：key 有效 → 真模型；否则演示模式 -------------------------
async function probeModel() {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }),
      signal: AbortSignal.timeout(12_000),
    });
    return r.ok ? 'deepseek-chat' : null;
  } catch { return null; }
}
const MODEL = await probeModel();
console.log(MODEL ? `[model] 已接通 ${MODEL}，Bot 将真模型回复` : '[model] key 缺失或无效 → 演示模式（角色化回声）');

// ---- mock 的 agent-community 状态与服务 --------------------------------------
const file = path.join(STATE, 'community.json');
const nowIso = () => new Date().toISOString();
fs.writeFileSync(file, JSON.stringify({
  meta: { demoMode: MODEL === null },
  bots: [
    { id: 'b1', name: '验收员', description: '负责交付前回归的测试 Bot', avatar: { seed: '🧪' }, provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high', permission: 'read-only', mentionOnly: false, workspace: 'D:/work/qa', profile: { profileId: 'bot-qa', memoryNamespace: 'bot-qa' }, systemPrompt: '你是「验收员」，团队的交付质检员。说话简洁、结论先行，用中文。' },
    { id: 'b2', name: '生活管家', description: '日程、待办与生活杂务', avatar: { seed: '🌤' }, provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'standard', permission: 'read-only', mentionOnly: true, workspace: 'D:/work/life', profile: { profileId: 'bot-life', memoryNamespace: 'bot-life' }, systemPrompt: '你是「生活管家」，管理主人的日程与生活杂务。语气亲切、务实，用中文。' },
  ],
  rooms: [
    { id: 'dm-b1', name: '验收员', directBotId: 'b1', memberIds: ['b1'], connection: { kind: 'direct' }, sequence: 1, updatedAt: nowIso(), taskState: { assignments: [] } },
    { id: 'dm-b2', name: '生活管家', directBotId: 'b2', memberIds: ['b2'], connection: { kind: 'direct' }, sequence: 1, updatedAt: nowIso(), taskState: { assignments: [] } },
  ],
  messages: [
    { id: 'seed-1', roomId: 'dm-b1', sender: { kind: 'bot', botId: 'b1', name: '验收员' }, text: '回归清单我已经备好了，随时可以开工。找我聊就在这个私聊里 @ 我。', createdAt: nowIso() },
  ],
  runs: [], roomReadAt: {},
}, null, 2));
process.env.DSH_AGENT_COMMUNITY_STATE = file;
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (s) => fs.writeFileSync(file, JSON.stringify(s, null, 2));

// ---- Bot 执行器：真模型优先，降级演示回声 ------------------------------------
async function llmReply(bot, roomId, userText) {
  if (!MODEL) return null;
  const s = read();
  const room = s.rooms.find(r => r.id === roomId);
  const history = s.messages.filter(m => m.roomId === roomId).slice(-12).map(m => ({
    role: m.sender?.kind === 'user' ? 'user' : 'assistant',
    content: (m.sender?.kind === 'user' ? '' : `${m.sender?.name}: `) + m.text,
  }));
  const sys = `${bot.systemPrompt}\n你在「${room?.name ?? '聊天'}」${room?.directBotId ? '与主人私聊' : '（公司大群）'}。只以这个身份回一句话，不要扮演别人，不要输出 JSON。`;
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: sys }, ...history], max_tokens: 300, temperature: 0.8 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error('model http ' + r.status);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('empty completion');
  return text;
}

function echoReply(bot, roomId, userText) {
  const s = read();
  const roster = s.bots.map(b => b.name).join('、');
  if (/名册|状态|谁/.test(userText)) return `【演示】现在团队有：${roster}。我在岗，随时可以干活。（配置有效的 DEEPSEEK_API_KEY 后，这句话就是真模型说的）`;
  if (/审批|权限|本机/.test(userText)) return `【演示】本机执行要走授权闸门：页面上方的横幅里有票等你批。「总是允许」会按动作记常驻授权。`;
  return `【演示】收到：「${userText.slice(0, 40)}」。我是${bot.name}——现在模型没接通，这是角色化回声。把有效的 DEEPSEEK_API_KEY 配上重启 preview，我就用真脑子回你。`;
}

async function botTurn(botId, roomId, userText) {
  const started = Date.now();
  const runId = 'run-' + started + '-' + botId;
  const s0 = read();
  const bot = s0.bots.find(b => b.id === botId);
  if (!bot) return;
  s0.runs.push({ id: runId, botId, roomId, status: 'running', startedAt: nowIso(), prompt: String(userText ?? '').slice(0, 80) });
  write(s0);
  let reply;
  try { reply = await llmReply(bot, roomId, userText); }
  catch (e) { console.log('[model] 真模型失败，降级回声:', String(e.message || e)); reply = null; }
  if (reply == null) reply = echoReply(bot, roomId, userText);
  const s1 = read();
  s1.messages.push({
    id: 'm-' + Date.now() + '-' + botId, roomId,
    sender: { kind: 'bot', botId, name: bot.name }, text: reply,
    createdAt: nowIso(), runId, durationMs: Date.now() - started,
  });
  const run = s1.runs.find(r => r.id === runId);
  if (run) { run.status = 'finished'; run.finishedAt = nowIso(); }
  write(s1);
}

// 群里 @谁谁答；没人被点名 → leader（总理）；私聊 → 房间属主 Bot
function routeTurns(roomId, text) {
  const s = read();
  const room = s.rooms.find(r => r.id === roomId);
  if (!room) return;
  let targets = [];
  if (room.directBotId) targets = [room.directBotId];
  else {
    const named = (text.match(/@([\u4e00-\u9fa5\w-]+)/g) ?? []).map(m => m.slice(1));
    targets = s.bots.filter(b => (room.memberIds ?? []).includes(b.id) && named.includes(b.name)).map(b => b.id);
    if (!targets.length) targets = room.team?.leaderBotId ? [room.team.leaderBotId] : [];
  }
  for (const t of targets) void botTurn(t, roomId, text);
}

// ---- mock 服务（sendMessage 之后由执行器驱动回复）---------------------------
const mockSvc = {
  listBots: () => read().bots.map(b => ({ ...b, systemPrompt: b.systemPrompt ?? '' })),
  listRooms: () => read().rooms,
  async createRoom(arg) {
    const s = read();
    const id = 'r-' + Date.now();
    s.rooms.push({
      id, name: arg.name, memberIds: arg.memberIds ?? [], directBotId: arg.directBotId ?? null,
      connection: 'disconnected', sequence: 0, updatedAt: nowIso(),
      team: arg.team ?? undefined,
      taskState: { assignments: [], objective: arg.name === '公司大群' ? '让每个 Bot 有活干、有回报' : null },
    });
    write(s); return { id };
  },
  async createBot(arg) {
    const s = read();
    const id = 'b-' + Date.now();
    s.bots.push({ id, name: arg.name, description: arg.description ?? '', avatar: { seed: '🤖' }, provider: arg.provider, model: arg.model, reasoningEffort: arg.reasoningEffort, permission: arg.permission, mentionOnly: !!arg.mentionOnly, workspace: 'D:/tmp/' + id, profile: { profileId: 'bot-' + arg.name, memoryNamespace: 'bot-' + arg.name }, systemPrompt: arg.systemPrompt ?? '' });
    write(s); return { id };
  },
  async updateBot(arg) {
    const s = read();
    const b = s.bots.find(x => x.id === arg.id);
    if (!b) return { ok: false };
    if (arg.systemPrompt !== undefined) b.systemPrompt = arg.systemPrompt;
    write(s); return b;
  },
  async inviteBot(arg) {
    const s = read();
    const r = s.rooms.find(x => x.id === arg.roomId);
    if (r && !(r.memberIds ?? []).includes(arg.botId)) { r.memberIds = [...(r.memberIds ?? []), arg.botId]; write(s); }
    return { ok: true };
  },
  async postTeamMessage(arg) {
    const s = read();
    const msg = { id: 'm-' + Date.now(), roomId: arg.roomId, sender: arg.sender, text: arg.text, kind: arg.kind, createdAt: nowIso() };
    s.messages.push(msg); write(s);
    return { message: msg };
  },
  queueRoomRun() { return { id: 'run-mock' }; },
  async sendMessage(arg) {
    const s = read();
    const msg = { id: 'm-' + Date.now(), roomId: arg.roomId, sender: arg.sender ?? { kind: 'user', name: '我' }, text: arg.text, mentions: [], createdAt: nowIso() };
    s.messages.push(msg); write(s);
    setTimeout(() => { try { routeTurns(arg.roomId, arg.text); } catch (e) { console.log('[route]', e.message); } }, 60);
    return { id: msg.id };
  },
  // —— 提问与工具审批（与真实服务同样的内存账本形状）——
  ledger: { byRoom: new Map() },
  questionBridge: { pending: new Map() },
  approvalBridge: { pending: new Map() },
  async answerBotQuestion(arg) {
    const rows = mockSvc.ledger.byRoom.get('dm-b1') ?? [];
    const row = rows.find(e => e.questionId === arg.questionId);
    if (row) row.status = arg.skip ? 'skipped' : 'answered';
    mockSvc.questionBridge.pending.delete(arg.questionId);
    return { ok: true };
  },
  async approveBotToolCall(callId, outcome) {
    for (const rows of mockSvc.ledger.byRoom.values()) {
      const row = rows.find(e => (e.callId ?? e.id) === callId);
      if (row) { row.outcome = outcome; mockSvc.approvalBridge.pending.delete(callId); }
    }
    return { ok: true };
  },
};
mockSvc.ledger.byRoom.set('dm-b1', [{
  type: 'question', questionId: 'q1', botName: '验收员',
  question: '回归清单列好了 12 项，要现在全部跑一遍吗？大概 5 分钟。',
  options: ['全跑', '只跑冒烟'], allowFreeText: true, status: 'pending', at: nowIso(),
}]);
mockSvc.questionBridge.pending.set('q1', {});

// ---- 挂载真实插件 ------------------------------------------------------------
const registered = [];
const { apply } = await import(pathToFileURL(path.join(ROOT, 'host', 'index.js')).href);
const stop = apply({
  logger: { info: (...a) => console.log('[host]', ...a), error: (...a) => console.log('[host!]', ...a) },
  get: (name) => (name === 'agentCommunity' ? mockSvc : undefined),
  tools: { register(definition) { registered.push(definition); return () => { }; } },
});
await new Promise(r => setTimeout(r, 500));   // 总理引导 + 能力挂载

// ---- 预置：一条笔记本规则 + 一张本机执行待审批票 -----------------------------
const brain = registered.find(t => t.name === 'brain_remember');
if (brain) {
  await brain.execute({ text: '交付成片一律 1080p，低于这个分辨率直接打回', tags: ['交付', '分辨率'] }, { agent: { session: { id: 'ac:dm-b1:b1' } } });
}
const engine = await import(pathToFileURL(path.join(ROOT, 'host', 'capabilities', 'computer', 'engine.mjs')).href);
await engine.call('computer_shell', {
  command: process.execPath, args: ['-e', 'console.log("hi from preview")'],
  cwd: path.join(STATE, 'sandbox'),   // 必须在沙箱内，否则批准后也会被围栏拒绝
});

// ---- 等控制台端口就绪 --------------------------------------------------------
let port = null;
for (let i = 0; i < 50 && !port; i++) {
  await new Promise(r => setTimeout(r, 100));
  try { port = Number(fs.readFileSync(path.join(ROOT, 'host', 'capabilities', 'console', 'web', '.port'), 'utf8')); } catch { }
}
if (!port) { console.error('console 没起来'); process.exit(1); }

console.log('\n──────────────────────────────────────────────────');
console.log(`  共振:  http://127.0.0.1:${port}`);
console.log('  · 公司大群/私聊里发消息，Bot 会回（' + (MODEL ? '真模型' : '演示回声') + '）');
console.log('  · 群里 @名字 点名谁回；验收员有个问题等你答');
console.log('  · 顶部横幅有本机执行票等你批，批准即真实执行');
console.log('  · Ctrl+C 退出');
console.log('──────────────────────────────────────────────────\n');
const bye = () => { try { stop(); } catch { } process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
setInterval(() => { }, 1 << 30); // 保活
