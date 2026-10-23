// Renders the swarm views against the user's real agent-community state (read-only) so the bot
// console is verified without a browser: profession, persona, own workspace, a2a runs, mentions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const React = (await import('react')).default ?? await import('react');
globalThis.__DSH_REACT__ = React;
globalThis.window = {};
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
globalThis.document = { head: { appendChild() { } }, getElementById: () => null, createElement: () => ({ id: '', textContent: '', setAttribute() { } }) };

(0, eval)(fs.readFileSync('D:/111/dsh-local-computer/lib/client.js','utf8'));
const { Transcript, RunList, BotDetail, MentionText, normalizeCommunity } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const { renderToStaticMarkup: rtm } = await import('react-dom/server');

const COMMUNITY = 'C:/Users/EDY/.dsh/agent-community/state.json';
const raw = JSON.parse(fs.readFileSync(COMMUNITY, 'utf8'));
const bots = raw.bots.map(b => ({
  id: b.id, name: b.name, avatar: b.avatar?.seed ?? '', model: b.model, reasoningEffort: b.reasoningEffort,
  provider: b.provider, permission: b.permission, mentionOnly: !!b.mentionOnly, workspace: b.workspace,
  systemPrompt: b.systemPrompt, memoryNamespace: b.profile?.memoryNamespace, profileId: b.profile?.profileId, description: b.description,
}));
const rooms = raw.rooms.map(r => ({ id: r.id, name: r.name, memberIds: r.memberIds, directBotId: r.directBotId ?? null, connection: r.connection }));
const messages = raw.messages.map(m => ({ id: m.id, roomId: m.roomId, text: m.text, sender: m.sender, createdAt: m.createdAt }));
const runs = raw.runs.map(r => ({ id: r.id, botId: r.botId, roomId: r.roomId, origin: r.origin, prompt: r.prompt, status: r.status, startedAt: r.startedAt }));
const say = t => console.log(t);

assert.ok(bots.length >= 1, 'the community must have at least one bot to render');
const room = rooms.find(r => messages.some(m => m.roomId === r.id)) ?? rooms[0];
const html = rtm(React.createElement(Transcript, { messages: messages.filter(m => m.roomId === room.id), bots }));
assert.ok(/wc-transcript/.test(html), 'transcript renders');
assert.ok(/data-mine="1"/.test(html) && /data-mine="0"/.test(html), 'both your bubbles and bot bubbles render');
assert.ok(/wc-avatar/.test(html), 'bot bubbles carry their avatar');
assert.ok(/wc-plate/.test(html), 'bot bubbles name the speaker');
assert.ok(!/undefined|NaN/.test(html), 'no leaked undefined in the transcript');
say(`PASS  transcript: room「${room.name}」renders ${(messages.filter(m => m.roomId === room.id)).length} messages as user/bot bubbles`);

const a2a = runs.find(r => r.origin === 'a2a');
assert.ok(a2a, 'the real state contains at least one bot-to-bot run');
const rh = rtm(React.createElement(RunList, { runs, bots }));
assert.ok(/bot 派给 bot/.test(rh), 'a2a runs are labelled as bot-to-bot, in Chinese');
assert.ok(rtm(React.createElement(RunList, { runs: [a2a], bots })).includes(a2a.prompt.slice(0, 8)), 'the dispatching prompt is shown');
say(`PASS  runs: ${runs.filter(r => r.origin === 'a2a').length} a2a of ${runs.length}, e.g. ${bots.find(b => b.id === a2a.botId)?.name} was tasked by a peer`);

for (const b of bots) {
  const bh = rtm(React.createElement(BotDetail, { bot: b, rooms, runs }));
  assert.ok(bh.includes(b.name), 'the bot names itself');
  assert.ok(bh.includes(b.workspace), 'its own isolated workspace is shown');
  assert.ok(b.systemPrompt ? bh.includes(b.systemPrompt.slice(0, 12)) : /还没有写个性化指令/.test(bh), 'persona text or an honest empty state');
  assert.ok(/独立工作区|记忆命名空间/.test(bh), 'the profession/persona fields are labelled');
}
say(`PASS  bot detail: ${bots.map(b => b.name).join('、')} each show profession, persona, own workspace, memory namespace`);

const mh = rtm(React.createElement(MentionText, { text: `请 @${bots[0].name} 复核`, names: bots.map(b => b.name) }));
assert.ok(/wc-mention/.test(mh) && mh.includes(`@${bots[0].name}`), '@-mentions become chips and keep the @');
const plain = rtm(React.createElement(MentionText, { text: 'no mentions here', names: ['x'] }));
assert.ok(plain.includes('no mentions here') && !plain.includes('**'), 'plain text passes through untouched');
// the bots answer in Markdown; rendering it as plain text used to leak ** and - into the transcript
const mdText = ['**粗体结论** 和 `npm run build`', '- 第一条', '- 第二条', '请 @甲 复核'].join('\n');
const md = rtm(React.createElement(MentionText, { text: mdText, names: ['甲'] }));
assert.ok(md.includes('<strong>粗体结论</strong>'), 'bold becomes <strong>, not literal asterisks');
assert.ok(/<code[^>]*>npm run build<\/code>/.test(md), 'inline code renders as <code>');
assert.ok(/<ul><li/.test(md), 'a bullet list becomes a real list');
assert.ok(/wc-mention/.test(md) && md.includes('@甲'), 'mentions still chip inside markdown');
assert.ok(!md.includes('**'), 'no bold markers leak into the transcript');
const CLIENT_SRC = fs.readFileSync('D:/111/dsh-local-computer/lib/client.js', 'utf8');
assert.ok(!/innerHTML|dangerouslySetInnerHTML/.test(CLIENT_SRC), 'markdown renders as React nodes, never as raw HTML');
console.log('PASS  markdown: bold/code/list/mention render, markers never leak, no innerHTML anywhere');
say('PASS  mentions: @name renders as a chip, non-mention text is untouched');

console.log(`\n4 swarm checks passed against the live community state (read-only)`);

// 5. the remote's RAW snapshot shape must normalize into what the page reads.
//    Without this, a working ctx.remote still renders an empty BOT group (avatar.seed,
//    taskState.assignments and the top-level unread map are all nested differently).
// normalizeCommunity already destructured from the client API above
const rawRemote = {
  bots: [{ id: 'b1', name: '甲', avatar: { seed: '🤖', locked: false }, profile: { memoryNamespace: 'ns-甲', profileId: 'p-甲' }, systemPrompt: '你是甲', model: 'deepseek-flash', provider: 'deepseek-account', reasoningEffort: 'high', permission: 'full-access', mentionOnly: true }],
  rooms: [{ id: 'r1', name: '验收群', memberIds: ['b1'], sequence: 3, connection: 'connected',
    taskState: { round: 2, maxRounds: 5, objective: '把成片验完', assignments: [{ id: 't1', botId: 'b1', task: '核对 720p', status: 'in_progress' }], finished: { report: 'done' } } }],
  messages: [], runs: [{ id: 'run1', botId: 'b1', roomId: 'r1', origin: 'a2a', status: 'running', leaseOwner: 'l1', finishedAt: null, controlRevision: 4 }],
  unread: { r1: 7 },
};
const nn = normalizeCommunity(rawRemote);
assert.equal(nn.bots[0].avatar, '🤖', 'avatar.seed flattens to the glyph the rail renders');
assert.equal(nn.bots[0].memoryNamespace, 'ns-甲', 'profile.memoryNamespace surfaces');
assert.equal(nn.rooms[0].assignments[0].task, '核对 720p', 'taskState.assignments become the task board');
assert.equal(nn.rooms[0].objective, '把成片验完', 'the room objective surfaces');
assert.equal(nn.rooms[0].unread, 7, 'the top-level unread map lands on its room');
assert.equal(nn.runs[0].running, true, 'a leased, unfinished run reads as running');
assert.equal(nn.runs[0].controlRevision, 4, 'the run-control concurrency token survives');
assert.equal(JSON.stringify(normalizeCommunity(nn).rooms[0].assignments), JSON.stringify(nn.rooms[0].assignments), 'normalizing twice changes nothing');
const rendered = rtm(React.createElement(RunList, { runs: nn.runs, bots: nn.bots }));
assert.ok(/执行中/.test(rendered) && /bot 派给 bot/.test(rendered), 'the normalized run renders as a live a2a run');
console.log('PASS  remote shape: a raw snapshot() normalizes into the page model, and is idempotent');

// 6. room.team arrives as {leader:{kind,botId},leaderName,status}; the page reads leaderId/leaderName.
const rawTeam = {
  bots: [{ id: 'b1', name: '甲', avatar: { seed: '🤖' }, model: 'deepseek-flash', provider: 'p', reasoningEffort: 'high', permission: 'full-access' }],
  rooms: [{ id: 'r1', name: '协作群', memberIds: ['b1'], connection: 'connected',
    team: { leader: { kind: 'bot', botId: 'b1' }, leaderName: '甲', status: 'active' } }],
  messages: [], runs: [], unread: {},
};
const nt = normalizeCommunity(rawTeam);
assert.equal(nt.rooms[0].team.leaderId, 'b1', 'team.leader.botId flattens to leaderId');
assert.equal(nt.rooms[0].team.leaderName, '甲', 'the leader name survives');
assert.equal(nt.rooms[0].team.status, 'active', 'the team status survives');
console.log('PASS  team: leader/leaderName/status normalize out of the raw nested shape');

// 7. the bot detail must show this bot's own memory, and say so honestly when there is none
// BotDetail is destructured from the client API at the top of this file
const mem = [
  { id: 'm1', botId: 'b1', kind: 'task', text: '核对 720p 的片子被驳回了 3 条', at: '2026-10-21T10:00:00Z' },
  { id: 'm2', botId: 'b1', kind: 'note', text: '用户偏好结论先行', at: '2026-10-21T11:00:00Z' },
];
const withMem = rtm(React.createElement(BotDetail, { bot: nt.bots[0], rooms: nt.rooms, runs: [], memories: mem }));
assert.ok(withMem.includes('核对 720p'), 'the memory text renders');
assert.ok(/任务收尾/.test(withMem), 'a run-derived memory is labelled 任务收尾');
assert.ok(/自己记的/.test(withMem), 'a self-note is labelled 自己记的');
assert.ok(!/还没有记忆条目/.test(withMem), 'the empty state must not appear when there are entries');
const noMem = rtm(React.createElement(BotDetail, { bot: nt.bots[0], rooms: nt.rooms, runs: [], memories: [] }));
assert.ok(/还没有记忆条目/.test(noMem), 'and the empty state is explicit when there are none');
assert.ok(noMem.includes('甲'), 'the bot still identifies itself');
console.log('PASS  memory view: entries labelled by kind, explicit empty state, both render');

// 8. a group proposal must show what the bot wants to create, who is in it, and a way to say yes/no.
const { ProposalList } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const propBots = [{ id: 'b1', name: '甲' }, { id: 'b2', name: '乙' }];
const props = [{
  id: 'p1', name: '成片验收群', reason: '两个人要来回对同一份片子', taskText: '把这条 720p 的片子验完',
  memberIds: ['b1', 'b2'], createdAt: '2026-10-21T10:00:00Z',
}];
let decided = null;
const ph = rtm(React.createElement(ProposalList, { proposals: props, bots: propBots, onDecide: (k, v) => { decided = [k, v]; } }));
assert.ok(/成片验收群/.test(ph), 'the proposed group name shows');
assert.ok(/甲、乙/.test(ph), 'the proposed members show by name, not by id');
assert.ok(/把这条 720p 的片子验完/.test(ph), 'the original task text is carried so nothing is lost on confirm');
assert.ok(/确认建群/.test(ph) && />拒绝</.test(ph), 'confirm and decline are both offered');
assert.equal(decided, null, 'rendering must not decide anything by itself');
console.log('PASS  proposal: name, members, task text and both verdicts render; nothing auto-decides');

// the same component must stay out of the way when there is nothing to decide
assert.equal(rtm(React.createElement(ProposalList, { proposals: [], bots: propBots, onDecide: () => { } })), '',
  'no proposals renders nothing at all');
console.log('PASS  proposal: an empty list renders nothing');

// 9. a bot asking for a tool is a decision the human makes; the card must say who, what, why, and
//    expose exactly two outcomes with the service's own outcome strings.
const { TeamApprovalList, TeamApprovalCard } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const appr = [{ id: 'a1', roomId: 'r1', memberName: '甲', toolName: 'computer_shell', reason: '要跑 pnpm build', createdAt: '2026-10-21T10:00:00Z' }];
let answer = null;
const ah = rtm(React.createElement(TeamApprovalList, { approvals: appr, onDecide: (k, v) => { answer = [k, v]; } }));
assert.ok(/要调工具/.test(ah), 'the card names the decision class');
assert.ok(ah.includes('甲') && ah.includes('computer_shell'), 'who and which tool are both visible');
assert.ok(/要跑 pnpm build/.test(ah), 'the reason is shown');
assert.ok(/只放行这一次/.test(ah) && />拒绝</.test(ah), 'both outcomes are offered');
assert.equal(answer, null, 'rendering decides nothing');
assert.equal(rtm(React.createElement(TeamApprovalList, { approvals: [], onDecide: () => { } })), '', 'no approvals renders nothing');
console.log('PASS  team approval: member + tool + reason + two outcomes, nothing auto-decides');

// 10. attachments are declared metadata only ("there is no thumbnail, because the bytes are not
//     here"), so the bubble shows name + size and must not invent a download control.
const attMsg = [{
  id: 'x1', roomId: 'r1', sender: { kind: 'bot', botId: 'b1', name: '甲' }, createdAt: '2026-10-21T10:00:00Z',
  text: '片子好了',
  attachments: [{ name: '03_final.mp4', size: 7340032, mime: 'video/mp4', kind: 'file' }],
}];
const { Transcript: T2 } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const ath = rtm(React.createElement(T2, { messages: attMsg, bots: [{ id: 'b1', name: '甲', avatar: '🤖' }] }));
assert.ok(ath.includes('03_final.mp4'), 'the attachment name is visible');
assert.ok(/7\.0 MB/.test(ath), 'the size is humanised');
assert.ok(!/<a |download|href=/.test(ath), 'no fake download affordance is invented for metadata-only files');
console.log('PASS  attachments: name + humanised size, and no invented download link');

// 11. a transcript is a live log: role=log + aria-live, and it is named.
assert.ok(/role="log"/.test(ath) && /aria-live="polite"/.test(ath), 'the transcript is an announced live log');
assert.ok(/aria-label="[^"]+"/.test(ath), 'the log has an accessible name');
console.log('PASS  a11y: the transcript announces itself as a named live log');

// 12. you can create a room yourself: the form names it, lists the bots as real checkboxes,
//     refuses an empty name, and sends exactly {name, memberIds}.
const { NewRoomForm } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const nrh = rtm(React.createElement(NewRoomForm, { bots: [{ id: 'b1', name: '甲', avatar: '🤖' }], onDone: () => { } }));
assert.ok(/新建房间/.test(nrh), 'the form says what it creates');
assert.ok(/id="wc-room-name"/.test(nrh), 'the name field is labelled and addressable');
assert.ok(/type="checkbox"/.test(nrh) && nrh.includes('甲'), 'bots are offered as checkboxes by name');
assert.ok(/建群/.test(nrh) && /取消/.test(nrh), 'create and cancel are both present');
console.log('PASS  new room: named field + member checkboxes + both actions');

// 13. a live run can be steered, not only cancelled; a finished failed run offers retry instead.
const { RunRow } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const liveRun = { id: 'run9', botId: 'b1', origin: 'user', status: 'running', leaseOwner: 'l', finishedAt: null, controlRevision: 2, prompt: '跑构建' };
const liveH = rtm(React.createElement(RunRow, { r: liveRun, byId: { b1: { name: '甲' } }, onControl: () => { } }));
assert.ok(/转向/.test(liveH), 'a running run can be steered');
assert.ok(/取消/.test(liveH), 'and still cancelled');
const deadRun = { id: 'run8', botId: 'b1', origin: 'user', status: 'failed', finishedAt: '2026-10-21T10:00:00Z', controlRevision: 3, prompt: '跑构建' };
const deadH = rtm(React.createElement(RunRow, { r: deadRun, byId: { b1: { name: '甲' } }, onControl: () => { } }));
assert.ok(/重试/.test(deadH) && !/转向/.test(deadH), 'a finished failed run offers retry, not steer');
console.log('PASS  run control: steer + cancel while live, retry once finished');

// 14. a bot is editable after creation: the detail view offers 编辑 and the facts are read-only.
const { BotDetail: BD2 } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const bdHtml = rtm(React.createElement(BD2, { bot: nt.bots[0], rooms: nt.rooms, runs: [], memories: [] }));
assert.ok(/编辑/.test(bdHtml), 'the detail view offers an edit action');
assert.ok(!/type="text"/.test(bdHtml), 'and is read-only until you ask to edit');
assert.ok(/个性化指令/.test(bdHtml) && /独立工作区/.test(bdHtml), 'the facts and persona are still shown');
console.log('PASS  bot edit: detail offers 编辑, stays read-only until invoked');

// 15. creating a bot accepts the real CreateBotRequest fields, including the avatar seed.
const { NewBotForm: NBF } = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const nbh = rtm(React.createElement(NBF, { onDone: () => { } }));
for (const id of ['wc-f-name', 'wc-f-description', 'wc-f-avatarSeed', 'wc-f-systemPrompt']) {
  assert.ok(nbh.includes(`id="${id}"`), `the form exposes ${id}`);
}
assert.ok(/avatarSeed/.test(nbh), 'the avatar seed field is present (it is a real CreateBotRequest field)');
console.log('PASS  new bot: profession + role + avatar + persona fields are all real request fields');

// 16. a run row says how long it took (finished) or how long it has been going (live).
const finished = { id: 'r1', botId: 'b1', origin: 'user', status: 'completed', startedAt: '2026-10-21T10:00:00Z', finishedAt: '2026-10-21T10:02:05Z', controlRevision: 1, prompt: 'x' };
const fh = rtm(React.createElement(RunRow, { r: finished, byId: { b1: { name: '甲' } }, onControl: () => { } }));
assert.ok(/2m 5s/.test(fh), 'a finished run shows its duration, got: ' + fh.slice(-160));
const live2 = { id: 'r2', botId: 'b1', origin: 'user', status: 'running', leaseOwner: 'l', startedAt: new Date(Date.now() - 5000).toISOString(), controlRevision: 1, prompt: 'x' };
const lh = rtm(React.createElement(RunRow, { r: live2, byId: { b1: { name: '甲' } }, onControl: () => { } }));
assert.ok(/\d+s…/.test(lh), 'a live run shows elapsed time with a trailing marker');
console.log('PASS  run time: finished runs show duration, live runs show elapsed');

// 17. deleting a bot is offered only behind a confirmation, never as a one-press action.
const bd17 = rtm(React.createElement(BD2, { bot: nt.bots[0], rooms: nt.rooms, runs: [], memories: [] }));
assert.ok(/删除/.test(bd17), 'the detail view offers delete');
assert.ok(!/确认删除/.test(bd17), 'and it is not pre-armed');
assert.ok(/编辑/.test(bd17), 'edit is still the primary action');
console.log('PASS  bot delete: offered, but not pre-armed');

// 18. the community action must never be shadowed by the approval handler again. It was: `doAct`
// called a local `act`, so clear/delete/run-control resolved to the approval function, hit the
// "trusted gesture" guard and returned without doing anything.
const src = fs.readFileSync('D:/111/dsh-local-computer/lib/client.js', 'utf8');
assert.ok(/async function communityAct\(kind, payload\)/.test(src), 'the community action is its own function');
assert.ok(/await communityAct\(altKind \?\? kind, payload\)/.test(src), 'doAct calls the community action');
assert.ok(/onVerdict: respond/.test(src), 'the approval handler is wired as respond');
assert.ok(!/const act = useCallback/.test(src), 'no local act shadows the community action');
assert.ok(/item\(t\('direct'\)/.test(src), 'the bot menu offers a direct chat');
console.log('PASS  action wiring: doAct -> communityAct, approvals -> respond, bot menu offers 私聊');

// 19. a bot's blocking question renders with its options, a free-text answer, and a skip.
const APIQ = globalThis.__DSH_LOCAL_COMPUTER__ ?? globalThis.window?.__DSH_LOCAL_COMPUTER__;
const qh = rtm(React.createElement(APIQ.QuestionCard, {
  q: { id: 'q1', memberName: '甲', question: '要继续吗？', options: ['继续', '停止'], allowFreeText: true, createdAt: 'now' },
  i: 0, onDecide: () => { },
}));
assert.ok(/要继续吗？/.test(qh), 'the question text renders');
assert.ok(/继续/.test(qh) && /停止/.test(qh), 'each option is a button');
assert.ok(/type="text"/.test(qh), 'free text is available');
assert.ok(/跳过/.test(qh) && /发送/.test(qh), 'skip and send are offered');
assert.ok(/answerBotQuestion/.test(src), 'options/answers go through answerBotQuestion');
console.log('PASS  question card: text + option buttons + free text + skip');

// 20. every action the page can send must exist in the host allowlist; a drift here is a dead button.
const hostSrc = fs.readFileSync('D:/111/dsh-local-computer/lib/index.js', 'utf8');
const methodsBlock = hostSrc.match(/const METHODS = \{([\s\S]*?)\n\s*\};/);
assert.ok(methodsBlock, 'host exposes the action allowlist');
const allowed = new Set([...methodsBlock[1].matchAll(/(\w+):\s*'/g)].map(m => m[1]));
// every action name that appears in the client (static or dynamic call sites) must be accepted
const used = new Set([...src.matchAll(/'(createBot|updateBot|deleteBot|createRoom|updateRoom|deleteRoom|archiveRoom|sendMessage|postTeamMessage|clearMessages|assignTasks|decomposeTasks|setRoomGoal|proposeGroup|confirmGroup|declineGroup|controlRun|retryRun|markRoomRead|inviteBot|dmBot|dismissTeam|approveBotToolCall|answerBotQuestion|teamOverview)'/g)].map(m => m[1]));
for (const name of used) assert.ok(allowed.has(name), `client action "${name}" is missing from the host allowlist`);
console.log(`PASS  action allowlist: ${[...used].length} client actions all accepted (${[...used].join(', ')})`);

// 21. the prime is visibly protected: no delete in its detail dialog or context menu.
const primeBot = { ...nt.bots[0], protected: true };
const primeHtml = rtm(React.createElement(BD2, { bot: primeBot, rooms: nt.rooms, runs: [], memories: [] }));
assert.ok(/CEO/.test(primeHtml), 'the prime is labelled with its rank');
assert.ok(!/删除/.test(primeHtml), 'the prime offers no delete action');
assert.ok(/menu\.bot\.protected \? null : item\(t\('delete'\)/.test(src), 'the context menu hides delete for the prime');
console.log('PASS  prime UI: labelled, no delete in the detail dialog or context menu');
