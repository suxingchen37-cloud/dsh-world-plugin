// Walks the exact request sequence the renderer performs against the host, in order, with the
// origin and headers the real client uses. This is the contract between lib/client.js and
// lib/index.js; the unit tests cover each side, this covers the seam.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE = path.join('D:/111/dsh-local-computer/state', 'wire-' + process.pid);
fs.mkdirSync(STATE, { recursive: true });
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
// a community fixture: one live group proposal on the room, one expired; only the live one may
// surface to the page
const COMM = path.join(STATE, 'community.json');
const future = new Date(Date.now() + 600000).toISOString();
fs.writeFileSync(COMM, JSON.stringify({
  bots: [
    { id: 'prime1', name: '总理', provider: 'deepseek-account', model: 'deepseek-flash' },
    { id: 'b1', name: '甲', provider: 'deepseek-account', model: 'deepseek-flash' },
  ],
  rooms: [
    {
      id: 'r1', name: '测试群', memberIds: ['b1'], connection: 'disconnected', taskState: { assignments: [] },
      pendingGroupProposal: {
        id: 'p1', roomId: 'r1', name: '协作群', memberIds: ['b1', 'b2'], leaderId: 'b1',
        reason: '多人更快', taskText: '干活', status: 'pending', createdAt: new Date().toISOString(), expiresAt: future,
      },
    },
    {
      id: 'r2', name: '过期群', memberIds: ['b1'],
      pendingGroupProposal: { id: 'p2', roomId: 'r2', name: '旧', status: 'pending', expiresAt: new Date(Date.now() - 60000).toISOString() },
    },
  ],
  messages: [
    { id: 'm1', roomId: 'r1', sender: { kind: 'bot', botId: 'b1', name: '甲' }, text: '跑完了，文件在附件', mentions: [],
      createdAt: '2026-10-22T02:00:00.000Z', runId: 'run1', durationMs: 4926,
      deliverables: [{ path: 'D:/work/明细.csv', name: '明细.csv', description: '6 条费用明细', size: 131 }],
      toolActivity: [{ name: 'pwsh', status: 'ok', detail: 'x'.repeat(500) }] },
  ],
  runs: [{ id: 'run1', botId: 'b1', roomId: 'r1', origin: 'user', prompt: '回归任务', status: 'completed',
    startedAt: '2026-10-22T02:00:00.000Z', finishedAt: '2026-10-22T02:00:04.926Z', controlRevision: 3 }],
  // the real read cursor is an object { id, at } — comparing it with String() made every badge 0
  roomReadAt: { r1: { id: 'mark1', at: '2026-10-21T00:00:00.000Z' } },
}, null, 2));
process.env.DSH_AGENT_COMMUNITY_STATE = COMM;
// a private port range so the test never fights the real client
process.env.DSH_LOCAL_COMPUTER_PORT = String(48900 + (process.pid % 50));

const { apply, inject } = await import('../lib/index.js');
// cordis keys every ctx.<service> read off this declaration; without it the read throws
// "cannot get property ... without inject" (verified against dsh's own cordis build)
assert.deepEqual(inject, ['agentCommunity', 'tools'], 'the host declares the services it commands');
// the Typert service is the real shape here: methods return live objects, which may be circular.
// Sending a message used to serialize such a result straight into the HTTP response and take the
// host process down mid-write; this mock reproduces exactly that return value.
const circular = {}; circular.self = circular;
let createdArg = null;
let deleted = false;
const toolsByName = {};
let companyRoom = null;
let postedTeam = null;
let queuedRun = null;
let orgGoal = null;
let orgTasks = null;
let orgControl = null;
let orgRetry = null;
let lastUpdate = null;
const svc = {
  async sendMessage(arg) { return { ...circular, echoed: arg }; },
  createBot(arg) {
    createdArg = arg;
    if (arg.name === 'sync-boom') throw new Error('sync-boom');
    return { id: 'new1', name: arg.name, model: arg.model };
  },
  updateBot(arg) {
    // a real update needs the bot id; without one the call rejects, which is the async-boom case
    if (arg?.id) { lastUpdate = arg; return Promise.resolve({ id: arg.id }); }
    return Promise.reject(new Error('async-boom'));
  },
  async deleteBot() { deleted = true; return { ok: true }; },
  async spawnBot(input) {
    if (input.roomId === 'leader-room') return { ok: false, error: '只有本群的 leader 能新建 Bot；把增员需求用 message_member 发给 leader。' };
    return { ok: true, spawnedBy: input.botId };
  },
  listBots: () => [{ id: 'prime1', name: '总理' }, { id: 'b1', name: '甲' }],
  listRooms: () => companyRoom ? [companyRoom, { id: 'r1' }] : [{ id: 'r1' }],
  // the room objective is not in state.json; it lives behind this accessor
  roomGoal: (roomId) => roomId === 'r1' ? { text: '本周产出一版可用的世界观设定', status: 'active' } : undefined,
  approvedCalls: [],
  // positional on purpose: (callId, outcome) — passing an object here used to do nothing at all
  approveBotToolCall(callId, outcome) { svc.approvedCalls.push([callId, outcome]); },
  async createRoom(arg) {
    companyRoom = { id: 'company1', name: arg.name, memberIds: [...(arg.memberIds ?? [])], team: arg.team, directBotId: undefined };
    return companyRoom;
  },
  async inviteBot(arg) { if (companyRoom && !companyRoom.memberIds.includes(arg.botId)) companyRoom.memberIds.push(arg.botId); return { ok: true }; },
  async postTeamMessage(arg) { postedTeam = arg; return { message: { id: 'm-app' } }; },
  setRoomGoal(arg) { orgGoal = arg; return { ok: true }; },
  decomposeTasks(arg) { orgTasks = arg; return { ok: true }; },
  listRuns() { return [{ id: 'run1', roomId: 'r1', controlRevision: 3, status: 'running' }]; },
  controlRun(arg) { orgControl = arg; return { status: arg.action === 'cancel' ? 'cancelled' : 'running' }; },
  retryRun(arg) { orgRetry = arg; return { ok: true }; },
  queueRoomRun(roomId, botId, prompt, origin) { queuedRun = { roomId, botId, prompt, origin }; return { id: 'run-app' }; },
  executor: { nudge() { } },
  // live, in-memory state exactly where the service keeps it
  ledger: { byRoom: new Map([['r1', [
    { type: 'approval', callId: 'c1', botName: '甲', toolName: 'bash', args: '{"cmd":"ls"}', at: 'now' },
    { type: 'question', questionId: 'q1', botName: '甲', question: '继续吗？', options: ['继续', '停止'], allowFreeText: true, status: 'pending', at: 'now' },
    { type: 'question', questionId: 'q2', botName: '甲', question: '已答', status: 'answered', at: 'now' },
  ]]]) },
  approvalBridge: { pending: new Map([['c1', {}]]) },
  questionBridge: { pending: new Map([['q1', {}]]) },
};
const ctx = {
  logger: { info() { } },
  tools: { register(definition) { toolsByName[definition.name] = definition; return () => { }; } },
  // cordis' sanctioned optional lookup
  get(name) { return name === 'agentCommunity' && svcOn ? svc : undefined; },
};
let svcOn = true;
// and the trap the old code fell into: a direct property read throws "without inject"
Object.defineProperty(ctx, 'agentCommunity', {
  get() { throw new Error('cannot get property "agentCommunity" without inject'); },
});
const stop = apply(ctx);
const epFile = path.join(STATE, 'ui-endpoint.json');
for (let i = 0; i < 60 && !fs.existsSync(epFile); i++) await new Promise(r => setTimeout(r, 50));
const ep = JSON.parse(fs.readFileSync(epFile, 'utf8'));
let checks = 0;
const say = t => { if (String(t).startsWith('PASS')) checks++; console.log(t); };
const APP = { origin: 'dsh-app://app' };
const read = (p, extra = {}) => fetch(ep.url + p, { headers: { ...APP, ...extra } });
const post = (p, body) => fetch(ep.url + p, {
  method: 'POST', headers: { ...APP, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

// 1. the port the client probes
const h = await read('/health');
assert.equal(h.status, 200, 'health answers without a token');
assert.equal((await h.json()).ok, true);
say(`PASS  probe: ${ep.url}/health -> 200 (this is how the renderer finds the host)`);

// 2. reads the page makes on mount, with no token at all
const snap = await read('/snapshot');
assert.equal(snap.status, 200, 'the app origin reads the snapshot without a token');
const snapJson = await snap.json();
assert.ok(Array.isArray(snapJson.pending) && Array.isArray(snapJson.allowedRoots), 'snapshot carries the fields the page reads');
const comm = await read('/community');
assert.equal(comm.status, 200, 'community is readable the same way');
const commJson = await comm.json();
assert.ok(Array.isArray(commJson.bots) && Array.isArray(commJson.rooms), 'community carries bots + rooms');
assert.equal(commJson.proposals.length, 1, 'only the unexpired room proposal is surfaced');
assert.equal(commJson.proposals[0].id, 'p1', 'the proposal comes from room.pendingGroupProposal');
const live1 = await (await read('/live')).json();
assert.equal(live1.approvals.length, 1, 'one pending approval');
assert.equal(live1.approvals[0].toolName, 'bash');
assert.equal(live1.questions.length, 1, 'only the pending question, not the answered one');
assert.equal(live1.questions[0].options.length, 2);
svc.approvalBridge.pending.delete('c1');
const live2 = await (await read('/live')).json();
assert.equal(live2.approvals.length, 0, 'a resolved approval leaves the live list');
say('PASS  live state: room proposals + in-memory approvals/questions surface, resolved ones drop out');

// the fields the redesigned 世界 page needs, each of which used to arrive empty or unusable
const comm2 = await (await read('/community')).json();
assert.equal(comm2.rooms.find(r => r.id === 'r1').unread, 1, 'a bot message after the read cursor counts as unread');
assert.equal(comm2.rooms.find(r => r.id === 'r1').objective, '本周产出一版可用的世界观设定', 'the goal comes from the service, not state.json');
const msg1 = comm2.messages.find(m => m.id === 'm1');
assert.equal(msg1.deliverables[0].name, '明细.csv', 'deliverables reach the page — real data has no attachments');
assert.equal(msg1.runId, 'run1');
assert.equal(msg1.durationMs, 4926);
assert.ok(msg1.toolActivity[0].detail.length <= 160, 'tool output is capped so one huge diff cannot eat the payload');
assert.equal(comm2.runs.find(r => r.id === 'run1').durationMs, 4926, 'a finished run reports its duration');
svc.approvalBridge.pending.set('c1', {}); // the earlier check resolved it; bring a live ticket back
const liveApp = (await (await read('/live')).json()).approvals[0];
assert.ok(liveApp.args.includes('ls'), '/live carries the full args so 看全文 can show them');
assert.equal(liveApp.risk, 'irreversible', 'a bash ticket is flagged as the damaging kind');
const nApr = (await (await read('/snapshot')).json()).nonce;
const apr = await post('/act', { kind: 'approveBotToolCall', payload: { callId: 'c9', verdict: 'always' }, nonce: nApr });
const aprJson = await apr.json();
assert.equal(apr.status, 200, JSON.stringify(aprJson));
assert.deepEqual(svc.approvedCalls.slice(-1)[0], ['c9', 'allowed-once'], 'the positional call really fires');
assert.match(aprJson.note || '', /总是允许/, 'and the page is told 总是允许 is not a standing grant');
say('PASS  page wiring: unread cursor, room goal via roomGoal(), deliverables/runId/duration, full args + risk, positional approve');
const diag = await (await read('/diag')).json();
assert.equal(diag.service, true, 'the host can reach the community service');
assert.equal(diag.bots, 2);
assert.ok(diag.rooms >= 1, 'diag sees rooms, got ' + diag.rooms);
say('PASS  /diag: reads the community service without mutating anything');

// the prime is adopted by name, protected from deletion, and the only bot allowed to spawn
for (let i = 0; i < 20; i++) {
  try { if (JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8')).primeBotId) break; } catch { }
  await new Promise(r => setTimeout(r, 50));
}
assert.equal(JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8')).primeBotId, 'prime1', 'the prime id is remembered');
const nDel = (await (await read('/snapshot')).json()).nonce;
const delPrime = await post('/act', { kind: 'deleteBot', payload: { id: 'prime1' }, nonce: nDel });
assert.equal(delPrime.status, 422, 'deleting the prime is refused');
assert.match((await delPrime.json()).error, /总理/);
assert.equal(deleted, false, 'the service delete never ran for the prime');
const nonPrimeSpawn = await svc.spawnBot({ botId: 'b1', roomId: 'r1', name: 'x' });
assert.equal(nonPrimeSpawn.ok, false, 'a non-prime bot cannot spawn');
assert.match(nonPrimeSpawn.error, /总理/);
assert.match(nonPrimeSpawn.error, /apply_new_bot/, 'the refusal tells the bot how to apply');
const primeSpawn = await svc.spawnBot({ botId: 'prime1', roomId: 'r1', name: 'x' });
assert.equal(primeSpawn.ok, true, 'the prime can spawn');
// in a bot-to-bot application DM the applicant is the leader; the prime must still be able to hire
const fallbackSpawn = await svc.spawnBot({ botId: 'prime1', roomId: 'leader-room', name: '登记助手', description: '协助登记' });
assert.equal(fallbackSpawn.ok, true, 'the prime can hire from an application DM');
assert.equal(fallbackSpawn.createdOnly, true);
assert.equal(fallbackSpawn.name, '登记助手');
say('PASS  prime policy: undeletable; non-prime spawn refused; prime spawns in groups and application DMs');

// the company group is created with every bot, led by the prime, and remembered
let companyId = null;
for (let i = 0; i < 20 && !companyId; i++) {
  try { companyId = JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8')).companyRoomId; } catch { }
  await new Promise(r => setTimeout(r, 50));
}
assert.equal(companyId, 'company1', 'the company room id is remembered');
assert.equal(companyRoom?.name, '公司大群');
assert.deepEqual(companyRoom?.memberIds.sort(), ['b1', 'prime1'], 'every bot is in the company room');
assert.equal(companyRoom?.team?.leaderBotId, 'prime1', 'the prime leads the company room');

// a bot that needs a colleague files the request in the company group and wakes the prime
assert.ok(toolsByName.apply_new_bot, 'the application tool is registered');
const applied = await toolsByName.apply_new_bot.execute(
  { name: '数据助理', need: '整理 CSV', why: '现有成员都不会数据清洗', description: '负责表格清洗' },
  { agent: { session: { id: 'ac:r1:b1' } } },
);
assert.equal(applied.ok, true, 'the application is accepted: ' + JSON.stringify(applied));
assert.equal(postedTeam?.roomId, 'company1', 'the application lands in the company group');
assert.deepEqual(postedTeam?.targetBotIds, [], 'the message is posted without a random-session run');
assert.equal(queuedRun?.botId, 'prime1', 'the prime is woken on its stable session');
assert.equal(queuedRun?.roomId, 'company1');
assert.match(postedTeam?.text || '', /@总理/);
assert.match(postedTeam?.text || '', /数据清洗|整理 CSV/);
say('PASS  company group: created with all bots led by the prime; apply_new_bot posts @总理 there');

// ---- ranks are permissions: 总理 > 管方向（计划+控运行）> 小官（守一个领域）> 组长（最底层干活） ----
const compState = JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8'));
const setRank = (rank) => { const st = JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8')); st.ranks = { ...(st.ranks ?? {}), b1: rank }; fs.writeFileSync(path.join(STATE, 'computer.json'), JSON.stringify(st, null, 2)); };
const execB1 = { agent: { session: { id: 'ac:r1:b1' } } };

setRank('officer');
const who = await toolsByName.org_rank.execute({}, execB1);
assert.equal(who.rank, 'officer');
assert.equal(who.companyRoomId, 'company1');
const deniedPlan = await toolsByName.org_plan.execute({ goal: '做一版方案' }, execB1);
assert.equal(deniedPlan.ok, false, 'an officer cannot plan');
assert.match(deniedPlan.error, /管方向/);
const deniedCtrl = await toolsByName.org_control.execute({ run_id: 'run1', action: 'cancel' }, execB1);
assert.equal(deniedCtrl.ok, false, 'an officer cannot control runs');

// 组长 is the bottom rung: it does the work, it neither plans nor steers runs
setRank('execution');
const execCtrl = await toolsByName.org_control.execute({ run_id: 'run1', action: 'cancel' }, execB1);
assert.equal(execCtrl.ok, false, 'a lead cannot control runs');
assert.match(execCtrl.error, /管方向/, 'the refusal names who can: ' + execCtrl.error);
const execPlan = await toolsByName.org_plan.execute({ goal: 'x' }, execB1);
assert.equal(execPlan.ok, false, 'a lead cannot plan');

setRank('direction');
const planned = await toolsByName.org_plan.execute({ goal: '把新功能做完', tasks: [{ subject: '写文档', assignee: '总理' }] }, execB1);
assert.equal(planned.ok, true, JSON.stringify(planned));
assert.equal(orgGoal?.text, '把新功能做完');
assert.equal(orgTasks?.tasks?.[0]?.assigneeName, '总理');
const ctrl = await toolsByName.org_control.execute({ run_id: 'run1', action: 'cancel' }, execB1);
assert.equal(ctrl.ok, true, JSON.stringify(ctrl));
assert.equal(orgControl?.action, 'cancel');
assert.equal(orgControl?.expectedRevision, 3);

// org_roster is how a bot knows the ladder before assigning work
const roster = await toolsByName.org_roster.execute({}, execB1);
assert.equal(roster.companyRoomId, 'company1');
assert.equal(roster.prime, 'prime1');
const meRow = roster.roster.find(r => r.id === 'b1');
assert.equal(meRow.rank, 'direction');
assert.equal(meRow.rankName, '管方向');
assert.ok(roster.roster.some(r => r.id === 'prime1' && r.domain === '全公司'), 'the prime owns the whole company');

// 负责范围 is ours too: the UI writes it through /act updateBot, the service never sees it
const nonceR = (await (await read('/snapshot')).json()).nonce;
const domSet = await post('/act', { kind: 'updateBot', payload: { id: 'b1', name: '甲', rank: 'officer', domain: '生活' }, nonce: nonceR });
assert.equal(domSet.status, 200, JSON.stringify(await domSet.json().catch(() => null)));
assert.equal(lastUpdate.domain, undefined, 'domain is stripped before the service is called');
assert.equal(lastUpdate.rank, undefined, 'rank is stripped before the service is called');
assert.equal(lastUpdate.name, '甲', 'everything else is passed through untouched');
const stAfter = JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8'));
assert.equal(stAfter.domains.b1, '生活');
assert.equal(stAfter.ranks.b1, 'officer');
const commDomain = await (await read('/community')).json();
assert.equal(commDomain.bots.find(b => b.id === 'b1').domain, '生活');
assert.equal(commDomain.bots.find(b => b.id === 'b1').rank, 'officer');
// an unranked bot is a fresh hire: both halves must agree it sits at the bottom
const nonceU = (await (await read('/snapshot')).json()).nonce;
assert.equal((await post('/act', { kind: 'updateBot', payload: { id: 'b1', name: '甲', rank: '', domain: '' }, nonce: nonceU })).status, 200);
const unranked = await (await read('/community')).json();
assert.equal(unranked.bots.find(b => b.id === 'b1').rank, 'execution', 'the page shows a fresh bot as 组长');
assert.equal(unranked.bots.find(b => b.id === 'b1').domain, '', 'clearing the domain clears it');
const freshRank = await toolsByName.org_rank.execute({}, execB1);
assert.equal(freshRank.rank, 'execution');
assert.equal(freshRank.rankName, '组长', 'the bot is told the same thing the page shows');

const primeWho = await toolsByName.org_rank.execute({}, { agent: { session: { id: 'ac:r1:prime1' } } });
assert.equal(primeWho.rank, 'boss');
const primeCtrl = await toolsByName.org_control.execute({ run_id: 'run1', action: 'cancel' }, { agent: { session: { id: 'ac:r1:prime1' } } });
assert.equal(primeCtrl.ok, true, 'the prime can always control runs: ' + JSON.stringify(primeCtrl));
say('PASS  ranks = permissions: only 总理/管方向 plan and control; 小官/组长 denied; roster + domain + fresh-hire default persist');
const browse = await read('/browse');
assert.equal(browse.status, 200, 'browse is readable');
assert.ok(Array.isArray((await browse.json()).entries), 'browse returns entries');
say('PASS  mount reads: /snapshot + /community + /browse all answer the app origin with no token');

// 3. a nonce is handed out with the snapshot, and a write is refused without it
assert.ok(snapJson.nonce, 'the snapshot carries a nonce');
const noNonce = await post('/respond', { approvalId: 'x', verdict: 'deny' });
assert.equal(noNonce.status, 403, 'a write without a nonce is refused');
const badNonce = await post('/respond', { approvalId: 'x', verdict: 'deny', nonce: 'nope' });
assert.equal(badNonce.status, 403, 'a forged nonce is refused');
say('PASS  writes: no nonce 403, forged nonce 403');

// 4. a valid nonce from the app origin reaches the handler (404 = it passed auth)
const withNonce = await post('/respond', { approvalId: 'no-such-ticket', verdict: 'deny', nonce: snapJson.nonce });
assert.equal(withNonce.status, 404, 'a valid nonce reaches the handler, got ' + withNonce.status);
// and that nonce is now spent
const replay = await post('/respond', { approvalId: 'no-such-ticket', verdict: 'deny', nonce: snapJson.nonce });
assert.equal(replay.status, 403, 'the same nonce cannot be replayed');
say('PASS  authorized write: reaches the handler once, then the nonce is spent');

// 4b. the autonomy switch is the page's one write that decides whether the agent may act without
// asking, so it is gated exactly like /respond — and it is the only place that flips it
const nBadType = (await (await read('/snapshot')).json()).nonce;
assert.equal((await post('/autonomy', { autonomy: false })).status, 403, 'turning autonomy off with no nonce is refused');
assert.equal((await post('/autonomy', { autonomy: 'yes', nonce: nBadType })).status, 400, 'a non-boolean autonomy is refused');
const nOff = (await (await read('/snapshot')).json()).nonce;
const off = await post('/autonomy', { autonomy: false, nonce: nOff });
assert.equal(off.status, 200, 'the page can turn it off: ' + JSON.stringify(await off.json().catch(() => null)));
assert.equal((await (await read('/snapshot')).json()).autonomy, false, 'the snapshot now says the agent must wait');
const autoState = JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8'));
assert.ok(autoState.audit.some(a => a.kind === 'autonomy' && a.autonomy === false), 'the flip is written into the audit trail');
const nOn = (await (await read('/snapshot')).json()).nonce;
assert.equal((await post('/autonomy', { autonomy: true, nonce: nOn })).status, 200);
assert.equal((await (await read('/snapshot')).json()).autonomy, true, 'and back on');
say('PASS  /autonomy: no nonce 403, bad type 400, off->snapshot false+audited, on again');

// 5. a foreign page gets nothing
const evil = await fetch(ep.url + '/snapshot', { headers: { origin: 'https://evil.example' } });
assert.equal(evil.status, 401, 'a foreign origin cannot read');
assert.equal(evil.headers.get('access-control-allow-origin'), null, 'and receives no CORS grant');
const evilHealth = await fetch(ep.url + '/health', { headers: { origin: 'https://evil.example' } });
assert.equal(evilHealth.status, 200, 'health stays open (it carries no data)');
assert.equal(evilHealth.headers.get('access-control-allow-origin'), null, 'but still grants no CORS');
say('PASS  foreign page: 401 on data, no CORS header even on /health');

// 6. the send path that used to crash: a service result with circular refs must not reach
//    JSON.stringify, and the host must still be serving afterwards.
const fresh = await (await read('/snapshot')).json();
const send1 = await post('/act', { kind: 'sendMessage', payload: { roomId: 'r1', text: 'hi' }, nonce: fresh.nonce });
assert.equal(send1.status, 200, 'sendMessage via /act answers 200, got ' + send1.status);
assert.deepEqual(await send1.json(), { ok: true, kind: 'sendMessage' }, 'the result is never echoed back');
const alive = await read('/health');
assert.equal(alive.status, 200, 'the host process survived a circular service result');
say('PASS  /act sendMessage: a circular service result is dropped, 200 returned, host still alive');

// 7. however a service call fails, the failure stays inside its request
// a profile default is what a new bot must inherit, or it can never run
const HOME = path.join(STATE, 'home');
fs.mkdirSync(path.join(HOME, 'profiles', 'desktop'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'profiles', 'desktop', 'cordis.patch.yml'), [
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: deepseek-account',
  '    model: deepseek-flash',
  '    reasoningEffort: high',
  '- id: next-entry',
  '',
].join('\n'));
process.env.DSH_HOME = HOME;
const defs = await (await read('/defaults')).json();
assert.equal(defs.model?.provider, 'deepseek-account');
assert.equal(defs.model?.model, 'deepseek-flash');

const n1 = (await (await read('/snapshot')).json()).nonce;
const syncBoom = await post('/act', { kind: 'createBot', payload: { name: 'sync-boom' }, nonce: n1 });
assert.equal(syncBoom.status, 422, 'a throwing service call answers 422');
assert.match((await syncBoom.json()).error, /sync-boom/);
assert.equal(createdArg?.provider, 'deepseek-account', 'createBot inherits the profile provider');
assert.equal(createdArg?.model, 'deepseek-flash', 'createBot inherits the profile model');
assert.equal(createdArg?.reasoningEffort, 'high', 'createBot inherits the profile effort');
delete process.env.DSH_HOME;
say('PASS  new bot: /defaults reports the profile model and createBot inherits provider/model/effort');
const n2 = (await (await read('/snapshot')).json()).nonce;
const asyncBoom = await post('/act', { kind: 'updateBot', payload: {}, nonce: n2 });
assert.equal(asyncBoom.status, 422, 'a rejecting service call answers 422');
assert.match((await asyncBoom.json()).error, /async-boom/);

// a malformed community state file used to throw outside any try in the sync route
const badState = path.join(STATE, 'bad-state.json');
fs.writeFileSync(badState, JSON.stringify({ rooms: {}, messages: {} }));
process.env.DSH_AGENT_COMMUNITY_STATE = badState;
const broken = await read('/community');
assert.equal(broken.status, 500, 'a throwing read route answers 500, got ' + broken.status);
delete process.env.DSH_AGENT_COMMUNITY_STATE;
const alive2 = await read('/health');
assert.equal(alive2.status, 200, 'the host survived a throwing route');
const crash = fs.readFileSync(path.join(STATE, 'crash.log'), 'utf8');
assert.match(crash, /http/, 'the route failure is recorded in crash.log');
say('PASS  failures are contained: sync throw 422, rejection 422, throwing route 500, host alive, crash.log written');

// 8. if the community service goes away, actions degrade to a clear 503 — still no crash
svcOn = false;
const n3 = (await (await read('/snapshot')).json()).nonce;
const gone = await post('/act', { kind: 'sendMessage', payload: { roomId: 'r1', text: 'x' }, nonce: n3 });
assert.equal(gone.status, 503, 'a missing service answers 503, got ' + gone.status);
assert.match((await gone.json()).error, /agent-community/);
assert.equal((await read('/health')).status, 200);
say('PASS  service absence: /act answers 503 with the reason, host still alive');

stop();
await new Promise(r => setTimeout(r, 150));
fs.rmSync(STATE, { recursive: true, force: true });
console.log(`\n${checks} wire checks passed (the seam between the two halves)`);
process.exit(0);
