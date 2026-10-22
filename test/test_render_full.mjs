// Renders every part of the 世界 page against one rich, realistic payload. A single undefined
// prop or bad map in any section blanks the whole view, and no per-component test catches that;
// this renders them together, in the order the page composes them.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const React = (await import('react')).default ?? await import('react');
globalThis.__DSH_REACT__ = React;
globalThis.window = {};
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
globalThis.document = { head: { appendChild() { } }, getElementById: () => null, createElement: () => ({ id: '', textContent: '', setAttribute() { } }) };
(0, eval)(fs.readFileSync('D:/111/dsh-local-computer/lib/client.js', 'utf8'));
const API = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window.__DSH_LOCAL_COMPUTER__;
const rtm = (await import('react-dom/server')).renderToStaticMarkup;
const say = t => console.log(t);

const bots = [
  { id: 'b1', name: '甲', avatar: '🤖', model: 'deepseek-flash', provider: 'deepseek-account', reasoningEffort: 'high', permission: 'full-access', mentionOnly: true, workspace: 'C:\\w\\b1', memoryNamespace: 'bot-甲', systemPrompt: '你是甲，负责核对。' },
  { id: 'b2', name: '乙', avatar: '🌟', model: 'deepseek-flash', provider: 'deepseek-account', reasoningEffort: 'high', permission: 'workspace-write', mentionOnly: false, workspace: 'C:\\w\\b2', memoryNamespace: 'bot-乙', systemPrompt: '' },
];
const rooms = [{
  id: 'r1', name: '验收群', memberIds: ['b1', 'b2'], connection: 'connected', unread: 2,
  objective: '把这条片子验完', round: 2, maxRounds: 5, team: { leaderId: 'b1', leaderName: '甲', status: 'active' },
  assignments: [{ id: 't1', botId: 'b1', task: '核对 720p', status: 'in_progress', report: null, round: 2 }],
  notices: [{ id: 'n1', text: '甲 开始核对' }],
}];
const messages = [
  { id: 'm1', roomId: 'r1', sender: { kind: 'user', name: '我' }, text: '开工', createdAt: '2026-10-22T02:00:00Z' },
  { id: 'm2', roomId: 'r1', sender: { kind: 'bot', botId: 'b1', name: '甲' }, text: '**收到**，`npm run build` 先跑\n- 第一步\n- 第二步\n请 @乙 复核', createdAt: '2026-10-22T02:01:00Z', attachments: [{ name: 'a.mp4', size: 2048, kind: 'file' }] },
];
const runs = [
  { id: 'x1', botId: 'b1', roomId: 'r1', origin: 'a2a', status: 'running', leaseOwner: 'l', startedAt: '2026-10-22T02:01:30Z', controlRevision: 3, prompt: '核对 720p', running: true },
  { id: 'x2', botId: 'b2', roomId: 'r1', origin: 'user', status: 'completed', startedAt: '2026-10-22T02:00:00Z', finishedAt: '2026-10-22T02:01:00Z', controlRevision: 1, prompt: '复核', running: false },
];
const swarm = {
  available: true, bots, rooms, messages, runs,
  tasks: [{ id: 't1', roomId: 'r1', roomName: '验收群', botId: 'b1', task: '核对 720p', status: 'in_progress' }],
  memories: [{ id: 'mm1', botId: 'b1', kind: 'task', text: '上一轮核完 3 条', at: '2026-10-21T10:00:00Z' }],
  proposals: [{ id: 'p1', name: '新协作群', reason: '要来回对片子', taskText: '验片', memberIds: ['b1', 'b2'], createdAt: '2026-10-22T02:00:00Z' }],
  approvals: [{ id: 'a1', roomId: 'r1', memberName: '甲', toolName: 'computer_shell', reason: '要跑构建', createdAt: '2026-10-22T02:00:30Z' }],
  mailbox: [{ id: 'mb1', roomId: 'r1', botId: 'b1', status: 'pending' }],
};

// 1. the room view pieces, in page order
const parts = {
  transcript: rtm(React.createElement(API.Transcript, { messages, bots })),
  taskBoard: rtm(React.createElement(API.TaskBoard, { room: rooms[0], bots })),
  runList: rtm(React.createElement(API.RunList, { runs, bots, onControl: () => { } })),
  proposals: rtm(React.createElement(API.ProposalList, { proposals: swarm.proposals, bots, onDecide: () => { } })),
  approvals: rtm(React.createElement(API.TeamApprovalList, { approvals: swarm.approvals, onDecide: () => { } })),
  botDetail: rtm(React.createElement(API.BotDetail, { bot: bots[0], rooms, runs, memories: [swarm.memories[0]], onSaved: () => { }, onDeleted: () => { } })),
  composer: rtm(React.createElement(API.Composer, { room: rooms[0], onDone: () => { } })),
  newBot: rtm(React.createElement(API.NewBotForm, { onDone: () => { } })),
  newRoom: rtm(React.createElement(API.NewRoomForm, { bots, onDone: () => { } })),
  brain: rtm(React.createElement(API.BrainSection, { memory: { available: true, vault: 'C:\\v', total: 5, bots: 2, pending: [{ path: 'Bots/甲/身份.md', action: 'create' }] }, onSync: () => { }, busy: false })),
  machine: rtm(React.createElement(API.MachineZone, { roots: ['C:\\a', 'C:\\b'], i: 2, active: false })),
};
for (const [k, html] of Object.entries(parts)) {
  assert.ok(html && html.length > 20, k + ' must render something');
  assert.ok(!/undefined|NaN/.test(html), k + ' must not leak undefined/NaN');
}
say(`PASS  all ${Object.keys(parts).length} sections render together without throwing or leaking undefined`);

// 2. the page itself, in both views
const bigSnapshot = {
  machineId: 'dsh-test', pending: [{ approvalId: 'ap1', action: 'run-command', args: { command: 'node' }, createdAt: '2026-10-22T02:00:00Z' }],
  permissions: { 'read-file': 'always' }, audit: [{ kind: 'executed', action: 'run-command', command: 'whoami', exitCode: 0, at: '2026-10-22T02:00:00Z' }],
  allowedRoots: ['C:\\a', 'C:\\b'], nonce: 'n1',
};
for (const focus of ['machine', 'newbot', 'newroom']) {
  const html = rtm(React.createElement(API.WorldPage, { snapshot: bigSnapshot, initialFocus: focus }));
  assert.ok(html.length > 500, 'the ' + focus + ' view renders');
  assert.ok(!/undefined|NaN/.test(html), 'the ' + focus + ' view leaks nothing');
}
say('PASS  WorldPage renders in machine / newbot / newroom modes with a full snapshot');

console.log('\n4 full-render checks passed');
