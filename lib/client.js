(function (root) {
  "use strict";
// dsh-local-computer —— client side (runs inside the dsh web renderer).
//
// Host contract observed in shipped plugins (dsh-ui-tidy, ui-agent-community, dsh-diff-approval,
// agent-teams, codex-auth, im-connect):
//   window.__ModuleLoader__.load({ id, factory })  -- factory receives `require`, exports.apply(ctx) runs
//   ctx.slots.inject(name, () => ctx.slots.register({ name, id, order, locale, label, inject }, Component))
//   slot "sidebar.panellist" -> an entry in the rail      slot "main" -> whole-view takeover
//
// The visual language is the target app's own: every primitive below is a value lifted verbatim
// from dist/renderer/assets/index-CMR1RvAA.css of the shipped Grok Bot bundle
// (see D:\111\_tmp_rea\recon\frontend-values.json). No invented scales.
// React is deliberately NOT imported statically. A `link:`-installed plugin has no build step for
// a bundler to resolve a bare specifier against, so the shipped client bundles take React from the
// module loader's `require`. This file accepts whichever route is live:
//   window.__ModuleLoader__.load({ id, factory: (require) => ... })  ->  require('react')
//   a test/host that pre-seeds globalThis.__DSH_REACT__             ->  that instance
let React = (typeof globalThis !== 'undefined' && globalThis.__DSH_REACT__) || null;
const need = () => { if (!React) throw new Error('dsh-local-computer: React not supplied to this client bundle'); return React; };
const h = (...a) => need().createElement(...a);
const useState = (...a) => need().useState(...a);
const useEffect = (...a) => need().useEffect(...a);
const useCallback = (...a) => need().useCallback(...a);
const useMemo = (...a) => need().useMemo(...a);
const useRef = (...a) => need().useRef(...a);

const NS = 'dsh-local-computer';
const BUILD = '2026-10-22.16';
const VIEW_KEY = 'world';
const WELL_KNOWN_PORT = 47831;
const LOOPBACK_PORTS = [0, 1, 2, 3, 4].map(i => WELL_KNOWN_PORT + i);
let PROBED_BASE = null;
// The last transport failure, verbatim. A first paint with no effect run behind it (a server render,
// or a remount right after a failed probe) seeds its error state from this instead of pretending to
// be "loading" — that is what lets the offline banner name the real cause instead of generic copy.
let LAST_TRANSPORT_ERROR = null;

// Same range the host walks, probed once: /health is the one route that needs no token, so this
// only asks "is anyone home", never for data.
async function probeLoopback() {
  if (PROBED_BASE) return PROBED_BASE;
  for (const port of LOOPBACK_PORTS) {
    const base = 'http://127.0.0.1:' + port;
    try {
      const r = await fetch(base + '/health', { cache: 'no-store' });
      if (r.ok) { PROBED_BASE = base; return base; }
    } catch { }
  }
  return null;
}

const LOCALE = {
  zh: {
    entry: '世界', title: '世界', machine: '本机', pending: '待审批', permissions: '已长期允许',
    subtitle: 'DeepSeek 要动你的电脑时，先在这里问你。',
    autonomy_on: '自主运行', autonomy_off: '等你批准',
    autonomy_on_hint: 'AI 可以自己批准并执行', autonomy_off_hint: 'AI 会停下来问你',
    autonomy_failed: '切换没生效：',
    audit: '执行记录', args: '参数', details: '详情', hide: '收起', allow: '允许一次', always: '总是允许',
    deny: '拒绝', refreshing: '同步中', refresh: '立即同步', connected: '已连接', disconnected: '未连接本机执行服务',
    offline_body: '审批队列跑在宿主进程的回环端口上，但这次渲染进程没拿到端口和令牌，所以这一区读不到东西。Bot 与房间不依赖它，照常可用。',
    retry: '重试', none_pending: '没有等待你决定的动作', none_permissions: '还没有你放行过的动作类型',
    none_audit: '还没有执行记录', exit: '退出码', granted_at: '放行于', just_now: '刚刚',
    min_ago: '分钟前', hour_ago: '小时前', spent: '一次性放行已用掉', deny_reason: '已拒绝',
    approve_hint: '允许只放行这一次；总是允许会写入长期许可，之后同类动作不再询问。',
    revoke: '取消允许', loading: '正在读取本机状态', action_pending: '正在处理',
    kind_executed: '执行', kind_responded: '决定', kind_revoked: '撤权', kind_denied: '拒绝', kind_pending: '等待',
    live: '实时', need_gesture: '这次表态没有被浏览器认定为真实点击，已拒绝。请你亲自点一次按钮。',
    need_sync: '状态已过期，正在重新同步，请稍后再点一次。', respond_failed: '表态没送出去：',
    revoke_failed: '撤权没送出去：',
    machine: '本机', machine_hint: 'agent 能看到的目录范围，超出这些根目录一律拒绝。', empty_dir: '空目录',
    bots: 'Bot', rooms: '房间', swarm_unavailable: '没读到 agent-community 的状态', show_all: '展开全文',
    no_messages: '这个房间还没有对话', no_runs: '还没有派过任务', running: '执行中', a2a: 'bot 派给 bot',
    no_goal: '还没定目标', deliverable: '交付文件',
    from_user: '你派的', profession: '职业', model: '模型', permission: '权限', mention_only: '只在被 @ 时说话',
    yes: '是', no: '否', workspace: '独立工作区', memory: '记忆命名空间', rooms_in: '所在房间',
    runs_done: '任务完成', persona: '个性化指令', no_persona: '这位还没有写个性化指令', back_machine: '回到本机执行',
    say_to: '跟', dispatch: '派活', enter_send: 'Enter 发送，Shift+Enter 换行；这会真的唤起一次模型运行',
    new_bot: '新建 Bot', role_line: '一句话定位', persona_ph: '你是一名……（这位的专属指令，会作为 systemPrompt 存下来）',
    prime: '总理', rank_label: '等级', rank_direction: '管方向', rank_officer: '小官', rank_execution: '组长',
    rank_hint: '等级从高到低：总理 > 管方向 > 小官 > 组长。管方向和总理能设目标、拆任务、派活、控运行；小官独管一个具体领域；组长在最底层，只执行派下来的任务。',
    domain_label: '负责范围', domain_ph: '例如：生活、工作（小官一般要填）',
    create_bot: '创建', cancel: '取消', need_name: '先给它一个职业名', new_bot_note: '新 Bot 会有自己独立的工作区与记忆命名空间，模型沿用 profile 的 DeepSeek 配置。你可以在界面直接建；Bot 之间要建新 Bot，需向「总理」申请。',
    busy: '忙碌', idle: '空闲', task_board: '任务板', objective: '本群目标', no_tasks: '这个群还没有任务卡',
    reported: '已回报', machine_console: '本机执行', pick_a_room: '左边选一个房间，或者点「本机执行」看审批与目录。',
    me: '我', transcript: '对话转录', empty_world: '这台机器上还没有任何 bot。先建一个，再拉一个群让它干活。', clear_messages: '清空消息', confirm_clear: '确认清空', delete_room: '删除房间', confirm_delete_room: '确认删除房间', bot_settings: 'Bot 设置', direct: '私聊', close: '关闭', delete: '删除', confirm_delete: '确认删除', edit: '编辑', save: '保存', avatar: '头像', steer: '转向', steer_ph: '告诉它改做什么', send: '发送', delivery: '投递',
    new_room: '新建房间', room_name: '房间名', room_name_ph: '比如「成片验收群」', members: '成员',
    no_bots_yet: '还没有 bot，先去 BOT 那栏建一个', create_room: '建群', need_room_name: '先给这个群起个名字',
    new_room_note: '建好后你可以直接在这里派活；成员会按你的指令在群里协作。', wants_tool: '要调工具', some_bot: '某个 bot', allow_once_only: '只放行这一次',
    asks_you: '想问你', answer_ph: '输入你的回答，Enter 发送', skip: '跳过',
    st_done: '已完成', st_failed: '失败', st_cancelled: '已取消', st_queued: '排队中', st_running: '执行中', st_interrupted: '已中断',
    leader: '组长', memory_view: '记忆', memory_task: '任务收尾', memory_note: '自己记的', no_memory: '这位还没有记忆条目（任务收尾或它自己记笔记后会出现）',
    brain: '外置大脑', vault: 'Vault', brain_notes: '笔记', brain_loading: '正在读 vault…',
    brain_none: '没配 vault（设 DSH_OBSIDIAN_VAULT，或让 dsh-obsidian 指向一个）',
    brain_rule: '一个 bot 一个目录，只写自己那份；越出 Bots/ 的路径一律拒绝，也不删旧笔记。',
    brain_synced: '已经同步，没有待写入的笔记', brain_write: '写入 Obsidian', brain_created: '篇已写入',
    notebook: '笔记本', nb_live: '现行', nb_archived: '已下线', nb_ledger: '账本', nb_rule: '规则', nb_log: '记事',
    nb_written: '写下', nb_about: '说的是', nb_expires: '有效期', nb_forever: '长期', nb_expired: '已过期', nb_team: '团队共享',
    nb_add: '记一条', nb_ph: '例如：抖音的成片必须 1080p 以上', nb_retire: '下线', nb_kind: '类型', nb_who: '记在谁名下',
    nb_empty: '还没有条目。让 bot 用 brain_rule 立，或你自己在这里记一条。',
    nb_hint: '每条带三个时间：写下、说的是哪天、什么时候作废。过期的只当历史，不当现状；下线的进归档，不删。',
    nb_need_text: '先写要记什么', nb_need_bot: '先选记在谁名下', nb_failed: '没记上：', nb_days_ago: '天前',
    routine: '定时触发', cancel_run: '取消', retry: '重试', proposal: '建群提案', confirm_group: '确认建群',
    crash_title: '这一页渲染时出错了，DeepSeek 其它界面不受影响',
    crash_body: '重新加载插件或点重试即可恢复；出错信息已写进插件状态目录，供排查。',
  },
  en: {
    entry: 'World', title: 'World', machine: 'This machine', pending: 'Pending', permissions: 'Standing grants',
    subtitle: 'Every local action waits here for you first.',
    autonomy_on: 'Autonomous', autonomy_off: 'Waits for you',
    autonomy_on_hint: 'The agent approves and runs its own tickets', autonomy_off_hint: 'The agent stops and asks you first',
    autonomy_failed: 'The switch did not take effect: ',
    audit: 'Audit', args: 'arguments', details: 'Details', hide: 'Hide', allow: 'Allow once', always: 'Always allow',
    deny: 'Deny', refreshing: 'Syncing', refresh: 'Sync now', connected: 'Connected', disconnected: 'Local computer service unreachable',
    offline_body: 'The approval queue lives on the host process loopback port, which this renderer was never given; bots and rooms do not depend on it and still work.',
    retry: 'Retry', none_pending: 'Nothing is waiting on you', none_permissions: 'No action type granted yet',
    none_audit: 'No executions yet', exit: 'exit', granted_at: 'granted', just_now: 'just now',
    min_ago: 'm ago', hour_ago: 'h ago', spent: 'one-time grant spent', deny_reason: 'denied',
    approve_hint: 'Allow once covers this call only. Always allow writes a standing grant and stops asking.',
    revoke: 'Revoke', loading: 'Reading local state', action_pending: 'Working',
    kind_executed: 'ran', kind_responded: 'decided', kind_revoked: 'revoked', kind_denied: 'denied', kind_pending: 'waiting',
    live: 'live', need_gesture: 'That verdict was not a browser-trusted click, so it was dropped. Press the button yourself.',
    need_sync: 'State went stale; re-syncing, please press again.', respond_failed: 'The verdict did not reach the service: ',
    revoke_failed: 'The revoke did not reach the service: ',
    machine: 'This machine', machine_hint: 'The directories the agent can see. Anything outside these roots is refused.', empty_dir: 'empty',
    bots: 'Bots', rooms: 'Rooms', swarm_unavailable: 'agent-community state could not be read', show_all: 'Show full text',
    no_messages: 'Nothing said in this room yet', no_runs: 'No tasks dispatched yet', running: 'running', a2a: 'bot → bot',
    no_goal: 'no goal set', deliverable: 'deliverable',
    from_user: 'from you', profession: 'Profession', model: 'Model', permission: 'Permission', mention_only: 'Speaks only when @-mentioned',
    yes: 'yes', no: 'no', workspace: 'Own workspace', memory: 'Memory namespace', rooms_in: 'In rooms',
    runs_done: 'Runs done', persona: 'Personal instructions', no_persona: 'No personal instructions yet', back_machine: 'Back to local execution',
    say_to: 'Message', dispatch: 'Dispatch', enter_send: 'Enter sends, Shift+Enter adds a line; this starts a real model run',
    new_bot: 'New bot', role_line: 'One-line role', persona_ph: 'You are a… (kept as this bot\'s systemPrompt)',
    prime: 'Prime', rank_label: 'Rank', rank_direction: 'Direction', rank_officer: 'Officer', rank_execution: 'Lead',
    rank_hint: 'Ranks from high to low: Prime > Direction > Officer > Lead. Direction and the Prime set goals, decompose, assign and control runs; an Officer owns one concrete domain; a Lead sits at the bottom and only executes assigned tasks.',
    domain_label: 'Domain', domain_ph: 'e.g. Life, Work (officers usually fill this)',
    create_bot: 'Create', cancel: 'Cancel', need_name: 'Give it a role name first', new_bot_note: 'A new bot gets its own workspace and memory namespace; the model follows the profile DeepSeek settings. You can create one here; bots must ask the Prime for new bots.',
    busy: 'busy', idle: 'idle', task_board: 'Task board', objective: 'Room objective', no_tasks: 'No task cards in this room yet',
    reported: 'reported', machine_console: 'Local execution', pick_a_room: 'Pick a room on the left, or open Local execution for approvals and files.',
    me: 'me', transcript: 'Transcript', empty_world: 'No bots on this machine yet. Create one, then put it in a room with work to do.', clear_messages: 'Clear messages', confirm_clear: 'Clear them', delete_room: 'Delete room', confirm_delete_room: 'Delete this room', bot_settings: 'Bot settings', direct: 'Direct chat', close: 'Close', delete: 'Delete', confirm_delete: 'Delete it', edit: 'Edit', save: 'Save', avatar: 'Avatar', steer: 'Steer', steer_ph: 'Tell it what to do instead', send: 'Send', delivery: 'delivery',
    new_room: 'New room', room_name: 'Room name', room_name_ph: 'e.g. Final-cut review', members: 'Members',
    no_bots_yet: 'No bots yet — create one under BOT first', create_room: 'Create room', need_room_name: 'Give the room a name first',
    new_room_note: 'Once it exists you can dispatch work here; members collaborate in the room.', wants_tool: 'wants a tool', some_bot: 'a bot', allow_once_only: 'Allow once',
    asks_you: 'asks you', answer_ph: 'Type your answer, Enter to send', skip: 'Skip',
    st_done: 'done', st_failed: 'failed', st_cancelled: 'cancelled', st_queued: 'queued', st_running: 'running', st_interrupted: 'interrupted',
    leader: 'lead', memory_view: 'Memory', memory_task: 'after a run', memory_note: 'self-noted', no_memory: 'No memory entries yet — they appear when a run finishes or the bot notes something itself',
    brain: 'External brain', vault: 'Vault', brain_notes: 'Notes', brain_loading: 'Reading the vault…',
    brain_none: 'No vault configured (set DSH_OBSIDIAN_VAULT, or point dsh-obsidian at one)',
    brain_rule: 'One folder per bot, and a bot only writes inside its own. Anything escaping Bots/ is refused; old notes are never deleted.',
    brain_synced: 'In sync — nothing pending', brain_write: 'Write to Obsidian', brain_created: 'notes written',
    notebook: 'Notebook', nb_live: 'Current', nb_archived: 'Retired', nb_ledger: 'Ledger', nb_rule: 'rule', nb_log: 'note',
    nb_written: 'written', nb_about: 'about', nb_expires: 'valid until', nb_forever: 'standing', nb_expired: 'expired', nb_team: 'team',
    nb_add: 'Add', nb_ph: 'e.g. Douyin deliverables must be 1080p or better', nb_retire: 'Retire', nb_kind: 'Kind', nb_who: 'Whose book',
    nb_empty: 'Nothing yet. Let a bot write one with brain_rule, or add one here.',
    nb_hint: 'Three times per entry: written, the day it is about, when it expires. Expired reads as history, not current fact; retired goes to the archive and is never deleted.',
    nb_need_text: 'Write what to remember first', nb_need_bot: 'Pick whose book first', nb_failed: 'Not saved: ', nb_days_ago: 'd ago',
    routine: 'scheduled', cancel_run: 'Cancel', retry: 'Retry', proposal: 'group proposal', confirm_group: 'Confirm group',
    crash_title: 'This page failed to render; the rest of DeepSeek is unaffected',
    crash_body: 'Retry to remount it. The error was written to the plugin state directory for diagnosis.',
  },
};

function lang() {
  return (typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}
function t(key) { return LOCALE[lang()][key] ?? LOCALE.en[key] ?? key; }
const rankLabel = (r) => (r === 'boss' || r === 'prime') ? t('prime') : (r ? (t('rank_' + r) === 'rank_' + r ? r : t('rank_' + r)) : '');

// The renderer is never handed the host's loopback port. Try the one origin it can already reach:
// the plugin route that serves this bundle. If that route only serves client.js the fetch fails and
// the page keeps its honest offline state — this can only ever add a working channel.
// the outcome of the last probe, surfaced in the offline banner so a failed channel is diagnosable

function endpoint() {
  const cfg = (typeof window !== 'undefined' && (window.__LOCAL_COMPUTER__ || window.__DSH_LOCAL_COMPUTER__)) || null;
  // the host binds this well-known loopback port; mutations still need a nonce, which the host
  // only mints for the app's own origin, so a tokenless default is safe here.
  if (!cfg?.url) return { url: 'http://127.0.0.1:' + WELL_KNOWN_PORT, token: '' };
  return { url: String(cfg.url).replace(/\/+$/, ''), token: String(cfg.token ?? '') };
}

async function api(pathname, body) {
  let ep = endpoint();
  // no injected config: find the host in its port range before the first real request
  if (!ep || (!ep.token && pathname !== '/health')) {
    const base = await probeLoopback();
    if (base) ep = { url: base, token: ep?.token ?? '' };
  }
  if (!ep) throw new Error('no endpoint');
  let res;
  try {
    res = await fetch(ep.url + pathname, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-local-computer-token': ep.token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // the host may have restarted on another port in the range; re-probe on the next attempt
    PROBED_BASE = null;
    // name the transport's own cause (ECONNREFUSED, ENOTFOUND …) instead of a bare "fetch failed"
    const cause = e && e.cause;
    const why = String((e && e.message) || e)
      + (cause ? ` (${cause.code || cause.message || cause})` : '');
    LAST_TRANSPORT_ERROR = why;
    throw new Error(why);
  }
  if (!res.ok) {
    // surface the host's own reason (e.g. "agent-community service is not loaded") rather than
    // a bare "http 503", so a failed send says what actually failed
    let msg = 'http ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = String(j.error); } catch { }
    LAST_TRANSPORT_ERROR = msg;
    throw new Error(msg);
  }
  const payload = await res.json();
  LAST_TRANSPORT_ERROR = null;
  return payload;
}

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso).slice(0, 16);
  const d = Date.now() - ms;
  if (d < 45e3) return t('just_now');
  if (d < 36e5) return `${Math.round(d / 6e4)} ${t('min_ago')}`;
  if (d < 864e5) return `${Math.round(d / 36e5)} ${t('hour_ago')}`;
  return new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
}

const ACTION_ICON = {
  'run-command': 'terminal', 'read-file': 'file', 'write-file': 'pencil', 'list-dir': 'folder',
};

// ---------------------------------------------------------------- tokens + chrome
const STYLE_ID = 'dsh-local-computer-style';
const CSS = `
.wc-scope{
  /* --- primitives, verbatim from the shipped Grok Bot CSS --------------------- */
  --cursor-duration-instant:50ms; --cursor-duration-fast:.1s; --cursor-duration-normal:.15s;
  --cursor-duration-slow:.2s; --cursor-duration-slower:.3s;
  --cursor-easing-default:ease; --cursor-easing-out:ease-out;
  --cursor-easing-out-quint:cubic-bezier(.16,1,.3,1);
  --cursor-easing-out-strong:cubic-bezier(.165,.84,.44,1);
  --panel-ease-out:cubic-bezier(.23,1,.32,1);
  --cursor-radius-xs:2px; --cursor-radius-sm:4px; --cursor-radius-base:6px; --cursor-radius-lg:8px;
  --cursor-radius-xl:12px; --cursor-radius-2xl:14px; --cursor-radius-3xl:16px; --cursor-radius-4xl:18px;
  --cursor-radius-full:9999px;
  --cursor-height-xs:20px; --cursor-height-sm:24px; --cursor-height-base:28px; --cursor-height-lg:32px;
  --sp-1:4px; --sp-1-5:6px; --sp-2:8px; --sp-2-5:10px; --sp-3:12px; --sp-3-5:14px; --sp-4:16px;
  --sp-5:20px; --sp-6:24px; --sp-8:32px; --sp-10:40px;
  --ui-press-scale:.98;

  /* --- the sand substrate: one ink, one paper, an alpha ladder ---------------- */
  --sand-ink:#1c1c1c; --sand-paper:#fff;
  --sand-bg-pane:var(--sand-paper); --sand-bg-chrome:#fcfcfc; --sand-bg-sidebar:#f5f5f5;
  --sand-text-primary:var(--sand-ink);
  --sand-text-secondary:color-mix(in srgb, var(--sand-ink) 68%, transparent);
  --sand-text-tertiary:color-mix(in srgb, var(--sand-ink) 56%, transparent);
  --sand-text-quaternary:color-mix(in srgb, var(--sand-ink) 40%, transparent);
  --sand-text-on-primary:var(--sand-paper);
  --sand-icon-primary:color-mix(in srgb, var(--sand-ink) 92%, transparent);
  --sand-icon-secondary:color-mix(in srgb, var(--sand-ink) 66%, transparent);
  --sand-icon-tertiary:color-mix(in srgb, var(--sand-ink) 52%, transparent);
  --sand-border-primary-translucent:color-mix(in srgb, var(--sand-ink) 24%, transparent);
  --sand-border-secondary-translucent:color-mix(in srgb, var(--sand-ink) 12%, transparent);
  --sand-border-tertiary-translucent:color-mix(in srgb, var(--sand-ink) 8%, transparent);
  --sand-border-quaternary-translucent:color-mix(in srgb, var(--sand-ink) 6%, transparent);
  --sand-bg-secondary:color-mix(in srgb, var(--sand-ink) 6%, transparent);
  --sand-bg-tertiary:color-mix(in srgb, var(--sand-ink) 8%, transparent);
  --sand-bg-quaternary:color-mix(in srgb, var(--sand-ink) 4%, transparent);
  --sand-bg-hover:color-mix(in srgb, var(--sand-ink) 6%, transparent);
  --sand-bg-active:color-mix(in srgb, var(--sand-ink) 8%, transparent);
  --sand-bg-secondary-hover:color-mix(in srgb, var(--sand-ink) 10%, transparent);
  --sand-bg-secondary-active:color-mix(in srgb, var(--sand-ink) 18%, transparent);
  --sand-fill-bubble-agent:color-mix(in srgb, var(--sand-ink) 6%, transparent);
  --sand-fill-bubble-user:var(--sand-ink);
  --sand-shadow-card:color-mix(in srgb, var(--sand-ink) 4%, transparent);
  --sand-shadow-control:color-mix(in srgb, var(--sand-ink) 12%, transparent);
  --sand-box-shadow-sm:0 2px 8px 0 var(--sand-shadow-card);
  --sand-box-shadow-popup:0 3px 8px 0 var(--sand-shadow-card),0 2px 5px 0 var(--sand-shadow-card),0 1px 1px 0 var(--sand-shadow-card);

  /* --- hues, from the sand palette ------------------------------------------- */
  --sand-blue:#1680f3; --sand-danger:#e72e3b; --sand-success:#10ab61; --sand-warn:#da830e;
  --sand-border-focus-primary:#1e86fc;
  --sand-bg-primary:var(--sand-ink); --sand-bg-primary-hover:color-mix(in srgb, var(--sand-ink) 82%, var(--sand-paper));
  --sand-bg-danger:color-mix(in srgb, var(--sand-danger) 10%, transparent);
  --sand-bg-danger-hover:color-mix(in srgb, var(--sand-danger) 16%, transparent);
  --sand-bg-blue:color-mix(in srgb, var(--sand-blue) 8%, transparent);
  --sand-bg-blue-hover:color-mix(in srgb, var(--sand-blue) 14%, transparent);
  --sand-text-danger:color-mix(in srgb, var(--sand-danger) 82%, var(--sand-ink));
  --sand-text-blue:color-mix(in srgb, var(--sand-blue) 74%, var(--sand-ink));

  /* --- type ------------------------------------------------------------------ */
  --sand-font-size-xxs:11px; --sand-font-size-xs:12px; --sand-font-size-sm:13px; --sand-font-size-base:14px;
  --sand-font-size-lg:15px; --sand-font-size-xl:17px; --sand-font-size-xxl:22px;
  --sand-line-height-xxs:16px; --sand-line-height-xs:16px; --sand-line-height-sm:18px; --sand-line-height-base:20px;
  --sand-line-height-lg:22px; --sand-line-height-xl:24px; --sand-line-height-xxl:28px;
  --sand-letter-spacing-xl:-.008em; --sand-letter-spacing-xxl:-.012em;
  --wc-sans:"SF Pro",-apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,"Noto Sans SC",sans-serif;
  --wc-mono:"XVF Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;

  /* --- component: menu + rows ------------------------------------------------ */
  --sand-menu-radius:12px; --sand-menu-row-radius:6px; --sand-menu-row-height:30px; --sand-menu-row-gap:4px;
  --sand-search-menu-row-height:32px; --ui-sidebar-leading-icon-size:14px; --ui-sidebar-row-fill:transparent;
  --wc-measure:840px;

  /* scoped browser surfaces: nothing inside this view ships with defaults */
  font-family:var(--wc-sans); font-size:var(--sand-font-size-base); line-height:var(--sand-line-height-base);
  letter-spacing:0em; color:var(--sand-text-primary);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.wc-scope *,.wc-scope *::before,.wc-scope *::after{box-sizing:border-box}
.wc-scope ::selection,.wc-scope::selection{background:var(--sand-bg-active);color:var(--sand-text-primary)}
.wc-scope input,.wc-scope textarea,.wc-scope button{caret-color:var(--sand-text-primary);font:inherit;letter-spacing:inherit}
.wc-scope :focus{outline:none}
.wc-scope [data-kbd="1"] :focus-visible,.wc-scope[data-kbd="1"] :focus-visible{
  outline:2px solid var(--sand-border-focus-primary); outline-offset:1px; border-radius:var(--cursor-radius-base)}
.wc-scope .wc-scroll{scrollbar-width:thin;scrollbar-color:var(--sand-border-secondary-translucent) transparent;overscroll-behavior:contain}
.wc-scope .wc-scroll::-webkit-scrollbar{width:14px;height:14px;background:transparent}
.wc-scope .wc-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--sand-text-quaternary) 45%,transparent);
  border-radius:var(--cursor-radius-full);border:4px solid transparent;background-clip:padding-box}
.wc-scope .wc-scroll::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--sand-text-tertiary) 55%,transparent);background-clip:padding-box}
.wc-scope .wc-scroll::-webkit-scrollbar-track{background:transparent}

@media (prefers-color-scheme: dark){.wc-scope{
  --sand-ink:#f0f0f0; --sand-paper:#1e1e1e;
  --sand-bg-pane:#1c1c1e; --sand-bg-chrome:#1e1e1e; --sand-bg-sidebar:#232325;
  --sand-text-on-primary:#141414; --sand-bg-primary:#f0f0f0;
  --sand-bg-primary-hover:color-mix(in srgb,#f0f0f0 84%,#1c1c1e);
  --sand-shadow-card:color-mix(in srgb,#000 40%,transparent);
  --sand-shadow-control:color-mix(in srgb,#000 55%,transparent);
  --sand-border-focus-primary:#4a9dff; --sand-blue:#4a9dff; --sand-success:#2fc37f; --sand-warn:#f0a44a;
}}
.wc-scope[data-scheme="dark"]{
  --sand-ink:#f0f0f0; --sand-paper:#1e1e1e;
  --sand-bg-pane:#1c1c1e; --sand-bg-chrome:#1e1e1e; --sand-bg-sidebar:#232325;
  --sand-text-on-primary:#141414; --sand-bg-primary:#f0f0f0;
  --sand-bg-primary-hover:color-mix(in srgb,#f0f0f0 84%,#1c1c1e);
  --sand-shadow-card:color-mix(in srgb,#000 40%,transparent);
  --sand-shadow-control:color-mix(in srgb,#000 55%,transparent);
  --sand-border-focus-primary:#4a9dff; --sand-blue:#4a9dff; --sand-success:#2fc37f; --sand-warn:#f0a44a;
}

/* ---------------------------------------------------------------- shell */
.wc-root{position:relative;width:100%;max-width:100%;height:100%;min-height:0;background:var(--sand-bg-chrome);display:flex;overflow:hidden}
.wc-app{display:grid;grid-template-columns:clamp(176px,24%,236px) minmax(0,1fr);width:100%;max-width:100%;height:100%;min-height:0;overflow:hidden}
.wc-rail{display:flex;flex-direction:column;min-width:0;min-height:0;gap:var(--sp-2);padding:var(--sp-2) var(--sp-2);overflow:hidden;
  background:var(--sand-bg-sidebar);border-right:.5px solid var(--sand-border-quaternary-translucent)}
.wc-rail-head{display:flex;align-items:center;gap:var(--sp-1-5);padding:var(--sp-1) var(--sp-1-5) var(--sp-2);
  font-size:var(--sand-font-size-xxs);line-height:var(--sand-line-height-xxs);letter-spacing:.04em;
  text-transform:uppercase;color:var(--sand-text-secondary)}
.wc-machine{display:flex;align-items:center;gap:var(--sp-1-5);min-width:0;padding:var(--sp-2);
  border-radius:var(--cursor-radius-lg);background:var(--sand-bg-pane);
  box-shadow:inset 0 0 0 .5px var(--sand-border-tertiary-translucent)}
.wc-machine-dot{position:relative;flex:0 0 auto;width:8px;height:8px;border-radius:var(--cursor-radius-full);
  background:var(--sand-success)}
.wc-machine-dot[data-off="1"]{background:var(--sand-text-quaternary)}
.wc-machine-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);font-weight:500}
.wc-machine-sub{font-size:var(--sand-font-size-xxs);line-height:var(--sand-line-height-xxs);color:var(--sand-text-secondary);
  font-variant-numeric:tabular-nums}

.wc-rows{display:flex;flex-direction:column;gap:var(--sand-menu-row-gap);list-style:none;margin:0;padding:0}
.wc-row-link{display:flex;align-items:center;gap:var(--sp-2);width:100%;height:var(--sand-menu-row-height);
  padding:0 var(--sp-2);border:0;border-radius:var(--sand-menu-row-radius);background:transparent;
  color:var(--sand-text-primary);font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);
  text-align:start;text-decoration:none;cursor:pointer;
  transition:background-color var(--cursor-duration-normal) var(--cursor-easing-default),
             color var(--cursor-duration-normal) var(--cursor-easing-default),
             transform var(--cursor-duration-fast) var(--cursor-easing-default)}
.wc-row-link:hover{background:var(--sand-bg-hover)}
.wc-row-link:active{transform:scale(var(--ui-press-scale))}
.wc-row-link[aria-current="true"]{background:var(--sand-bg-active);font-weight:500}
.wc-row-link .wc-ico{color:var(--sand-icon-secondary)}
.wc-row-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-count{flex:0 0 auto;min-width:20px;height:var(--cursor-height-xs);padding:0 var(--sp-1);border-radius:var(--cursor-radius-full);
  display:grid;place-items:center;font-size:var(--sand-font-size-xxs);line-height:1;font-variant-numeric:tabular-nums;
  background:var(--sand-bg-secondary-active);color:var(--sand-text-primary)}
.wc-count[data-tone="warn"]{background:color-mix(in srgb,var(--sand-warn) 72%,var(--sand-ink));color:var(--sand-paper)}
.wc-count[data-zero="1"]{background:var(--sand-bg-secondary);color:var(--sand-text-secondary)}

.wc-rail-foot{margin-top:auto;display:flex;flex-direction:column;gap:var(--sp-1);padding:var(--sp-1-5) var(--sp-1) var(--sp-1)}
.wc-rail-note{font-size:var(--sand-font-size-xxs);line-height:var(--sand-line-height-xxs);color:var(--sand-text-secondary);
  display:flex;align-items:center;gap:var(--sp-1);font-variant-numeric:tabular-nums}

/* ---------------------------------------------------------------- pane */
.wc-pane{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--sand-bg-pane);overflow:hidden}
.wc-pane-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:var(--sp-3);
  min-height:52px;padding:var(--sp-2) var(--sp-6);background:color-mix(in srgb,var(--sand-bg-pane) 72%,transparent);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  border-bottom:.5px solid var(--sand-border-quaternary-translucent)}
.wc-h1{margin:0;font-size:var(--sand-font-size-xl);line-height:var(--sand-line-height-xl);
  font-weight:600;letter-spacing:var(--sand-letter-spacing-xl);text-wrap:balance}
.wc-hint{margin:0;font-size:var(--sand-font-size-xs);line-height:var(--sand-line-height-xs);color:var(--sand-text-secondary);
  max-width:56ch}
.wc-pane-tools{margin-inline-start:auto;display:flex;align-items:center;gap:var(--sp-2)}
.wc-pane-body{flex:1;min-height:0;overflow:auto;padding:var(--sp-6) var(--sp-6) var(--sp-10);
  display:flex;flex-direction:column;gap:var(--sp-8)}
.wc-col{display:flex;flex-direction:column;gap:var(--sp-2);width:min(100%,var(--wc-measure))}
.wc-sec-head{display:flex;align-items:baseline;gap:var(--sp-2);margin:0 0 var(--sp-1)}
.wc-sec-title{font-size:var(--sand-font-size-lg);line-height:var(--sand-line-height-lg);font-weight:600;letter-spacing:0em}
.wc-sec-meta{font-size:var(--sand-font-size-xxs);line-height:var(--sand-line-height-xxs);color:var(--sand-text-secondary);
  font-variant-numeric:tabular-nums}
.wc-sec-id{margin-top:calc(-1 * var(--sp-4));padding-top:var(--sp-4)}

/* buttons */
.wc-btn{display:inline-flex;align-items:center;gap:var(--sp-1-5);height:var(--cursor-height-base);padding:0 var(--sp-2-5);
  border:.5px solid var(--sand-border-secondary-translucent);border-radius:var(--cursor-radius-base);
  background:var(--sand-bg-secondary);color:var(--sand-text-primary);cursor:pointer;white-space:nowrap;
  font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);font-weight:500;
  transition:background-color var(--cursor-duration-normal) var(--cursor-easing-default),
             border-color var(--cursor-duration-normal) var(--cursor-easing-default),
             color var(--cursor-duration-normal) var(--cursor-easing-default),
             transform var(--cursor-duration-fast) var(--cursor-easing-default),
             box-shadow var(--cursor-duration-normal) var(--cursor-easing-default)}
.wc-btn:hover{background:var(--sand-bg-secondary-hover)}
.wc-btn:active{transform:scale(var(--ui-press-scale));background:var(--sand-bg-secondary-active)}
.wc-btn[disabled]{cursor:default;opacity:.42;background:var(--sand-bg-quaternary);transform:none}
.wc-btn[data-tone="primary"]{background:var(--sand-bg-primary);color:var(--sand-text-on-primary);border-color:transparent}
.wc-btn[data-tone="primary"]:hover{background:var(--sand-bg-primary-hover)}
.wc-btn[data-tone="primary"]:active{background:var(--sand-bg-primary)}
.wc-btn[data-tone="danger"]{background:var(--sand-bg-danger);color:var(--sand-text-danger);border-color:color-mix(in srgb,var(--sand-danger) 22%,transparent)}
.wc-btn[data-tone="danger"]:hover{background:var(--sand-bg-danger-hover)}
.wc-btn[data-tone="accent"]{background:var(--sand-bg-blue);color:var(--sand-text-blue);border-color:color-mix(in srgb,var(--sand-blue) 24%,transparent)}
.wc-btn[data-tone="accent"]:hover{background:var(--sand-bg-blue-hover)}
.wc-btn[data-tone="ghost"]{background:transparent;border-color:transparent;color:var(--sand-text-secondary)}
.wc-btn[data-tone="ghost"]:hover{background:var(--sand-bg-hover);color:var(--sand-text-primary)}
.wc-ico-btn{width:var(--cursor-height-base);height:var(--cursor-height-base);padding:0;justify-content:center;flex:0 0 auto}
.wc-ico-btn:active{transform:scale(.94)}

/* the tray banner: a problem named, with its recovery next to it */
.wc-banner{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--sp-3);
  padding:var(--sp-2) var(--sp-3);border-radius:var(--cursor-radius-xl);
  background:var(--sand-bg-quaternary);box-shadow:inset 0 0 0 .5px var(--sand-border-tertiary-translucent),var(--sand-box-shadow-sm)}
.wc-banner[data-tone="warn"]{background:color-mix(in srgb,var(--sand-warn) 9%,var(--sand-bg-pane));
  box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--sand-warn) 30%,transparent)}
.wc-banner-title{font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);font-weight:600;display:flex;align-items:center;gap:var(--sp-2)}
.wc-banner-body{grid-column:1/-1;margin:calc(-1 * var(--sp-1)) 0 0;font-size:var(--sand-font-size-xs);
  line-height:var(--sand-line-height-xs);color:var(--sand-text-secondary);max-width:62ch}
.wc-banner[data-tone="warn"] .wc-banner-body{color:color-mix(in srgb,var(--sand-warn) 74%,var(--sand-ink))}

/* approval cards: real depth from an offset + soft blur, never a zero-offset halo */
.wc-items{display:flex;flex-direction:column;gap:var(--sp-2)}
.wc-item{position:relative;display:flex;flex-direction:column;gap:var(--sp-2);padding:var(--sp-3);
  border-radius:var(--cursor-radius-xl);background:var(--sand-bg-pane);
  box-shadow:inset 0 0 0 .5px var(--sand-border-secondary-translucent),var(--sand-box-shadow-sm);
  transition:box-shadow var(--cursor-duration-slow) var(--cursor-easing-default),
             transform var(--cursor-duration-normal) var(--cursor-easing-default)}
.wc-item:hover{box-shadow:inset 0 0 0 .5px var(--sand-border-primary-translucent),var(--sand-box-shadow-popup)}
.wc-item-top{display:flex;align-items:center;gap:var(--sp-2);min-width:0}
.wc-item-title{display:flex;align-items:center;gap:var(--sp-2);min-width:0;font-size:var(--sand-font-size-base);
  line-height:var(--sand-line-height-base);font-weight:600}
.wc-item-title .wc-ico{color:var(--sand-icon-secondary);flex:0 0 auto}
.wc-mono{font-family:var(--wc-mono);font-size:var(--sand-font-size-sm);letter-spacing:0em;font-variant-numeric:tabular-nums}
.wc-id{font-family:var(--wc-mono);font-size:var(--sand-font-size-xxs);color:var(--sand-text-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:14ch}
.wc-when{margin-inline-start:auto;flex:0 0 auto;font-size:var(--sand-font-size-xxs);line-height:var(--sand-line-height-xxs);
  color:var(--sand-text-secondary);font-variant-numeric:tabular-nums}
.wc-plate{display:inline-flex;align-items:center;height:var(--cursor-height-xs);padding:0 var(--sp-1-5);flex:0 0 auto;
  border-radius:var(--cursor-radius-sm);background:var(--sand-bg-primary);color:var(--sand-text-on-primary);
  font-size:var(--sand-font-size-xxs);line-height:1;font-weight:500;letter-spacing:.01em}
.wc-plate[data-tone="ok"]{background:color-mix(in srgb,var(--sand-success) 72%,var(--sand-ink));color:var(--sand-paper)}
.wc-plate[data-tone="warn"]{background:color-mix(in srgb,var(--sand-warn) 72%,var(--sand-ink));color:var(--sand-paper)}
.wc-plate[data-tone="danger"]{background:color-mix(in srgb,var(--sand-danger) 82%,var(--sand-ink));color:var(--sand-paper)}
.wc-plate[data-tone="muted"]{background:var(--sand-bg-secondary-active);color:var(--sand-text-primary)}
.wc-plate .wc-ico{margin-inline-end:3px}

/* args: the 0fr -> 1fr row collapse, exactly as the app animates disclosure */
.wc-disclosure{display:grid;grid-template-rows:0fr;transition:grid-template-rows var(--cursor-duration-slower) var(--panel-ease-out)}
.wc-disclosure[data-open="1"]{grid-template-rows:1fr}
.wc-disclosure > .wc-disclosure-in{min-height:0;overflow:hidden}
.wc-code{margin:0;padding:var(--sp-2) var(--sp-3);border-radius:var(--cursor-radius-base);
  background:var(--sand-bg-quaternary);box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent);
  font-family:var(--wc-mono);font-size:var(--sand-font-size-xs);line-height:17px;color:var(--sand-text-secondary);
  white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;tab-size:2}
.wc-toggle{display:inline-flex;align-items:center;gap:var(--sp-1);padding:0;border:0;background:transparent;cursor:pointer;
  font-size:var(--sand-font-size-xs);line-height:var(--sand-line-height-xs);color:var(--sand-text-secondary);
  transition:color var(--cursor-duration-fast) var(--cursor-easing-default)}
.wc-toggle:hover{color:var(--sand-text-primary)}
.wc-toggle .wc-ico{transition:transform var(--cursor-duration-normal) var(--cursor-easing-out-quint)}
.wc-toggle[aria-expanded="true"] .wc-ico{transform:rotate(90deg)}

/* verdict controls reveal on hover/focus the way the app reveals message actions */
.wc-item-act{display:flex;align-items:center;gap:var(--sp-1-5);flex-wrap:wrap}
.wc-item-act .wc-btn{--sand-menu-row-height:28px}
@media (hover:hover){
  .wc-item-act{opacity:var(--wc-reveal,.55);transition:opacity var(--cursor-duration-normal) var(--cursor-easing-default)}
  .wc-item:hover .wc-item-act,.wc-item:focus-within .wc-item-act,.wc-item-act:hover{opacity:1}
}
.wc-item-note{margin:0;font-size:var(--sand-font-size-xxs);line-height:var(--sand-line-height-xxs);color:var(--sand-text-secondary)}
.wc-sec-hint{margin:0 0 var(--sp-1);font-size:var(--sand-font-size-xs);line-height:var(--sand-line-height-xs);
  color:var(--sand-text-secondary);max-width:66ch}

/* the transcript: agent rows are soft fill, your decisions are solid ink bubbles (sand's own rule) */
.wc-log{display:flex;flex-direction:column;gap:var(--sp-1)}
.wc-log-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:var(--sp-2);
  min-height:var(--sand-search-menu-row-height);padding:var(--sp-1-5) var(--sp-2);border-radius:var(--cursor-radius-lg);
  background:var(--sand-fill-bubble-agent);
  transition:background-color var(--cursor-duration-normal) var(--cursor-easing-default)}
.wc-log-row:hover{background:var(--sand-bg-secondary-hover)}
.wc-log-row[data-mine="1"]{background:var(--sand-fill-bubble-user);color:var(--sand-text-on-primary);
  margin-inline-start:var(--sp-8);border-end-end-radius:var(--cursor-radius-sm)}
.wc-log-row[data-mine="1"]:hover{background:color-mix(in srgb,var(--sand-ink) 88%,var(--sand-paper))}
.wc-log-row[data-mine="1"] .wc-log-cmd,.wc-log-row[data-mine="1"] .wc-log-exit{color:color-mix(in srgb,var(--sand-text-on-primary) 78%,transparent)}
.wc-log-row[data-mine="1"] .wc-plate{background:color-mix(in srgb,var(--sand-text-on-primary) 18%,transparent);color:var(--sand-text-on-primary)}
.wc-log-main{display:flex;align-items:baseline;gap:var(--sp-2);min-width:0}
.wc-log-cmd{font-family:var(--wc-mono);font-size:var(--sand-font-size-xs);line-height:16px;color:var(--sand-text-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.wc-log-exit{font-size:var(--sand-font-size-xxs);font-variant-numeric:tabular-nums;color:var(--sand-text-secondary);flex:0 0 auto}

/* the machine: a confined browser over the roots this machine actually exposed */
.wc-crumb{display:flex;align-items:center;gap:var(--sp-1);min-width:0;flex-wrap:wrap}
.wc-crumb button{display:inline-flex;align-items:center;gap:var(--sp-1);border:0;background:transparent;cursor:pointer;
  padding:2px var(--sp-1);border-radius:var(--cursor-radius-sm);color:var(--sand-text-secondary);
  font-family:var(--wc-mono);font-size:var(--sand-font-size-xs);
  transition:background-color var(--cursor-duration-fast) var(--cursor-easing-default),color var(--cursor-duration-fast) var(--cursor-easing-default)}
.wc-crumb button:hover{background:var(--sand-bg-hover);color:var(--sand-text-primary)}
.wc-crumb button[disabled]{cursor:default;opacity:.4}
.wc-roots{display:flex;gap:var(--sp-1);flex-wrap:wrap}
.wc-files{display:flex;flex-direction:column;gap:1px;padding:var(--sp-1);border-radius:var(--cursor-radius-lg);
  background:var(--sand-bg-quaternary);box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent)}
.wc-file{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:var(--sp-2);
  min-height:var(--sand-menu-row-height);padding:0 var(--sp-2);border:0;width:100%;background:transparent;
  border-radius:var(--sand-menu-row-radius);cursor:pointer;text-align:start;color:var(--sand-text-primary);
  font-size:var(--sand-font-size-sm);
  transition:background-color var(--cursor-duration-fast) var(--cursor-easing-default)}
.wc-file:hover{background:var(--sand-bg-hover)}
.wc-file:active{transform:scale(var(--ui-press-scale))}
.wc-file .wc-ico{color:var(--sand-icon-secondary)}
.wc-file span:first-of-type{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--wc-mono);font-size:var(--sand-font-size-xs)}
.wc-file em{font-style:normal;font-size:var(--sand-font-size-xxs);color:var(--sand-text-secondary);font-variant-numeric:tabular-nums}
.wc-file[data-dir="0"]{cursor:default}
.wc-file[data-dir="0"]:hover{background:transparent}
.wc-grant-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:var(--sp-2);
  min-height:var(--sand-search-menu-row-height);padding:var(--sp-1-5) var(--sp-2);border-radius:var(--cursor-radius-lg);
  transition:background-color var(--cursor-duration-normal) var(--cursor-easing-default)}
.wc-grant-row:hover{background:var(--sand-bg-hover)}
.wc-grant-row .wc-id{max-width:none}
.wc-sep{height:.5px;background:var(--sand-border-quaternary-translucent);border:0;margin:0}

/* a slot-level failure surfaces here instead of taking the webview down */
.wc-crash{margin:var(--sp-3);padding:var(--sp-3);border-radius:var(--cursor-radius-lg);background:var(--sand-bg-pane);
  box-shadow:inset 0 0 0 .5px var(--sand-border-tertiary-translucent);display:grid;gap:var(--sp-2);justify-items:start}
.wc-crash-title{font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);font-weight:600;color:var(--sand-text-primary)}
.wc-crash-text{margin:0;font-size:var(--sand-font-size-xs);line-height:var(--sand-line-height-xs);color:var(--sand-text-secondary)}
.wc-crash-why{max-width:100%;overflow:auto;padding:2px 6px;border-radius:var(--cursor-radius-sm);background:var(--sand-bg-quaternary);
  font-family:var(--cursor-font-mono,ui-monospace,monospace);font-size:var(--sand-font-size-xs);color:var(--sand-text-tertiary)}
.wc-crash .wc-btn{justify-self:start}
/* empty + skeleton */
.wc-empty{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3);border-radius:var(--cursor-radius-lg);
  font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);color:var(--sand-text-secondary);
  background:var(--sand-bg-quaternary);box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent)}
.wc-skel{border-radius:var(--cursor-radius-base);background:
  linear-gradient(90deg,var(--sand-bg-secondary) 0%,var(--sand-bg-quaternary) 42%,var(--sand-bg-secondary) 84%) 0 0/220% 100%;
  animation:wc-shimmer 1.5s linear infinite}
.wc-skel-row{height:64px}
.wc-skel-line{height:12px;margin:var(--sp-1) 0}
@keyframes wc-shimmer{0%{background-position:200% 0}to{background-position:-200% 0}}
.wc-spin{animation:wc-spin 1.1s linear infinite;transform-origin:50% 50%}
@keyframes wc-spin{to{transform:rotate(360deg)}}

/* the one authored moment: the pane wipes open from the rail, rows lift in behind it */
.wc-root[data-enter="1"] .wc-pane{animation:wc-pane-wipe .3s var(--panel-ease-out) both}
@keyframes wc-pane-wipe{0%{opacity:0;clip-path:inset(-12px 100% -12px -12px)}to{opacity:1;clip-path:inset(-12px)}}
.wc-root[data-enter="1"] .wc-stag{animation:wc-lift .26s var(--cursor-easing-out-quint) both;
  animation-delay:calc(90ms + var(--i,0) * 26ms)}
@keyframes wc-lift{0%{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.wc-root[data-enter="1"] .wc-log-row.wc-flash{animation:wc-anchor 1.6s var(--cursor-easing-out) both}
@keyframes wc-anchor{0%,40%{background-color:color-mix(in srgb,var(--sand-blue) 16%,var(--sand-fill-bubble-agent))}
  to{background-color:var(--sand-fill-bubble-agent)}}
.wc-dot-live{width:6px;height:6px;border-radius:var(--cursor-radius-full);background:var(--sand-success);flex:0 0 auto;
  animation:wc-breathe 2.4s var(--cursor-easing-in-out,ease-in-out) infinite}
@keyframes wc-breathe{0%,to{opacity:1}50%{opacity:.4}}

@media (prefers-reduced-motion: reduce){
  .wc-scope{--ui-press-scale:1}
  .wc-root[data-enter="1"] .wc-pane,.wc-root[data-enter="1"] .wc-stag,.wc-log-row.wc-flash,.wc-skel,.wc-dot-live,.wc-spin{animation:none}
  .wc-root[data-enter="1"] .wc-pane{clip-path:none;opacity:1}
  .wc-scope *{transition-duration:1ms !important}
  .wc-item-act{opacity:1}
}

/* ---------------------------------------------------------------- bot swarm */
.wc-avatar{flex:0 0 auto;width:var(--cursor-height-sm);height:var(--cursor-height-sm);border-radius:var(--cursor-radius-base);
  display:grid;place-items:center;font-size:14px;line-height:1;background:var(--sand-bg-secondary);
  box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent)}
.wc-avatar[data-direct="1"]{background:var(--sand-bg-active)}
.wc-rail-group{display:flex;flex-direction:column;gap:1px;min-height:0}
.wc-rail-scroll{overflow:auto;min-height:0;display:flex;flex-direction:column;gap:var(--sp-3);padding-bottom:var(--sp-2)}
.wc-row-sub{font-size:var(--sand-font-size-xxs);line-height:var(--sand-line-height-xxs);color:var(--sand-text-secondary);
  font-variant-numeric:tabular-nums}
.wc-live{width:6px;height:6px;border-radius:var(--cursor-radius-full);background:var(--sand-success);flex:0 0 auto}
.wc-live[data-idle="1"]{background:var(--sand-text-quaternary)}
.wc-transcript{display:flex;flex-direction:column;gap:var(--sp-2);max-width:72ch}
.wc-msg{display:flex;flex-direction:column;gap:var(--sp-1);padding:var(--sp-2) var(--sp-3);
  border-radius:var(--cursor-radius-xl);background:var(--sand-fill-bubble-agent);align-self:flex-start;max-width:100%}
.wc-msg[data-mine="1"]{align-self:flex-end;background:var(--sand-fill-bubble-user);color:var(--sand-text-on-primary);
  border-end-end-radius:var(--cursor-radius-sm)}
.wc-msg[data-mine="1"] .wc-msg-when{color:color-mix(in srgb,var(--sand-text-on-primary) 70%,transparent)}
.wc-msg-head{display:flex;align-items:center;gap:var(--sp-2);min-width:0}
.wc-msg-text{margin:0;font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);
  white-space:pre-wrap;overflow-wrap:anywhere}
.wc-msg-when{margin-left:auto;font-size:var(--sand-font-size-xxs);color:var(--sand-text-secondary);font-variant-numeric:tabular-nums}
.wc-mention{display:inline-flex;align-items:center;padding:0 5px;border-radius:var(--cursor-radius-sm);
  background:color-mix(in srgb,var(--sand-blue) 14%,transparent);color:var(--sand-text-blue);font-weight:500}
.wc-msg[data-mine="1"] .wc-plate{background:color-mix(in srgb,var(--sand-text-on-primary) 18%,transparent);color:var(--sand-text-on-primary)}
.wc-msg[data-mine="1"] .wc-mention{background:color-mix(in srgb,var(--sand-text-on-primary) 18%,transparent);color:var(--sand-text-on-primary)}
.wc-clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden}
.wc-clamp[data-open="1"]{-webkit-line-clamp:unset;display:block}
.wc-runs{display:flex;flex-direction:column;gap:var(--sp-1);border-radius:var(--cursor-radius-lg);padding:var(--sp-1);
  background:var(--sand-bg-quaternary);box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent)}
.wc-run{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;gap:var(--sp-2);
  padding:var(--sp-1) var(--sp-2);border-radius:var(--sand-menu-row-radius);font-size:var(--sand-font-size-xs)}
.wc-run:hover{background:var(--sand-bg-hover)}
.wc-run-prompt{font-family:var(--wc-mono);font-size:var(--sand-font-size-xxs);color:var(--sand-text-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-kv{display:grid;grid-template-columns:minmax(96px,auto) minmax(0,1fr);gap:var(--sp-1) var(--sp-3);
  font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm)}
.wc-kv dt{color:var(--sand-text-secondary)}
.wc-kv dd{margin:0;font-family:var(--wc-mono);font-size:var(--sand-font-size-xs);overflow-wrap:anywhere}
.wc-persona{margin:var(--sp-2) 0 0;padding:var(--sp-3);border-radius:var(--cursor-radius-lg);white-space:pre-wrap;
  background:var(--sand-bg-quaternary);box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent);
  font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-base);color:var(--sand-text-secondary);
  max-height:340px;overflow:auto}

/* composer: the app's own geometry — 44px tall, radius 18, a 28px send that presses to .94 */
.wc-compose{position:sticky;bottom:0;display:flex;align-items:flex-end;gap:var(--sp-2);
  padding:var(--sp-3) var(--sp-6) var(--sp-4);background:linear-gradient(to top,var(--sand-bg-pane) 62%,transparent)}
.wc-composer{flex:1;min-width:0;display:flex;align-items:flex-end;gap:var(--sp-2);min-height:44px;
  padding:var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);border-radius:var(--cursor-radius-4xl);
  background:var(--sand-bg-pane);box-shadow:inset 0 0 0 .5px var(--sand-border-secondary-translucent),var(--sand-box-shadow-sm);
  transition:box-shadow var(--cursor-duration-slow) var(--cursor-easing-default),clip-path .26s var(--panel-ease-out)}
.wc-composer:focus-within{box-shadow:inset 0 0 0 1px var(--sand-border-focus-primary),var(--sand-box-shadow-popup)}
.wc-composer textarea{flex:1;min-width:0;border:0;background:transparent;resize:none;outline:none;
  font-family:inherit;font-size:var(--sand-font-size-base);line-height:var(--sand-line-height-base);
  color:var(--sand-text-primary);caret-color:var(--sand-text-primary);max-height:160px;padding:2px 0}
.wc-composer textarea::placeholder{color:var(--sand-text-secondary)}
.wc-send{width:var(--cursor-height-lg);height:var(--cursor-height-lg);border-radius:var(--cursor-radius-full);
  display:grid;place-items:center;border:0;cursor:pointer;flex:0 0 auto;
  background:var(--sand-bg-primary);color:var(--sand-text-on-primary);
  transition:transform .12s var(--panel-ease-out),opacity .15s ease,background-color var(--cursor-duration-normal) var(--cursor-easing-default)}
.wc-send:hover{background:var(--sand-bg-primary-hover)}
.wc-send:active{transform:scale(.94)}
.wc-send[disabled]{opacity:.35;cursor:default;transform:none}
.wc-compose-hint{font-size:var(--sand-font-size-xxs);color:var(--sand-text-secondary);align-self:center}

/* forms */
.wc-form{display:flex;flex-direction:column;gap:var(--sp-3);max-width:62ch}
.wc-form h2{font-size:var(--sand-font-size-xl);line-height:var(--sand-line-height-xl);letter-spacing:var(--sand-letter-spacing-xl)}
.wc-scope input[type=checkbox]{accent-color:var(--sand-text-primary);width:14px;height:14px;margin:0}
.wc-field{display:flex;flex-direction:column;gap:var(--sp-1)}
.wc-field label{font-size:var(--sand-font-size-xs);line-height:var(--sand-line-height-xs);color:var(--sand-text-secondary)}
.wc-field input[type=text],.wc-field textarea,.wc-field select{
  border-radius:var(--cursor-radius-base);border:.5px solid var(--sand-border-secondary-translucent);
  background:var(--sand-bg-pane);color:var(--sand-text-primary);padding:var(--sp-1-5) var(--sp-2);
  font-family:inherit;font-size:var(--sand-font-size-sm);line-height:var(--sand-line-height-sm);
  transition:border-color var(--cursor-duration-normal) var(--cursor-easing-default),box-shadow var(--cursor-duration-normal) var(--cursor-easing-default)}
.wc-field textarea{min-height:120px;resize:vertical;font-family:var(--wc-mono);font-size:var(--sand-font-size-xs);line-height:17px}
.wc-field input:focus-visible,.wc-field textarea:focus-visible{outline:none;border-color:var(--sand-border-focus-primary);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--sand-blue) 22%,transparent)}
.wc-check{display:flex;align-items:center;gap:var(--sp-2);font-size:var(--sand-font-size-sm);color:var(--sand-text-primary)}
.wc-answer{display:flex;gap:var(--sp-2);align-items:flex-end;margin-top:var(--sp-2)}
.wc-answer .wc-btn{flex:0 0 auto}
.wc-steer input{flex:1;min-width:120px;height:var(--cursor-height-base);padding:0 var(--sp-2);border-radius:var(--cursor-radius-base);border:.5px solid var(--sand-border-secondary-translucent);background:var(--sand-bg-pane);color:var(--sand-text-primary);font:inherit;font-size:var(--sand-font-size-xs)}
.wc-steer input:focus-visible{outline:none;border-color:var(--sand-border-focus-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--sand-blue) 22%,transparent)}
.wc-members{display:flex;flex-direction:column;gap:var(--sp-1);padding:var(--sp-2);border-radius:var(--cursor-radius-base);background:var(--sand-bg-quaternary);box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent);max-height:220px;overflow:auto}
.wc-members .wc-check{padding:var(--sp-1) var(--sp-1-5);border-radius:var(--cursor-radius-sm);cursor:pointer}
.wc-members .wc-check:hover{background:var(--sand-bg-hover)}
.wc-members .wc-avatar{width:20px;height:20px;font-size:12px}
.wc-form-act{display:flex;align-items:center;gap:var(--sp-2);margin-top:var(--sp-1)}
.wc-err{font-size:var(--sand-font-size-xs);color:var(--sand-text-danger)}

/* ---------------------------------------------------------------- density + states
   Component tokens first, so nothing below hardcodes a size. Values follow the target's own
   scale (menu row 30, search row 32, base type 14/20, menu radius 12) — not a generic kit. */
.wc-scope{
  --ui-row-h:var(--sand-menu-row-height);
  --ui-row-radius:var(--sand-menu-row-radius);
  --ui-msg-size:var(--sand-font-size-base);
  --ui-msg-line:var(--sand-line-height-base);
  --ui-msg-pad-y:var(--sp-2);
  --ui-msg-pad-x:var(--sp-3);
  --ui-msg-measure:62ch;
  --ui-head-h:52px;
}
.wc-msg{padding:var(--ui-msg-pad-y) var(--ui-msg-pad-x);max-width:min(100%,var(--ui-msg-measure))}
.wc-msg-text{font-size:var(--ui-msg-size);line-height:var(--ui-msg-line)}
.wc-msg-when{font-variant-numeric:tabular-nums}
.wc-pane-body{scroll-padding-top:calc(var(--ui-head-h) + var(--sp-2))}
/* every control ships default/hover/active/disabled/focus, in that priority */
.wc-file:disabled,.wc-btn:disabled,.wc-send:disabled,.wc-row-link:disabled{opacity:.4;cursor:not-allowed;transform:none}
.wc-toggle:disabled{opacity:.4;cursor:not-allowed}
.wc-crumb button:active{transform:scale(var(--ui-press-scale))}
.wc-crumb button:disabled{opacity:.4;cursor:default;transform:none}
.wc-msg:hover{background:color-mix(in srgb,var(--sand-fill-bubble-agent) 70%,var(--sand-bg-hover))}
.wc-msg[data-mine="1"]:hover{background:color-mix(in srgb,var(--sand-ink) 88%,var(--sand-paper))}
.wc-field input:disabled,.wc-field textarea:disabled{opacity:.5;cursor:not-allowed}
/* markdown inside a bubble: paragraphs breathe, lists indent, code keeps its own surface */
.wc-msg-text p.wc-md-p{margin:0}
.wc-msg-text p.wc-md-p + p.wc-md-p{margin-top:var(--sp-1-5)}
.wc-md-gap{height:var(--sp-1-5)}
.wc-md-head{font-weight:600;margin:var(--sp-1) 0 0}
.wc-msg-text ul,.wc-msg-text ol{margin:var(--sp-1) 0;padding-inline-start:var(--sp-5)}
.wc-msg-text li{margin:2px 0}
.wc-attach{display:flex;flex-wrap:wrap;gap:var(--sp-1);margin-top:var(--sp-1)}
.wc-attach-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 6px;border-radius:var(--cursor-radius-sm);background:var(--sand-bg-secondary);font-size:var(--sand-font-size-xxs);color:var(--sand-text-secondary)}
.wc-attach-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-attach-chip em{font-style:normal;color:var(--sand-text-tertiary)}
.wc-msg[data-mine="1"] .wc-attach-chip{background:color-mix(in srgb,var(--sand-text-on-primary) 16%,transparent);color:inherit}
.wc-inline-code{font-family:var(--wc-mono);font-size:.92em;padding:1px 4px;border-radius:var(--cursor-radius-sm);
  background:var(--sand-bg-secondary);color:var(--sand-text-primary)}
.wc-msg[data-mine="1"] .wc-inline-code{background:color-mix(in srgb,var(--sand-text-on-primary) 16%,transparent);color:inherit}

/* room list: an unread room leans forward, a quiet one recedes */
.wc-row-link .wc-row-label{transition:color var(--cursor-duration-fast) var(--cursor-easing-default)}
.wc-row-link:hover .wc-row-label{color:var(--sand-text-primary)}
/* loading drift: one authored shimmer, never a spinner per row */
.wc-skel-row{height:56px}
@media (min-width:1100px){
  .wc-pane-body{padding:var(--sp-6) var(--sp-10) var(--sp-10)}
  .wc-transcript{gap:var(--sp-2-5)}
}

/* context menu + dialog: the bot settings live here, not in the transcript */
.wc-menu{position:fixed;z-index:10000;min-width:180px;padding:var(--sp-1);border-radius:var(--sand-menu-radius);
  background:var(--sand-bg-pane);box-shadow:inset 0 0 0 .5px var(--sand-border-secondary-translucent),var(--sand-box-shadow-popup);
  transform-origin:0 0;animation:wc-menu-in .12s var(--cursor-easing-out-quint) both}
@keyframes wc-menu-in{0%{opacity:0;transform:scale(.96) translateY(-2px)}to{opacity:1;transform:none}}
.wc-menu-head{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-1) var(--sp-2) var(--sp-1-5);
  font-size:var(--sand-font-size-xs);color:var(--sand-text-secondary)}
.wc-menu-item{display:flex;align-items:center;gap:var(--sp-2);width:100%;height:var(--sand-menu-row-height);
  padding:0 var(--sp-2);border:0;border-radius:var(--sand-menu-row-radius);background:transparent;color:var(--sand-text-primary);
  font:inherit;font-size:var(--sand-font-size-sm);text-align:start;cursor:pointer;
  transition:background-color var(--cursor-duration-fast) var(--cursor-easing-default)}
.wc-menu-item:hover{background:var(--sand-bg-hover)}
.wc-menu-item[data-tone="danger"]{color:var(--sand-text-danger)}
.wc-menu-item[data-tone="danger"]:hover{background:var(--sand-bg-danger)}
.wc-scrim{position:fixed;inset:0;z-index:9999;display:grid;place-items:start center;padding:8vh var(--sp-4) var(--sp-4);
  background:color-mix(in srgb,var(--sand-ink) 24%,transparent);animation:wc-fade .15s var(--cursor-easing-default) both}
@keyframes wc-fade{0%{opacity:0}to{opacity:1}}
.wc-dialog{width:min(720px,100%);max-height:84vh;display:flex;flex-direction:column;border-radius:var(--cursor-radius-xl);
  background:var(--sand-bg-pane);box-shadow:inset 0 0 0 .5px var(--sand-border-secondary-translucent),var(--sand-box-shadow-popup);
  animation:wc-dialog-in .18s var(--cursor-easing-out-quint) both}
@keyframes wc-dialog-in{0%{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
.wc-dialog-head{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);
  border-bottom:.5px solid var(--sand-border-quaternary-translucent)}
.wc-dialog-head h2{margin:0;flex:1;min-width:0}
.wc-dialog-body{min-height:0;overflow:auto;padding:var(--sp-4)}
/* ---------------------------------------------------------------- entry + responsive */
.wc-entry{display:flex;align-items:center;gap:var(--sp-2, 8px);width:100%}
.wc-globe{flex:0 0 auto;color:var(--sand-icon-secondary, currentColor)}
@media (max-width:820px){
  /* single column: the rail becomes a horizontal strip that scrolls, never a squeezed column */
  .wc-app{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .wc-rail{flex-direction:row;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);
    border-right:0;border-bottom:.5px solid var(--sand-border-quaternary-translucent);overflow-x:auto;overflow-y:hidden}
  .wc-rail > .wc-rail-head{display:none}
  .wc-machine{flex:0 0 auto;max-width:200px}
  .wc-rail-scroll{flex-direction:row;align-items:center;gap:var(--sp-3);overflow:visible;padding-bottom:0}
  .wc-rail-group{flex:0 0 auto}
  .wc-rail-foot{margin-top:0;flex:0 0 auto;flex-direction:row;align-items:center;gap:var(--sp-2)}
  .wc-row-link{width:auto;height:var(--cursor-height-base);padding:0 var(--sp-2);white-space:nowrap}
  .wc-rows{flex-direction:row;flex-wrap:nowrap}
  .wc-pane-body{padding:var(--sp-4) var(--sp-4) var(--sp-8)}
  .wc-pane-head{padding:var(--sp-2) var(--sp-4)}
  .wc-pane-head [data-autonomy-hint]{display:none}
}
@media (max-width:560px){
  .wc-machine-sub{display:none}
  .wc-banner{grid-template-columns:minmax(0,1fr)}
  .wc-item-top{flex-wrap:wrap}
  .wc-when{margin-inline-start:0;order:3;width:100%}
  .wc-log-row{grid-template-columns:auto minmax(0,1fr)}
  .wc-log-exit{grid-column:2}
}
`;

function ensureStyle() {
  if (typeof document === 'undefined' || !document.createElement) return;
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    el.setAttribute('data-plugin', NS);
    document.head?.appendChild(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
}

// keyboard-nav gating, same rule the app ships: a ring only after a real Tab.
function useKeyboardNav(ref) {
  useEffect(() => {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    const onKey = e => { if (e.key === 'Tab') ref.current?.setAttribute('data-kbd', '1'); };
    const onPointer = () => ref.current?.removeAttribute('data-kbd');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [ref]);
}

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
const ICONS = {
  globe: ['M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5Z', 'M1.75 8h12.5', 'M8 1.75c1.85 1.6 2.8 3.9 2.8 6.25S9.85 12.65 8 14.25c-1.85-1.6-2.8-3.9-2.8-6.25S6.15 3.35 8 1.75Z'],
  terminal: ['M2.2 3.4h11.6v9.2H2.2z', 'M4.6 6.4 6.4 8l-1.8 1.6', 'M8.2 9.8h3.2'],
  file: ['M4 1.9h5l3 3v9.2H4z', 'M9 1.9V5h3'],
  pencil: ['M2.9 13.1 4 10.2l6.8-6.8 2 2-6.8 6.8-1.1 1.1z', 'M10.8 3.4 12.6 5.2'],
  folder: ['M1.9 4h4l1.2 1.6h7v8.4h-12.2z'],
  shield: ['M8 1.8 13.4 3.6v4.2c0 3.1-2.2 5.3-5.4 6.4-3.2-1.1-5.4-3.3-5.4-6.4V3.6z', 'M5.9 8 7.4 9.5l3-3'],
  chat: ['M2.1 3.3h11.8v7.6H8.6L5.2 13.6v-2.7H2.1z'],
  timeline: ['M2.4 3.6h11.2', 'M2.4 8h7.6', 'M2.4 12.4h9.4'],
  bolt: ['M9.2 1.8 4.2 9h3.2l-.6 5.2L10.8 7H7.6z'],
  refresh: ['M13.2 8a5.2 5.2 0 1 1-1.6-3.7', 'M13.4 2.6v2.6h-2.6'],
  x: ['M4.2 4.2l7.6 7.6', 'M11.8 4.2 4.2 11.8'],
  chevron: ['M6.4 4.2 10.4 8l-4 3.8'],
  check: ['M3.2 8.4 6.4 11.4l6.4-6.8'],
  clock: ['M8 1.9a6.1 6.1 0 1 0 0 12.2A6.1 6.1 0 0 0 8 1.9Z', 'M8 4.6V8.2l2.4 1.6'],
  plug: ['M6 1.9v3.2', 'M10 1.9v3.2', 'M3.9 5.1h8.2v2.4a4.1 4.1 0 0 1-8.2 0z', 'M8 11.6v2.5'],
  dot: ['M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z'],
};
function icon(name, opts = {}) {
  const size = opts.size ?? 14;
  return h('svg', {
    className: ['wc-ico', opts.className].filter(Boolean).join(' '), width: size, height: size, viewBox: '0 0 16 16',
    'aria-hidden': 'true', focusable: 'false',
  }, (ICONS[name] ?? ICONS.dot).map((d, i) => h('path', { key: i, d, ...P })));
}

function useSnapshot(seed) {
  const [snap, setSnap] = useState(seed ?? null);
  // a first paint with no load behind it still knows why the channel is down: api() records it.
  // (No "endpoint() missing" branch: endpoint() always falls back to the well-known loopback port,
  // so such a branch could never fire — "not connected" is only ever a real failure.)
  const [err, setErr] = useState(() => (LAST_TRANSPORT_ERROR ? String(LAST_TRANSPORT_ERROR) : null));
  const [tick, setTick] = useState(0);
  const [at, setAt] = useState(null);
  const nonce = useRef(seed?.nonce ?? null);

  const load = useCallback(async () => {
    try {
      const s = await api('/snapshot');
      setSnap(s); setErr(null); setAt(new Date());
      if (s?.nonce) nonce.current = s.nonce;
    } catch (e) {
      setErr(e?.message ? String(e.message) : 'unreachable');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load, tick]);

  return { snap, err, at, reload: () => setTick(x => x + 1), nonce, setErr };
}

function IconBtn({ name, label, onClick, tone, spin }) {
  return h('button', {
    type: 'button', className: 'wc-btn wc-ico-btn', 'data-tone': tone ?? 'ghost', onClick,
    title: label, 'aria-label': label,
  }, icon(spin ? name : name, { className: spin ? 'wc-spin' : null, size: 15 }));
}

function Disclosure({ open, children }) {
  return h('div', { className: 'wc-disclosure', 'data-open': open ? '1' : '0', 'aria-hidden': !open },
    h('div', { className: 'wc-disclosure-in' }, children));
}

function ApprovalRow({ item, index, busy, onVerdict }) {
  const [open, setOpen] = useState(false);  const args = item.args ?? {};
  const hasArgs = Object.keys(args).length > 0;
  const preview = useMemo(() => {
    const flat = Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join('  ');
    return flat.length > 72 ? flat.slice(0, 72) + '…' : flat;
  }, [args]);

  return h('li', { className: 'wc-item wc-stag', style: { '--i': index }, key: item.approvalId },
    h('div', { className: 'wc-item-top' },
      h('span', { className: 'wc-plate' }, icon('bolt', { size: 11 }), t('kind_pending')),
      h('span', { className: 'wc-item-title' },
        icon(ACTION_ICON[item.action] ?? 'terminal', { size: 15 }),
        h('span', { className: 'wc-mono' }, item.action)),
      h('span', { className: 'wc-id', title: item.approvalId }, item.approvalId),
      h('time', { className: 'wc-when', dateTime: item.createdAt }, relTime(item.createdAt))),
    hasArgs ? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' } },
      h('button', {
        type: 'button', className: 'wc-toggle', 'aria-expanded': open, onClick: () => setOpen(o => !o),
      }, icon('chevron'), h('span', null, open ? t('hide') : t('details'))),
      h('span', { className: 'wc-mono', style: { color: 'var(--sand-text-secondary)', fontSize: 'var(--sand-font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto', textAlign: 'end' } }, preview)) : null,
    hasArgs ? h(Disclosure, { open }, h('pre', { className: 'wc-code wc-scroll' }, JSON.stringify(args, null, 2))) : null,
    h('div', { className: 'wc-item-act' },
      h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'primary', disabled: !!busy,
        onClick: (e) => onVerdict(item.approvalId, 'allow-once', e),
      }, busy ? icon('clock', { className: 'wc-spin' }) : icon('check'), busy ? t('action_pending') : t('allow')),
      h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'accent', disabled: !!busy,
        onClick: (e) => onVerdict(item.approvalId, 'always', e),
      }, icon('shield'), t('always')),
      h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'danger', disabled: !!busy,
        onClick: (e) => onVerdict(item.approvalId, 'deny', e),
      }, icon('x'), t('deny'))));
}

function GrantRow({ action, index, onRevoke }) {
  return h('li', { className: 'wc-grant-row wc-stag', style: { '--i': index }, key: action },
    h('span', { className: 'wc-mono' }, action),
    h('span', { className: 'wc-plate', 'data-tone': 'muted' }, t('always')),
    h(IconBtn, { name: 'x', label: `${t('revoke')} ${action}`, onClick: (e) => onRevoke(action, e) }));
}

const KIND_TONE = { executed: 'ok', responded: null, revoked: 'warn', denied: 'danger' };
const MINE_KINDS = new Set(['responded', 'denied', 'revoked']);
function LogRow({ a, index, flash }) {
  const verdict = a.verdict ? ({ 'allow-once': t('allow'), always: t('always'), deny: t('deny') })[a.verdict] : null;
  const label = t('kind_' + (a.kind ?? 'executed').replace(/-/g, '_')) || a.kind;
  const detail = a.command ?? verdict ?? '';
  return h('li', {
    className: 'wc-log-row wc-stag' + (flash ? ' wc-flash' : ''), style: { '--i': index },
    'data-mine': MINE_KINDS.has(a.kind) ? '1' : '0',
    key: `${a.at ?? ''}-${a.approvalId ?? a.action ?? ''}-${index}`,
  },
    h('span', { className: 'wc-plate', 'data-tone': KIND_TONE[a.kind] ?? null }, label),
    h('span', { className: 'wc-log-main' },
      h('span', { className: 'wc-mono', style: { flex: '0 0 auto' } }, a.action ?? ''),
      detail ? h('span', { className: 'wc-log-cmd', title: String(detail) }, String(detail)) : null),
    h('span', { className: 'wc-log-exit' },
      a.exitCode !== undefined && a.exitCode !== null ? `${t('exit')} ${a.exitCode}` : relTime(a.at)));
}

function Section({ id, title, count, children, i }) {
  return h('section', { className: 'wc-col wc-sec-id', id, 'aria-labelledby': `${id}-h`, style: { '--i': i } },
    h('div', { className: 'wc-sec-head wc-stag', style: { '--i': i } },
      h('h2', { className: 'wc-sec-title', id: `${id}-h` }, title),
      h('span', { className: 'wc-sec-meta' }, count)),
    children);
}

function useBrowse(initial) {
  const [dir, setDir] = useState(initial ?? null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(async (p) => {
    try { const d = await api('/browse' + (p ? '?path=' + encodeURIComponent(p) : '')); setData(d); setErr(d.error ?? null); }
    catch (e) { setErr(String(e?.message || e)); }
  }, []);
  useEffect(() => { load(dir); }, [dir, load]);
  return { dir, data, err, go: setDir };
}

const dur = (ms) => { if (!Number.isFinite(ms) || ms < 0) return ''; const s = Math.round(ms / 1000); if (s < 60) return s + "s"; const m = Math.floor(s / 60); return m + "m" + (s % 60 ? " " + (s % 60) + "s" : ""); };
const human = n => n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

function MachineZone({ roots, i }) {
  const [start, setStart] = useState(roots?.[0] ?? null);
  const browse = useBrowse(start);
  const d = browse.data;
  useEffect(() => { if (roots?.[0] && start === null) setStart(roots[0]); }, [roots, start]);

  return h('div', { className: 'wc-col', style: { '--i': i } },
    h('div', { className: 'wc-roots wc-stag', style: { '--i': i } },
      (roots ?? []).map((r, k) => h('button', {
        key: r, type: 'button', className: 'wc-btn', 'data-tone': d?.path === r ? 'primary' : 'secondary',
        onClick: () => browse.go(r),
      }, icon('folder', { size: 13 }), r.split(/[\\/]/).filter(Boolean).pop() || r))),
    h('div', { className: 'wc-crumb wc-stag', style: { '--i': i } },
      d?.parent ? h('button', { type: 'button', onClick: () => browse.go(d.parent), 'aria-label': '..' }, icon('chevron', { size: 12, style: { transform: 'rotate(180deg)' } })) : null,
      h('span', { className: 'wc-mono', style: { fontSize: 'var(--sand-font-size-xs)', color: 'var(--sand-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' } }, d?.path ?? '…')),
    browse.err && !d?.entries?.length ? h('div', { className: 'wc-empty' }, icon('plug', { size: 15 }), browse.err) : null,
    !d ? h('div', { className: 'wc-col' }, h('div', { className: 'wc-skel wc-skel-line' }),
      h('div', { className: 'wc-skel wc-skel-line', style: { width: '70%' } })) : null,
    d ? h('div', { className: 'wc-files wc-scroll' },
      d.entries.length
        ? d.entries.map(f => h('button', {
          key: f.path, type: 'button', className: 'wc-file', 'data-dir': f.dir ? '1' : '0',
          onClick: f.dir ? () => browse.go(f.path) : undefined, title: f.path,
        }, icon(f.dir ? 'folder' : 'file', { size: 14 }),
          h('span', null, f.name), h('em', null, f.dir ? '' : human(f.size))))
        : h('div', { className: 'wc-file' }, h('span', null, t('empty_dir')))) : null);
}

// The swarm is reached the same way the shipped Bots panel reaches it: through the Client-callable
// Host remote. The loopback endpoint stays for the local-computer half, which has no remote.
let REMOTE = null;
function setRemote(r) { REMOTE = r || null; }
// The remote's snapshot() and the loopback projection are NOT the same shape: the remote carries
// `avatar.seed`, `room.taskState.assignments` and a top-level `unread` map, while the page reads
// `avatar`, `room.assignments` and `room.unread`. Without this, a working ctx.remote would still
// render an empty BOT group. Idempotent, so applying it to the already-projected loopback payload is a no-op.
const ACTIVE_RUN = new Set(['queued','claimed','running','summarizing']);
const isLiveRun = (r) => ACTIVE_RUN.has(String(r.status || '').toLowerCase())
  && !r.finishedAt
  && (!r.leaseExpiresAt || Date.parse(r.leaseExpiresAt) > Date.now());

function normalizeCommunity(raw) {
  if (!raw || raw.available === false) return raw ? { available: false, reason: raw.reason } : null;
  const unread = raw.unread ?? {};
  const bots = (raw.bots ?? []).map(b => ({
    ...b,
    avatar: typeof b.avatar === 'string' ? b.avatar : (b.avatar?.seed ?? ''),
    memoryNamespace: b.memoryNamespace ?? b.profile?.memoryNamespace ?? '',
    profileId: b.profileId ?? b.profile?.profileId ?? '',
    mentionOnly: b.mentionOnly ?? false,
    protected: !!b.protected,
    rank: b.rank ?? '',
    domain: b.domain ?? '',
  }));
  const rooms = (raw.rooms ?? []).map(r => {
    const ts = r.taskState ?? null;
    const assignments = (r.assignments ?? ts?.assignments ?? []).map(a => ({
      id: a.id, botId: a.botId ?? a.assigneeId, task: a.task ?? a.subject ?? '', status: a.status ?? null,
      round: a.round, report: a.report?.text ?? a.report ?? null,
    }));
    return {
      ...r, assignments,
      connection: typeof r.connection === 'string' ? r.connection : (r.connection?.kind ?? r.connection?.status ?? ''),
      objective: r.objective ?? ts?.objective ?? null,
      round: r.round ?? ts?.round ?? 0, maxRounds: r.maxRounds ?? ts?.maxRounds ?? 0,
      finished: r.finished ?? ts?.finished?.report ?? null,
      unread: r.unread ?? unread[r.id] ?? 0,
      notices: (r.notices ?? []).map(n => (typeof n === 'string' ? { text: n } : n)),
      memberIds: r.memberIds ?? [],
      team: r.team ? {
        leaderId: r.team.leader?.botId ?? r.team.leaderId ?? null,
        leaderName: r.team.leaderName ?? null,
        status: r.team.status ?? null,
      } : null,
    };
  });
  const runs = (raw.runs ?? []).map(r => ({
    ...r,
    running: r.running ?? isLiveRun(r),
    controlRevision: r.controlRevision ?? r.revision ?? 0,
  }));
  const memories = raw.memories ?? raw.botMemories ?? [];
  const approvals = (raw.approvals ?? []).map(a => ({
    id: a.id, roomId: a.roomId, memberName: a.memberName ?? '', toolName: a.toolName ?? '',
    reason: a.reason ?? '', args: a.args ?? a.reason ?? '', risk: a.risk ?? 'reversible',
    argsTruncated: !!a.argsTruncated, createdAt: a.createdAt ?? '', sessionId: a.sessionId,
  }));
  return {
    ...raw, available: true, bots, rooms, runs, memories,
    proposals: raw.proposals ?? raw.pendingGroupProposals ?? raw.groupProposals ?? [],
    approvals,
    questions: raw.questions ?? [],
    tasks: raw.tasks ?? rooms.flatMap(r => (r.assignments ?? []).map(a => ({ ...a, roomId: r.id, roomName: r.name }))),
  };
}

async function community() {
  // Loopback first: it is the path this build is verified against end to end. The remote stays as
  // the fallback for a host that could only bind an ephemeral port, where loopback is unreachable.
  if (endpoint()) {
    try {
      const r = await api('/community');
      const n = normalizeCommunity(r);
      // approvals/questions only exist in the service's memory; /live reads that same ledger
      const live = await api('/live').catch(() => null);
      if (n && live) {
        const byId = new Map((n.approvals ?? []).map(a => [a.id, a]));
        for (const a of live.approvals ?? []) if (a?.id && !byId.has(a.id)) byId.set(a.id, a);
        n.approvals = [...byId.values()];
        n.questions = live.questions ?? n.questions ?? [];
      }
      if (n) return { ...n, source: 'loopback' };
    } catch { /* fall through to the remote */ }
  }
  if (REMOTE?.agentCommunity) {
    try {
      const n = normalizeCommunity(await REMOTE.agentCommunity.snapshot());
      if (n?.bots?.length || n?.rooms?.length) return { ...n, source: 'remote' };
    } catch { }
  }
  return null;
}
async function communityAct(kind, payload) {
  // Same ordering as reads: the verified path first. A remote call that fails after the host
  // already acted would be unretryable, so it is only used when loopback is unreachable.
  if (endpoint()) {
    const attempt = () => api('/act', { kind, payload, nonce: takeNonce() });
    try { return await attempt(); }
    catch (e) {
      // A tab left idle holds an expired nonce. A nonce rejection means nothing executed, so
      // taking one fresh read (which mints a new nonce for the app origin) and retrying once is
      // safe — and it stops a first press after a pause from looking like a broken send.
      if (/nonce/i.test(String(e?.message || ''))) {
        try {
          const fresh = await api('/community');
          if (fresh?.nonce) PENDING_NONCE = fresh.nonce;
          return await attempt();
        } catch (e2) { if (!REMOTE?.agentCommunity?.[kind]) throw e2; }
      } else if (!REMOTE?.agentCommunity?.[kind]) throw e;
    }
  }
  if (REMOTE?.agentCommunity?.[kind]) return await REMOTE.agentCommunity[kind](payload ?? {});
  throw new Error('no host channel for ' + kind);
}
let PENDING_NONCE = null;
const takeNonce = () => { const n = PENDING_NONCE; PENDING_NONCE = null; return n; };

// Fire-and-forget self-report. The loopback channel is only reachable when the webview was handed
// the endpoint, which is exactly the thing in question — so always log to the console too, which
// works regardless and is what makes "did the client half mount?" answerable in devtools.
function report(info) {
  try { console.log('[' + NS + '] client mount report', JSON.stringify(info)); } catch { }
  try {
    const ep = endpoint();
    if (!ep) return;
    fetch(ep.url + '/client-hello', {
      method: 'POST', headers: { 'x-local-computer-token': ep.token, 'content-type': 'application/json' },
      body: JSON.stringify(info),
    }).catch(() => { });
  } catch { }
}

function useCommunity() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const d = await community();
      if (!live) return;
      if (d?.nonce) PENDING_NONCE = d.nonce;
      setData(d);
      setErr(d?.available === false ? 'unavailable' : d ? null : 'no-source');
    };
    load();
    // match the shipped panel's cadence: fast while a run is live, quiet when nothing moves
    let timer = null;
    const schedule = () => {
      const live = (data?.runs ?? []).some(r => !r.finishedAt && r.status !== 'completed' && r.status !== 'cancelled');
      timer = setTimeout(async () => { await load(); schedule(); }, live ? 400 : 1500);
    };
    timer = setTimeout(schedule, 1500);
    return () => { live = false; clearTimeout(timer); };
  }, []);
  return { data, err, reload: () => community().then(setData) };
}

// @-mentions are how bots hand work to each other, so they render as first-class chips
// A deliberately small Markdown subset: the bots answer in Markdown, and rendering it as plain
// text leaked ** and - into the transcript. Everything is a React text node, so nothing injects.
function inlineMd(text, names, keyBase) {
  const nodes = [];
  const src = '(`[^`]+`)|(\\*\\*[^*]+\\*\\*)|(@(?:' +
    (names.length ? names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') : '\u0000') + '))';
  const re = new RegExp(src, 'g');
  let last = 0, m, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(h('code', { key: keyBase + '-c' + (n++), className: 'wc-inline-code' }, m[1].slice(1, -1)));
    else if (m[2]) nodes.push(h('strong', { key: keyBase + '-b' + (n++) }, m[2].slice(2, -2)));
    else nodes.push(h('span', { key: keyBase + '-m' + (n++), className: 'wc-mention' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MentionText({ text, names }) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(h(list.kind, { key: 'l' + blocks.length }, list.items)); list = null; } };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (bullet || ordered) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) { flush(); list = { kind, items: [] }; }
      list.items.push(h('li', { key: 'li' + i }, inlineMd((bullet || ordered)[1], names, 'i' + i)));
      return;
    }
    flush();
    if (!line.trim()) { blocks.push(h('div', { key: 'sp' + i, className: 'wc-md-gap' })); return; }
    if (heading) blocks.push(h('div', { key: 'h' + i, className: 'wc-md-head' }, inlineMd(heading[1], names, 'h' + i)));
    else blocks.push(h('p', { key: 'p' + i, className: 'wc-md-p' }, inlineMd(line, names, 'p' + i)));
  });
  flush();
  return h('div', { className: 'wc-msg-text' }, blocks);
  if (last < text.length) out.push(text.slice(last));
  return h('p', { className: 'wc-msg-text' }, ...out);
}

function Transcript({ messages, bots }) {
  const names = bots.map(b => b.name).filter(Boolean);
  const byId = Object.fromEntries(bots.map(b => [b.id, b]));
  const [open, setOpen] = useState({});
  if (!messages.length) return h('div', { className: 'wc-empty' }, icon('timeline', { size: 15 }), t('no_messages'));
  return h('div', { className: 'wc-transcript', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions text', 'aria-label': t('transcript') },
    messages.map((m, i) => {
      const mine = m.sender?.kind !== 'bot';
      const raw = mine ? (m.sender?.name || '') : (byId[m.sender?.botId]?.name || m.sender?.name || 'bot');
      const who = (raw === 'user' || raw === 'User') ? t('me') : (raw || t('me'));
      const long = (m.text || '').length > 420;
      // a turn's real files arrive as `deliverables` (path/name/size), not `attachments`
      const files = [...(m.attachments ?? []), ...(m.deliverables ?? [])].map(f => ({
        name: f.name || String(f.path || '').split(/[\\/]/).pop() || '?',
        size: f.size ?? null, title: f.description || f.path || f.mime || '',
      }));
      return h('article', {
        key: m.id ?? i, className: 'wc-msg wc-stag', 'data-mine': mine ? '1' : '0', style: { '--i': Math.min(i, 12) },
      },
        h('div', { className: 'wc-msg-head' },
          mine ? null : h('span', { className: 'wc-avatar', 'data-direct': '1' }, byId[m.sender?.botId]?.avatar || '🤖'),
          h('span', { className: 'wc-plate', 'data-tone': mine ? 'muted' : null }, who),
          h('span', { className: 'wc-msg-when' }, relTime(m.createdAt))),
        files.length ? h('div', { className: 'wc-attach' }, files.map((f, k) => h('span', {
          key: k, className: 'wc-attach-chip', title: f.title,
        }, icon('file', { size: 12 }), h('span', null, f.name), h('em', null, f.size ? human(f.size) : '')))) : null,
        h('div', { className: 'wc-clamp', 'data-open': open[m.id] ? '1' : '0' },
          h(MentionText, { text: m.text || '', names })),
        long ? h('button', { type: 'button', className: 'wc-toggle', 'aria-expanded': !!open[m.id],
          onClick: () => setOpen(o => ({ ...o, [m.id]: !o[m.id] })) }, open[m.id] ? t('hide') : t('show_all')) : null);
    }));
}

const STATUS_KEY = { completed: 'st_done', failed: 'st_failed', cancelled: 'st_cancelled', queued: 'st_queued', running: 'st_running', summarizing: 'st_running', interrupted: 'st_interrupted' };
const statusLabel = (s) => { const k = STATUS_KEY[String(s || '').toLowerCase()]; return k ? t(k) : (s || '—'); };
const RUN_TONE = { completed: 'ok', running: null, failed: 'danger', cancelled: 'warn', queued: 'muted' };
// live: how long it has been going; finished: how long it took. Both from real timestamps.
function runTime(r) {
  const start = Date.parse(r.startedAt ?? r.createdAt ?? '');
  if (!Number.isFinite(start)) return relTime(r.createdAt);
  const end = r.finishedAt ? Date.parse(r.finishedAt) : Date.now();
  const span = dur(end - start);
  return r.finishedAt ? span : (span ? span + '…' : '');
}

function RunRow({ r, byId, onControl }) {
  const origin = r.origin === 'a2a' ? t('a2a') : (r.origin === 'routine' ? t('routine') : t('from_user'));
  const who = byId[r.botId]?.name ?? String(r.botId ?? '').slice(0, 6);
  // a raw run object carries no running flag; derive it so both shapes behave the same
  const isLive = r.running == null ? isLiveRun(r) : !!r.running;
  const canCancel = isLive && onControl;
  const canRetry = !isLive && ['failed', 'cancelled'].includes(r.status) && onControl;
  const [steering, setSteering] = useState(false);
  const [text, setText] = useState('');
  const sendSteer = () => {
    const v = text.trim();
    if (!v) { setSteering(false); return; }
    onControl({ id: r.id, action: 'steer', text: v, expectedRevision: r.controlRevision ?? 0 });
    setText(''); setSteering(false);
  };
  const buttons = steering
    ? h('span', { className: 'wc-item-act wc-steer' },
      h('input', {
        type: 'text', autoFocus: true, value: text, placeholder: t('steer_ph'),
        'aria-label': t('steer'),
        onChange: e => setText(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter') sendSteer(); if (e.key === 'Escape') { setSteering(false); setText(''); } },
      }),
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: sendSteer, disabled: !text.trim() }, t('send')),
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => { setSteering(false); setText(''); } }, t('cancel')))
    : h('span', { className: 'wc-item-act' },
      canCancel ? h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'accent',
        onClick: () => setSteering(true),
      }, t('steer')) : null,
      canCancel ? h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'danger',
        onClick: () => onControl({ id: r.id, action: 'cancel', expectedRevision: r.controlRevision ?? 0 }),
      }, t('cancel_run')) : null,
      canRetry ? h('button', {
        type: 'button', className: 'wc-btn',
        onClick: () => onControl({ id: r.id, expectedRevision: r.controlRevision ?? 0 }, 'retryRun'),
      }, icon('refresh'), t('retry')) : null,
      h('span', { className: 'wc-log-exit' }, runTime(r)));
  return h('div', { className: 'wc-run' },
    h('span', { className: 'wc-plate', 'data-tone': isLive ? null : (RUN_TONE[r.status] ?? 'muted') },
      isLive ? h('span', { className: 'wc-live' }) : null, isLive ? t('running') : statusLabel(r.status)),
    h('span', { className: 'wc-plate', 'data-tone': r.origin === 'a2a' ? 'muted' : null }, origin),
    h('span', { className: 'wc-run-prompt', title: r.prompt }, who + ' · ' + (r.prompt || '')),
    buttons);
}

function RunList({ runs, bots, onControl }) {
  const byId = Object.fromEntries(bots.map(b => [b.id, b]));
  if (!runs.length) return h('div', { className: 'wc-empty' }, icon('bolt', { size: 15 }), t('no_runs'));
  return h('div', { className: 'wc-runs' }, runs.map(r => h(RunRow, { key: r.id, r, byId, onControl })));
}

function ProposalCard({ p, i, byId, onDecide }) {
  const name = p.name ?? p.suggestedName;
  const actions = h('div', { className: 'wc-item-act' },
    h('span', { className: 'wc-row-sub' }, (p.memberIds ?? []).map(id => byId[id]?.name ?? String(id).slice(0, 6)).join('、')),
    h('button', {
      type: 'button', className: 'wc-btn', 'data-tone': 'primary',
      onClick: e => onDecide('confirmGroup', { proposalId: p.id, memberIds: p.memberIds ?? [], name }),
    }, icon('check'), t('confirm_group')),
    h('button', {
      type: 'button', className: 'wc-btn', 'data-tone': 'danger',
      onClick: e => onDecide('declineGroup', { proposalId: p.id }),
    }, icon('x'), t('deny')));
  return h('div', { className: 'wc-item wc-stag', style: { '--i': i }, key: p.id ?? i },
    h('div', { className: 'wc-item-top' },
      h('span', { className: 'wc-plate' }, icon('bolt', { size: 11 }), t('proposal')),
      h('span', { className: 'wc-item-title' }, name),
      h('span', { className: 'wc-when' }, relTime(p.createdAt))),
    h('p', { className: 'wc-sec-hint' }, p.reason ?? ''),
    p.taskText ? h('pre', { className: 'wc-code wc-scroll' }, p.taskText) : null,
    actions);
}

function ProposalList({ proposals, bots, onDecide }) {
  if (!proposals?.length) return null;
  const byId = Object.fromEntries(bots.map(b => [b.id, b]));
  return h('div', { className: 'wc-items' }, proposals.map((p, i) =>
    h(ProposalCard, { key: p.id ?? i, p, i, byId, onDecide })));
}

// A bot is editable after creation: profession, one-line role, personal instructions, whether it
// speaks only when mentioned, its permission tier and its avatar. Saving goes through updateBot,
// the same method the shipped panel uses.
function BotDetail({ bot, rooms, runs, memories, onSaved, onDeleted }) {
  const own = runs.filter(r => r.botId === bot.id);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [d, setD] = useState({ name: '', description: '', systemPrompt: '', mentionOnly: false, permission: 'workspace-write', avatarSeed: '', rank: '', domain: '' });
  const startEdit = () => {
    setD({
      name: bot.name || '', description: bot.description || '', systemPrompt: bot.systemPrompt || '',
      mentionOnly: !!bot.mentionOnly, permission: bot.permission || 'workspace-write', avatarSeed: bot.avatar || '',
      rank: bot.rank && bot.rank !== 'boss' ? bot.rank : '',
      domain: bot.domain && !bot.protected ? bot.domain : '',
    });
    setErr(null); setEditing(true);
  };
  const set = k => e => setD({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    if (!d.name.trim()) { setErr(t('need_name')); return; }
    setBusy(true); setErr(null);
    try {
      await communityAct('updateBot', {
        id: bot.id, name: d.name.trim(), description: d.description, systemPrompt: d.systemPrompt,
        mentionOnly: d.mentionOnly, permission: d.permission, avatarSeed: d.avatarSeed || undefined,
        rank: d.rank, domain: d.domain.trim(),
      });
      setEditing(false); onSaved?.();
    } catch (e) { setErr(String((e && e.message) || e)); }
    finally { setBusy(false); }
  };

  const head = h('div', { className: 'wc-item-top' },
    h('span', { className: 'wc-avatar' }, (editing ? d.avatarSeed : bot.avatar) || '🤖'),
    h('span', { className: 'wc-item-title' }, bot.name),
    bot.protected ? h('span', { className: 'wc-plate', 'data-tone': 'ok' }, t('prime')) : null,
    h('span', { className: 'wc-when' }, relTime(bot.updatedAt)),
    h('span', { className: 'wc-item-act' },
      editing
        ? [
          h('button', { key: 's', type: 'button', className: 'wc-btn', 'data-tone': 'primary', disabled: busy, onClick: save },
            icon('check'), busy ? t('action_pending') : t('save')),
          h('button', { key: 'c', type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => setEditing(false) }, t('cancel')),
        ]
        : confirmDelete
          ? [
            h('button', {
              key: 'y', type: 'button', className: 'wc-btn', 'data-tone': 'danger', disabled: busy,
              onClick: async () => {
                setBusy(true);
                try { await communityAct('deleteBot', { id: bot.id }); onDeleted?.(); }
                catch (e) { setErr(String((e && e.message) || e)); setConfirmDelete(false); }
                finally { setBusy(false); }
              },
            }, icon('x'), t('confirm_delete')),
            h('button', { key: 'n', type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => setConfirmDelete(false) }, t('cancel')),
          ]
          : bot.protected
            ? [
              h('button', { key: 'e', type: 'button', className: 'wc-btn', onClick: startEdit }, icon('pencil', { size: 13 }), t('edit')),
              h('span', { key: 'p', className: 'wc-plate', 'data-tone': 'ok' }, t('prime')),
            ]
            : [
              h('button', { key: 'e', type: 'button', className: 'wc-btn', onClick: startEdit }, icon('pencil', { size: 13 }), t('edit')),
              h('button', { key: 'd', type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => setConfirmDelete(true) }, t('delete')),
            ]));

  const facts = h('dl', { className: 'wc-kv' },
    h('dt', null, t('profession')), h('dd', null, bot.description || bot.name),
    h('dt', null, t('model')), h('dd', null, `${bot.provider} / ${bot.model} / ${bot.reasoningEffort}`),
    h('dt', null, t('rank_label')), h('dd', null, rankLabel(bot.rank) || '—'),
    h('dt', null, t('domain_label')), h('dd', null, bot.domain || '—'),
    h('dt', null, t('permission')), h('dd', null, bot.permission ?? '—'),
    h('dt', null, t('mention_only')), h('dd', null, bot.mentionOnly ? t('yes') : t('no')),
    h('dt', null, t('workspace')), h('dd', null, bot.workspace ?? '—'),
    h('dt', null, t('memory')), h('dd', null, bot.memoryNamespace || bot.profileId || '—'),
    h('dt', null, t('rooms_in')), h('dd', null, rooms.filter(r => (r.memberIds ?? []).includes(bot.id)).map(r => r.name).join('、') || '—'),
    h('dt', null, t('runs_done')), h('dd', null, `${own.filter(r => r.status === 'completed').length} / ${own.length}`));

  const form = h('div', { className: 'wc-form' },
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-eb-name' }, t('profession')),
      h('input', { id: 'wc-eb-name', type: 'text', value: d.name, onChange: set('name') })),
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-eb-desc' }, t('role_line')),
      h('input', { id: 'wc-eb-desc', type: 'text', value: d.description, onChange: set('description') })),
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-eb-avatar' }, t('avatar')),
      h('input', { id: 'wc-eb-avatar', type: 'text', value: d.avatarSeed, onChange: set('avatarSeed'), placeholder: '🤖' })),
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-eb-perm' }, t('permission')),
      h('select', { id: 'wc-eb-perm', value: d.permission, onChange: set('permission') },
        PERMS.map(p => h('option', { key: p, value: p }, p)))),
    bot.protected ? null : h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-eb-rank' }, t('rank_label')),
      h('select', { id: 'wc-eb-rank', value: d.rank, onChange: set('rank') },
        [['', '—'], ['direction', t('rank_direction')], ['officer', t('rank_officer')], ['execution', t('rank_execution')]]
          .map(([v, label]) => h('option', { key: v || 'none', value: v }, label)))),
    bot.protected ? null : h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-eb-domain' }, t('domain_label')),
      h('input', { id: 'wc-eb-domain', type: 'text', value: d.domain, onChange: set('domain'), maxLength: 40, placeholder: t('domain_ph') })),
    bot.protected ? null : h('p', { className: 'wc-item-note' }, t('rank_hint')),
    h('label', { className: 'wc-check' },
      h('input', { type: 'checkbox', checked: d.mentionOnly, onChange: set('mentionOnly') }), t('mention_only')),
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-eb-persona' }, t('persona')),
      h('textarea', { id: 'wc-eb-persona', value: d.systemPrompt, onChange: set('systemPrompt'), placeholder: t('persona_ph') })),
    err ? h('p', { className: 'wc-err', role: 'alert' }, err) : null);

  const memoryBlock = [
    h('h3', { key: 'mem-h', className: 'wc-sec-title', style: { marginTop: 'var(--sp-5)' } }, `${t('memory_view')} (${(memories ?? []).length})`),
    (memories ?? []).length
      ? h('ul', { key: 'mem-list', className: 'wc-log', style: { listStyle: 'none', margin: 0, padding: 0 } },
        (memories ?? []).slice(-20).reverse().map((m, i) => h('li', { key: m.id ?? i, className: 'wc-log-row' },
          h('span', { className: 'wc-plate', 'data-tone': m.kind === 'note' ? 'muted' : 'ok' },
            m.kind === 'note' ? t('memory_note') : t('memory_task')),
          h('span', { className: 'wc-log-main' }, h('span', { className: 'wc-log-cmd', title: m.text }, m.text ?? '')),
          h('span', { className: 'wc-log-exit' }, relTime(m.at)))))
      : h('div', { key: 'mem-empty', className: 'wc-empty' }, icon('timeline', { size: 15 }), t('no_memory')),
  ];

  const persona = [
    h('h3', { key: 'per-h', className: 'wc-sec-title', style: { marginTop: 'var(--sp-5)' } }, t('persona')),
    h('pre', { key: 'per-text', className: 'wc-persona wc-scroll' }, bot.systemPrompt || t('no_persona')),
  ];

  return h('div', { className: 'wc-col' }, head,
    editing ? form : facts,
    ...(editing ? [] : memoryBlock),
    ...(editing ? [] : persona));
}

function Composer({ room, onDone, onSent }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const send = async (e) => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true); setErr(null);
    try { await communityAct('sendMessage', { roomId: room.id, text: v }); setText(''); onSent?.(v); onDone?.(); }
    catch (e2) { setErr(String(e2?.message || e2)); }
    finally { setBusy(false); }
  };
  return h('div', { className: 'wc-compose' },
    h('div', { className: 'wc-composer' },
      h('textarea', {
        rows: 1, value: text, placeholder: `${t('say_to')} ${room.name}`, 'aria-label': t('say_to'),
        onChange: e => setText(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } },
      }),
      h('button', { type: 'button', className: 'wc-send', onClick: send, disabled: !text.trim() || busy,
        title: t('dispatch'), 'aria-label': t('dispatch') }, busy ? icon('clock', { size: 15, className: 'wc-spin' }) : icon('chevron', { size: 16 }))),
    h('span', { className: 'wc-compose-hint', id: 'wc-compose-hint' }, err ? h('span', { className: 'wc-err', role: 'alert' }, err) : t('enter_send')));
}

const PERMS = ['read-only', 'workspace-write', 'full-access'];
function NewBotForm({ onDone }) {
  const [f, setF] = useState({ name: '', description: '', systemPrompt: '', avatarSeed: '', mentionOnly: true, permission: 'workspace-write' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [defaults, setDefaults] = useState(null);
  // a bot without provider/model can never run; the host reads the profile's own default so the
  // form can state it instead of the user having to know the provider ids
  useEffect(() => { let live = true; api('/defaults').then(d => { if (live) setDefaults(d?.model ?? null); }).catch(() => { }); return () => { live = false; }; }, []);
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async () => {
    if (!f.name.trim()) { setErr(t('need_name')); return; }
    setBusy(true); setErr(null);
    try {
      const d = defaults ?? {};
      await communityAct('createBot', {
        ...f,
        ...(d.provider ? { provider: d.provider } : {}),
        ...(d.model ? { model: d.model } : {}),
        ...(d.reasoningEffort ? { reasoningEffort: d.reasoningEffort } : {}),
      });
      onDone?.();
    }
    catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  const field = (key, label, type) => h('div', { className: 'wc-field', key },
    h('label', { htmlFor: 'wc-f-' + key }, label),
    type === 'textarea'
      ? h('textarea', { id: 'wc-f-' + key, value: f[key], onChange: set(key), placeholder: t('persona_ph') })
      : h('input', { id: 'wc-f-' + key, type: 'text', value: f[key], onChange: set(key) }));
  return h('div', { className: 'wc-form' },
    h('h2', { className: 'wc-sec-title' }, t('new_bot')),
    field('name', t('profession')), field('description', t('role_line')), field('avatarSeed', t('avatar')), field('systemPrompt', t('persona'), 'textarea'),
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-f-perm' }, t('permission')),
      h('select', { id: 'wc-f-perm', value: f.permission, onChange: set('permission') }, PERMS.map(p => h('option', { key: p, value: p }, p)))),
    h('label', { className: 'wc-check' },
      h('input', { type: 'checkbox', checked: f.mentionOnly, onChange: set('mentionOnly') }), t('mention_only')),
    defaults?.provider
      ? h('p', { className: 'wc-item-note' }, `${t('model')} · ${defaults.provider} / ${defaults.model}${defaults.reasoningEffort ? ' / ' + defaults.reasoningEffort : ''}`)
      : null,
    h('p', { className: 'wc-item-note' }, t('new_bot_note')),
    err ? h('p', { className: 'wc-err' }, err) : null,
    h('div', { className: 'wc-form-act' },
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: submit, disabled: busy },
        icon('check'), busy ? t('action_pending') : t('create_bot')),
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: onDone }, t('cancel'))));
}

const TASK_TONE = { done: 'ok', completed: 'ok', in_progress: null, pending: 'muted', failed: 'danger', blocked: 'warn' };
function TaskBoard({ room, bots }) {
  const byId = Object.fromEntries(bots.map(b => [b.id, b]));
  const rows = room.assignments ?? [];
  return h('div', { className: 'wc-col' },
    room.objective ? h('p', { className: 'wc-sec-hint' }, `${t('objective')}：${room.objective}`) : null,
    rows.length ? h('div', { className: 'wc-runs' }, rows.map((a, i) => h('div', { key: a.id ?? i, className: 'wc-run' },
      h('span', { className: 'wc-plate', 'data-tone': TASK_TONE[a.status] ?? 'muted' }, a.status ?? '—'),
      h('span', { className: 'wc-plate', 'data-tone': 'muted' }, `R${a.round ?? room.round ?? 1}`),
      h('span', { className: 'wc-run-prompt', title: a.report ?? a.task },
        `${byId[a.botId]?.name ?? '—'} · ${a.task ?? ''}`),
      h('span', { className: 'wc-log-exit' }, a.report ? t('reported') : ''))))
      : h('div', { className: 'wc-empty' }, icon('timeline', { size: 15 }), t('no_tasks')),
    (room.notices ?? []).length ? h('p', { className: 'wc-item-note' }, room.notices.map(n => n?.text ?? n).join(' · ')) : null);
}

function useMemory() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const d = await api('/memory'); if (live) setData(d); } catch { }
    };
    load();
    const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return { data, refresh: () => api('/memory').then(setData).catch(() => { }) };
}

function useNotebook() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    const load = async () => { try { const d = await api('/brain'); if (live) setData(d); } catch { } };
    load();
    const timer = setInterval(load, 6000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return { data, refresh: () => api('/brain').then(setData).catch(() => { }) };
}

const nbDay = iso => String(iso ?? '').slice(0, 10);

function NotebookSection({ data, bots, onAdd, onRetire, busy }) {
  const [who, setWho] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('rule');
  const [showDead, setShowDead] = useState(false);
  const [err, setErr] = useState(null);
  if (!data) return h('div', { className: 'wc-empty' }, icon('timeline', { size: 15 }), t('brain_loading'));
  const today = new Date().toISOString().slice(0, 10);
  const entries = data.entries ?? [];
  const book = (Array.isArray(bots) && bots.length ? bots : []).map(b => b.id).includes(who) ? who : (bots?.[0]?.id ?? '');
  const live = entries.filter(e => e.status !== 'retired');
  const dead = entries.filter(e => e.status === 'retired');
  const nameOf = id => bots?.find(b => b.id === id)?.name ?? id?.slice?.(0, 6) ?? '—';
  const submit = (e) => {
    if (!e?.nativeEvent?.isTrusted) { setErr(t('need_gesture')); return; }
    if (!book) { setErr(t('nb_need_bot')); return; }
    if (!text.trim()) { setErr(t('nb_need_text')); return; }
    setErr(null);
    onAdd({ botId: book, text: text.trim(), kind, tags: [] }).then(() => { setText(''); }).catch(x => setErr(t('nb_failed') + String(x?.message || x)));
  };
  const row = e => h('div', { className: 'wc-log-row', key: e.id },
    h('span', { className: 'wc-plate', 'data-tone': e.scope === 'team' ? 'ok' : (e.kind === 'rule' ? null : 'muted') },
      e.scope === 'team' ? t('nb_team') : (e.kind === 'rule' ? t('nb_rule') : t('nb_log'))),
    h('span', { className: 'wc-log-main' },
      h('span', { className: 'wc-log-cmd', title: e.text }, e.text),
      h('span', { className: 'wc-row-sub' },
        `${t('nb_written')} ${nbDay(e.writtenAt)}`,
        ' · ', e.aboutDate ? `${t('nb_about')} ${e.aboutDate}` : `— ${t('nb_about')}`,
        ' · ', e.expiresAt ? (e.expiresAt < today ? t('nb_expired') + ' ' + e.expiresAt : `${t('nb_expires')} ${e.expiresAt}`) : t('nb_forever'),
        e.mergedFrom?.length ? ` · ${e.mergedFrom.length} → 1` : '')),
    e.status === 'retired' ? h('span', { className: 'wc-log-exit' }, t('nb_archived')) : h('button', {
      type: 'button', className: 'wc-btn', 'data-tone': 'ghost', disabled: busy,
      onClick: () => onRetire(e).catch(x => setErr(t('nb_failed') + String(x?.message || x))),
    }, t('nb_retire')));
  const byBot = new Map();
  for (const e of live) { const k = e.scope === 'team' ? '__team__' : e.botId; if (!byBot.has(k)) byBot.set(k, []); byBot.get(k).push(e); }
  const groups = [...byBot.entries()].sort((a, b) => (a[0] === '__team__' ? -1 : b[0] === '__team__' ? 1 : nameOf(a[0]).localeCompare(nameOf(b[0]))));
  const form = h('div', { className: 'wc-form' },
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-nb-who' }, t('nb_who')),
      h('select', { id: 'wc-nb-who', value: book, onChange: e => setWho(e.target.value) },
        (bots ?? []).map(b => h('option', { key: b.id, value: b.id }, b.name)))),
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-nb-text' }, t('nb_add')),
      h('input', {
        id: 'wc-nb-text', type: 'text', value: text, placeholder: t('nb_ph'), maxLength: 500,
        onChange: e => setText(e.target.value), onKeyDown: e => { if (e.key === 'Enter') submit(e); },
      })),
    h('div', { className: 'wc-field' }, h('label', { htmlFor: 'wc-nb-kind' }, t('nb_kind')),
      h('select', { id: 'wc-nb-kind', value: kind, onChange: e => setKind(e.target.value) },
        [['rule', t('nb_rule')], ['log', t('nb_log')]].map(([v, l]) => h('option', { key: v, value: v }, l)))),
    h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', disabled: busy, onClick: submit }, icon('plus', { size: 13 }), t('nb_add')));
  const ledger = (data.ledger ?? []).slice(0, 8);
  return h('div', { className: 'wc-col' },
    h('p', { className: 'wc-sec-hint' }, t('nb_hint')),
    form,
    err ? h('p', { className: 'wc-err', role: 'alert' }, err) : null,
    groups.length ? groups.map(([k, list]) => h('div', { key: k, className: 'wc-col' },
      h('h4', { className: 'wc-sec-title' }, k === '__team__' ? t('nb_team') : nameOf(k), ' · ', list.length),
      h('div', { className: 'wc-log', style: { listStyle: 'none', margin: 0, padding: 0 } }, list.map(row)))) : h('div', { className: 'wc-empty' }, icon('timeline', { size: 15 }), t('nb_empty')),
    dead.length ? h('button', {
      type: 'button', className: 'wc-btn', 'data-tone': 'ghost',
      onClick: () => setShowDead(!showDead), 'aria-expanded': showDead ? 'true' : 'false',
    }, t('nb_archived'), ' ', dead.length, showDead ? '▴' : '▾') : null,
    showDead ? h('div', { className: 'wc-log', style: { listStyle: 'none', margin: 0, padding: 0 } }, dead.map(row)) : null,
    ledger.length ? h('div', { className: 'wc-col' },
      h('h4', { className: 'wc-sec-title' }, t('nb_ledger')),
      h('div', { className: 'wc-log', style: { listStyle: 'none', margin: 0, padding: 0 } },
        ledger.map((r, i) => h('div', { className: 'wc-log-row', key: r.at + i },
          h('span', { className: 'wc-plate', 'data-tone': 'muted' }, r.action),
          h('span', { className: 'wc-log-main' }, h('span', { className: 'wc-log-cmd', title: r.summary }, r.summary ?? '')),
          h('span', { className: 'wc-log-exit' }, nbDay(r.at)))))) : null);
}

function PendingRow({ p }) {
  const bot = p.path.split('/')[1] ?? '';
  return h('div', { className: 'wc-run', key: p.path },
    h('span', { className: 'wc-plate', 'data-tone': p.action === 'update' ? 'warn' : 'muted' }, p.action),
    h('span', { className: 'wc-plate', 'data-tone': 'muted' }, bot),
    h('span', { className: 'wc-run-prompt', title: p.path }, p.path));
}

function BrainSection({ memory, onSync, busy }) {
  if (!memory) return h('div', { className: 'wc-empty' }, icon('plug', { size: 15 }), t('brain_loading'));
  if (!memory.available) return h('div', { className: 'wc-empty' }, icon('plug', { size: 15 }), memory.reason ?? t('brain_none'));
  const pending = memory.pending ?? [];
  const list = pending.length
    ? h('div', { className: 'wc-runs' }, pending.slice(0, 12).map(p => h(PendingRow, { key: p.path, p })))
    : h('div', { className: 'wc-empty' }, icon('check', { size: 15 }), t('brain_synced'));
  const meta = h('dl', { className: 'wc-kv' },
    h('dt', null, t('vault')), h('dd', null, memory.vault),
    h('dt', null, t('brain_notes')), h('dd', null, `${memory.total} · ${memory.bots} bots`));
  const rule = h('p', { className: 'wc-sec-hint' }, t('brain_rule'));
  const actions = h('div', { className: 'wc-form-act' },
    h('button', {
      type: 'button', className: 'wc-btn', 'data-tone': 'primary',
      disabled: busy || !pending.length, onClick: onSync,
    }, icon('refresh'), busy ? t('action_pending') : t('brain_write')));
  return h('div', { className: 'wc-col' }, meta, rule, list, actions);
}

// A bot asked to run a tool and needs a human verdict. Same card geometry as a group proposal,
// because it is the same decision class: something happens only after you say yes.
function TeamApprovalCard({ a, i, onDecide }) {
  return h('div', { className: 'wc-item wc-stag', style: { '--i': i } },
    h('div', { className: 'wc-item-top' },
      h('span', { className: 'wc-plate' }, icon('bolt', { size: 11 }), t('wants_tool')),
      h('span', { className: 'wc-item-title' }, a.memberName || t('some_bot')),
      h('span', { className: 'wc-mono' }, a.toolName),
      h('span', { className: 'wc-when' }, relTime(a.createdAt))),
    a.reason ? h('p', { className: 'wc-sec-hint' }, a.reason) : null,
    h('div', { className: 'wc-item-act' },
      h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'primary',
        onClick: () => onDecide('approveBotToolCall', { id: a.id, outcome: 'allowed-once' }),
      }, icon('check'), t('allow_once_only')),
      h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'danger',
        onClick: () => onDecide('approveBotToolCall', { id: a.id, outcome: 'rejected' }),
      }, icon('x'), t('deny'))));
}

function TeamApprovalList({ approvals, onDecide }) {
  if (!approvals || !approvals.length) return null;
  return h('div', { className: 'wc-items' },
    approvals.map((a, i) => h(TeamApprovalCard, { key: a.id, a, i, onDecide })));
}

// A bot is blocked until the user answers. The question exists only in the service's memory, so
// it arrives through /live; answering resolves the waiting turn instead of letting it expire.
function QuestionCard({ q, i, onDecide }) {
  const [text, setText] = useState('');
  const options = Array.isArray(q.options) ? q.options : [];
  const answer = () => { const v = text.trim(); if (v) onDecide('answerBotQuestion', { questionId: q.id, answer: v }); };
  return h('div', { className: 'wc-item wc-stag', style: { '--i': i } },
    h('div', { className: 'wc-item-top' },
      h('span', { className: 'wc-plate' }, icon('chat', { size: 11 }), t('asks_you')),
      h('span', { className: 'wc-item-title' }, q.memberName || t('some_bot')),
      h('span', { className: 'wc-when' }, relTime(q.createdAt))),
    q.question ? h('p', { className: 'wc-sec-hint' }, q.question) : null,
    options.length ? h('div', { className: 'wc-item-act' },
      options.map((opt, k) => h('button', {
        key: k, type: 'button', className: 'wc-btn',
        onClick: () => onDecide('answerBotQuestion', { questionId: q.id, answer: String(opt) }),
      }, String(opt)))) : null,
    q.allowFreeText !== false ? h('div', { className: 'wc-answer' },
      h('div', { className: 'wc-field', style: { flex: '1 1 180px' } },
        h('input', {
          type: 'text', value: text, placeholder: t('answer_ph'),
          onChange: e => setText(e.target.value),
          onKeyDown: e => { if (e.key === 'Enter') answer(); },
        })),
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', disabled: !text.trim(), onClick: answer }, t('send')),
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => onDecide('answerBotQuestion', { questionId: q.id, skip: true }) }, t('skip'))) : null);
}
function QuestionList({ questions, onDecide }) {
  if (!questions || !questions.length) return null;
  return h('div', { className: 'wc-items' }, questions.map((q, i) => h(QuestionCard, { key: q.id, q, i, onDecide })));
}
// You can start a group yourself, not only approve a bot's proposal.
function NewRoomForm({ bots, onDone }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const toggle = id => setPicked(p => ({ ...p, [id]: !p[id] }));
  const submit = async () => {
    if (!name.trim()) { setErr(t('need_room_name')); return; }
    const memberIds = Object.keys(picked).filter(k => picked[k]);
    setBusy(true); setErr(null);
    try { await communityAct('createRoom', { name: name.trim(), memberIds }); onDone?.(); }
    catch (e) { setErr(String((e && e.message) || e)); }
    finally { setBusy(false); }
  };
  return h('div', { className: 'wc-form' },
    h('h2', { className: 'wc-sec-title' }, t('new_room')),
    h('div', { className: 'wc-field' },
      h('label', { htmlFor: 'wc-room-name' }, t('room_name')),
      h('input', { id: 'wc-room-name', type: 'text', value: name, placeholder: t('room_name_ph'), onChange: e => setName(e.target.value) })),
    h('div', { className: 'wc-field' },
      h('label', null, t('members')),
      (bots || []).length
        ? h('div', { className: 'wc-members' }, bots.map(b => h('label', { key: b.id, className: 'wc-check' },
          h('input', { type: 'checkbox', checked: !!picked[b.id], onChange: () => toggle(b.id) }),
          h('span', { className: 'wc-avatar' }, b.avatar || '🤖'), h('span', null, b.name))))
        : h('p', { className: 'wc-item-note' }, t('no_bots_yet'))),
    h('p', { className: 'wc-item-note' }, t('new_room_note')),
    err ? h('p', { className: 'wc-err', role: 'alert' }, err) : null,
    h('div', { className: 'wc-form-act' },
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: submit, disabled: busy },
        icon('check'), busy ? t('action_pending') : t('create_room')),
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: onDone }, t('cancel'))));
}
// Right-click a bot to reach its settings. The settings live in a dialog over the page instead of
// replacing the conversation: you asked to keep the transcript clean.
function BotContextMenu({ menu, onClose, onSettings, onDelete, onDirect }) {
  const boxRef = useRef(null);
  useEffect(() => {
    // a capture-phase listener sees the pointerdown before the item's click does; without the
    // containment check it unmounted the menu and the item could never be clicked
    const close = (e) => {
      const box = boxRef.current;
      const t = e.target;
      if (box && t && typeof box.contains === 'function' && box.contains(t)) return;
      onClose();
    };
    const esc = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [onClose]);
  if (!menu) return null;
  const item = (label, iconName, tone, onClick) => h('button', {
    type: 'button', className: 'wc-menu-item', 'data-tone': tone || null,
    onClick: e => { e.stopPropagation(); onClick(); },
  }, icon(iconName, { size: 13 }), h('span', null, label));
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 768;
  const left = Math.max(8, Math.min(menu.x, vw - 224));
  const top = Math.max(8, Math.min(menu.y, vh - 186));
  return h('div', {
    ref: boxRef, className: 'wc-menu', role: 'menu', style: { left: left + 'px', top: top + 'px' },
  },
    h('div', { className: 'wc-menu-head' }, menu.bot.avatar || '🤖', menu.bot.name),
    item(t('direct'), 'chat', null, onDirect),
    item(t('bot_settings'), 'pencil', null, onSettings),
    menu.bot.protected ? null : item(t('delete'), 'x', 'danger', onDelete));
}

function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return h('div', { className: 'wc-scrim', onPointerDown: e => { if (e.target === e.currentTarget) onClose(); } },
    h('div', { className: 'wc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { className: 'wc-dialog-head' },
        h('h2', { className: 'wc-sec-title' }, title),
        h('button', { type: 'button', className: 'wc-btn wc-ico-btn', 'aria-label': t('close'), onClick: onClose }, icon('x', { size: 14 }))),
      h('div', { className: 'wc-dialog-body wc-scroll' }, children)));
}
function WorldEntry() {
  ensureStyle();
  // the host renders the registered `label` itself, so the component supplies only the glyph —
  // emitting the text here produced a "世界 世界" entry in the rail.
  return icon('globe', { className: 'wc-globe', size: 16 });
}

function WorldPage({ snapshot, initialFocus } = {}) {
  ensureStyle();
  const rootRef = useRef(null);
  // Scroll behaviour: jump to the newest message when the room changes, and keep following new
  // ones only if the reader was already at the bottom — scrolling is never taken away from them.
  const bodyRef = useRef(null);
  const pinnedRef = useRef(true);
  const scopeRef = useRef(null);
  const { snap, err, at, reload, nonce, setErr } = useSnapshot(snapshot);
  useKeyboardNav(scopeRef);

  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [enter, setEnter] = useState(true);
  // messages the user just sent, shown until the service's own copy reaches the next /community
  // read (it persists asynchronously) — without this the composer cleared and the bubble was
  // missing for a beat, which reads as "the send was lost"
  const [optimistic, setOptimistic] = useState([]);
  const [wantDirect, setWantDirect] = useState(null);
  useEffect(() => {
    const raf = rootRef.current?.ownerDocument?.defaultView?.requestAnimationFrame?.(() => setEnter(false)) ?? setTimeout(() => setEnter(false), 600);
    return () => { if (typeof raf === 'number') clearTimeout(raf); };
  }, []);

  const data = snap ?? snapshot ?? null;
  // absent means autonomous, the same rule /snapshot applies: the host answers its own tickets
  // unless the user turned that off from this page
  const auto = data?.autonomy !== false;
  const pending = (data?.pending ?? []).filter(p => !p.granted && !p.resolved);
  const audit = data?.audit ?? [];
  const permissions = data?.permissions ?? {};

  const seen = useRef(new Set(audit.map(a => a.at)));
  const [flash, setFlash] = useState(() => new Set());
  useEffect(() => {
    const fresh = audit.filter(a => a.at && !seen.current.has(a.at)).map(a => a.at);
    if (!fresh.length && seen.current.size) return;
    fresh.forEach(x => seen.current.add(x));
    if (!fresh.length) return;
    setFlash(new Set(fresh));
    const to = setTimeout(() => setFlash(new Set()), 1700);
    return () => clearTimeout(to);
  }, [audit]);

  const respond = useCallback(async (approvalId, verdict, e) => {
    // A verdict must come from a gesture the browser vouches for, carrying a nonce that only the
    // snapshot this page is answering could have produced. Scripted .click() and replay both fail.
    if (!e?.nativeEvent?.isTrusted) { setNotice(t('need_gesture')); return; }
    const n = nonce.current;
    if (!n) { setNotice(t('need_sync')); reload(); return; }
    nonce.current = null;
    setBusy(approvalId);
    try { await api('/respond', { approvalId, verdict, nonce: n }); setNotice(null); reload(); }
    // setErr was called here while the hook's setter was never destructured, so a failed verdict
    // threw inside its own catch and the reason was lost. Both sites now say what the host answered.
    catch (e2) { const why = String(e2?.message || e2); setErr(why); setNotice(t('respond_failed') + why); reload(); }
    finally { setBusy(null); }
  }, [reload, nonce, setErr]);
  const revoke = useCallback(async (action, e) => {
    const n = nonce.current;
    if (!e?.nativeEvent?.isTrusted || !n) { setNotice(t('need_gesture')); return; }
    nonce.current = null;
    try { await api('/revoke', { action, nonce: n }); reload(); }
    catch (e2) { const why = String(e2?.message || e2); setErr(why); setNotice(t('revoke_failed') + why); reload(); }
  }, [reload, nonce, setErr]);
  // One click flips "may the agent answer its own tickets". The nonce proves this page is answering
  // the snapshot it is looking at, exactly like a verdict does.
  const toggleAutonomy = useCallback(async (e) => {
    if (e?.nativeEvent && !e.nativeEvent.isTrusted) { setNotice(t('need_gesture')); return; }
    const n = nonce.current;
    if (!n) { setNotice(t('need_sync')); reload(); return; }
    nonce.current = null;
    setBusy('autonomy');
    try { await api('/autonomy', { autonomy: !auto, nonce: n }); setNotice(null); reload(); }
    catch (e2) { const why = String(e2?.message || e2); setNotice(t('autonomy_failed') + why); reload(); }
    finally { setBusy(null); }
  }, [auto, reload, nonce]);

  const com = useCommunity();
  const mem = useMemory();
  const nb = useNotebook();
  const [nbBusy, setNbBusy] = useState(false);
  // the notebook writes go through the same single-use nonce as every other write; a spent one is
  // replaced by the next poll, so a failed attempt says why instead of silently doing nothing
  const nbWrite = async (payload) => {
    const n = nb.data?.nonce;
    if (!n) { nb.refresh(); throw new Error(t('need_sync')); }
    setNbBusy(true);
    try {
      const r = await api('/brain', payload);
      if (!r || r.ok !== true) throw new Error((r && r.error) || 'failed');
      nb.refresh();
      return r;
    } finally { setNbBusy(false); }
  };
  const nbAdd = p => nbWrite({ op: 'add', ...p });
  const nbRetire = e => nbWrite({ op: 'retire', id: e.id, reason: '用户在页面上线了' });
  const [brainBusy, setBrainBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRoomDelete, setConfirmRoomDelete] = useState(false);
  const [menu, setMenu] = useState(null);        // right-click target on a bot row
  const [settingsBot, setSettingsBot] = useState(null);
  const doAct = async (kind, payload, altKind) => {
    setBrainBusy(true);
    try { await communityAct(altKind ?? kind, payload); setNotice(null); com.reload?.(); }
    catch (e) { setNotice(String(e?.message || e)); }
    finally { setBrainBusy(false); }
  };
  const controlRun = (req, kind) => doAct(kind ?? 'controlRun', req);

  const syncBrain = async (e) => {
    if (!e?.nativeEvent?.isTrusted) { setNotice(t('need_gesture')); return; }
    const n = mem.data?.nonce;
    if (!n) { setNotice(t('need_sync')); mem.refresh(); return; }
    setBrainBusy(true);
    try { const r = await api('/memory/sync', { nonce: n }); setNotice(`${r.created ?? 0} ${t('brain_created')}`); mem.refresh(); }
    catch (err2) { setNotice(String(err2?.message || err2)); }
    finally { setBrainBusy(false); }
  };
  const swarm = com.data?.available ? com.data : null;
  // opening a direct chat may have just created the room, so wait for the next read to carry it
  useEffect(() => {
    if (!wantDirect || !swarm) return;
    const room = (swarm.rooms ?? []).find(r => r.directBotId === wantDirect);
    if (room) { setFocus({ kind: 'room', id: room.id }); setWantDirect(null); }
  }, [swarm, wantDirect]);
  // clicking a bot row means "talk to this bot": open its direct room, creating it on first use.
  // group rooms stay the explicit list below BOT.
  const openDirect = (b) => {
    if (!b) return;
    const existing = (swarm?.rooms ?? []).find(r => r.directBotId === b.id);
    if (existing) { setFocus({ kind: 'room', id: existing.id }); return; }
    setWantDirect(b.id);
    communityAct('createRoom', { name: b.name, memberIds: [b.id], directBotId: b.id })
      .then(() => com.reload?.())
      .catch(e => { setWantDirect(null); setNotice(String(e?.message || e)); });
  };
  // Tell the host we actually painted, with what. Mount alone proves registration, not rendering:
  // this is what turns "did the page draw?" into something readable from disk.
  const painted = useRef(false);
  useEffect(() => {
    if (!swarm || painted.current) return;
    painted.current = true;
    report({
      at: new Date().toISOString(), build: BUILD, rendered: true,
      bots: (swarm.bots ?? []).length, rooms: (swarm.rooms ?? []).length,
      messages: (swarm.messages ?? []).length, runs: (swarm.runs ?? []).length,
      source: swarm.source ?? null, error: null,
    });
  }, [swarm]);
  const [focus, setFocus] = useState({ kind: initialFocus || 'auto', id: null });
  const autoRoom = focus.kind === 'auto' ? ((swarm?.rooms ?? []).find(r => !r.directBotId) ?? (swarm?.rooms ?? [])[0] ?? null) : null;
  const openRoom = swarm?.rooms?.find(r => r.id === focus.id) ?? autoRoom;
  // reading a room is what clears its badge; without this the unread count never went down
  const readMarked = useRef('');
  useEffect(() => {
    if (!openRoom || !openRoom.unread) return;
    const key = openRoom.id + ':' + openRoom.unread;
    if (readMarked.current === key) return;
    readMarked.current = key;
    communityAct('markRoomRead', { roomId: openRoom.id }).then(() => com.reload?.()).catch(() => { readMarked.current = ''; });
  }, [openRoom?.id, openRoom?.unread]);
  const optimisticFor = (roomId) => optimistic.filter(o => o.roomId === roomId && Date.now() - Date.parse(o.createdAt) < 300000);

  const scrollKey = `${focus.kind}:${focus.id ?? ''}:${(swarm?.messages ?? []).length}:${openRoom ? optimisticFor(openRoom.id).length : 0}`;
  // a pending "clear this room?" must never carry over to another room
  useEffect(() => { setConfirmClear(false); setConfirmRoomDelete(false); }, [focus.id]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => { pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // the local-computer console opens at its top; a conversation follows the newest message
    if (focus.kind === 'machine') { el.scrollTop = 0; return; }
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  // "not connected" is decided by a real failure, never by a guess about the config: api() already
  // recorded why when the channel is down (err), and !data covers the first paint before any answer.
  const off = err || !data;
  const loading = !data && !off;
  const jumps = [
    { href: '#wc-pending', icon: 'bolt', label: t('pending'), n: pending.length, warn: pending.length > 0 },
    { href: '#wc-machine', icon: 'folder', label: t('machine'), n: (data?.allowedRoots ?? []).length },
    { href: '#wc-permissions', icon: 'shield', label: t('permissions'), n: Object.keys(permissions).length },
    { href: '#wc-audit', icon: 'timeline', label: t('audit'), n: audit.length },
  ];

  // one row of the machine console nav; only rendered while that console is open
  const machineJump = (j, i) => h('li', { key: j.href, className: 'wc-stag', style: { '--i': i + 1 } },
    h('a', {
      className: 'wc-row-link', href: j.href,
      onClick: e => {
        e.preventDefault();
        setFocus({ kind: 'machine', id: null });
        requestAnimationFrame(() => document.querySelector(j.href)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      },
    }, icon(j.icon),
      h('span', { className: 'wc-row-label' }, j.label),
      h('span', {
        className: 'wc-count', 'data-zero': j.n ? undefined : '1', 'data-tone': j.warn ? 'warn' : undefined,
      }, j.n)));
  const LIST = { listStyle: 'none', margin: 0, padding: 0 };

  const group = (label, rows, action) => (rows.length || action) ? h('div', { className: 'wc-rail-group', key: label },
    h('div', { className: 'wc-rail-head' }, label, action ? h('span', { style: { marginLeft: 'auto' } }, action) : null),
    h('ul', { className: 'wc-rows', style: LIST }, rows)) : null;
  const busyBot = id => (swarm?.runs ?? []).some(r => r.botId === id && r.running);
  const botRows = (swarm?.bots ?? []).map((b, i) => h('li', { key: b.id, className: 'wc-stag', style: { '--i': i } },
    h('button', { type: 'button', className: 'wc-row-link', 'data-on': openRoom?.directBotId === b.id ? '1' : undefined, 'aria-current': openRoom?.directBotId === b.id ? 'true' : undefined,
      onClick: () => openDirect(b),
      onContextMenu: e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, bot: b }); } },
      h('span', { className: 'wc-avatar' }, b.avatar || '🤖'),
      h('span', { className: 'wc-row-label' }, b.name),
      h('span', { className: 'wc-row-sub' }, (b.rank && b.rank !== 'boss' ? rankLabel(b.rank) + ' · ' : '') + (b.domain ? b.domain + ' · ' : '') + (busyBot(b.id) ? t('busy') : t('idle'))))));
  // One-to-one chats live on the BOT rows above; this list is groups only, so a DM never shows up
  // twice. Direct rooms stay reachable through their bot.
  const roomRows = (swarm?.rooms ?? []).filter(r => !r.directBotId).map((r, i) => h('li', { key: r.id, className: 'wc-stag', style: { '--i': i } },
    h('button', { type: 'button', className: 'wc-row-link', 'aria-current': (openRoom && openRoom.id === r.id) ? 'true' : undefined, onClick: () => setFocus({ kind: 'room', id: r.id }) },
      icon('timeline'),
      h('span', { className: 'wc-row-label' }, r.name),
      r.unread ? h('span', { className: 'wc-count', 'data-tone': 'warn' }, r.unread)
        : h('span', { className: 'wc-count', 'data-zero': '1' }, r.memberIds.length))));

  // the local-computer console is not resident: its rows exist only while you are in that mode
  const machineMode = focus.kind === 'machine';
  const rail = h('nav', { className: 'wc-rail', 'aria-label': t('title') },
    ...(machineMode ? [h('div', { className: 'wc-rail-head' }, t('machine')),
    // the machine identity row is not resident: it appears only inside the 本机执行 console
    h('div', { className: 'wc-machine wc-stag', style: { '--i': 0 } },
      h('span', { className: 'wc-machine-dot', 'data-off': off ? '1' : '0', 'aria-hidden': 'true' }),
      h('span', { className: 'wc-machine-name', title: data?.machineId ?? '—' }, data?.machineId ?? '—'),
      h('span', { className: 'wc-machine-sub' }, off ? t('disconnected') : `${audit.length} ${t('audit')}`)),
 ] : []),
    h('div', { className: 'wc-rail-scroll wc-scroll' },
      group(t('bots'), botRows, h('button', {
        type: 'button', className: 'wc-toggle', 'aria-label': t('new_bot'), onClick: () => setFocus({ kind: 'newbot', id: null }),
      }, '+')),
      group(t('rooms'), roomRows, h('button', {
        type: 'button', className: 'wc-toggle', 'aria-label': t('new_room'), onClick: () => setFocus({ kind: 'newroom', id: null }),
      }, '+')),
      machineMode ? group(t('machine'), jumps.map(machineJump)) : null),
    h('div', { className: 'wc-rail-foot' },
      h('button', {
        type: 'button', className: 'wc-row-link', 'data-on': machineMode ? '1' : undefined,
        onClick: () => setFocus({ kind: 'machine', id: null }),
      }, icon('terminal'),
        h('span', { className: 'wc-row-label' }, t('machine_console')),
        pending.length ? h('span', { className: 'wc-count', 'data-tone': 'warn' }, pending.length) : null),
      h('div', { className: 'wc-rail-note' },
        off ? null : h('span', { className: 'wc-dot-live', 'aria-hidden': 'true' }),
        icon(off ? 'plug' : 'refresh', { size: 12 }),
        h('span', null, off ? t('disconnected')
          : `${t('live')} · ${at ? new Date(at).toLocaleTimeString(lang() === 'zh' ? 'zh-CN' : 'en-GB') : '…'}`)),
      h(IconBtn, { name: 'refresh', label: t('refresh'), onClick: reload, spin: loading })));

  // Before the swarm payload lands, the auto view must NOT flash the local-computer console.
  const swarmPending = !com.data && !com.err;
  const mailboxFor = (roomId) => {
    const rows = (swarm?.mailbox ?? []).filter(m => m.roomId === roomId);
    if (!rows.length) return null;
    const by = k => rows.filter(m => m.status === k).length;
    return h('span', { className: 'wc-sec-meta' }, `${t('delivery')} ${by('pending')}/${by('claimed')}/${by('settled')}`);
  };
  const proposals = swarm?.proposals ?? [];
  const emptyLibrary = swarm && !(swarm.bots ?? []).length && !(swarm.rooms ?? []).length
    ? h('div', { className: 'wc-col' },
      h('div', { className: 'wc-empty' }, icon('globe', { size: 15 }), t('empty_world')),
      h('div', { className: 'wc-form-act' },
        h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: () => setFocus({ kind: 'newbot', id: null }) }, t('new_bot')),
        h('button', { type: 'button', className: 'wc-btn', onClick: () => setFocus({ kind: 'newroom', id: null }) }, t('new_room'))))
    : null;
  const approvals = swarm?.approvals ?? [];
  const questions = swarm?.questions ?? [];
  const decisionSection = (proposals.length || approvals.length || questions.length) ? h('div', { className: 'wc-col' },
    questions.length ? h('section', { className: 'wc-col', id: 'wc-questions', 'aria-labelledby': 'wc-questions-h' },
      h('div', { className: 'wc-sec-head' },
        h('h2', { className: 'wc-sec-title', id: 'wc-questions-h' }, t('asks_you')),
        h('span', { className: 'wc-sec-meta' }, String(questions.length))),
      h(QuestionList, { questions, onDecide: doAct })) : null,
    proposals.length ? h('section', { className: 'wc-col', id: 'wc-proposals', 'aria-labelledby': 'wc-proposals-h' },
      h('div', { className: 'wc-sec-head' },
        h('h2', { className: 'wc-sec-title', id: 'wc-proposals-h' }, t('proposal')),
        h('span', { className: 'wc-sec-meta' }, String(proposals.length))),
      h(ProposalList, { proposals, bots: swarm?.bots ?? [], onDecide: doAct })) : null,
    approvals.length ? h('section', { className: 'wc-col', id: 'wc-approvals', 'aria-labelledby': 'wc-approvals-h' },
      h('div', { className: 'wc-sec-head' },
        h('h2', { className: 'wc-sec-title', id: 'wc-approvals-h' }, t('wants_tool')),
        h('span', { className: 'wc-sec-meta' }, String(approvals.length))),
      h(TeamApprovalList, { approvals, onDecide: doAct })) : null) : null;

  // merge optimistic sends with the served transcript; one served user message of the same text
  // within two minutes consumes exactly one optimistic copy, so a deliberate double-send still
  // shows two bubbles once both server copies arrive
  const roomMessages = openRoom ? (swarm.messages ?? []).filter(m => m.roomId === openRoom.id) : [];
  const servedUsed = new Set();
  const localPending = openRoom ? optimisticFor(openRoom.id).filter(o => {
    const idx = roomMessages.findIndex((m, i) => !servedUsed.has(i) && m.sender?.kind === 'user' && m.text === o.text
      && Math.abs(Date.parse(m.createdAt) - Date.parse(o.createdAt)) < 120000);
    if (idx >= 0) { servedUsed.add(idx); return false; }
    return true;
  }) : [];
  // the dialog must follow the newest snapshot, otherwise a successful save leaves the old
  // name/description on screen until it is closed and reopened
  const settingsLive = settingsBot ? ((swarm?.bots ?? []).find(b => b.id === settingsBot.id) ?? settingsBot) : null;

  const swarmBody = openRoom
    ? h('div', { className: 'wc-col' },
        h('div', { className: 'wc-sec-head' },
          h('h2', { className: 'wc-sec-title' }, openRoom.name),
          // room.connection is per-room transport state and is "disconnected" for every room on
          // this machine — showing it read as "the host is down". The goal is the useful fact here.
          h('span', { className: 'wc-sec-meta' }, `${openRoom.memberIds.length} · ${openRoom.objective || t('no_goal')}`),
          mailboxFor(openRoom.id),
          openRoom.team?.leaderName
            ? h('span', { className: 'wc-plate', 'data-tone': 'muted' }, `${t('leader')} · ${openRoom.team.leaderName}`)
            : null,
          // destructive, so both take two presses; nothing happens on the first one
          h('span', { className: 'wc-item-act', style: { marginInlineStart: 'auto' } },
            confirmClear
              ? [
                h('button', {
                  key: 'cy', type: 'button', className: 'wc-btn', 'data-tone': 'danger',
                  onClick: () => { setConfirmClear(false); doAct('clearMessages', { roomId: openRoom.id }); },
                }, icon('x'), t('confirm_clear')),
                h('button', { key: 'cn', type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => setConfirmClear(false) }, t('cancel')),
              ]
              : confirmRoomDelete
                ? [
                  h('button', {
                    key: 'dy', type: 'button', className: 'wc-btn', 'data-tone': 'danger',
                    onClick: () => { setConfirmRoomDelete(false); doAct('deleteRoom', { id: openRoom.id }).then(() => setFocus({ kind: 'auto', id: null })); },
                  }, icon('x'), t('confirm_delete_room')),
                  h('button', { key: 'dn', type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => setConfirmRoomDelete(false) }, t('cancel')),
                ]
                : [
                  h('button', {
                    key: 'c', type: 'button', className: 'wc-btn', 'data-tone': 'ghost',
                    onClick: () => setConfirmClear(true),
                  }, icon('timeline', { size: 13 }), t('clear_messages')),
                  h('button', {
                    key: 'd', type: 'button', className: 'wc-btn', 'data-tone': 'ghost',
                    onClick: () => setConfirmRoomDelete(true),
                  }, icon('x', { size: 13 }), t('delete_room')),
                ])),
        h(Transcript, { messages: [...roomMessages, ...localPending], bots: swarm.bots ?? [] }),
        h('h3', { className: 'wc-sec-title', style: { marginTop: 'var(--sp-6)' } }, t('task_board')),
        h(TaskBoard, { room: openRoom, bots: swarm.bots ?? [] }),
        h('h3', { className: 'wc-sec-title', style: { marginTop: 'var(--sp-6)' } }, t('audit')),
        h(RunList, { runs: (swarm.runs ?? []).filter(r => r.roomId === openRoom.id), bots: swarm.bots ?? [], onControl: controlRun }),
        h(ProposalList, { proposals: swarm.proposals ?? [], bots: swarm.bots ?? [], onDecide: doAct }))
    : focus.kind === 'newroom'
      ? h(NewRoomForm, { bots: swarm?.bots ?? [], onDone: () => setFocus({ kind: 'machine', id: null }) })
      : focus.kind === 'newbot'
      ? h(NewBotForm, { onDone: () => setFocus({ kind: 'machine', id: null }) })
      : null;

  const head = h('header', { className: 'wc-pane-head' },
    h('div', { style: { minWidth: 0 } },
      h('h1', { className: 'wc-h1' }, openRoom?.name ?? t('title')),
      h('p', { className: 'wc-hint' }, t('subtitle'))),
    h('div', { className: 'wc-pane-tools' },
      // the autonomy switch: the one place the state is visible, and the one click that takes it back.
      // Existing wc-* primitives only; the long hint drops out below 820px, the short label stays.
      off ? null : h('span', { className: 'wc-hint', 'data-autonomy-hint': '1' },
        auto ? t('autonomy_on_hint') : t('autonomy_off_hint')),
      h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'ghost', 'data-autonomy': auto ? 'on' : 'off',
        'aria-pressed': auto ? 'true' : 'false',
        title: auto ? t('autonomy_on_hint') : t('autonomy_off_hint'),
        onClick: toggleAutonomy,
      }, auto ? icon('bolt', { size: 13 }) : icon('shield', { size: 13 }),
      h('span', null, auto ? t('autonomy_on') : t('autonomy_off'))),
      swarmBody ? h('button', {
        type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => setFocus({ kind: 'machine', id: null }),
      }, t('back_machine')) : null,
      h('span', { className: 'wc-plate', 'data-tone': off ? 'warn' : (pending.length ? null : 'ok') },
        off ? icon('plug', { size: 11 }) : icon(pending.length ? 'bolt' : 'check', { size: 11 }),
        off ? t('disconnected') : (loading ? t('loading') : t('connected')))));

  const banner = h('div', { className: 'wc-banner wc-stag', 'data-tone': 'warn', role: 'status', style: { '--i': 0, maxWidth: '78ch' } },
    h('div', { className: 'wc-banner-title' }, icon('plug', { size: 15 }), t('disconnected')),
    h('div', { style: { display: 'flex', gap: 'var(--sp-2)' } },
      h('button', { type: 'button', className: 'wc-btn', onClick: reload }, icon('refresh'), t('retry'))),
    h('p', { className: 'wc-banner-body' }, err ? `${t('offline_body')} · ${err}` : t('offline_body')));

  const skel = h('div', { className: 'wc-col' },
    h('div', { className: 'wc-skel wc-skel-row' }),
    h('div', { className: 'wc-skel wc-skel-row' }),
    h('div', { className: 'wc-skel wc-skel-line', style: { width: '40%' } }));

  const sections = [
    notice ? h('p', { key: 'notice', className: 'wc-sec-hint', role: 'status' }, notice) : null,
    off ? h('div', { key: 'off' }, banner) : loading ? h('div', { key: 'skel' }, skel) : null,
    data ? h(Section, { key: 'pending', id: 'wc-pending', title: t('pending'), count: `${pending.length}`, i: 0 },
      pending.length ? h('p', { key: 'hint', className: 'wc-sec-hint' }, t('approve_hint')) : null,
      pending.length ? h('ul', { className: 'wc-items', style: LIST },
        pending.map((p, i) => h(ApprovalRow, {
          key: p.approvalId, item: p, index: i + 1, busy: busy === p.approvalId, onVerdict: respond,
        })))
        : h('div', { className: 'wc-empty' }, icon('check', { size: 15 }), t('none_pending'))) : null,
    data ? h(Section, { key: 'machine', id: 'wc-machine', title: t('machine'), count: `${(data.allowedRoots ?? []).length}`, i: 2 },
      h('p', { key: 'hint', className: 'wc-sec-hint' }, t('machine_hint')),
      h(MachineZone, { roots: data.allowedRoots, i: 2, active: machineMode })) : null,
    data ? h(Section, { key: 'perms', id: 'wc-permissions', title: t('permissions'), count: `${Object.keys(permissions).length}`, i: 3 },
      Object.keys(permissions).length ? h('ul', { className: 'wc-items', style: { ...LIST, gap: 'var(--sp-1)' } },
        Object.entries(permissions).map(([a], i) => h(GrantRow, { key: a, action: a, index: i, onRevoke: revoke })))
        : h('div', { className: 'wc-empty' }, icon('shield', { size: 15 }), t('none_permissions'))) : null,
    data ? h(Section, { key: 'brain', id: 'wc-brain', title: t('brain'), count: `${mem.data?.total ?? 0}`, i: 4 },
      h(BrainSection, { memory: mem.data, busy: brainBusy, onSync: syncBrain })) : null,
    data ? h(Section, { key: 'notebook', id: 'wc-notebook', title: t('notebook'), count: `${(nb.data?.entries ?? []).filter(e => e.status !== 'retired').length}`, i: 5 },
      h(NotebookSection, { data: nb.data, bots: swarm?.bots ?? [], busy: nbBusy, onAdd: nbAdd, onRetire: nbRetire })) : null,
    data ? h(Section, { key: 'audit', id: 'wc-audit', title: t('audit'), count: `${audit.length}`, i: 6 },
      audit.length ? h('ul', { className: 'wc-log', style: { ...LIST, gap: 'var(--sp-1)' } },
        audit.map((a, i) => h(LogRow, { key: `${a.at ?? ''}#${i}`, a, index: i, flash: !!a.at && flash.has(a.at) })))
        : h('div', { className: 'wc-empty' }, icon('timeline', { size: 15 }), t('none_audit'))) : null,
  ];

  // the composer is a sibling of the scroller, so it can never cover the last message
  const composerEl = openRoom ? h(Composer, {
    room: openRoom,
    onDone: () => com.reload?.(),
    onSent: (text) => {
      const createdAt = new Date().toISOString();
      setOptimistic(list => [...list, {
        id: 'local-' + createdAt + '-' + Math.random().toString(16).slice(2),
        roomId: openRoom.id, sender: { kind: 'user', name: 'user' }, text, createdAt,
      }]);
      com.reload?.();
    },
  }) : null;
  const pane = h('main', { className: 'wc-pane' }, head,
    h('div', { ref: bodyRef, className: 'wc-pane-body wc-scroll' }, decisionSection, swarmBody ?? emptyLibrary ?? (swarmPending && focus.kind === 'auto' && !off ? h('div', { className: 'wc-col' },
      h('div', { className: 'wc-skel wc-skel-row' }), h('div', { className: 'wc-skel wc-skel-row' }),
      h('div', { className: 'wc-skel wc-skel-line', style: { width: '46%' } })) : sections)), composerEl);

  return h('div', { ref: scopeRef, className: 'wc-scope', 'data-kbd': '0', style: { height: '100%' } },
    h('div', { ref: rootRef, className: 'wc-root', 'data-enter': enter ? '1' : '0' },
      h('div', { className: 'wc-app' }, rail, pane),
      h(BotContextMenu, {
        menu, onClose: () => setMenu(null),
        onDirect: () => { const b = menu.bot; setMenu(null); openDirect(b); },
        onSettings: () => { setSettingsBot(menu.bot); setMenu(null); },
        onDelete: () => { setSettingsBot(menu.bot); setMenu(null); },
      }),
      settingsLive ? h(Dialog, { title: settingsLive.name + ' · ' + t('bot_settings'), onClose: () => setSettingsBot(null) },
        h(BotDetail, {
          bot: settingsLive, rooms: swarm?.rooms ?? [], runs: swarm?.runs ?? [],
          memories: (swarm?.memories ?? []).filter(m => m.botId === settingsLive.id),
          onSaved: () => com.reload?.(),
          onDeleted: () => { setSettingsBot(null); com.reload?.(); },
        })) : null));
}

// A render error inside a slot must not blank the host's webview. This boundary keeps the rest of
// DeepSeek alive and leaves evidence behind (console + the host's client-status file).
let CrashBoundary = null;
function guarded(Inner, where) {
  return function Guarded(props) {
    const R = need();
    if (!CrashBoundary) {
      CrashBoundary = class extends R.Component {
        constructor(p) { super(p); this.state = { error: null }; }
        static getDerivedStateFromError(error) { return { error }; }
        componentDidCatch(error, info) {
          try { console.error('[dsh-local-computer] ' + where + ' render failed', error, info); } catch { }
          try {
            report({
              at: new Date().toISOString(), renderError: String((error && error.message) || error),
              stack: String((error && error.stack) || '').split('\n').slice(0, 10), slot: where,
            });
          } catch { }
        }
        render() {
          if (!this.state.error) return this.props.children;
          return h('div', { className: 'wc-crash', role: 'alert', 'data-slot': where },
            h('div', { className: 'wc-crash-title' }, t('crash_title')),
            h('p', { className: 'wc-crash-text' }, t('crash_body')),
            h('code', { className: 'wc-crash-why' }, String((this.state.error && this.state.error.message) || this.state.error)),
            h('button', { type: 'button', className: 'wc-btn', onClick: () => this.setState({ error: null }) }, t('retry')));
        }
      };
    }
    return h(CrashBoundary, null, h(Inner, props));
  };
}

function apply(ctx) {
  ensureStyle();
  // cordis' ctx THROWS for a service this module did not declare in `inject`, so every access
  // beyond the declared `slots` has to be behind a guard — optional chaining does not help.
  try { setRemote(ctx?.remote); } catch { }
  try { ctx.locale?.register?.(NS, { zh: LOCALE.zh, en: LOCALE.en }); } catch { }
  const reg = (name, fn) => { try { fn(); return [name, 'ok']; } catch (e) { console.error(`[${NS}] slot ${name} failed:`, e); return [name, String(e?.message || e)]; } };
  const r1 = reg('sidebar.panellist', () => ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: VIEW_KEY, order: 10, locale: NS, label: () => t('entry') }, guarded(WorldEntry, 'sidebar.panellist'))));
  const r2 = reg('main', () => ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: VIEW_KEY }, guarded(WorldPage, 'main'))));
  // Report our own mount so the host side can state, with evidence, whether the page is live.
  // The probe takes a thunk: `ctx.remote` must not be evaluated outside the try.
  const has = (probe) => { try { return probe() != null; } catch { return false; } };
  report({
    at: new Date().toISOString(), build: BUILD, slots: [r1, r2],
    remote: has(() => ctx.remote.agentCommunity), locale: has(() => ctx.locale), slotsApi: has(() => ctx.slots),
  });
}

const inject = [];

// Self-register with the dsh renderer's module loader, the same way the shipped client bundles do.

  const API = { name: NS, apply, WorldPage, WorldEntry, LOCALE, endpoint, api, act: communityAct, CSS, STYLE_ID, guarded,
    Transcript, RunList, RunRow, BotDetail, MentionText, MachineZone, ProposalCard, ProposalList, TeamApprovalCard, TeamApprovalList, QuestionCard, QuestionList, NewRoomForm, TaskBoard, Composer, NewBotForm, BrainSection, PendingRow, normalizeCommunity, community };
  API.__setReact = (R) => { React = R; };
  API.__setRemote = (r) => { try { setRemote(r); } catch (e) { } };
  if (root && root.__ModuleLoader__ && root.__ModuleLoader__.load) {
    root.__ModuleLoader__.load({
      id: NS,
      factory: function (require) {
        const React_ = require("react");
        API.__setReact(React_);
        return {
          inject: ["slots", "remote"],
          apply: function (ctx) {
            // Nothing this module does may take web boot down: a throw here previously surfaced as
            // "dsh-local-computer: failed" and blocked the whole app. Report it instead.
            try {
              try { API.__setRemote(ctx && ctx.remote); } catch (e) { }
              return apply(ctx);
            } catch (e) {
              try { console.error('[' + NS + '] apply() failed, continuing without the page:', e); } catch (e2) { }
              try { report({ at: new Date().toISOString(), error: String(e && e.message || e) }); } catch (e3) { }
              return { inject: [] };
            }
          },
        };
      },
    });
  }
  root.__DSH_LOCAL_COMPUTER__ = API;
})(typeof window !== "undefined" ? window : globalThis);
