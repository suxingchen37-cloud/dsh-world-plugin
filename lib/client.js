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
let ReactDOM = (typeof globalThis !== 'undefined' && globalThis.__DSH_REACT_DOM__) || null;
let HOST_LAYOUT = null;
const need = () => { if (!React) throw new Error('dsh-local-computer: React not supplied to this client bundle'); return React; };
const h = (...a) => need().createElement(...a);
const useState = (...a) => need().useState(...a);
const useEffect = (...a) => need().useEffect(...a);
const useCallback = (...a) => need().useCallback(...a);
const useMemo = (...a) => need().useMemo(...a);
const useRef = (...a) => need().useRef(...a);

const NS = 'dsh-local-computer';
const BUILD = '2026-10-22.26';
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
    return_host: '返回 DeepSeek', host_restored: '已退出共振，可从左侧选择 DeepSeek 的原有功能。',
    space_description: 'AI 协作空间', nav_chat: '对话', nav_team: '伙伴', nav_memory: '记忆', nav_computer: '本机', nav_activity: '进展',
    team_hint: '选择一位伙伴开始私聊，或查看它的职责与设置。', activity_hint: '这里展示所有会话的真实运行记录。',
    entry: '共振', title: '共振', machine: '本机', pending: '待审批', permissions: '已长期允许',
    subtitle: 'DeepSeek 要动你的电脑时，先在这里问你。',
    autonomy_on: '自主运行', autonomy_off: '等你批准',
    autonomy_on_hint: 'AI 可以自己批准并执行', autonomy_off_hint: 'AI 会停下来问你',
    autonomy_failed: '切换没生效：',
    audit: '执行记录', args: '参数', details: '详情', hide: '收起', allow: '允许一次', always: '总是允许',
    deny: '拒绝', refreshing: '同步中', refresh: '立即同步', connected: '已连接', disconnected: '未连接本机执行服务',
    offline_body: '这一区靠本机的回环端口（47831–47835）连宿主，现在连不上。三种可能：① 宿主没在跑 —— 在客户端里重开一次「共振」；② 这段端口被别的程序占了 —— 宿主会退回随机端口，页面就再也找不到它；③ 防火墙拦了回环。Bot 与房间不依赖它，照常可用。',
    firstrun: '本机执行默认要你批准：AI 不能自己批自己，每条命令都会停下来等你。想让它自己跑，把右上角那个开关打开。',
    firstrun_ok: '知道了',
    onboard_title: '欢迎用「共振」',
    nav_home: '协作现场', nav_sessions: '会话', nav_cast: '角色', nav_projects: '项目', nav_caps: '能力',
    pos_ceo: 'CEO', pos_manager: '经理', pos_lead: '组长', pos_member: '组员', seat_empty: '待任命',
    need_you: '需要你决定', crew: '你的协作团队', crew_hint: '常驻成员', onboard_back: '上一步', onboard_next: '下一步', onboard_skip: '跳过引导', onboard_done: '开始使用',
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
    prime: 'CEO', rank_label: '等级', rank_direction: '经理', rank_officer: '组长', rank_execution: '组员',
    rank_hint: '等级从高到低：CEO > 经理 > 组长 > 组员。经理和 CEO 能设目标、拆任务、派活、控运行；组长独管一个具体领域；组员在最底层，只执行派下来的任务。',
    domain_label: '负责范围', domain_ph: '例如：生活、工作（组长一般要填）',
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
    return_host: 'Back to DeepSeek', host_restored: 'Resonance closed. Choose a DeepSeek feature in the sidebar.',
    space_description: 'AI collaboration space', nav_chat: 'Chats', nav_team: 'Team', nav_memory: 'Memory', nav_computer: 'Computer', nav_activity: 'Activity',
    team_hint: 'Start a direct chat or inspect a bot’s responsibilities and settings.', activity_hint: 'Real run history across conversations.',
    entry: 'Resonance', title: 'Resonance', machine: 'This machine', pending: 'Pending', permissions: 'Standing grants',
    subtitle: 'Every local action waits here for you first.',
    autonomy_on: 'Autonomous', autonomy_off: 'Waits for you',
    autonomy_on_hint: 'The agent approves and runs its own tickets', autonomy_off_hint: 'The agent stops and asks you first',
    autonomy_failed: 'The switch did not take effect: ',
    audit: 'Audit', args: 'arguments', details: 'Details', hide: 'Hide', allow: 'Allow once', always: 'Always allow',
    deny: 'Deny', refreshing: 'Syncing', refresh: 'Sync now', connected: 'Connected', disconnected: 'Local computer service unreachable',
    offline_body: 'This area reaches the host over loopback (ports 47831-47835) and cannot right now. Three usual causes: ① the host is not running — reopen Resonance in the client; ② another program is holding that port range, so the host fell back to a random port the page can never find; ③ a firewall is blocking loopback. Bots and rooms do not depend on it.',
    firstrun: 'Local execution waits for you by default: the agent cannot approve its own commands. Turn on 自主运行 (top right) if you want it to run unattended.',
    firstrun_ok: 'Got it',
    onboard_title: 'Welcome to Resonance',
    nav_home: 'Workspace', nav_sessions: 'Sessions', nav_cast: 'Cast', nav_projects: 'Projects', nav_caps: 'Capabilities',
    pos_ceo: 'CEO', pos_manager: 'Manager', pos_lead: 'Lead', pos_member: 'Member', seat_empty: 'Unassigned',
    need_you: 'Needs you', crew: 'Your crew', crew_hint: 'Standing members', onboard_back: 'Back', onboard_next: 'Next', onboard_skip: 'Skip', onboard_done: 'Start',
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

/*<RS-CSS>*/
const RS_CSS = `/* 共振 visual language, ported from the user's prototype and scoped under .rs-root
   so nothing here can reach the host's own chrome. */
.rs-root {display:block;min-height:100%;
  --bg:#f3f1e9;--paper:#fbfaf5;--ink:#20241e;--muted:#81867b;--line:#deded2;
  --night:#101310;--night2:#191d18;--night3:#252b23;--nightline:#30372e;
  --lime:#d9f875;--blue:#7e88ff;--coral:#ff886e;--mint:#83d9bd;--lav:#c4b6ff;
  --shadow:0 24px 60px #10131014;--ease:cubic-bezier(.2,.75,.25,1);
}

.rs-root * {box-sizing:border-box}
.rs-root,
.rs-root {margin:0;min-height:100%;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--bg)}
.rs-root button,
.rs-root input,
.rs-root textarea,
.rs-root select {font:inherit}
.rs-root button {cursor:pointer}
.rs-root button:focus-visible,
.rs-root input:focus-visible,
.rs-root textarea:focus-visible,
.rs-root select:focus-visible {outline:2px solid var(--blue);outline-offset:3px}
.rs-root svg {width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.rs-root button {border:0}
.rs-root .app {display:grid;grid-template-columns:70px minmax(420px,1fr) 292px;min-height:100vh}
.rs-root .rail {height:100vh;position:sticky;top:0;background:var(--night);color:#c8cec1;display:flex;flex-direction:column;align-items:center;padding:17px 0 13px;z-index:20}
.rs-root .logo {width:39px;height:39px;display:grid;place-items:center;color:var(--night);background:var(--lime);border-radius:14px;font-size:24px;font-weight:900;transform:rotate(-8deg);margin-bottom:31px;box-shadow:0 0 30px #d9f87516}
.rs-root .rail-nav {display:flex;flex-direction:column;gap:9px;width:100%;align-items:center}
.rs-root .rail-btn {width:44px;height:44px;border-radius:14px;background:transparent;color:#7e8779;display:grid;place-items:center;position:relative;transition:all .22s var(--ease)}
.rs-root .rail-btn:hover {color:#f5f8ee;background:#222820}
.rs-root .rail-btn.active {background:#2b3327;color:var(--lime)}
.rs-root .rail-btn.active:before {content:"";position:absolute;left:-13px;width:3px;height:22px;border-radius:0 4px 4px 0;background:var(--lime)}
.rs-root .rail-btn svg {width:19px;height:19px}
.rs-root .rail-spacer {flex:1}
.rs-root .rail-bottom {display:flex;flex-direction:column;gap:12px;align-items:center}
.rs-root .rail-avatar {width:35px;height:35px;border-radius:50%;background:#e9cbb7;color:#684b39;display:grid;place-items:center;font-weight:800;font-size:11px;border:2px solid #343a30}
.rs-root .rail-tip {font-size:8px;color:#737d6e;writing-mode:vertical-rl;letter-spacing:.18em;margin-top:12px}
.rs-root .center {min-width:0;min-height:100vh;display:flex;flex-direction:column;position:relative}
.rs-root .topbar {height:66px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 29px;border-bottom:1px solid #dfded4;background:#f3f1e9c9;backdrop-filter:blur(16px);position:sticky;top:0;z-index:10}
.rs-root .brandline {display:flex;align-items:center;gap:9px;font-size:10px;color:#878b80}
.rs-root .brandline .slash {color:#c4c5ba}
.rs-root .brandline strong {font-size:10px;color:#30352d;font-weight:800}
.rs-root .top-actions {margin-left:auto;display:flex;align-items:center;gap:8px}
.rs-root .status-pill {display:flex;align-items:center;gap:7px;font-size:9px;color:#52632d;border:1px solid #d4dfbd;background:#f7f9ee;padding:7px 10px;border-radius:99px}
.rs-root .status-dot {width:6px;height:6px;background:#9ebd4c;border-radius:50%;box-shadow:0 0 0 3px #a6c35b22}
.rs-root .quiet-btn {width:34px;height:34px;border:1px solid #e1dfd5;background:#fbfaf5;border-radius:11px;display:grid;place-items:center;color:#74796f;transition:.2s}
.rs-root .quiet-btn:hover {background:white;color:#242920;border-color:#c7c9bc}
.rs-root .quiet-btn svg {width:16px;height:16px}
.rs-root .content {width:100%;max-width:1260px;margin:0 auto;padding:30px 34px 150px}
.rs-root .view {display:none;animation:rs-arrive .32s var(--ease)}
.rs-root .view.active {display:block}
@keyframes rs-arrive {from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
.rs-root .kicker {font-size:9px;letter-spacing:.18em;text-transform:uppercase;font-weight:850;color:#8c9185}
.rs-root .headline {font-size:clamp(30px,3.6vw,48px);letter-spacing:-.075em;line-height:1.09;font-weight:850;margin:12px 0 12px;max-width:700px}
.rs-root .headline .marked {position:relative;z-index:0;white-space:nowrap}
.rs-root .headline .marked:after {content:"";position:absolute;z-index:-1;height:11px;left:-1px;right:-2px;bottom:2px;border-radius:5px;background:var(--lime);transform:rotate(-1.3deg)}
.rs-root .intro {font-size:12px;line-height:1.85;color:#7a8074;max-width:570px;margin:0}
.rs-root .opening {display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.rs-root .opening-copy {flex:1;min-width:0}
.rs-root .day-mark {width:98px;height:98px;position:relative;flex-shrink:0;margin:10px 6px 0 0}
.rs-root .day-mark .ring {position:absolute;inset:7px;border:1px solid #d0d4c4;border-radius:50%;transform:rotate(24deg)}
.rs-root .day-mark .ring:after {content:"";position:absolute;inset:12px -7px;border:1px solid #d0d4c4;border-radius:50%;transform:rotate(-58deg)}
.rs-root .day-mark .sun {position:absolute;inset:27px;border-radius:14px;background:var(--night);color:var(--lime);display:grid;place-items:center;font-size:23px;transform:rotate(-9deg);box-shadow:0 10px 20px #1013101a}
.rs-root .day-mark .sat {position:absolute;width:12px;height:12px;border-radius:50%;background:var(--coral);top:8px;right:2px;border:3px solid var(--bg)}
.rs-root .stage {position:relative;min-height:320px;margin:25px 0 17px;overflow:hidden;border-radius:22px;background:var(--night);color:#f1f4e9;isolation:isolate}
.rs-root .stage:before {content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 53%,#343c2d 0%,#1c211b 38%,#101310 77%);z-index:-2}
.rs-root .stage:after {content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,transparent,#6a755c,transparent);opacity:.4}
.rs-root .stage-top {position:absolute;left:22px;right:22px;top:19px;display:flex;align-items:center;gap:8px;z-index:5}
.rs-root .stage-label {font-size:9px;color:#a4ad99;letter-spacing:.11em}
.rs-root .stage-live {margin-left:auto;font-size:8px;display:flex;align-items:center;gap:6px;color:#bac5af}
.rs-root .stage-live .status-dot {background:var(--lime);box-shadow:0 0 0 3px #d9f87516}
.rs-root .stage-number {font-size:8px;color:#697263;border:1px solid #353d31;border-radius:7px;padding:5px 7px}
.rs-root .orbit {position:absolute;left:50%;top:52%;width:min(440px,75%);height:218px;border:1px solid #515a47;border-radius:50%;transform:translate(-50%,-50%) rotate(-13deg);opacity:.45}
.rs-root .orbit:before,
.rs-root .orbit:after {content:"";position:absolute;inset:18px 57px;border:1px solid #515a47;border-radius:50%;transform:rotate(58deg)}
.rs-root .orbit:after {inset:-17px 110px;transform:rotate(-30deg);opacity:.7}
.rs-root .stage-core {position:absolute;left:50%;top:52%;width:86px;height:86px;border-radius:27px;transform:translate(-50%,-50%) rotate(-8deg);background:var(--lime);color:#1b2115;display:grid;place-items:center;font-size:37px;font-weight:900;box-shadow:0 0 0 12px #d9f87508,0 18px 55px #0006;animation:rs-corefloat 5s ease-in-out infinite}
@keyframes rs-corefloat {0%,100%{margin-top:0}50%{margin-top:-7px}}
.rs-root .stage-core:after {content:"";position:absolute;inset:-8px;border:1px solid #d9f87555;border-radius:31px;transform:rotate(18deg)}
.rs-root .stage-caption {position:absolute;left:50%;top:calc(52% + 58px);transform:translateX(-50%);font-size:8px;color:#9da994;letter-spacing:.12em;white-space:nowrap}
.rs-root .character {position:absolute;width:96px;height:120px;display:flex;flex-direction:column;align-items:center;z-index:4;cursor:pointer;transition:transform .25s var(--ease);filter:drop-shadow(0 9px 14px #0003)}
.rs-root .character:hover {transform:translateY(-5px) scale(1.035)}
.rs-root .character .body {position:absolute;width:55px;height:52px;bottom:19px;border-radius:22px 22px 18px 18px;background:var(--char);border:1px solid #ffffff40;box-shadow:inset -7px -6px 0 #0000000c}
.rs-root .character .head {position:absolute;width:62px;height:57px;top:8px;border-radius:23px 23px 20px 20px;background:var(--char);border:1px solid #ffffff75;box-shadow:inset -6px -6px 0 #0000000d;z-index:2}
.rs-root .character .head:before,
.rs-root .character .head:after {content:"";position:absolute;width:6px;height:9px;border-radius:6px;background:#242920;top:24px}
.rs-root .character .head:before {left:17px}
.rs-root .character .head:after {right:17px}
.rs-root .character .mouth {position:absolute;top:38px;left:50%;width:12px;height:6px;border-bottom:2px solid #30352c;border-radius:0 0 12px 12px;transform:translateX(-50%);z-index:3}
.rs-root .character .cheek {position:absolute;width:8px;height:5px;background:#ffffff7a;border-radius:50%;top:34px;z-index:3}
.rs-root .character .cheek.left {left:7px}
.rs-root .character .cheek.right {right:7px}
.rs-root .character .antenna {position:absolute;top:0;left:50%;width:2px;height:13px;background:var(--char);transform:translateX(-50%);z-index:1}
.rs-root .character .antenna:after {content:"";position:absolute;width:8px;height:8px;border-radius:50%;background:var(--char);top:-3px;left:-3px;box-shadow:0 0 0 2px #ffffff30}
.rs-root .character .feet {position:absolute;bottom:10px;display:flex;gap:17px;z-index:0}
.rs-root .character .feet i {width:14px;height:15px;background:var(--char);border-radius:3px 3px 8px 8px;display:block}
.rs-root .character .name {position:absolute;bottom:-4px;font-size:9px;font-weight:800;color:#e6ebdf;white-space:nowrap;letter-spacing:.01em}
.rs-root .character .role {position:absolute;bottom:-18px;font-size:7px;color:#9da794;white-space:nowrap}
.rs-root .character.ace {--char:#d9f875;left:calc(50% - 191px);top:calc(52% - 49px);animation:rs-buddyA 5.1s ease-in-out infinite}
.rs-root .character.ace .head {border-radius:23px 23px 18px 18px}
.rs-root .character.ace .antenna {height:18px}
.rs-root .character.he {--char:#83d9bd;left:calc(50% + 93px);top:calc(52% - 57px);animation:rs-buddyB 5.8s ease-in-out infinite}
.rs-root .character.he .head {border-radius:27px 20px 24px 20px}
.rs-root .character.he .head:before {height:7px;width:7px}
.rs-root .character.li {--char:#bdb1ff;left:calc(50% - 43px);top:calc(52% + 59px);transform:scale(.78);animation:rs-buddyC 6s ease-in-out infinite}
.rs-root .character.li .head {border-radius:20px 20px 25px 25px}
@keyframes rs-buddyA {0%,100%{margin-top:0}50%{margin-top:-8px}}
@keyframes rs-buddyB {0%,100%{margin-top:0}50%{margin-top:7px}}
@keyframes rs-buddyC {0%,100%{margin-top:0}50%{margin-top:-5px}}
.rs-root .speech {position:absolute;z-index:5;padding:8px 11px;border-radius:12px 12px 12px 3px;background:#f2f4e9;color:#292f24;font-size:9px;line-height:1.5;box-shadow:0 7px 22px #0002;max-width:180px;animation:speechIn .45s var(--ease)}
.rs-root .speech:after {content:"";position:absolute;left:12px;bottom:-5px;border-width:5px 5px 0 0;border-style:solid;border-color:#f2f4e9 transparent transparent transparent}
.rs-root .speech.s1 {left:8%;top:31%}
.rs-root .speech.s2 {right:7%;top:30%;background:#d9f875;color:#27301c;border-radius:12px 12px 3px 12px}
.rs-root .speech.s2:after {left:auto;right:12px;border-color:#d9f875 transparent transparent transparent}
.rs-root .speech.s3 {left:31%;bottom:14%;background:#dcd6ff;color:#2c2b43}
.rs-root .speech.s3:after {border-color:#dcd6ff transparent transparent transparent}
.rs-root .stage-footer {position:absolute;left:22px;right:22px;bottom:15px;display:flex;align-items:center;gap:9px;z-index:6}
.rs-root .stage-footer .mini-line {width:23px;height:1px;background:#59634f}
.rs-root .stage-footer span {font-size:8px;color:#87917e}
.rs-root .stage-footer .stage-action {margin-left:auto;background:transparent;color:var(--lime);font-size:9px;display:flex;align-items:center;gap:6px}
.rs-root .stage-action svg {width:13px;height:13px}
.rs-root .stage-action:hover {color:#f2ffd1}
.rs-root .pulse-ring {position:absolute;left:50%;top:52%;width:126px;height:126px;border:1px solid #d9f87530;border-radius:50%;transform:translate(-50%,-50%);animation:rs-pulse 3.2s ease-out infinite}
@keyframes rs-pulse {0%{transform:translate(-50%,-50%) scale(.8);opacity:.7}100%{transform:translate(-50%,-50%) scale(1.8);opacity:0}}
.rs-root .stage.is-working .stage-core {animation:rs-corefloat 1.5s ease-in-out infinite}
.rs-root .stage.is-working .stage-live {color:var(--lime)}
.rs-root .stage.is-working .stage-live .status-dot {animation:rs-blink 1s ease-in-out infinite}
@keyframes rs-blink {50%{opacity:.3}}
.rs-root .below-stage {display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0 26px}
.rs-root .presence-label {font-size:9px;color:#8a8f84;margin-right:2px}
.rs-root .presence {display:flex;align-items:center;gap:6px;border:1px solid #e0ded4;background:#f8f7f0;padding:6px 9px 6px 6px;border-radius:99px;color:#666d60;font-size:8px}
.rs-root .presence .tiny {width:19px;height:19px;border-radius:7px;display:grid;place-items:center;font-size:8px;font-weight:900;color:#1d2419;background:var(--lime)}
.rs-root .presence .tiny.mint {background:var(--mint)}
.rs-root .presence .tiny.lav {background:var(--lav)}
.rs-root .presence .tiny.coral {background:var(--coral)}
.rs-root .presence .state {color:#9ba08f;font-size:7px}
.rs-root .add-presence {display:flex;align-items:center;gap:5px;color:#6e7567;background:transparent;font-size:9px;padding:7px}
.rs-root .add-presence:hover {color:#222820}
.rs-root .add-presence svg {width:14px;height:14px}
.rs-root .section-heading {display:flex;align-items:baseline;gap:10px;margin:25px 0 10px}
.rs-root .section-heading h2 {font-size:13px;letter-spacing:-.03em;margin:0;font-weight:850}
.rs-root .section-heading span {font-size:9px;color:#92968b}
.rs-root .section-heading button {margin-left:auto;background:transparent;color:#5964d8;font-size:9px;font-weight:800}
.rs-root .timeline {position:relative;padding:4px 0 0 7px}
.rs-root .timeline:before {content:"";position:absolute;top:10px;bottom:16px;left:14px;width:1px;background:#d8d9cd}
.rs-root .event {position:relative;display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;padding:9px 0 14px;align-items:start}
.rs-root .event-marker {position:relative;width:16px;height:16px;border-radius:50%;background:var(--bg);border:1px solid #b7bcaa;display:grid;place-items:center;margin-top:2px;z-index:1}
.rs-root .event-marker:after {content:"";width:5px;height:5px;border-radius:50%;background:#8eaa4b}
.rs-root .event-marker.blue:after {background:#7983ef}
.rs-root .event-marker.coral:after {background:#ef8a70}
.rs-root .event-body {min-width:0}
.rs-root .event-meta {display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px}
.rs-root .event-meta strong {font-size:9px;font-weight:850}
.rs-root .event-meta span {font-size:8px;color:#999d92}
.rs-root .event-text {font-size:10px;color:#747a6f;line-height:1.7;max-width:700px}
.rs-root .event-time {font-size:8px;color:#a4a79e;white-space:nowrap;padding-top:3px}
.rs-root .event-tag {display:inline-flex;align-items:center;gap:4px;font-size:7px;color:#6a793f;background:#edf3dd;padding:4px 6px;border-radius:5px}
.rs-root .event-tag.review {color:#626bc4;background:#edeeff}
.rs-root .composer-dock {position:fixed;z-index:15;left:calc(70px + (100vw - 70px - 292px)/2);bottom:17px;transform:translateX(-50%);width:min(760px,calc(100vw - 440px));background:#171b16;color:#eef2e8;border:1px solid #333b30;border-radius:19px;box-shadow:0 20px 60px #11140f30;padding:12px 13px 10px}
.rs-root .composer-dock:before {content:"";position:absolute;right:8%;top:-1px;width:120px;height:1px;background:var(--lime);opacity:.7}
.rs-root .composer-main {display:flex;align-items:flex-end;gap:10px}
.rs-root .composer-icon {width:31px;height:31px;border-radius:10px;background:var(--lime);color:#20251b;display:grid;place-items:center;font-size:17px;flex-shrink:0;margin-bottom:1px}
.rs-root #prompt {flex:1;min-width:0;min-height:34px;max-height:120px;resize:vertical;border:0;background:transparent;color:#f3f6ed;font-size:12px;line-height:1.65;padding:6px 0;outline:none}
.rs-root #prompt::placeholder {color:#818a7a}
.rs-root .send {width:35px;height:35px;border-radius:11px;background:var(--lime);color:#1c2117;display:grid;place-items:center;flex-shrink:0;transition:.18s}
.rs-root .send:hover {background:#ebff9c;transform:translateY(-2px)}
.rs-root .send svg {width:16px;height:16px}
.rs-root .composer-tools {display:flex;align-items:center;gap:7px;margin-top:8px;padding-top:8px;border-top:1px solid #30372e;flex-wrap:wrap}
.rs-root .mode-switch {display:flex;align-items:center;gap:2px;padding:3px;background:#242a22;border-radius:9px}
.rs-root .mode-switch button {padding:6px 8px;font-size:8px;color:#9ca594;border-radius:6px;background:transparent}
.rs-root .mode-switch button.active {background:#3b4432;color:var(--lime)}
.rs-root .domain-button,
.rs-root .tool-chip {display:flex;align-items:center;gap:5px;border:1px solid #3a4135;border-radius:8px;background:transparent;color:#a9b19f;font-size:8px;padding:7px 8px}
.rs-root .domain-button:hover,
.rs-root .tool-chip:hover {color:#f4f7ef;border-color:#69765a}
.rs-root .domain-button svg,
.rs-root .tool-chip svg {width:12px;height:12px}
.rs-root .dock-hint {margin-left:auto;color:#737e6b;font-size:8px}
.rs-root .right {height:100vh;position:sticky;top:0;overflow-y:auto;background:#faf9f3;border-left:1px solid #e0dfd4;padding:24px 18px 24px}
.rs-root .right-head {display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.rs-root .right-head strong {font-size:11px;letter-spacing:-.01em}
.rs-root .right-head span {font-size:8px;color:#999d92;letter-spacing:.12em}
.rs-root .conductor {padding-bottom:20px;border-bottom:1px solid var(--line)}
.rs-root .conductor-top {display:flex;gap:11px;align-items:center}
.rs-root .conductor-copy {flex:1;min-width:0}
.rs-root .conductor-copy strong {font-size:10px;display:block}
.rs-root .conductor-copy span {font-size:8px;color:#858b7e;display:block;margin-top:4px;line-height:1.5}
.rs-root .conductor p {font-size:9px;line-height:1.75;color:#7e8478;margin:13px 0 0}
.rs-root .big-avatar {width:45px;height:45px;border-radius:16px;background:var(--lime);position:relative;display:grid;place-items:center;flex-shrink:0}
.rs-root .big-avatar .face {width:25px;height:24px;border-radius:10px 10px 8px 8px;background:#273020;position:relative}
.rs-root .big-avatar .face:before {content:"••";position:absolute;top:2px;left:4px;color:var(--lime);font-size:12px;letter-spacing:3px}
.rs-root .big-avatar .face:after {content:"";position:absolute;width:7px;height:3px;border-bottom:1.5px solid var(--lime);border-radius:0 0 5px 5px;left:9px;top:15px}
.rs-root .right-section {padding:19px 0;border-bottom:1px solid var(--line)}
.rs-root .right-section-head {display:flex;align-items:baseline;gap:7px;margin-bottom:13px}
.rs-root .right-section-head strong {font-size:10px}
.rs-root .right-section-head span {margin-left:auto;font-size:8px;color:#9a9e94}
.rs-root .member {display:flex;align-items:center;gap:9px;padding:8px 0;cursor:pointer}
.rs-root .member:hover .member-name {color:#5964d8}
.rs-root .member-avatar {width:32px;height:32px;border-radius:11px;display:grid;place-items:center;color:#20251c;font-size:11px;font-weight:900;flex-shrink:0;position:relative}
.rs-root .member-avatar:after {content:"";position:absolute;right:-2px;bottom:-2px;width:7px;height:7px;border:2px solid #faf9f3;border-radius:50%;background:#9cbd4b}
.rs-root .member-avatar.mint {background:var(--mint)}
.rs-root .member-avatar.lav {background:var(--lav)}
.rs-root .member-avatar.coral {background:var(--coral)}
.rs-root .member-avatar.blue {background:#b4d5ff}
.rs-root .member-copy {flex:1;min-width:0}
.rs-root .member-name {font-size:9px;font-weight:850;display:block;transition:.15s}
.rs-root .member-desc {font-size:8px;color:#909589;display:block;margin-top:4px}
.rs-root .member-status {font-size:7px;color:#82954f;white-space:nowrap}
.rs-root .member-status.idle {color:#a1a498}
.rs-root .member-status.working {color:#5e6acb}
.rs-root .empty-expert {font-size:9px;color:#92978b;line-height:1.7;padding:5px 0 7px}
.rs-root .right-link {display:flex;align-items:center;gap:7px;background:transparent;color:#5d67d7;font-size:8px;font-weight:800;padding:8px 0}
.rs-root .right-link svg {width:13px;height:13px}
.rs-root .live-event {display:flex;gap:9px;align-items:flex-start;padding:8px 0}
.rs-root .live-event .bullet {width:7px;height:7px;border-radius:50%;background:var(--coral);margin-top:4px;flex-shrink:0}
.rs-root .live-event .bullet.green {background:#99b64d}
.rs-root .live-event .bullet.blue {background:#7d86f3}
.rs-root .live-event p {font-size:8px;line-height:1.65;color:#72796d;margin:0}
.rs-root .live-event time {display:block;font-size:7px;color:#a2a69a;margin-top:3px}
.rs-root .right-note {font-size:8px;line-height:1.7;color:#a0a498;margin-top:17px}
.rs-root /
.page-title {margin:9px 0 25px}
.rs-root .page-title h1 {font-size:35px;letter-spacing:-.065em;margin:9px 0}
.rs-root .page-title p {font-size:11px;color:#7c8276;line-height:1.8;margin:0;max-width:620px}
.rs-root .view-tabs {display:flex;gap:18px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
.rs-root .view-tabs button {position:relative;background:transparent;color:#858a7f;padding:12px 0;font-size:9px}
.rs-root .view-tabs button.active {color:#242920;font-weight:850}
.rs-root .view-tabs button.active:after {content:"";position:absolute;bottom:-1px;left:0;right:0;height:2px;background:#252a22}
.rs-root .role-stage {background:var(--night);border-radius:22px;min-height:250px;padding:26px;position:relative;overflow:hidden;color:#f4f6ed;margin-bottom:25px}
.rs-root .role-stage:after {content:"✳";position:absolute;right:5%;top:-48px;font-size:230px;color:#d9f87508;transform:rotate(-15deg);pointer-events:none}
.rs-root .role-stage-label {font-size:8px;letter-spacing:.14em;color:#9da795}
.rs-root .role-stage h2 {font-size:24px;letter-spacing:-.05em;margin:13px 0 8px}
.rs-root .role-stage p {font-size:10px;color:#aeb7a5;line-height:1.8;max-width:480px;margin:0}
.rs-root .role-stage .role-stage-action {margin-top:19px;background:var(--lime);color:#22271c;padding:9px 12px;border-radius:9px;font-size:9px;font-weight:850}
.rs-root .cast-list {border-top:1px solid var(--line)}
.rs-root .cast-row {display:grid;grid-template-columns:54px minmax(0,1fr) minmax(130px,220px) auto;gap:13px;align-items:center;padding:15px 0;border-bottom:1px solid var(--line);cursor:pointer;transition:.15s}
.rs-root .cast-row:hover {padding-left:5px;background:#eeede5}
.rs-root .cast-art {width:47px;height:51px;position:relative;display:grid;place-items:center}
.rs-root .cast-art .blob {width:39px;height:39px;border-radius:15px;background:var(--cast);position:relative;box-shadow:inset -5px -5px 0 #0000000d}
.rs-root .cast-art .blob:before {content:"••";position:absolute;top:10px;left:9px;color:#242920;letter-spacing:5px;font-size:11px}
.rs-root .cast-art .blob:after {content:"";position:absolute;left:15px;top:24px;width:8px;height:3px;border-bottom:1.5px solid #242920;border-radius:0 0 4px 4px}
.rs-root .cast-main strong {font-size:11px;display:block}
.rs-root .cast-main span {font-size:8px;color:#8c9186;display:block;margin-top:5px}
.rs-root .cast-description {font-size:9px;color:#747a6f;line-height:1.65}
.rs-root .cast-row button {background:transparent;color:#5f69d8;font-size:9px;font-weight:800;padding:8px}
.rs-root .editorial-list {border-top:1px solid var(--line)}
.rs-root .editorial-row {display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;align-items:center;padding:17px 0;border-bottom:1px solid var(--line)}
.rs-root .editorial-index {font-size:10px;color:#9aa092;font-weight:850}
.rs-root .editorial-main strong {font-size:11px;display:block}
.rs-root .editorial-main p {font-size:9px;color:#7f8579;line-height:1.7;margin:5px 0 0;max-width:650px}
.rs-root .editorial-meta {font-size:8px;color:#92978b;text-align:right;white-space:nowrap}
.rs-root .editorial-row button {background:transparent;color:#5e68d8;font-size:9px;font-weight:800}
.rs-root .project-scope {display:flex;align-items:center;gap:10px;margin:0 0 22px;flex-wrap:wrap}
.rs-root .scope-pill {font-size:8px;color:#6f7669;border:1px solid #deded2;border-radius:99px;padding:7px 10px;background:#f8f7f0}
.rs-root .scope-pill.active {background:var(--night);color:var(--lime);border-color:var(--night)}
.rs-root .modal-shade {position:fixed;inset:0;background:#0e110e99;backdrop-filter:blur(7px);z-index:100;display:none;align-items:center;justify-content:center;padding:18px}
.rs-root .modal-shade.open {display:flex}
.rs-root .modal {width:min(460px,100%);background:#fbfaf5;border-radius:18px;overflow:hidden;box-shadow:0 25px 90px #0005;animation:rs-arrive .2s var(--ease)}
.rs-root .modal-head {padding:19px 20px 15px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
.rs-root .modal-head strong {font-size:13px}
.rs-root .modal-head span {display:block;font-size:9px;color:#8c9186;margin-top:4px}
.rs-root .modal-close {margin-left:auto;background:#eeede5;width:29px;height:29px;border-radius:9px;font-size:18px;color:#6d7367}
.rs-root .modal-body {padding:18px 20px}
.rs-root .field {margin-bottom:14px}
.rs-root .field label {display:block;font-size:9px;font-weight:850;color:#5c6256;margin-bottom:7px}
.rs-root .field input,
.rs-root .field textarea,
.rs-root .field select {width:100%;border:1px solid #deded2;border-radius:10px;background:#fffef9;padding:11px;font-size:10px;color:#252a22}
.rs-root .field textarea {min-height:78px;resize:vertical;line-height:1.65}
.rs-root .modal-foot {display:flex;justify-content:flex-end;gap:8px;padding:13px 20px;border-top:1px solid var(--line)}
.rs-root .secondary {background:#efeee6;color:#63695e;padding:9px 12px;border-radius:9px;font-size:9px;font-weight:800}
.rs-root .primary {background:var(--night);color:var(--lime);padding:9px 13px;border-radius:9px;font-size:9px;font-weight:850}
.rs-root .toast {position:fixed;z-index:120;left:50%;bottom:25px;transform:translate(-50%,15px);opacity:0;pointer-events:none;background:#1b2019;color:#f2f5eb;border:1px solid #3a4333;border-radius:11px;padding:11px 15px;font-size:9px;transition:.25s;box-shadow:0 12px 30px #0002;max-width:calc(100vw - 28px)}
.rs-root .toast.show {opacity:1;transform:translate(-50%,0)}
.rs-root .disclaimer {font-size:8px;color:#9da293;line-height:1.7;margin-top:18px}
@media(max-width:1240px){
.rs-root .app {grid-template-columns:66px minmax(0,1fr)}
.rs-root .right {display:none}
.rs-root .composer-dock {left:calc(66px + (100vw - 66px)/2);width:min(760px,calc(100vw - 150px))}
.rs-root .topbar {padding:0 24px}
.rs-root .content {padding-left:25px;padding-right:25px}
}
@media(max-width:760px){
.rs-root .app {display:block}
.rs-root .rail {position:fixed;left:0;right:0;top:auto;bottom:0;width:100%;height:62px;min-height:0;flex-direction:row;padding:5px 10px;border-top:1px solid #30372e;justify-content:center}
.rs-root .logo,
.rs-root .rail-spacer,
.rs-root .rail-bottom,
.rs-root .rail-tip {display:none}
.rs-root .rail-nav {flex-direction:row;justify-content:space-around;gap:5px;width:100%}
.rs-root .rail-btn {width:44px;height:43px}
.rs-root .rail-btn.active:before {left:50%;top:-6px;width:20px;height:2px;border-radius:0 0 4px 4px;transform:translateX(-50%)}
.rs-root .center {padding-bottom:64px}
.rs-root .topbar {height:56px;padding:0 14px}
.rs-root .brandline {font-size:9px}
.rs-root .brandline strong {font-size:9px}
.rs-root .status-pill {display:none}
.rs-root .content {padding:22px 15px 155px}
.rs-root .headline {font-size:32px}
.rs-root .day-mark {width:65px;height:65px;margin:8px 0 0 -5px;transform:scale(.78);transform-origin:top right}
.rs-root .opening {gap:8px}
.rs-root .intro {font-size:11px}
.rs-root .stage {min-height:300px;margin-top:20px;border-radius:17px}
.rs-root .orbit {width:92%;height:170px}
.rs-root .stage-core {width:65px;height:65px;border-radius:21px;font-size:28px}
.rs-root .character {transform:scale(.72)}
.rs-root .character:hover {transform:scale(.76) translateY(-4px)}
.rs-root .character.ace {left:calc(50% - 150px);top:calc(52% - 39px)}
.rs-root .character.he {left:calc(50% + 60px);top:calc(52% - 42px)}
.rs-root .character.li {left:calc(50% - 35px);top:calc(52% + 46px)}
.rs-root .speech {font-size:8px;padding:7px 8px;max-width:135px}
.rs-root .speech.s1 {left:4%;top:25%}
.rs-root .speech.s2 {right:3%;top:25%}
.rs-root .speech.s3 {left:23%;bottom:13%}
.rs-root .stage-caption {top:calc(52% + 47px)}
.rs-root .stage-top {left:14px;right:14px;top:13px}
.rs-root .stage-footer {left:14px;right:14px;bottom:12px}
.rs-root .below-stage {gap:6px}
.rs-root .presence {padding:5px 7px 5px 5px}
.rs-root .presence-label {width:100%}
.rs-root .composer-dock {left:50%;bottom:71px;transform:translateX(-50%);width:calc(100vw - 20px);padding:10px;border-radius:16px}
.rs-root .composer-main {gap:7px}
.rs-root .composer-icon {width:28px;height:28px}
.rs-root .mode-switch button {padding:6px 6px;font-size:7px}
.rs-root .domain-button {font-size:7px;padding:6px}
.rs-root .tool-chip {display:none}
.rs-root .dock-hint {display:none}
.rs-root .composer-tools {gap:5px}
.rs-root .page-title h1 {font-size:30px}
.rs-root .role-stage {padding:21px;min-height:220px}
.rs-root .role-stage h2 {font-size:21px}
.rs-root .cast-row {grid-template-columns:43px minmax(0,1fr) auto;gap:9px}
.rs-root .cast-art {width:40px}
.rs-root .cast-description {display:none}
.rs-root .cast-main strong {font-size:10px}
.rs-root .cast-row button {font-size:8px;padding:6px}
.rs-root .editorial-row {grid-template-columns:25px minmax(0,1fr);gap:8px}
.rs-root .editorial-meta {grid-column:2;text-align:left}
.rs-root .editorial-row button {grid-column:2;justify-self:start;padding:3px 0}
.rs-root .event {grid-template-columns:24px minmax(0,1fr)}
.rs-root .event-time {display:none}
}
@media(max-width:390px){
.rs-root .day-mark {display:none}
.rs-root .headline {font-size:29px}
.rs-root .stage {min-height:285px}
.rs-root .character.ace {left:calc(50% - 130px)}
.rs-root .character.he {left:calc(50% + 42px)}
.rs-root .speech.s1 {left:3%;max-width:115px}
.rs-root .speech.s2 {right:2%;max-width:118px}
.rs-root .mode-switch button {padding:6px 4px}
.rs-root .status-pill {display:none}
}
.rs-root /
[hidden] {display:none!important}
.rs-root .character.is-listening .head {transform:scale(1.045) translateY(-2px)}
.rs-root .character.is-thinking .head {transform:rotate(5deg) translateY(-2px)}
.rs-root .character.is-thinking .antenna:after {box-shadow:0 0 0 4px #ffffff16,0 0 18px var(--char)}
.rs-root .character.is-speaking .mouth {height:8px;width:9px;border:2px solid #30352c;border-radius:50%;background:#30352c}
.rs-root .character.is-working .body {animation:rs-bodywork .72s ease-in-out infinite alternate}
.rs-root .character.is-confirming .head {transform:rotate(-4deg) scale(1.035)}
@keyframes rs-bodywork {from{transform:translateY(0)}to{transform:translateY(-4px)}}
.rs-root .work-surface {margin:29px 0 25px;padding:20px 0 18px;border-top:1px solid #d5d7ca;border-bottom:1px solid #d5d7ca;animation:rs-arrive .32s var(--ease)}
.rs-root .work-surface-head {display:flex;align-items:flex-start;gap:18px;justify-content:space-between;margin-bottom:18px}
.rs-root .work-surface-head h2 {font-size:22px;letter-spacing:-.055em;margin:8px 0 6px}
.rs-root .work-surface-head p {font-size:10px;line-height:1.75;color:#7e8478;margin:0;max-width:580px}
.rs-root .workspace-state {flex-shrink:0;display:flex;align-items:center;gap:7px;border:1px solid #d8dfc9;background:#f7f9ef;color:#687b3d;border-radius:99px;padding:7px 10px;font-size:8px}
.rs-root .workspace-state:before {content:"";width:6px;height:6px;border-radius:50%;background:#a1bd52}
.rs-root .workspace-layout {display:grid;grid-template-columns:minmax(0,1fr) 215px;gap:20px;align-items:start}
.rs-root .workspace-main {min-width:0}
.rs-root .workspace-toolbar {display:flex;align-items:center;gap:8px;padding:0 0 10px;border-bottom:1px solid #dfe0d5;margin-bottom:11px}
.rs-root .workspace-toolbar strong {font-size:10px}
.rs-root .workspace-toolbar span {font-size:8px;color:#92978b}
.rs-root .workspace-toolbar .workspace-kind {margin-left:auto;color:#777f6e;background:#e8ebdf;padding:5px 7px;border-radius:5px}
.rs-root .workspace-editor {display:block;width:100%;min-height:180px;resize:vertical;border:1px solid #dfe0d5;border-radius:10px;background:#fbfaf5;color:#34392f;padding:15px;font-size:10px;line-height:1.9;white-space:pre-wrap}
.rs-root .workspace-editor:focus {outline:2px solid #d9f875;outline-offset:1px}
.rs-root .workspace-note {font-size:8px;color:#9a9f93;line-height:1.7;margin-top:8px}
.rs-root .workspace-aside {border-left:1px solid #dfe0d5;padding:2px 0 0 17px;min-width:0}
.rs-root .workspace-aside h3 {font-size:10px;margin:0 0 8px}
.rs-root .workspace-aside p {font-size:9px;line-height:1.75;color:#777e71;margin:0 0 13px;overflow-wrap:anywhere}
.rs-root .workspace-aside .aside-label {font-size:8px;letter-spacing:.1em;color:#92988a;margin-bottom:7px}
.rs-root .workspace-rule {height:1px;background:#dedfd3;margin:13px 0}
.rs-root .workspace-checklist {display:flex;flex-direction:column;gap:10px}
.rs-root .workspace-check {display:flex;align-items:flex-start;gap:7px;font-size:9px;line-height:1.6;color:#737a6d;cursor:pointer}
.rs-root .workspace-check input {appearance:none;flex-shrink:0;width:13px;height:13px;border:1px solid #c7cbbd;border-radius:4px;margin:1px 0 0;background:#fbfaf5;cursor:pointer}
.rs-root .workspace-check input:checked {background:#22271e;border-color:#22271e;position:relative}
.rs-root .workspace-check input:checked:after {content:"✓";position:absolute;color:#d9f875;font-size:9px;left:2px;top:-2px}
.rs-root .workspace-check:has(input:checked) {color:#9a9f92;text-decoration:line-through}
.rs-root .workspace-foot {display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:15px;padding-top:13px;border-top:1px solid #dfe0d5}
.rs-root .workspace-footnote {font-size:8px;color:#999e91;line-height:1.7}
.rs-root .workspace-actions {display:flex;gap:7px}
.rs-root .workspace-btn {background:transparent;border:1px solid #d7d9cc;color:#686f61;border-radius:8px;padding:8px 10px;font-size:8px}
.rs-root .workspace-btn:hover {background:#ebece2}
.rs-root .workspace-btn.primary {background:#20251e;color:#d9f875;border-color:#20251e}
.rs-root .workspace-btn.primary:hover {background:#333b2d}
.rs-root .workspace-log {border-top:1px solid #dfe0d5}
.rs-root .workspace-log-row {display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:9px;align-items:start;padding:12px 0;border-bottom:1px solid #e2e2d8}
.rs-root .workspace-log-index {font-size:9px;color:#9aa091;padding-top:2px}
.rs-root .workspace-log-row strong {display:block;font-size:9px;margin-bottom:4px}
.rs-root .workspace-log-row p {font-size:8px;line-height:1.7;color:#83897d;margin:0}
.rs-root .workspace-log-state {font-size:7px;color:#8c927f;white-space:nowrap;border:1px solid #e0e1d7;border-radius:5px;padding:4px 6px}
.rs-root .workspace-log-state.pending {color:#777f6c;background:#f1f1e8}
.rs-root .workspace-log-state.done {color:#6d7d43;background:#eef3df;border-color:#dfe8cb}
.rs-root .workspace-output {padding:14px 0}
.rs-root .workspace-output h3 {font-size:11px;margin:0 0 7px}
.rs-root .workspace-output p {font-size:9px;line-height:1.8;color:#747b6e;margin:0}
@media(max-width:760px){
.rs-root .work-surface {margin:22px 0 21px;padding:17px 0}
.rs-root .work-surface-head {gap:9px}
.rs-root .work-surface-head h2 {font-size:19px}
.rs-root .workspace-state {font-size:7px;padding:6px 7px}
.rs-root .workspace-layout {grid-template-columns:1fr;gap:15px}
.rs-root .workspace-aside {border-left:0;border-top:1px solid #dfe0d5;padding:13px 0 0}
.rs-root .workspace-editor {min-height:155px;padding:12px}
.rs-root .workspace-foot {align-items:flex-start}
.rs-root .workspace-actions {width:100%}
.rs-root .workspace-actions button {flex:1}
}
.rs-root /
.workspace-control-strip {display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:-4px 0 17px;padding:10px 0 12px;border-bottom:1px solid #dfe0d5}
.rs-root .workspace-control-strip .control-label {font-size:8px;letter-spacing:.08em;color:#969b8f;margin-right:auto}
.rs-root .workspace-control-strip button {display:flex;align-items:center;gap:5px;background:transparent;border:1px solid #d9dbcf;border-radius:8px;padding:7px 9px;color:#676e61;font-size:8px}
.rs-root .workspace-control-strip button:hover {background:#e9ebdf;color:#2b3126}
.rs-root .workspace-control-strip button.warn {border-color:#e8c9bc;color:#a2644d}
.rs-root .workspace-control-strip button.warn:hover {background:#fff0e9}
.rs-root .workspace-control-strip button svg {width:12px;height:12px}
.rs-root .handoff-section {margin-top:18px;padding-top:15px;border-top:1px solid #dfe0d5}
.rs-root .handoff-head {display:flex;align-items:baseline;gap:8px;margin-bottom:9px}
.rs-root .handoff-head strong {font-size:10px}
.rs-root .handoff-head span {font-size:8px;color:#969b8f}
.rs-root .handoff-list {position:relative;padding-left:8px}
.rs-root .handoff-list:before {content:"";position:absolute;left:13px;top:8px;bottom:12px;width:1px;background:#d8dbcf}
.rs-root .handoff-item {position:relative;display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:9px;padding:8px 0 10px;align-items:start}
.rs-root .handoff-node {width:11px;height:11px;border-radius:50%;background:#f3f1e9;border:1px solid #aeb69d;position:relative;z-index:1;margin-top:2px}
.rs-root .handoff-node.current {background:#d9f875;border-color:#9bb64b;box-shadow:0 0 0 3px #d9f87528}
.rs-root .handoff-copy strong {font-size:9px;display:block;margin-bottom:4px}
.rs-root .handoff-copy p {font-size:8px;color:#7d8477;line-height:1.7;margin:0}
.rs-root .handoff-time {font-size:7px;color:#a1a698;white-space:nowrap;padding-top:2px}
.rs-root .previous-version {margin-top:12px;border-top:1px dashed #d6d9cc;padding-top:11px}
.rs-root .previous-version summary {font-size:8px;color:#747b6e;cursor:pointer}
.rs-root .previous-version p {font-size:8px;color:#969b8f;line-height:1.7;margin:8px 0 0}
.rs-root .status-paused {color:#986c3d!important;background:#fbf0dd!important;border-color:#e8d6b4!important}
.rs-root .status-confirm {color:#636bc5!important;background:#efefff!important;border-color:#d9d9fa!important}
.rs-root .session-current-label {font-size:8px;letter-spacing:.12em;color:#8b9184;margin:16px 0 4px}
.rs-root .session-task-state {display:inline-flex;align-items:center;gap:5px;border:1px solid #dfe1d6;border-radius:5px;padding:4px 6px;font-size:7px;color:#747b6e;margin-top:6px}
.rs-root .session-task-state:before {content:"";width:5px;height:5px;border-radius:50%;background:#a7bb63}
.rs-root .session-task-state.paused {color:#996e42;background:#fcf1df;border-color:#ead6b2}
.rs-root .session-task-state.done {color:#6c7850;background:#edf2df;border-color:#dfe8c9}
@media(max-width:760px){
.rs-root .workspace-control-strip {gap:5px}
.rs-root .workspace-control-strip .control-label {width:100%;margin-bottom:3px}
.rs-root .workspace-control-strip button {padding:7px 8px}
.rs-root .handoff-item {grid-template-columns:17px minmax(0,1fr)}
.rs-root .handoff-time {display:none}
}
.rs-root /
.v5-tag {display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border:1px solid #dcded0;border-radius:6px;font-size:9px;color:#818879;white-space:nowrap}
.rs-root .v5-tag.lime {background:#edf4d7;color:#5a6d32;border-color:#dce7bd}
.rs-root .v5-tag.coral {background:#fff0e8;color:#9d634d;border-color:#eed5c7}
.rs-root .v5-tag.blue {background:#eeefff;color:#686caa;border-color:#dcdcf2}
.rs-root .v5-button {display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #d9dccf;border-radius:9px;background:var(--paper);padding:9px 12px;color:#59634e;font-size:11px;line-height:1.3;transition:background .2s,transform .2s}
.rs-root .v5-button:hover {background:#e9eddc;transform:translateY(-1px)}
.rs-root .v5-button.primary {background:#22281f;border-color:#22281f;color:var(--lime)}
.rs-root .v5-button.primary:hover {background:#36402b}
.rs-root .v5-button.ghost {background:transparent}
.rs-root .v5-button.danger {color:#a0634d;border-color:#e9d4c8}
.rs-root .v5-button:disabled {opacity:.45;cursor:not-allowed;transform:none}
.rs-root .v5-quiet {border:0;background:transparent;color:#828b77;padding:5px 0;font-size:10px;text-align:left}
.rs-root .v5-quiet:hover {color:#323c27}
.rs-root .v5-heading {display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:17px}
.rs-root .v5-heading h2 {font-size:20px;letter-spacing:-.05em;margin:6px 0 5px}
.rs-root .v5-heading p {font-size:11px;line-height:1.8;margin:0;color:#858c7c}
.rs-root .v5-eyebrow {font-size:8px;letter-spacing:.17em;font-weight:800;color:#939a89}
.rs-root .v5-actions {display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.rs-root .v5-muted {font-size:10px;color:#919886;line-height:1.8}
.rs-root .v5-home {margin:26px 0 32px;padding-top:24px;border-top:1px solid var(--line)}
.rs-root .v5-tabs {display:flex;gap:21px;align-items:center;border-bottom:1px solid #dbded0;margin-bottom:17px;overflow:auto;scrollbar-width:thin}
.rs-root .v5-tabs button {position:relative;flex-shrink:0;padding:9px 0 12px;background:transparent;font-size:11px;color:#929887}
.rs-root .v5-tabs button[aria-selected="true"] {color:#2a3321;font-weight:700}
.rs-root .v5-tabs button[aria-selected="true"]:after {content:"";position:absolute;bottom:-1px;left:0;right:0;height:2px;background:#637542;border-radius:2px}
.rs-root .v5-files {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
.rs-root .v5-file {min-width:0;text-align:left;background:var(--paper);border:1px solid #dedfd2;border-radius:15px;padding:17px 14px 13px;transition:transform .2s,border-color .2s;position:relative;overflow:hidden}
.rs-root .v5-file:hover {transform:translateY(-3px);border-color:#adb99b}
.rs-root .v5-file-symbol {display:flex;align-items:center;justify-content:center;width:37px;height:45px;border:1px solid #dddccb;border-radius:6px;background:#f2f0e6;font-size:9px;font-weight:800;color:#8d866d;position:relative;margin-bottom:21px}
.rs-root .v5-file-symbol:after {content:"";position:absolute;bottom:9px;left:9px;right:9px;height:1px;background:#b7b49d;box-shadow:0 -5px #b7b49d}
.rs-root .v5-file.csv .v5-file-symbol {background:#edf2de;border-color:#d9e1c5;color:#75874a}
.rs-root .v5-file strong {font-size:12px;font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rs-root .v5-file p {font-size:10px;line-height:1.7;color:#969b8a;min-height:32px;margin:6px 0 15px}
.rs-root .v5-file-foot {display:flex;justify-content:space-between;align-items:center;font-size:8px;color:#a2a894;border-top:1px solid #ececdf;padding-top:10px}
.rs-root .v5-file-arrow {position:absolute;right:14px;top:15px;color:#a0a88f;font-size:17px}
.rs-root .v5-home-foot {margin-top:12px;display:flex;justify-content:space-between;gap:12px;align-items:center}
.rs-root .v5-home-foot p {margin:0;font-size:9px;color:#9aa08f}
.rs-root .v5-decision-rail {margin:16px 15px 0;border:1px solid #e0dfcc;border-radius:14px;background:#fbfaf1;overflow:hidden}
.rs-root .v5-decision-rail-head {display:flex;justify-content:space-between;align-items:center;padding:13px 13px 9px;font-size:10px;font-weight:700}
.rs-root .v5-count {display:inline-grid;place-items:center;min-width:19px;height:19px;border-radius:50%;background:#e8e4cb;color:#7b7655;font-size:9px}
.rs-root .v5-rail-item {padding:11px 13px;border-top:1px solid #eeecdf}
.rs-root .v5-rail-item strong {font-size:10px;display:block;line-height:1.7;font-weight:600}
.rs-root .v5-rail-item p {font-size:9px;line-height:1.7;color:#969780;margin:4px 0 7px}
.rs-root .v5-rail-item button {font-size:9px;color:#737f4c;padding:0;background:transparent}
.rs-root .v5-rail-all {width:100%;padding:11px;background:#f1f0e3;color:#8e927e;font-size:9px;text-align:left}
.rs-root .v5-top-button {display:flex;align-items:center;gap:7px;border:1px solid #dce0ce;background:#f9f9f0;border-radius:99px;padding:7px 10px;font-size:9px;color:#69754f}
.rs-root .v5-top-button .v5-count {background:#dde9bc;width:17px;height:17px;min-width:17px;font-size:8px}
.rs-root .v5-panel {background:var(--paper);border:1px solid #dedfd1;border-radius:17px;padding:19px;margin:15px 0}
.rs-root .v5-panel h3 {font-size:13px;letter-spacing:-.03em;margin:0 0 10px}
.rs-root .v5-panel p {font-size:11px;line-height:1.85;color:#858d79;margin:6px 0 12px}
.rs-root .v5-divider {height:1px;background:#e3e5d8;margin:19px 0}
.rs-root .v5-page-title {margin:0 0 24px}
.rs-root .v5-page-title h1 {font-size:clamp(28px,3.4vw,42px);line-height:1.2;letter-spacing:-.07em;margin:11px 0 13px}
.rs-root .v5-page-title p {font-size:12px;color:#87907b;line-height:1.9;max-width:570px}
.rs-root .v5-list {border-top:1px solid #daddcf}
.rs-root .v5-list-row {display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:12px;padding:19px 0;border-bottom:1px solid #e0e3d5;align-items:start}
.rs-root .v5-list-row strong {font-size:12px;line-height:1.6;font-weight:650}
.rs-root .v5-list-row p {font-size:11px;color:#8b9380;line-height:1.8;margin:6px 0}
.rs-root .v5-list-index {font-size:10px;color:#a1a990;padding-top:4px}
.rs-root .v5-row-meta {display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:9px;color:#9ca48e}
.rs-root .v5-bot-avatar {display:grid;place-items:center;width:32px;height:32px;background:#e9edda;color:#6d7754;border-radius:10px;font-size:12px}
.rs-root .v5-search {display:flex;align-items:center;gap:10px;border:1px solid #d9dece;background:#fbfcf5;border-radius:11px;padding:10px 13px;margin:18px 0}
.rs-root .v5-search svg {width:15px;height:15px;color:#9aa28d}
.rs-root .v5-search input {width:100%;min-width:0;outline:none;border:0;background:transparent;font-size:12px;color:#5a674a}
.rs-root .v5-search input::placeholder {color:#a1a894}
.rs-root .v5-scope {display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:15px 0}
.rs-root .v5-scope button {border:1px solid transparent;border-radius:99px;font-size:10px;color:#919a82;background:transparent;padding:7px 11px}
.rs-root .v5-scope button.active {border-color:#d4dcc5;background:#e8eed8;color:#5b6c40}
.rs-root .v5-memory-split {display:grid;grid-template-columns:minmax(0,1fr) 195px;gap:27px}
.rs-root .v5-memory-note {border-left:1px solid #dce1d1;padding-left:21px;color:#8a947a;font-size:10px;line-height:1.9}
.rs-root .v5-memory-note h3 {color:#687753;font-size:11px}
.rs-root .v5-memory-note strong {font-size:25px;color:#596b40;letter-spacing:-.05em}
.rs-root .v5-empty {padding:30px 15px;border:1px dashed #d7deca;border-radius:12px;text-align:center;color:#9aa389;font-size:12px;line-height:1.9}
.rs-root .v5-info {display:flex;align-items:flex-start;gap:9px;padding:12px 14px;background:#ecf0df;border-radius:10px;color:#7d8a65;font-size:10px;line-height:1.8}
.rs-root .v5-info.warn {background:#f6ecdb;color:#9b8056}
.rs-root .v5-info svg {width:14px;height:14px;margin-top:2px}
.rs-root .v5-computer-head {display:flex;align-items:center;gap:15px;padding:23px;border-radius:17px;background:#20271c;color:#e4e9d9;margin:22px 0}
.rs-root .v5-computer-head .v5-computer-icon {display:grid;place-items:center;width:49px;height:49px;background:#323e27;border-radius:13px;color:var(--lime)}
.rs-root .v5-computer-head svg {width:25px;height:25px}
.rs-root .v5-computer-head h2 {font-size:15px;margin:0 0 6px;font-weight:600}
.rs-root .v5-computer-head p {font-size:10px;color:#a0ac8e;line-height:1.8;margin:0}
.rs-root .v5-computer-head .v5-tag {margin-left:auto;border-color:#4e5a40;color:#bfcda9}
.rs-root .v5-terminal {margin:14px 0;padding:17px 18px;border-radius:11px;background:#1c2319;color:#cad4bd;font:11px/1.9 Consolas,monospace;white-space:pre-wrap;overflow:auto;word-break:break-word}
.rs-root .v5-terminal .dim {color:#839371}
.rs-root .v5-path {font:10px/1.8 Consolas,monospace;color:#8c977d;margin:13px 0}
.rs-root .v5-file-row {display:flex;align-items:center;gap:12px;padding:13px 3px;border-bottom:1px solid #e3e6d8}
.rs-root .v5-file-row svg {color:#97a47f;width:17px;height:17px}
.rs-root .v5-file-row strong {font-size:11px;font-weight:500;flex:1}
.rs-root .v5-file-row span {font-size:9px;color:#a0aa92}
.rs-root .v5-file-row button {background:transparent;color:#7c8d5d;font-size:10px}
.rs-root .v5-run-line {display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:12px;position:relative;padding:15px 0}
.rs-root .v5-run-line:not(:last-child):before {content:"";position:absolute;left:9px;top:33px;bottom:-13px;width:1px;background:#d9dfcb}
.rs-root .v5-run-dot {width:19px;height:19px;border-radius:50%;display:grid;place-items:center;font-size:9px;background:#e1eacb;color:#7b8c57;z-index:1;margin-top:1px}
.rs-root .v5-run-dot.wait {background:#efe5cb;color:#a08950}
.rs-root .v5-run-line strong {font-size:11px}
.rs-root .v5-run-line p {font-size:10px;color:#939d84;line-height:1.8;margin:5px 0}
.rs-root .v5-run-line time {color:#9da78f;font-size:9px}
.rs-root .v5-drawer-shade {position:fixed;inset:0;background:#10170f55;backdrop-filter:blur(4px);z-index:100;opacity:0;visibility:hidden;transition:opacity .22s,visibility .22s}
.rs-root .v5-drawer-shade.open {opacity:1;visibility:visible}
.rs-root .v5-drawer {position:absolute;right:0;top:0;bottom:0;width:min(580px,100%);background:var(--paper);box-shadow:-20px 0 70px #0d190f22;transform:translateX(30px);transition:transform .25s;display:flex;flex-direction:column}
.rs-root .v5-drawer-shade.open .v5-drawer {transform:translateX(0)}
.rs-root .v5-drawer.wide {width:min(760px,100%)}
.rs-root .v5-drawer-head {display:flex;gap:12px;align-items:flex-start;padding:26px 27px 20px;border-bottom:1px solid #e0e3d5}
.rs-root .v5-drawer-head .v5-close {margin-left:auto;width:30px;height:30px;background:#edf0e3;border-radius:50%;color:#879576;font-size:20px;flex-shrink:0}
.rs-root .v5-drawer-title {font-size:22px;letter-spacing:-.05em;margin:5px 0}
.rs-root .v5-drawer-subtitle {font-size:10px;color:#939c84;line-height:1.8;margin:0}
.rs-root .v5-drawer-body {padding:22px 27px 28px;overflow:auto;flex:1;overscroll-behavior:contain}
.rs-root .v5-drawer-foot {border-top:1px solid #e2e5d7;padding:12px 27px;font-size:9px;color:#9ca58f;background:#f5f6eb}
.rs-root .v5-field {display:block;margin:17px 0}
.rs-root .v5-field>span {font-size:11px;color:#727f62;display:block;margin-bottom:8px}
.rs-root .v5-input {width:100%;border:1px solid #d8dfca;background:#fbfcf5;border-radius:9px;padding:11px 12px;font-size:12px;line-height:1.7;color:#526144;resize:vertical}
.rs-root .v5-input::placeholder {color:#adb59e}
.rs-root .v5-input.code {font:11px/1.9 Consolas,monospace;min-height:260px}
.rs-root .v5-field select {appearance:auto}
.rs-root .v5-check {display:flex;align-items:flex-start;gap:9px;font-size:11px;color:#7d8b6a;line-height:1.8;margin:14px 0}
.rs-root .v5-check input {accent-color:#71854d;margin-top:4px}
.rs-root .v5-choice {display:block;position:relative;border:1px solid #dfe4d3;border-radius:10px;padding:12px 13px;margin:9px 0;font-size:11px;color:#6c795b;background:#fafbf3;cursor:pointer}
.rs-root .v5-choice input {accent-color:#74884f;margin-right:9px}
.rs-root .v5-choice:has(input:checked) {border-color:#aebe8f;background:#edf3df}
.rs-root .v5-choice small {display:block;padding-left:25px;color:#99a389;line-height:1.8;margin-top:3px}
.rs-root .v5-toggle {display:flex;align-items:center;gap:10px;justify-content:space-between;padding:14px 0}
.rs-root .v5-toggle strong {font-size:12px;font-weight:600;color:#657450}
.rs-root .v5-toggle p {font-size:10px;color:#9aa588;line-height:1.8;margin:5px 0}
.rs-root .v5-toggle input {accent-color:#778d50;width:18px;height:18px;cursor:pointer}
.rs-root .v5-note-card {border:1px solid #dce1d0;border-radius:13px;padding:16px;margin:12px 0;background:#f7f9ee}
.rs-root .v5-note-card h3 {font-size:12px;margin:0 0 9px}
.rs-root .v5-note-card p {font-size:11px;line-height:1.9;color:#879476;margin:0}
.rs-root .v5-note-card .v5-actions {margin-top:13px}
.rs-root .v5-conflict {border-left:3px solid #c8ad7d;padding:10px 14px;background:#faf3e6;margin:12px 0}
.rs-root .v5-conflict strong {font-size:11px;color:#998458}
.rs-root .v5-conflict p {font-size:11px;line-height:1.9;color:#9b947f;margin:6px 0}
.rs-root .v5-preview-paper {padding:25px;border:1px solid #e0e4d3;background:#fffef9;border-radius:10px;font-size:12px;line-height:2;color:#68775a;white-space:pre-wrap;overflow-wrap:anywhere}
.rs-root .v5-preview-paper h2 {font-size:19px;letter-spacing:-.04em;color:#3c4c30;margin:0 0 12px}
.rs-root .v5-table-wrap {overflow:auto;border:1px solid #e1e6d4;border-radius:10px}
.rs-root .v5-table {border-collapse:collapse;width:100%;font-size:11px;white-space:nowrap}
.rs-root .v5-table th,
.rs-root .v5-table td {padding:12px 14px;text-align:left;border-bottom:1px solid #e7ebdd}
.rs-root .v5-table th {font-weight:600;color:#7c8c65;background:#edf2e1}
.rs-root .v5-table td {color:#80906b}
.rs-root .v5-table tr:last-child td {border-bottom:0}
.rs-root .v5-message {max-width:92%;padding:13px 15px;background:#edf2e0;border-radius:13px 13px 13px 3px;margin:14px 0;font-size:12px;line-height:1.9;color:#738360;white-space:pre-wrap}
.rs-root .v5-message.user {margin-left:auto;background:#e6e8f7;color:#7b7f9b;border-radius:13px 13px 3px 13px}
.rs-root .v5-message-label {font-size:9px;color:#a1ac90;display:block;margin-bottom:5px}
.rs-root .v5-conversation-form {display:flex;gap:8px;align-items:flex-end;margin-top:20px}
.rs-root .v5-conversation-form textarea {min-height:52px}
.rs-root .v5-conversation-form button {flex-shrink:0;margin-bottom:2px}
.rs-root .v5-mini-grid {display:grid;grid-template-columns:1fr 1fr;gap:11px}
.rs-root .v5-role-tools {display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 25px}
.rs-root .v5-rail-notice {font-size:9px;color:#a2ad90;line-height:1.8;padding:10px 13px}
.rs-root .v5-pill-line {display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 0}
.rs-root .v5-badge-note {font-size:9px;color:#9ca58f}
.rs-root .v5-home .v5-kicker-link {margin-top:4px}
.rs-root .v5-settings-strip {display:flex;gap:9px;align-items:center;padding:12px 0;border-top:1px solid #dfe4d2;margin-top:18px;flex-wrap:wrap}
.rs-root .v5-settings-strip strong {font-size:11px;font-weight:500;color:#7b8969;margin-right:auto}
@media(min-width:1101px){
.rs-root .right {overflow:auto;max-height:100vh;position:sticky;top:0;scrollbar-width:thin}
}
@media(max-width:1100px){
.rs-root .v5-memory-split {grid-template-columns:minmax(0,1fr)}
.rs-root .v5-memory-note {border-left:0;border-top:1px solid #dce1d1;padding:15px 0 0}
.rs-root .v5-top-button {padding:7px}
.rs-root .v5-top-button .v5-top-label {display:none}
}
@media(max-width:760px){
.rs-root .v5-heading {flex-wrap:wrap}
.rs-root .v5-files {grid-template-columns:1fr}
.rs-root .v5-file {display:grid;grid-template-columns:40px minmax(0,1fr) 22px;column-gap:14px;align-items:center;padding:15px}
.rs-root .v5-file-symbol {grid-row:1/4;margin:0}
.rs-root .v5-file strong {grid-column:2}
.rs-root .v5-file p {grid-column:2;min-height:0;margin:4px 0 8px}
.rs-root .v5-file-foot {grid-column:2;border:0;padding:0}
.rs-root .v5-file-arrow {position:static;grid-column:3;grid-row:1/4}
.rs-root .v5-mini-grid {grid-template-columns:1fr}
.rs-root .v5-drawer-body {padding:18px 20px}
.rs-root .v5-drawer-head {padding:22px 20px 17px}
.rs-root .v5-list-row {gap:9px;grid-template-columns:25px minmax(0,1fr) auto}
.rs-root .v5-list-row>.v5-actions {grid-column:2/4}
.rs-root .v5-computer-head {padding:18px}
.rs-root .v5-computer-head .v5-tag {display:none}
.rs-root .v5-home-foot {align-items:flex-start;flex-direction:column}
.rs-root .v5-home {padding-top:18px}
.rs-root .v5-search input {font-size:16px}
.rs-root .v5-top-button {font-size:8px}
}
@media(prefers-reduced-motion:reduce){
.rs-root .v5-drawer,
.rs-root .v5-drawer-shade,
.rs-root .v5-file,
.rs-root .v5-button {transition:none}
}
.rs-root /
.v6-home-entry {display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;margin-top:22px;padding:15px 18px;border:1px solid #d7deca;border-radius:13px;background:#eaf0db;color:#52673b;text-align:left}
.rs-root .v6-home-entry>span {display:flex;align-items:center;gap:9px;font-size:12px;font-weight:650}
.rs-root .v6-home-entry small {font-size:10px;color:#899874}
.rs-root .v6-home-entry:hover {background:#e2ebce}
.rs-root body.v6-chat-mode {overflow:hidden}
.rs-root .v6-chat-mode .content {max-width:none;padding:0;margin:0;flex:1;min-height:0}
.rs-root .v6-chat-mode .composer-dock {display:none}
.rs-root .v6-chat-mode .center {height:100dvh;min-height:0}
.rs-root .v6-chat-mode #view-chat.active {display:block;height:100%;animation:none}
.rs-root .v6-chat-layout {height:calc(100dvh - 66px);display:grid;grid-template-columns:216px minmax(0,1fr);position:relative;min-height:0;background:var(--paper)}
.rs-root .v6-chat-list {background:#eeeee4;border-right:1px solid #dfe2d4;display:flex;flex-direction:column;min-height:0;padding:23px 13px 0;overflow:hidden}
.rs-root .v6-list-heading {display:flex;align-items:center;justify-content:space-between;padding:0 5px;margin-bottom:21px}
.rs-root .v6-list-heading .v5-eyebrow {font-size:7px;letter-spacing:.13em}
.rs-root .v6-list-heading h2 {font-size:24px;letter-spacing:-.06em;margin:5px 0 0;font-weight:650}
.rs-root .v6-icon-button {display:inline-grid;place-items:center;width:33px;height:33px;flex-shrink:0;background:transparent;border:1px solid transparent;border-radius:10px;color:#7d8972}
.rs-root .v6-icon-button:hover {background:#e6ebd8;border-color:#d9dfcb}
.rs-root .v6-icon-button svg {width:17px;height:17px}
.rs-root .v6-new-chat {display:flex;align-items:center;justify-content:center;gap:8px;background:#252e20;color:#def18c;padding:11px 10px;border-radius:11px;font-size:11px;box-shadow:0 3px 8px #2028180c}
.rs-root .v6-new-chat:hover {background:#37472a}
.rs-root .v6-new-chat svg {width:15px;height:15px}
.rs-root .v6-chat-search {display:flex;align-items:center;gap:7px;margin:20px 3px 10px;color:#939c85;border-bottom:1px solid #dce1ce;padding:0 0 9px}
.rs-root .v6-chat-search svg {width:14px;height:14px}
.rs-root .v6-chat-search input {min-width:0;width:100%;background:transparent;border:0;font-size:11px;outline:none;color:#526044}
.rs-root .v6-chat-search input::placeholder {color:#9da48f}
.rs-root .v6-chat-filters {display:flex;gap:3px;margin:2px 0 11px}
.rs-root .v6-chat-filters button {background:transparent;color:#939d84;font-size:10px;padding:6px 12px;border-radius:7px}
.rs-root .v6-chat-filters button[aria-pressed=true] {color:#526c36;background:#dfe7cd}
.rs-root .v6-room-list {overflow-y:auto;min-height:0;flex:1;scrollbar-width:thin;padding-bottom:14px}
.rs-root .v6-room-row {display:flex;width:100%;gap:9px;padding:13px 9px;margin:3px 0;border:1px solid transparent;border-radius:12px;background:transparent;text-align:left;align-items:flex-start;color:#69765b}
.rs-root .v6-room-row:hover {background:#e5ead9}
.rs-root .v6-room-row.selected {background:#fbfcf5;border-color:#d8dfc9;box-shadow:0 4px 12px #35402b04}
.rs-root .v6-room-avatar {display:inline-grid;place-items:center;width:39px;height:39px;border:1px solid #dae4c6;background:#e9efd9;color:#6b7e4f;border-radius:13px;flex-shrink:0;font-size:13px;font-weight:600}
.rs-root .v6-room-avatar.group {background:#2d3826;color:#e0edab;border-color:#3b4730}
.rs-root .v6-room-avatar.small {width:29px;height:29px;border-radius:10px;font-size:10px;margin-top:2px}
.rs-root .v6-room-avatar.small svg {width:15px;height:15px}
.rs-root .v6-room-copy {flex:1;min-width:0;display:block}
.rs-root .v6-room-title {font-size:11px;font-weight:650;display:flex;gap:5px;align-items:center;line-height:1.6;overflow-wrap:anywhere}
.rs-root .v6-room-title small {font-size:7px;font-weight:400;color:#9ca889;border:1px solid #dfe5d4;border-radius:4px;padding:0 3px;white-space:nowrap}
.rs-root .v6-room-preview {display:block;font-size:10px;line-height:1.6;color:#919b83;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:4px 0 7px}
.rs-root .v6-room-time {display:block;font-size:8px;color:#a1aa94}
.rs-root .v6-no-rooms {font-size:11px;color:#98a287;line-height:1.8;padding:24px 8px}
.rs-root .v6-list-foot {display:flex;align-items:center;gap:9px;padding:15px 4px 20px;border-top:1px solid #dce1cf;color:#7b896a;font-size:10px}
.rs-root .v6-list-foot small {display:block;font-size:8px;color:#a4ad97;margin-top:4px}
.rs-root .v6-list-foot button {margin-left:auto;background:transparent;color:#869677;font-size:16px}
.rs-root .v6-offline-dot {width:6px;height:6px;border-radius:50%;background:#b2b5a1;box-shadow:0 0 0 4px #d8decb}
.rs-root .v6-thread {display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:#fbfaf5}
.rs-root .v6-thread-head {display:flex;align-items:center;gap:12px;padding:19px 25px 18px;flex-shrink:0;background:#fbfaf5}
.rs-root .v6-thread-title {min-width:0}
.rs-root .v6-thread-title h1 {font-size:16px;letter-spacing:-.035em;margin:0 0 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
.rs-root .v6-thread-title p {font-size:10px;color:#98a18a;margin:0;line-height:1.5}
.rs-root .v6-thread-actions {margin-left:auto;display:flex;align-items:center;gap:8px;flex-shrink:0}
.rs-root .v6-preview-label {font-size:8px;color:#98a784;border:1px solid #dce4d0;padding:5px 7px;border-radius:99px;white-space:nowrap}
.rs-root .v6-chat-context {display:flex;gap:15px;align-items:center;padding:10px 25px;border-block:1px solid #e8eadf;font-size:9px;color:#a0a98f;background:#f6f7ee;flex-shrink:0}
.rs-root .v6-chat-context>span {flex:1}
.rs-root .v6-chat-context button {display:flex;gap:4px;align-items:center;background:transparent;padding:0;color:#85946f;white-space:nowrap;font-size:9px}
.rs-root .v6-chat-context button svg {width:12px;height:12px}
.rs-root .v6-chat-context b {display:inline-grid;place-items:center;background:#e5ebd5;border-radius:50%;font-size:8px;width:15px;height:15px;font-weight:500}
.rs-root .v6-thread-scroll {flex:1;overflow:auto;min-height:0;padding:0 25px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#d6deca transparent}
.rs-root .v6-conversation-date {display:flex;align-items:center;gap:14px;max-width:760px;margin:23px auto 26px;font-size:8px;color:#a9af9c}
.rs-root .v6-conversation-date:before,
.rs-root .v6-conversation-date:after {content:"";height:1px;background:#e8eadf;flex:1}
.rs-root .v6-chat-message {display:flex;align-items:flex-start;gap:10px;max-width:760px;margin:0 auto 25px}
.rs-root .v6-message-avatar {display:grid;place-items:center;width:30px;height:30px;border-radius:11px;background:#e9efda;border:1px solid #dce5c9;color:#7c8a60;font-size:11px;flex-shrink:0;margin-top:2px}
.rs-root .v6-message-avatar.hemu {background:#e1efe4;color:#6d9c7a;border-color:#cce3d0}
.rs-root .v6-message-avatar.liyan {background:#ece8f4;color:#9a88af;border-color:#dfd7ec}
.rs-root .v6-message-avatar.user {background:#303a28;color:#dceab8;border-color:#435137}
.rs-root .v6-message-main {min-width:0;max-width:calc(100% - 50px)}
.rs-root .v6-message-meta {display:flex;align-items:center;gap:7px;margin:1px 0 8px;flex-wrap:wrap;font-size:8px;line-height:1.7;color:#a3ab94}
.rs-root .v6-message-meta strong {font-size:11px;color:#5e6b4e;font-weight:650}
.rs-root .v6-message-meta time {font-size:8px;color:#acb39f}
.rs-root .v6-message-meta small {font-size:7px;color:#a8af9a;border-left:1px solid #dce1d0;padding-left:7px}
.rs-root .v6-message-bubble {padding:13px 16px;background:#f0f2e7;color:#5b684d;border:1px solid #e4e8d8;border-radius:0 13px 13px 13px;font-size:12px;line-height:1.95;white-space:pre-wrap;overflow-wrap:anywhere}
.rs-root .v6-chat-message.mine {flex-direction:row-reverse}
.rs-root .v6-chat-message.mine .v6-message-meta {justify-content:flex-end}
.rs-root .v6-chat-message.mine .v6-message-bubble {background:#eaf0db;border-color:#dce5c9;border-radius:13px 0 13px 13px;color:#52683c}
.rs-root .v6-local-receipt {display:block;text-align:right;font-size:8px;color:#a4b08f;margin-top:7px}
.rs-root .v6-message-files,
.rs-root .v6-draft-files {display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.rs-root .v6-message-files:empty,
.rs-root .v6-draft-files:empty {display:none}
.rs-root .v6-file-chip {display:inline-flex;align-items:center;border:1px solid #dce3d0;border-radius:8px;background:#fafcf3;max-width:100%;color:#81946b}
.rs-root .v6-file-chip button {display:inline-flex;align-items:center;gap:6px;font-size:9px;background:transparent;color:inherit;padding:8px;min-width:0;overflow-wrap:anywhere;text-align:left}
.rs-root .v6-file-chip button svg {width:13px;height:13px}
.rs-root .v6-file-chip button:hover {color:#4e6a33}
.rs-root .v6-file-chip button+button {font-size:15px;border-left:1px solid #e2e8d6;padding:4px 7px}
.rs-root .v6-inline-decision {display:flex;gap:7px;align-items:center;border:1px solid #e7dcc5;border-radius:8px;background:#f8f3e7;color:#a09064;font-size:10px;padding:9px 11px;margin-top:10px}
.rs-root .v6-inline-decision svg {width:13px;height:13px}
.rs-root .v6-end-space {height:10px}
.rs-root .v6-compose-wrap {padding:9px 25px 18px;background:linear-gradient(#fbfaf500,#fbfaf5 14px);flex-shrink:0}
.rs-root .v6-compose {max-width:760px;margin:0 auto;padding:13px 14px 9px;border:1px solid #cfd8bf;border-radius:17px;background:#fdfef8;box-shadow:0 7px 24px #27391b06}
.rs-root .v6-compose:focus-within {border-color:#aabb88;box-shadow:0 4px 18px #526e2810}
.rs-root .v6-compose textarea {display:block;width:100%;min-height:48px;max-height:160px;resize:none;border:0;padding:2px 2px 6px;outline:none;background:transparent;font-size:12px;line-height:1.8;color:#526442;overflow-y:auto}
.rs-root .v6-compose textarea::placeholder {color:#a9b198}
.rs-root .v6-compose textarea:focus-visible {outline:0}
.rs-root .v6-compose-tools {display:flex;align-items:center;gap:8px}
.rs-root .v6-compose-tools .v6-icon-button {width:28px;height:28px;background:#edf1e3;border:1px solid #e4e9da}
.rs-root .v6-mentions {display:flex;gap:5px;overflow:auto;scrollbar-width:none;min-width:0}
.rs-root .v6-mentions button {font-size:8px;white-space:nowrap;border:1px solid #e3e9d8;background:#f5f8ee;color:#96a780;border-radius:99px;padding:5px 7px}
.rs-root .v6-mentions button:hover {color:#5f783f;background:#eaf1dc}
.rs-root .v6-send {display:grid;place-items:center;width:32px;height:32px;border-radius:11px;background:#2c3823;color:#e0f294;flex-shrink:0;margin-left:auto}
.rs-root .v6-send:hover {background:#456032}
.rs-root .v6-send:disabled {background:#e4e9da;color:#b2bda1;cursor:default}
.rs-root .v6-send svg {width:17px;height:17px}
.rs-root .v6-private-note {font-size:9px;color:#a2ae91}
.rs-root .v6-compose-hint {display:flex;justify-content:space-between;gap:10px;max-width:760px;margin:9px auto 0;font-size:8px;color:#a5ae96}
.rs-root .v6-draft-files {margin:0 0 9px}
.rs-root .v6-chat-welcome {max-width:410px;margin:8vh auto;text-align:center;color:#6f805c}
.rs-root .v6-welcome-mark {display:grid;place-items:center;background:#e5edcf;border-radius:20px;width:56px;height:56px;font-size:30px;margin:0 auto 22px;color:#738c4a;transform:rotate(-6deg)}
.rs-root .v6-chat-welcome h2 {font-size:23px;line-height:1.5;font-weight:550;letter-spacing:-.05em}
.rs-root .v6-chat-welcome p {font-size:11px;color:#9daa8d;line-height:1.8}
.rs-root .v6-chat-welcome button {display:block;border:1px solid #dfe6d1;border-radius:9px;margin:9px auto;background:#f6f8ed;color:#91a079;padding:10px 14px;font-size:10px}
.rs-root .v6-mobile-list,
.rs-root .v6-list-backdrop {display:none}
@media(min-width:761px){
.rs-root .rail-nav {min-height:0;overflow-y:auto;scrollbar-width:none}
.rs-root .rail-spacer {min-height:12px}
}
@media(min-width:1241px) and (max-width:1450px){
.rs-root .v6-chat-layout {grid-template-columns:190px minmax(0,1fr)}
.rs-root .v6-chat-list {padding-left:9px;padding-right:9px}
.rs-root .v6-thread-head {padding:18px}
.rs-root .v6-thread-scroll {padding:0 18px}
.rs-root .v6-compose-wrap {padding:9px 18px 18px}
.rs-root .v6-preview-label {display:none}
.rs-root .v6-chat-context {padding:10px 18px;gap:9px}
}
@media(max-width:900px){
.rs-root .v6-chat-layout {grid-template-columns:minmax(0,1fr)}
.rs-root .v6-chat-list {display:none}
.rs-root .v6-mobile-list {display:inline-grid}
.rs-root .v6-chat-layout.sidebar-open .v6-chat-list {display:flex;position:absolute;left:0;top:0;bottom:0;z-index:12;width:min(280px,85%);box-shadow:12px 0 40px #23321a15}
.rs-root .v6-chat-layout.sidebar-open .v6-list-backdrop {display:block;position:absolute;inset:0;background:#17220d44;z-index:11;backdrop-filter:blur(2px)}
}
@media(max-width:760px){
.rs-root .v6-chat-mode .center {height:calc(100dvh - 62px);padding-bottom:0}
.rs-root .v6-chat-layout {height:calc(100dvh - 118px)}
.rs-root .v6-thread-head {padding:13px 14px;gap:9px}
.rs-root .v6-thread-title h1 {font-size:14px;max-width:42vw}
.rs-root .v6-thread-title p {font-size:9px}
.rs-root .v6-room-avatar {width:33px;height:33px;border-radius:11px}
.rs-root .v6-preview-label {display:none}
.rs-root .v6-thread-actions {gap:0}
.rs-root .v6-chat-context {padding:10px 16px;gap:12px}
.rs-root .v6-chat-context>span {font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-root .v6-thread-scroll {padding:0 14px}
.rs-root .v6-chat-message {gap:8px;margin-bottom:21px}
.rs-root .v6-message-main {max-width:calc(100% - 39px)}
.rs-root .v6-message-avatar {width:27px;height:27px;font-size:10px;border-radius:9px}
.rs-root .v6-message-meta>span {display:none}
.rs-root .v6-message-bubble {padding:11px 13px;font-size:12px}
.rs-root .v6-compose-wrap {padding:6px 12px 12px}
.rs-root .v6-compose {padding:12px 11px 9px;border-radius:15px}
.rs-root .v6-compose textarea {font-size:16px;min-height:52px;line-height:1.6}
.rs-root .v6-compose-hint {font-size:7px}
.rs-root .v6-compose-hint>span:last-child {display:none}
.rs-root .v6-conversation-date {margin:18px auto 22px}
.rs-root .v6-chat-welcome {padding:0 15px;margin:5vh auto}
.rs-root .v6-chat-welcome h2 {font-size:21px}
.rs-root .rail-nav {gap:2px;overflow:visible}
.rs-root .rail-btn {flex:1;width:auto;max-width:44px;min-width:0}
.rs-root .v6-home-entry {flex-direction:column;align-items:flex-start;gap:9px}
.rs-root .v6-mentions button {font-size:8px;padding:5px 6px}
}`;
/*</RS-CSS>*/
const RESONANCE_SHELL_CSS = `
.rs-shell{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:#f3f1e9;color:#263020;font:13px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;isolation:isolate}
html[data-windows-titlebar]:not([data-fullscreen]) .rs-shell{top:var(--dsh-windows-titlebar-height,40px)}
html[data-platform="darwin"]:not([data-fullscreen]) .rs-shell{padding-top:32px}
.rs-shell *,.rs-shell *:before,.rs-shell *:after{box-sizing:border-box}.rs-shell button{font:inherit;cursor:pointer}.rs-shell button:focus-visible,.rs-shell a:focus-visible{outline:2px solid #7e88ff;outline-offset:3px}
.rs-shell-header{height:56px;flex-shrink:0;display:flex;align-items:center;gap:10px;padding:0 23px;border-bottom:1px solid #dddfd0;background:#f3f1e9}
.rs-shell-mark{display:grid;place-items:center;width:29px;height:29px;border-radius:10px;background:#26311f;color:#d9f875;font-size:22px;transform:rotate(-7deg)}
.rs-shell-name{font-size:14px;font-weight:700;letter-spacing:.03em}.rs-shell-description{font-size:10px;color:#94a084;border-left:1px solid #d8decc;padding-left:11px;margin-left:3px}.rs-shell-return{margin-left:auto;border:0;background:transparent;color:#8b977d;font-size:10px!important;padding:6px 0 6px 12px;display:flex;align-items:center;gap:5px;white-space:nowrap}.rs-shell-return:hover{color:#4e6438}.rs-shell-return .wc-ico{transform:rotate(180deg)}
.rs-shell-body{flex:1;min-height:0;overflow:hidden}.rs-shell-exit-error{padding:7px 22px;color:#966b4e;background:#fbf0df;font-size:11px}.rs-shell-closed{padding:24px;color:#788b61;font-size:13px}
.rs-shell .wc-scope{--sand-ink:#263020;--sand-paper:#fbfaf5;--sand-bg-pane:#fbfaf5;--sand-bg-chrome:#f3f1e9;--sand-bg-sidebar:#eeefe4;--sand-text-primary:#4a5e39;--sand-text-secondary:#89987a;--sand-text-tertiary:#99a68b;--sand-text-quaternary:#b2bba6;--sand-bg-primary:#2f3e24;--sand-bg-primary-hover:#465d33;--sand-text-on-primary:#e1efba;--sand-border-focus-primary:#9bb273;--sand-blue:#718950;--sand-font-size-sm:13px;--sand-font-size-xs:11px;--sand-font-size-xxs:10px;--sand-fill-bubble-user:#e6edd7;color:#4a5e39;font-family:inherit;background:#fbfaf5}
.rs-shell .wc-app{grid-template-rows:minmax(0,1fr)}.rs-shell .wc-rail{flex-direction:column;align-items:stretch;overflow:hidden;border-bottom:0}.rs-shell .wc-rail-scroll{flex:1;flex-direction:column;align-items:stretch;overflow:auto}.rs-shell .wc-rail-group,.rs-shell .wc-rows>li,.rs-shell .wc-machine{flex-shrink:0}.rs-shell .wc-rows{flex-direction:column}.rs-shell .wc-rail-foot{flex-direction:column;align-items:stretch;flex-shrink:0}.rs-shell .wc-rail .wc-row-link{width:100%}
.rs-workspace{display:grid;grid-template-columns:66px minmax(0,1fr);height:100%;min-height:0;overflow:hidden}.rs-nav{display:flex;flex-direction:column;align-items:center;gap:10px;min-height:0;overflow:auto;padding:22px 7px;background:#172016;border-right:1px solid #34412b;scrollbar-width:none}.rs-nav-button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:49px;min-height:55px;flex-shrink:0;border:1px solid transparent;border-radius:12px;color:#819375;background:transparent;font-size:9px!important;line-height:1.2}.rs-nav-button:hover{color:#dce6cc;background:#25321f}.rs-nav-button[aria-current="page"]{background:#2d3e23;color:#dbf49b;border-color:#41532f}.rs-nav-button .wc-ico{width:18px;height:18px}.rs-nav-bottom{margin-top:auto;font-size:7px;letter-spacing:.15em;color:#536b43;writing-mode:vertical-rl;padding-top:24px}
.rs-shell .wc-app{grid-template-columns:225px minmax(0,1fr)}.rs-shell .wc-rail{padding:19px 12px 13px;border-right:1px solid #dce2d0;gap:13px}.rs-shell .wc-rail-head{font-size:9px;color:#8c9b7c;padding:2px 6px 10px}.rs-shell .wc-row-link{height:auto;min-height:45px;padding:10px 9px;border-radius:11px;font-size:12px;gap:9px}.rs-shell .wc-row-link[data-on="1"]{background:#fbfcf5;box-shadow:inset 0 0 0 1px #d4dfc3;color:#526c37}.rs-shell .wc-row-sub{font-size:9px;color:#9baa89}.rs-shell .wc-avatar{border:1px solid #dae4cb;background:#e6edd8;border-radius:10px;width:30px;height:30px;display:grid;place-items:center;font-size:15px}.rs-shell .wc-rail-foot{border-top:1px solid #dbe2ce;padding-top:11px}.rs-shell .wc-rail-note{font-size:9px}.rs-shell .wc-pane{background:#fbfaf5}.rs-shell .wc-pane-head{padding:19px 27px;background:#fbfaf5;border-bottom:1px solid #e1e6d6;min-height:79px;flex-wrap:wrap;gap:12px}.rs-shell .wc-h1{font-size:17px;letter-spacing:-.025em;font-weight:650;color:#3d5130}.rs-shell .wc-pane-head .wc-hint{font-size:10px;line-height:1.8;margin-top:6px}.rs-shell .wc-pane-tools{gap:8px;margin-left:auto;flex-wrap:wrap}.rs-shell .wc-pane-tools [data-autonomy-hint]{display:none}.rs-shell .wc-pane-body{padding:25px 30px 30px;scroll-padding-top:20px}.rs-shell .wc-col{gap:20px}.rs-shell .wc-sec-title{font-size:12px;color:#627b46}.rs-shell .wc-sec-meta{font-size:10px;color:#98a888}.rs-shell .wc-transcript{width:100%;max-width:860px;gap:17px;margin:8px auto 0}.rs-shell .wc-msg{max-width:92%;padding:14px 17px;border:1px solid #e0e7d3;background:#f0f3e7;border-radius:0 14px 14px 14px;color:#60784a;align-self:flex-start}.rs-shell .wc-msg[data-mine="1"]{background:#e8efdb;color:#4e6837;border-color:#d7e2c3;border-radius:14px 0 14px 14px;align-self:flex-end}.rs-shell .wc-msg[data-mine="1"] .wc-msg-when{color:#8e9f7b}.rs-shell .wc-msg-text{font-size:13px;line-height:1.95}.rs-shell .wc-msg-head{font-size:10px;gap:9px;color:#809469}.rs-shell .wc-msg-when{font-size:9px;color:#9baa8c}.rs-shell .wc-btn{border-radius:8px;padding:7px 10px;font-size:11px;background:#f8fbef;color:#7c9163;border:1px solid #d7e2c7}.rs-shell .wc-btn[data-tone="primary"]{background:#304025;color:#e2f3b4;border-color:#304025}.rs-shell .wc-btn[data-tone="danger"]{color:#a46c50;background:#faf1e5;border-color:#e7d8c2}.rs-shell .wc-plate{font-size:9px;color:#8b9e73;background:#edf2e2;border-color:#dfe7d1}.rs-shell .wc-plate[data-tone="warn"]{color:#a28352;background:#f6eedc}.rs-shell .wc-composer{border-radius:14px;border:1px solid #cbd9b8;background:#fdfff7;padding:11px 13px;color:#536f3b}.rs-shell .wc-composer textarea{font-size:13px;line-height:1.8;color:#536f3b}.rs-shell .wc-send{background:#314225;color:#dfefa9;border-radius:10px}.rs-shell .wc-composer-wrap{background:#fbfaf5}.rs-shell .wc-scrim{background:#1c2a1466;backdrop-filter:blur(4px)}.rs-shell .wc-dialog{background:#fbfcf4;border:1px solid #d7e1c7;border-radius:18px}.rs-shell .wc-dialog-head{border-color:#dfe7d1}.rs-shell .wc-crash{padding:25px}.rs-view-heading{margin-bottom:24px}.rs-view-heading h2{font-size:28px;letter-spacing:-.05em;font-weight:550;color:#405830;margin:0 0 9px}.rs-view-heading p{font-size:12px;line-height:1.9;color:#91a17e;margin:0}.rs-team-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px}.rs-team-card{padding:20px;border:1px solid #dce5cf;border-radius:16px;background:#f7faef}.rs-team-avatar{font-size:28px;margin-bottom:12px;display:block}.rs-team-card h3{font-size:16px;margin:0 0 7px;color:#536e3c}.rs-team-card p{font-size:11px;color:#93a380;line-height:1.8}.rs-team-card .wc-form-act{margin-top:16px}.rs-inline-notice{padding:10px 27px;background:#f3edda;color:#998253;font-size:11px;border-bottom:1px solid #e9dfc6}
@media(max-width:1050px){.rs-shell .wc-app{grid-template-columns:195px minmax(0,1fr)}.rs-shell .wc-pane-head{padding:16px 20px}.rs-shell .wc-pane-body{padding:20px}.rs-shell .wc-pane-tools .wc-plate{display:none}}
@media(max-width:700px){.rs-shell-header{height:49px;padding:0 13px}.rs-shell-description{display:none}.rs-shell-return{font-size:9px!important}.rs-workspace{grid-template-columns:51px minmax(0,1fr)}.rs-nav{padding:14px 4px;gap:7px}.rs-nav-button{width:41px;min-height:48px;font-size:8px!important}.rs-nav-button .wc-ico{width:16px;height:16px}.rs-shell .wc-app{grid-template-columns:116px minmax(0,1fr)}.rs-shell .wc-rail{padding:14px 6px;gap:9px}.rs-shell .wc-rail .wc-row-link{padding:8px 5px;min-height:40px;flex-wrap:wrap;gap:5px}.rs-shell .wc-rail .wc-row-sub{width:100%;padding-left:0;font-size:8px}.rs-shell .wc-rail .wc-avatar{width:22px;height:22px;font-size:12px}.rs-shell .wc-rail .wc-row-label{font-size:10px}.rs-shell .wc-rail-note{font-size:8px;flex-wrap:wrap}.rs-shell .wc-rail-note .wc-ico{display:none}.rs-shell .wc-pane-head{padding:13px 12px;min-height:72px;gap:9px}.rs-shell .wc-h1{font-size:14px}.rs-shell .wc-pane-tools{margin-left:0;width:100%}.rs-shell .wc-pane-body{padding:16px 12px}.rs-shell .wc-msg{padding:11px 12px;max-width:100%}.rs-shell .wc-msg-text{font-size:12px}.rs-shell .wc-msg-head{flex-wrap:wrap}.rs-shell .wc-composer textarea{font-size:16px}.rs-shell .wc-btn{padding:6px 8px;font-size:10px}.rs-shell .wc-sec-meta{font-size:9px}.rs-team-grid{grid-template-columns:1fr}.rs-view-heading h2{font-size:23px}.rs-view-heading p{font-size:11px}.rs-inline-notice{padding:9px 12px}}
@media(prefers-reduced-motion:reduce){.rs-shell *{animation:none!important;scroll-behavior:auto!important}}
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
  const RS_LAYOUT = '.rs-workspace.has-aside{grid-template-columns:66px minmax(0,1fr) 292px;grid-template-rows:minmax(0,1fr);height:100%;min-height:0}'
    + '.rs-root .wc-app.no-rail{grid-template-columns:minmax(0,1fr)}.rs-workspace.has-aside>*{grid-row:1}.rs-workspace.has-aside>.wc-root{grid-column:2;min-height:0;min-width:0;height:100%;overflow:hidden}.rs-workspace.has-aside>.right{grid-column:3;display:flex;flex-direction:column;gap:0;min-height:0;overflow:auto;width:292px;min-width:292px;background:#f7f8ef;border-left:1px solid #dfe5d4}'
    + '@media(max-width:1240px){.rs-workspace.has-aside{grid-template-columns:66px minmax(0,1fr)}.rs-workspace.has-aside .right{display:none}}'
    + '.rs-workspace .topbar{display:flex;align-items:center;gap:12px;padding:10px 24px;border-bottom:1px solid #e3e8d8;background:#f7f8ef}'
    + '.editorial-row{display:flex;align-items:center;gap:14px;padding:14px 4px;border-bottom:1px solid #e6ebdc;cursor:pointer}'
    + '.editorial-row:hover{background:#f7f9f0}'
    + '.editorial-index{font-size:10px;color:#a3b090;min-width:22px}'
    + '.editorial-main{flex:1;min-width:0}.editorial-main strong{display:block;font-size:13px;color:#40582f}'
    + '.editorial-main p{margin:4px 0 0;font-size:10.5px;color:#93a380;line-height:1.7}'
    + '.editorial-meta{font-size:9.5px;color:#a3b090;white-space:nowrap}';
  const sheet = CSS + RS_CSS + RESONANCE_SHELL_CSS + RS_LAYOUT;
  if (el.textContent !== sheet) el.textContent = sheet;
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
  // the 共振 mark: four strokes crossing, the same ✳ the shell and the stage use
  mark: ['M8 2.2v11.6', 'M2.2 8h11.6', 'M3.9 3.9l8.2 8.2', 'M12.1 3.9l-8.2 8.2'],
  people: ['M6 2.3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z', 'M1.8 13.5v-1.2A3.2 3.2 0 0 1 5 9.1h2a3.2 3.2 0 0 1 3.2 3.2v1.2', 'M11 2.8a2.2 2.2 0 0 1 0 4.3', 'M12 9.2a3.2 3.2 0 0 1 2.2 3.1v1.2'],
  book: ['M2 2.8h4.2A2.1 2.1 0 0 1 8 3.9a2.1 2.1 0 0 1 1.8-1.1H14v10.4H9.8A2.1 2.1 0 0 0 8 14.3a2.1 2.1 0 0 0-1.8-1.1H2Z', 'M8 3.9v10.4'],
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
function isolateHostContent(node) {
  const saved = [];
  let branch = node;
  const body = node?.ownerDocument?.body;
  while (branch?.parentElement) {
    const parent = branch.parentElement;
    for (const el of parent.children) {
      if (el === branch || /^(SCRIPT|STYLE|LINK|META)$/.test(el.tagName)) continue;
      saved.push({ el, inert: el.getAttribute('inert'), aria: el.getAttribute('aria-hidden'),
        visibility: el.style.getPropertyValue('visibility'), priority: el.style.getPropertyPriority('visibility') });
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
      el.style.setProperty('visibility', 'hidden', 'important');
    }
    if (parent === body) break;
    branch = parent;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const {el, inert, aria, visibility, priority} of saved.reverse()) {
      if (inert === null) el.removeAttribute('inert'); else el.setAttribute('inert', inert);
      if (aria === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', aria);
      if (visibility) el.style.setProperty('visibility', visibility, priority); else el.style.removeProperty('visibility');
    }
  };
}

function returnToHost() {
  if (typeof HOST_LAYOUT?.selectPanel !== 'function') return false;
  HOST_LAYOUT.selectPanel(null);
  return true;
}

function ResonanceShell({ children }) {
  const containerRef = useRef(null);
  const [closed, setClosed] = useState(false);
  const [exitError, setExitError] = useState(null);
  const [portal] = useState(() => {
    if (!ReactDOM?.createPortal || typeof document === 'undefined' || !document.body) return null;
    const node = document.createElement('div');
    node.setAttribute('data-resonance-portal', '');
    return node;
  });
  useEffect(() => {
    if (closed) return;
    const node = portal || containerRef.current;
    const doc = node?.ownerDocument;
    if (!node || !doc?.body) return;
    const previousFocus = doc.activeElement;
    if (portal) doc.body.appendChild(portal);
    const restore = isolateHostContent(node);
    node.querySelector?.('[data-rs-focus]')?.focus({ preventScroll: true });
    return () => {
      restore();
      portal?.remove();
      if (previousFocus?.isConnected && !previousFocus.closest?.('[inert]')) previousFocus.focus?.({ preventScroll: true });
    };
  }, [portal, closed]);
  const leave = () => {
    try {
      if (!returnToHost()) setClosed(true);
    } catch (e) {
      setExitError(String(e?.message || e));
    }
  };
  if (closed) return h('div', { className: 'rs-shell-closed', role: 'status' }, t('host_restored'));
  const content = h('section', { className: 'rs-root rs-shell', ref: containerRef, 'aria-label': t('entry') },
    h('header', { className: 'rs-shell-header' },
      h('span', { className: 'rs-shell-mark', 'aria-hidden': 'true' }, '✳'),
      h('strong', { className: 'rs-shell-name' }, t('entry')),
      h('span', { className: 'rs-shell-description' }, t('space_description')),
      h('button', { type: 'button', className: 'rs-shell-return', 'data-rs-focus': '', onClick: leave, title: t('return_host') },
        icon('chevron', { size: 12 }), t('return_host'))),
    exitError ? h('div', { className: 'rs-shell-exit-error', role: 'alert' }, exitError,
      h('button', { type: 'button', className: 'wc-btn', onClick: () => setClosed(true) }, t('return_host'))) : null,
    h('div', { className: 'rs-shell-body' }, children));
  return portal ? ReactDOM.createPortal(content, portal) : content;
}

let GuardedWorld = null;
function ResonanceApp(props) {
  GuardedWorld ||= guarded(WorldPage, 'resonance-content');
  return h(ResonanceShell, null, h(GuardedWorld, props));
}

function WorldEntry() {
  ensureStyle();
  // the host renders the registered `label` itself, so the component supplies only the glyph —
  // emitting the text here produced a "世界 世界" entry in the rail.
  return icon('mark', { className: 'wc-globe', size: 16 });
}

// ---- first-run guide -------------------------------------------------------
// A new install opens on an empty board and an unexplained page. This says what the page is,
// runs four real checks against live data, and asks the one question that changes behaviour
// (whether the agent may approve its own commands). It never invents a config step: every row
// either passes or tells you exactly which file to look at.
const ONBOARD_KEY = 'rs.onboard.v1';

function useDefaultsInfo() {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    api('/defaults').then(x => { if (live) setD(x); }).catch(() => { });
    return () => { live = false; };
  }, []);
  return d;
}

function Onboarding({ snapshot, swarm, memory, autonomy, onAutonomy, onClose }) {
  const defaults = useDefaultsInfo();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState(null);
  const model = defaults && defaults.model ? defaults.model.provider + ' / ' + defaults.model.model : '';
  const rows = [
    ['页面 ↔ 宿主', !!snapshot, '连不上：在客户端里重开一次「共振」'],
    ['bot 团队', !!(swarm && (swarm.bots ?? []).length), '第一次进来会自动建「总理」和「公司大群」，等几秒再刷新'],
    ['模型', !!model, 'profile 里没有 agent-default-model：新建的 bot 跑不起来'],
    ['Obsidian 外脑（可选）', !!(memory && memory.available), '没配 vault 只是没有笔记镜像，其余照常'],
  ];
  const pick = async (v, e) => {
    setErr(null);
    try { await onAutonomy(v, e); } catch (x) { setErr(String(x?.message || x)); }
  };
  const body = step === 0
    ? h('div', { className: 'wc-col' },
      h('p', { className: 'wc-sec-hint', style: { margin: 0 } }, '这是你和 AI 团队一起干活的地方，不是一个聊天窗口。'),
      h('ul', { className: 'wc-log', style: { listStyle: 'none', margin: 0, padding: 0 } },
        h('li', { className: 'wc-log-row' }, h('span', { className: 'wc-plate' }, '1'), h('span', { className: 'wc-log-main' }, '你说目标，团队里的 bot 分工去做；每个 bot 有等级（CEO > 经理 > 组长 > 组员）和负责范围。')),
        h('li', { className: 'wc-log-row' }, h('span', { className: 'wc-plate' }, '2'), h('span', { className: 'wc-log-main' }, '本机执行默认要你亲手批：跑命令、读写文件都会先停下来问你，票据用一次就作废。')),
        h('li', { className: 'wc-log-row' }, h('span', { className: 'wc-plate' }, '3'), h('span', { className: 'wc-log-main' }, 'bot 会记事：立下的规矩写进笔记本（带三个时间、写入前查冲突），再镜像到 Obsidian 里它自己的目录。'))))
    : step === 1
      ? h('div', { className: 'wc-col' },
        h('p', { className: 'wc-sec-hint', style: { margin: 0 } }, '这四项是现查的，不是写死的文案：'),
        h('ul', { className: 'wc-log', style: { listStyle: 'none', margin: 0, padding: 0 } },
          rows.map(([label, ok, hint]) => h('li', { className: 'wc-log-row', key: label },
            h('span', { className: 'wc-plate', 'data-tone': ok ? 'ok' : 'warn' }, ok ? '就绪' : '要处理'),
            h('span', { className: 'wc-log-main' },
              h('span', { className: 'wc-log-cmd' }, label),
              ok ? null : h('span', { className: 'wc-row-sub' }, hint))))))
      : h('div', { className: 'wc-col' },
        h('p', { className: 'wc-sec-hint', style: { margin: 0 } }, '最后一个选择：AI 能不能自己批准自己的执行工单？'),
        h('div', { style: { display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' } },
          h('button', {
            type: 'button', className: 'wc-btn', 'data-tone': autonomy === true ? 'primary' : undefined,
            onClick: e => pick(false, e),
          }, '保持默认：每条都问我'),
          h('button', {
            type: 'button', className: 'wc-btn', 'data-tone': autonomy !== true ? undefined : 'primary',
            onClick: e => pick(true, e),
          }, '打开：AI 自己批自己')),
        h('p', { className: 'wc-sec-hint', style: { margin: 0 } },
          autonomy === true
            ? '现在是：开着。它会自己批准自己的命令。'
            : '现在是：关着。每条命令都会停下来等你 —— 推荐先这样用几天。'),
        err ? h('p', { className: 'wc-err', role: 'alert' }, err) : null);
  return h('div', { className: 'wc-scrim' },
    h('div', { className: 'wc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('onboard_title'), style: { width: 'min(620px,100%)' } },
      h('div', { className: 'wc-dialog-head' },
        h('h2', { className: 'wc-h1', style: { fontSize: 'var(--sand-font-size-lg)' } }, t('onboard_title')),
        h('span', { className: 'wc-plate', 'data-tone': 'muted' }, `${step + 1} / 3`)),
      h('div', { className: 'wc-dialog-body wc-scroll' }, body),
      h('div', { className: 'wc-form-act', style: { justifyContent: 'space-between' } },
        h('button', { type: 'button', className: 'wc-btn', disabled: step === 0, onClick: () => setStep(step - 1) }, t('onboard_back')),
        h('div', { style: { display: 'flex', gap: 'var(--sp-2)' } },
          h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: onClose }, t('onboard_skip')),
          step < 2
            ? h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: () => setStep(step + 1) }, t('onboard_next'))
            : h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: onClose }, t('onboard_done'))))));
}

// The memory place: what the bots decided stands, when it stops standing, and what was retired.
// Search and the two filters act on the same data the notebook section already edits.
function MemoryView({ nb, bots, busy, onAdd, onRetire, mem, onSync, brainBusy }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('live');
  const all = nb.data?.entries ?? [];
  const needle = q.trim().toLowerCase();
  const entries = all.filter(e => {
    if (scope === 'live' && e.status === 'retired') return false;
    if (scope === 'retired' && e.status !== 'retired') return false;
    if (!needle) return true;
    return (e.text || '').toLowerCase().includes(needle) || (e.tags ?? []).join(' ').toLowerCase().includes(needle);
  });
  const head = h('div', { className: 'rs-view-heading' },
    h('h2', null, '记住值得记住的，'),
    h('p', null, '每条规矩都带三个时间：什么时候写下的、说的是哪天、什么时候作废。过期的只当历史，不当现状；下线的进归档，永不真删。'));
  const tools = h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 } },
    h('label', { className: 'v6-chat-search', style: { margin: 0, flex: '1 1 240px' } },
      icon('book', { size: 14 }),
      h('input', {
        type: 'search', value: q, placeholder: '搜规则、标签或某个领域', 'aria-label': '搜索笔记本',
        style: { border: 0, background: 'transparent', outline: 'none', flex: 1, fontSize: 11, color: 'inherit' },
        onChange: e => setQ(e.target.value),
      })),
    [['live', '现行'], ['retired', '已下线'], ['all', '全部']].map(([k, label]) => h('button', {
      key: k, type: 'button', className: 'wc-btn', 'data-tone': scope === k ? 'primary' : 'ghost',
      onClick: () => setScope(k),
    }, label)));
  return h('div', { className: 'wc-col' },
    head,
    tools,
    h(NotebookSection, { data: { ...(nb.data ?? {}), entries }, bots, busy, onAdd, onRetire }));
}

// The machine place, in the design's shape: four tabs over the real queues. Every control here
// already existed — this only gives them the place the design asks for.
function ComputerView({ pending = [], runs = [], bots = [], permissions = {}, roots = [], audit = [], busy, initialTab, onVerdict, onControl, onRevoke }) {
  const [tab, setTab] = useState(initialTab || (pending.length ? 'pending' : 'done'));
  const tabs = [
    ['pending', '待你决定', pending.length],
    ['running', '执行中', runs.filter(r => r.running).length],
    ['done', '已完成', runs.filter(r => !r.running).length],
    ['grants', '权限与目录', Object.keys(permissions).length + (roots ?? []).length],
  ];
  const head = h('div', { className: 'rs-view-heading' },
    h('h2', null, t('nav_computer')),
    h('p', null, '能力的使用范围，由你决定。跑命令、读写文件都要先拿到你的票据。'));
  const tabBar = h('div', { style: { display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' } },
    tabs.map(([k, label, n]) => h('button', {
      key: k, type: 'button', className: 'wc-btn',
      'data-tone': tab === k ? 'primary' : 'ghost',
      onClick: () => setTab(k),
    }, label, n ? ' ' + n : '')));
  const body = tab === 'pending'
    ? (pending.length
      ? h('ul', { className: 'wc-items', style: { listStyle: 'none', margin: 0, padding: 0 } },
        pending.map((p, i) => h(ApprovalRow, { key: p.approvalId, item: p, index: i + 1, busy: busy === p.approvalId, onVerdict })))
      : h('div', { className: 'wc-empty' }, t('none_pending')))
    : tab === 'running' || tab === 'done'
      ? (runs.filter(r => (tab === 'running' ? r.running : !r.running)).length
        ? h(RunList, { runs: runs.filter(r => (tab === 'running' ? r.running : !r.running)), bots, onControl })
        : h('div', { className: 'wc-empty' }, tab === 'running' ? '现在没有在跑的' : '还没有跑完的记录'))
      : h('div', { className: 'wc-col' },
        h('h3', { className: 'wc-sec-title' }, t('permissions')),
        Object.keys(permissions).length
          ? h('ul', { className: 'wc-items', style: { listStyle: 'none', margin: 0, padding: 0 } },
            Object.entries(permissions).map(([a], i) => h(GrantRow, { key: a, action: a, index: i, onRevoke })))
          : h('div', { className: 'wc-empty' }, t('none_permissions')),
        h('h3', { className: 'wc-sec-title', style: { marginTop: 18 } }, t('workspace')),
        roots && roots.length ? h(MachineZone, { roots, i: 2 }) : h('div', { className: 'wc-empty' }, '没有授权任何一个目录'),
        audit && audit.length ? h('h3', { className: 'wc-sec-title', style: { marginTop: 18 } }, t('audit')) : null,
        audit && audit.length
          ? h('ul', { className: 'wc-log', style: { listStyle: 'none', margin: 0, padding: 0 } },
            audit.slice(-8).reverse().map((a, i) => h(LogRow, { key: `${a.at ?? ''}#${i}`, a, index: i, flash: false })))
          : null);
  return h('div', { className: 'wc-col' }, head, tabBar, body);
}

// The chat place, in the design's shape: a searchable room column, a thread head, the thread,
// and the composer docked under it. Messages reuse the transcript renderer (markdown, @chips,
// expand-in-place) so nothing that already worked gets lost by re-drawing bubbles.
function ChatView({ rooms, openRoom, onOpen, bots, nameById, messages, onSent, onDone, onNewRoom }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const shown = rooms.filter(r => {
    if (q.trim() && !(r.name || '').toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'unread') return !!r.unread;
    if (filter === 'read') return !r.unread;
    return true;
  });
  const roomRow = r => {
    const names = (r.memberIds ?? []).map(id => nameById[id]?.name).filter(Boolean).join('、') || '—';
    const active = openRoom?.id === r.id;
    const initial = h('span', {
      style: { width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center', background: '#e6edd8', color: '#5c7345', fontSize: 12, flex: '0 0 auto' },
    }, (r.name || '?').slice(0, 1));
    const copy = h('span', { style: { flex: 1, minWidth: 0 } },
      h('span', { style: { display: 'block', fontSize: 12, color: '#40582f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.name),
      h('span', { style: { display: 'block', fontSize: 9, color: '#9baa89', marginTop: 2 } }, names));
    const badge = r.unread
      ? h('span', { style: { background: '#d9f875', color: '#26311f', borderRadius: 999, fontSize: 9, padding: '1px 6px' } }, r.unread)
      : null;
    return h('button', {
      key: r.id, type: 'button', className: 'v6-chat-item', 'data-on': active ? '1' : undefined,
      style: {
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '10px 9px', border: 0,
        borderRadius: 11, background: active ? '#fbfcf5' : 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer',
      },
      onClick: () => onOpen(r.id),
    }, initial, copy, badge);
  };
  const filters = [['all', '全部'], ['unread', '有未读'], ['read', '已读']].map(([k, label]) => h('button', {
    key: k, type: 'button', className: 'v5-button ghost',
    style: filter === k ? { background: '#e6ecda', color: '#4e6438' } : null,
    onClick: () => setFilter(k),
  }, label));
  const sidebar = h('aside', { className: 'v6-chat-list' },
    h('div', { className: 'v6-list-heading' },
      h('div', null, h('div', { className: 'v5-eyebrow' }, 'CONVERSATIONS'), h('h2', null, t('nav_chat'))),
      h('button', { type: 'button', className: 'v6-icon-button', title: t('new_room'), onClick: onNewRoom }, icon('plus', { size: 17 }))),
    h('button', { type: 'button', className: 'v6-new-chat', onClick: onNewRoom }, icon('plus', { size: 15 }), '新建会话'),
    h('label', { className: 'v6-chat-search' },
      icon('globe', { size: 14 }),
      h('input', {
        type: 'search', value: q, placeholder: '搜索会话', 'aria-label': '搜索会话',
        style: { border: 0, background: 'transparent', outline: 'none', flex: 1, fontSize: 11, color: 'inherit' },
        onChange: e => setQ(e.target.value),
      })),
    h('div', { style: { display: 'flex', gap: 6, margin: '0 3px 10px' } }, filters),
    h('div', { style: { overflow: 'auto', minHeight: 0, paddingBottom: 16 } },
      shown.length ? shown.map(roomRow) : h('div', { className: 'wc-empty' }, '还没有会话')));
  const head = openRoom ? h('div', { className: 'v6-thread-head' },
    h('div', null,
      h('strong', { style: { fontSize: 14, color: '#40582f' } }, openRoom.name),
      h('div', { style: { fontSize: 10, color: '#9baa89', marginTop: 3 } },
        (openRoom.memberIds ?? []).map(id => nameById[id]?.name).filter(Boolean).join('、') || '—'))) : null;
  const body = openRoom
    ? h('div', { className: 'v6-thread-scroll wc-scroll' }, h(Transcript, { messages, bots }))
    : h('div', { className: 'wc-empty' }, t('pick_a_room'));
  const composer = openRoom ? h(Composer, { room: openRoom, onDone, onSent }) : null;
  return h('div', { className: 'v6-chat-layout' }, sidebar, h('section', { className: 'v6-thread' }, head, body, composer));
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
  const auto = data?.autonomy === true;
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

  // the guide opens once per browser; skipping counts as having seen it
  const [onboard, setOnboard] = useState(() => {
    try { return !localStorage.getItem(ONBOARD_KEY); } catch { return false; }
  });
  const closeOnboard = () => {
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { }
    setOnboard(false);
  };
  const setAutonomy = useCallback(async (v, e) => {
    if (e?.nativeEvent && !e.nativeEvent.isTrusted) throw new Error(t('need_gesture'));
    const n = nonce.current;
    if (!n) { reload(); throw new Error(t('need_sync')); }
    nonce.current = null;
    await api('/autonomy', { autonomy: v, nonce: n });
    reload();
  }, [reload, nonce]);
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
  const [goalEdit, setGoalEdit] = useState(null);
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
    if (!openRoom) { el.scrollTop = 0; return; }
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  // "not connected" is decided by a real failure, never by a guess about the config: api() already
  // recorded why when the channel is down (err). Before the first reply, show loading.
  const off = !!err;
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
  const botsColumn = ['bots', 'bot', 'newbot'].includes(focus.kind);
  const roomsColumn = false; // the chat place draws its own searchable column now
  const showRail = botsColumn || roomsColumn;
  const rail = h('nav', { className: 'wc-rail', 'aria-label': t('title') },
    ...(machineMode ? [h('div', { className: 'wc-rail-head' }, t('machine')),
    // the machine identity row is not resident: it appears only inside the 本机执行 console
    h('div', { className: 'wc-machine wc-stag', style: { '--i': 0 } },
      h('span', { className: 'wc-machine-dot', 'data-off': off ? '1' : '0', 'aria-hidden': 'true' }),
      h('span', { className: 'wc-machine-name', title: data?.machineId ?? '—' }, data?.machineId ?? '—'),
      h('span', { className: 'wc-machine-sub' }, off ? t('disconnected') : `${audit.length} ${t('audit')}`)),
 ] : []),
    h('div', { className: 'wc-rail-scroll wc-scroll' },
      // the left column is contextual, the way the design has it: 角色 shows the roster,
      // 对话 shows the rooms, and every other place gets the full width.
      botsColumn ? group(t('bots'), botRows, h('button', {
        type: 'button', className: 'wc-toggle', 'aria-label': t('new_bot'), onClick: () => setFocus({ kind: 'newbot', id: null }),
      }, '+')) : null,
      roomsColumn ? group(t('rooms'), roomRows, h('button', {
        type: 'button', className: 'wc-toggle', 'aria-label': t('new_room'), onClick: () => setFocus({ kind: 'newroom', id: null }),
      }, '+')) : null,
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
      h('h1', { className: 'wc-h1' }, openRoom?.name ?? ({ bots: t('nav_team'), notebook: t('nav_memory'), activity: t('nav_activity'), machine: t('machine_console') })[focus.kind] ?? t('title')),
      h('p', { className: 'wc-hint' }, openRoom
        ? `${openRoom.memberIds.length} ${t('members')} · ${openRoom.objective || t('no_goal')}`
        : focus.kind === 'bots' ? t('team_hint') : focus.kind === 'activity' ? t('activity_hint') : t('subtitle'))),
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
  // the chat place draws its own composer under the thread; only other views use the page one
  const composerEl = (openRoom && !['auto', 'room'].includes(focus.kind)) ? h(Composer, {
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
  const nameById = Object.fromEntries((swarm?.bots ?? []).map(b => [b.id, b]));
  const sessionRows = (swarm?.rooms ?? []).map((r, i) => h('div', {
    key: r.id, className: 'editorial-row', role: 'button', tabIndex: 0,
    onClick: () => setFocus({ kind: 'room', id: r.id }),
  },
  h('span', { className: 'editorial-index' }, String(i + 1).padStart(2, '0')),
  h('div', { className: 'editorial-main' },
    h('strong', null, r.name),
    h('p', null, r.objective ? '目标：' + r.objective : ((r.memberIds ?? []).map(id => nameById[id]?.name).filter(Boolean).join('、') || '—')),
    h('p', { style: { marginTop: 2, color: '#a9b69a' } }, (r.memberIds ?? []).map(id => nameById[id]?.name).filter(Boolean).join('、') || '—')),
  h('div', { className: 'editorial-meta' }, (r.unread ? r.unread + ' 未读' : '') )));

  const capsList = [
    ['理解与生成', '全部 deepseek-account / deepseek-flash，新建 bot 继承 profile 默认模型。做不到按任务换模型。'],
    ['本机执行', '跑命令、读写文件、列目录；每条先挂起等你批，票据一次性，越出授权根目录直接拒绝。'],
    ['等级与权限', 'CEO > 经理 > 组长 > 组员；只有 CEO 和经理能设目标、派活、控运行；任命由 CEO 做并公告。'],
    ['笔记本', '每条带三个时间，开工前按关键词+标签捞 5 条；写入前查冲突（嵌入/整合/融合/整改），永不真删，改动留账。'],
    ['外置大脑', '每个 bot 一个 Obsidian 目录：身份 / 规则 / 归档 / 账本 / 记忆 / 任务。'],
  ];

  // ---- 共振 shell ---------------------------------------------------------
  // The name on the stage is the bot's own name; the black chip beside it is the *position*
  // (CEO / 经理 / 组长). The user was explicit that these are two different things.
  const posLabel = { boss: t('pos_ceo'), direction: t('pos_manager'), officer: t('pos_lead'), execution: t('pos_member') };
  const rankOrder = { boss: 0, direction: 1, officer: 2, execution: 3 };
  const crew = [...(swarm?.bots ?? [])].sort((a, b) => (rankOrder[a.rank] ?? 9) - (rankOrder[b.rank] ?? 9));
  const isBusy = id => (swarm?.runs ?? []).some(r => r.botId === id && r.running);
  const seats = crew.slice(0, 3);
  const seatClass = ['ace', 'he', 'li'];
  const seatEl = (b, i) => h('div', {
    key: b ? b.id : 'empty' + i, className: 'character ' + seatClass[i], role: 'button', tabIndex: 0,
    title: b ? b.name + ' · ' + (posLabel[b.rank] ?? '') : t('seat_empty'),
    'data-character': b ? b.name : '',
    onClick: () => { if (b) openDirect(b); },
    onKeyDown: e => { if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDirect(b); } },
  },
  h('div', { className: 'antenna' }),
  h('div', { className: 'head' }, h('i', { className: 'cheek left' }), h('i', { className: 'cheek right' }), h('i', { className: 'mouth' })),
  h('div', { className: 'body' }),
  h('div', { className: 'feet' }, h('i'), h('i')),
  h('div', { className: 'name', style: b ? null : { opacity: 0.55 } },
    b ? b.name : t('seat_empty'),
    h('span', {
      className: 'rs-stage-tag',
      style: { display: 'inline-block', background: '#20241e', color: '#f3f1e9', fontSize: 8, padding: '1px 6px', borderRadius: 999, letterSpacing: '.04em', marginLeft: 5, verticalAlign: 'middle' },
    }, b ? (posLabel[b.rank] ?? '') : '—')));
  const stageEl = h('section', { className: 'stage', 'aria-label': t('nav_home') },
    h('div', { className: 'stage-top' },
      h('span', { className: 'stage-label' }, t('nav_home')),
      h('span', { className: 'stage-live' }, h('span', { className: 'status-dot' }),
        h('span', null, seats.length ? (pending.length ? t('need_you') + ' ' + pending.length : t('idle')) : t('seat_empty')))),
    h('div', { className: 'orbit' }), h('div', { className: 'pulse-ring' }),
    h('div', { className: 'stage-core' }, '✳'),
    h('div', { className: 'stage-caption' }, 'THE TEAM IS HERE'),
    [0, 1, 2].map(i => seatEl(seats[i], i)));

  const needCount = pending.length;
  const topbarEl = h('header', { className: 'topbar' },
    h('div', { className: 'brandline' },
      h('span', null, t('entry')), h('span', { className: 'slash' }, '/'),
      h('strong', null, openRoom?.name ?? (focus.kind === 'home' ? t('nav_home') : t('title')))),
    h('div', { className: 'top-actions' },
      needCount ? h('button', {
        type: 'button', className: 'v5-top-button', title: t('need_you'),
        onClick: () => { setFocus({ kind: 'machine', id: null }); },
      }, icon('bolt', { size: 13 }), h('span', null, t('need_you') + ' ' + needCount)) : null,
      h('span', { className: 'status-pill' }, h('span', { className: 'status-dot' }),
        h('span', null, off ? t('disconnected') : t('connected')))));

  const crewAside = h('aside', { className: 'right' },
    h('div', { className: 'right-head' }, h('strong', null, t('crew')), h('span', null, 'THE CREW')),
    crew.length ? h('div', { className: 'right-section' },
      h('div', { className: 'right-section-head' }, h('strong', null, t('crew_hint')), h('span', null, String(crew.length))),
      crew.map(b => h('div', { key: b.id, className: 'member', role: 'button', tabIndex: 0, onClick: () => openDirect(b) },
        h('div', { className: 'member-avatar' }, (b.name || '?').slice(0, 1)),
        h('div', { className: 'member-copy' },
          h('span', { className: 'member-name' }, b.name),
          h('span', { className: 'member-desc' }, [posLabel[b.rank], b.domain].filter(Boolean).join(' · ') || t('pos_member'))),
        h('span', { className: 'member-status' }, isBusy(b.id) ? t('busy') : t('idle')))))
      : h('div', { className: 'right-note' }, t('swarm_unavailable')));

  // The control strip is the design's core interaction, and every button here is a real call:
  // 暂停 = cancel the live run, 调整目标 = setRoomGoal, 当前进度 = the room's own task state.
  // 调整分工 needs an assignee picker that the design does not have yet, so it stays marked.
  const stripRoom = openRoom || (swarm?.rooms ?? [])[0] || null;
  const liveRun = (swarm?.runs ?? []).find(r => r.roomId === stripRoom?.id && r.running);
  const controlStrip = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 16px' } },
    h('span', { style: { fontSize: 10, color: '#93a380', marginRight: 4 } }, '你始终可以改变方向'),
    h('button', {
      type: 'button', className: 'wc-btn', disabled: !liveRun,
      onClick: () => liveRun && controlRun({ id: liveRun.id, action: 'cancel', expectedRevision: liveRun.controlRevision ?? 0 }, 'controlRun'),
    }, 'Ⅱ 暂停协作'),
    goalEdit === null
      ? h('button', { type: 'button', className: 'wc-btn', disabled: !stripRoom, onClick: () => setGoalEdit(stripRoom?.objective || '') }, '↗ 调整目标')
      : h('span', { style: { display: 'inline-flex', gap: 6, alignItems: 'center', flex: '1 1 260px' } },
        h('input', {
          type: 'text', value: goalEdit, autoFocus: true, 'aria-label': '本群目标',
          onChange: e => setGoalEdit(e.target.value),
          onKeyDown: e => { if (e.key === 'Escape') setGoalEdit(null); },
          style: { flex: 1, minWidth: 120, fontSize: 11, padding: '6px 8px', borderRadius: 8, border: '1px solid #d7e2c7', background: '#fdfff7' },
        }),
        h('button', {
          type: 'button', className: 'wc-btn', 'data-tone': 'primary',
          onClick: async () => {
            if (!stripRoom || !goalEdit.trim()) return;
            try { await communityAct('setRoomGoal', { roomId: stripRoom.id, text: goalEdit.trim() }); setGoalEdit(null); com.reload?.(); }
            catch (e) { /* the notice strip already surfaces write failures */ }
          },
        }, t('save')),
        h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'ghost', onClick: () => setGoalEdit(null) }, t('cancel'))),
    h('span', { className: 'wc-plate', 'data-tone': 'muted', title: '需要先定"派给谁"的挑选方式（前端还没这一块）' }, '＋ 调整分工 · 未接入'),
    h('span', { style: { fontSize: 10, color: '#93a380', marginLeft: 'auto' } },
      stripRoom ? ((stripRoom.objective ? '目标：' + stripRoom.objective : '还没设目标') + ' · ' + (liveRun ? '正在跑' : '空闲')) : ''));
  const specialBody = focus.kind === 'home' ? h('div', { className: 'wc-col' },
    stageEl,
    h('div', { className: 'rs-view-heading' }, h('h2', null, '任务工作台'), h('p', null, openRoom ? openRoom.name : t('pick_a_room'))),
    controlStrip,
    openRoom ? h(Transcript, { messages: [...roomMessages, ...localPending], bots: swarm?.bots ?? [] }) : sessionRows,
    h('div', { className: 'rs-view-heading' }, h('h2', null, '协作正在如何展开'), h('p', null, '只呈现有意义的进展')),
    h(RunList, { runs: (swarm?.runs ?? []).slice(0, 8), bots: swarm?.bots ?? [], onControl: controlRun }))
    : focus.kind === 'machine' ? h(ComputerView, {
      pending, runs: swarm?.runs ?? [], bots: swarm?.bots ?? [], permissions,
      roots: data?.allowedRoots ?? [], audit, busy, onVerdict: respond, onControl: controlRun, onRevoke: revoke,
    })
    : focus.kind === 'sessions' ? h('div', { className: 'wc-col' },
      h('div', { className: 'rs-view-heading' }, h('h2', null, t('nav_sessions')), h('p', null, '按目标和决策组织，不是聊天记录。')),
      !swarm ? h('div', { className: 'wc-empty' }, com.err || t('swarm_unavailable')) : sessionRows)
    : focus.kind === 'projects' ? h('div', { className: 'wc-col' },
      h('div', { className: 'rs-view-heading' }, h('h2', null, t('nav_projects')), h('p', null, '不同的工作，各自有自己的空间。')),
      h('div', { className: 'wc-empty', role: 'note' },
        '这一层还没接后端：现在只有"房间"，没有"项目/空间"这个实体。位置先留着，等前端和后端都定下来再接。'))
    : focus.kind === 'caps' ? h('div', { className: 'wc-col' },
      h('div', { className: 'rs-view-heading' }, h('h2', null, t('nav_caps')), h('p', null, '这一页只写这个插件真做到的事，做不到的直接标出来。')),
      capsList.map(([title, body]) => h('div', { key: title, className: 'v5-note-card' },
        h('strong', null, title), h('p', null, body))))
    : ['auto', 'room'].includes(focus.kind) ? h(ChatView, {
      rooms: swarm?.rooms ?? [], openRoom, bots: swarm?.bots ?? [], nameById,
      messages: [...roomMessages, ...localPending],
      onOpen: id => setFocus({ kind: 'room', id }),
      onNewRoom: () => setFocus({ kind: 'newroom', id: null }),
      onSent: text => {
        const createdAt = new Date().toISOString();
        setOptimistic(list => [...list, {
          id: 'local-' + createdAt + '-' + Math.random().toString(16).slice(2),
          roomId: openRoom.id, sender: { kind: 'user', name: 'user' }, text, createdAt,
        }]);
        com.reload?.();
      },
      onDone: () => com.reload?.(),
    })
    : focus.kind === 'bots' ? h('div', { className: 'wc-col' },
    h('div', { className: 'rs-view-heading' }, h('h2', null, t('nav_team')), h('p', null, t('team_hint'))),
    h('div', { className: 'wc-form-act' },
      h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: () => setFocus({ kind: 'newbot', id: null }) }, '+ ', t('new_bot')),
      h('button', { type: 'button', className: 'wc-btn', onClick: () => setFocus({ kind: 'newroom', id: null }) }, '+ ', t('new_room'))),
    !swarm ? h('div', { className: 'wc-empty' }, com.err || t('swarm_unavailable')) : !(swarm.bots ?? []).length ? h('div', { className: 'wc-empty' }, t('no_bots_yet'))
      : h('div', { className: 'rs-team-grid' }, (swarm.bots ?? []).map(b => h('article', { key: b.id, className: 'rs-team-card' },
        h('span', { className: 'rs-team-avatar', 'aria-hidden': 'true' }, b.avatar || '🤖'),
        h('h3', null, b.name), h('p', null, [b.rank ? rankLabel(b.rank) : '', b.domain, b.description].filter(Boolean).join(' · ') || t('no_persona')),
        h('span', { className: 'wc-plate' }, busyBot(b.id) ? t('busy') : t('idle')),
        h('div', { className: 'wc-form-act' },
          h('button', { type: 'button', className: 'wc-btn', 'data-tone': 'primary', onClick: () => openDirect(b) }, t('direct')),
          h('button', { type: 'button', className: 'wc-btn', onClick: () => setSettingsBot(b) }, t('bot_settings')))))))
    : focus.kind === 'notebook' ? h(MemoryView, {
      nb, bots: swarm?.bots ?? [], busy: nbBusy, onAdd: nbAdd, onRetire: nbRetire,
      mem: mem.data, onSync: syncBrain, brainBusy,
    })
    : focus.kind === 'activity' ? h('div', { className: 'wc-col' },
      h('div', { className: 'rs-view-heading' }, h('h2', null, t('nav_activity')), h('p', null, t('activity_hint'))),
      !swarm ? h('div', { className: 'wc-empty' }, com.err || t('swarm_unavailable'))
        : h(RunList, { runs: swarm.runs ?? [], bots: swarm.bots ?? [], onControl: controlRun }))
    : null;
  const navItems = [
    { id: 'auto', label: t('nav_chat'), glyph: 'chat', active: ['auto', 'room'].includes(focus.kind) },
    { id: 'home', label: t('nav_home'), glyph: 'globe', active: focus.kind === 'home' },
    { id: 'sessions', label: t('nav_sessions'), glyph: 'timeline', active: focus.kind === 'sessions' },
    { id: 'bots', label: t('nav_cast'), glyph: 'people', active: ['bots', 'newbot', 'newroom', 'bot'].includes(focus.kind) },
    { id: 'projects', label: t('nav_projects'), glyph: 'folder', active: focus.kind === 'projects' },
    { id: 'caps', label: t('nav_caps'), glyph: 'bolt', active: focus.kind === 'caps' },
    { id: 'notebook', label: t('nav_memory'), glyph: 'book', active: focus.kind === 'notebook' },
    { id: 'machine', label: t('nav_computer'), glyph: 'terminal', active: machineMode },
  ];
  const navigation = h('nav', { className: 'rs-nav', 'aria-label': t('entry') },
    navItems.map(item => h('button', {
      key: item.id, type: 'button', className: 'rs-nav-button', title: item.label,
      'aria-current': item.active ? 'page' : undefined,
      onClick: () => setFocus({ kind: item.id, id: null }),
    }, icon(item.glyph, { size: 18 }), h('span', null, item.label))),
    h('span', { className: 'rs-nav-bottom', 'aria-hidden': 'true' }, 'RESONANCE'));
  // First run says the one thing a new user cannot guess: nothing runs until they say so.
  const [firstRun, setFirstRun] = useState(() => {
    try { return !localStorage.getItem('rs.firstrun.v1'); } catch { return true; }
  });
  const firstRunNote = (firstRun && !onboard && data && data.autonomy !== true)
    ? h('div', {
      role: 'note',
      style: {
        display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap',
        padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-4)',
        border: '.5px solid var(--sand-border-secondary-translucent)',
        borderRadius: 'var(--cursor-radius-base)', background: 'var(--sand-bg-pane)',
      },
    },
    h('span', { style: { flex: '1 1 320px', minWidth: 0, fontSize: 'var(--sand-font-size-xs)', lineHeight: 1.8 } }, t('firstrun')),
    h('button', {
      type: 'button', className: 'wc-btn',
      onClick: () => { try { localStorage.setItem('rs.firstrun.v1', '1'); } catch { } setFirstRun(false); },
    }, t('firstrun_ok')))
    : null;

  const chatPlace = ['auto', 'room'].includes(focus.kind);
  const pane = h('main', { className: 'wc-pane' }, topbarEl, head,
    notice ? h('div', { className: 'rs-inline-notice', role: 'status' }, notice) : null,
    off ? banner : null,
    h('div', { ref: bodyRef, className: 'wc-pane-body wc-scroll' }, chatPlace ? null : firstRunNote, chatPlace ? null : decisionSection, specialBody ?? swarmBody ?? emptyLibrary ?? (swarmPending && focus.kind === 'auto' && !off ? h('div', { className: 'wc-col' },
      h('div', { className: 'wc-skel wc-skel-row' }), h('div', { className: 'wc-skel wc-skel-row' }),
      h('div', { className: 'wc-skel wc-skel-line', style: { width: '46%' } })) : sections)), composerEl);

  return h('div', { ref: scopeRef, className: 'wc-scope rs-workspace has-aside rs-root', 'data-kbd': '0', style: { height: '100%' } },
    navigation,
    crewAside,
    h('div', { ref: rootRef, className: 'wc-root', 'data-enter': enter ? '1' : '0' },
      h('div', { className: 'wc-app' + (showRail ? '' : ' no-rail') }, showRail ? rail : null, pane),
      onboard && data ? h(Onboarding, {
        snapshot: data, swarm, memory: mem.data, autonomy: data.autonomy,
        onAutonomy: setAutonomy, onClose: closeOnboard,
      }) : null,
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
  try { HOST_LAYOUT = ctx?.layout ?? null; } catch { HOST_LAYOUT = null; }
  try { ctx.locale?.register?.(NS, { zh: LOCALE.zh, en: LOCALE.en }); } catch { }
  const reg = (name, fn) => { try { fn(); return [name, 'ok']; } catch (e) { console.error(`[${NS}] slot ${name} failed:`, e); return [name, String(e?.message || e)]; } };
  const r1 = reg('sidebar.panellist', () => ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: VIEW_KEY, order: 10, locale: NS, label: () => t('entry') }, guarded(WorldEntry, 'sidebar.panellist'))));
  const r2 = reg('main', () => ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: VIEW_KEY }, guarded(ResonanceApp, 'main'))));
  // Report our own mount so the host side can state, with evidence, whether the page is live.
  // The probe takes a thunk: `ctx.remote` must not be evaluated outside the try.
  const has = (probe) => { try { return probe() != null; } catch { return false; } };
  report({
    at: new Date().toISOString(), build: BUILD, slots: [r1, r2],
    remote: has(() => ctx.remote.agentCommunity), locale: has(() => ctx.locale), slotsApi: has(() => ctx.slots),
    layout: has(() => ctx.layout), portal: typeof ReactDOM?.createPortal === 'function',
  });
}

const inject = [];

// Self-register with the dsh renderer's module loader, the same way the shipped client bundles do.

  const API = { name: NS, apply, WorldPage, WorldEntry, ResonanceApp, ResonanceShell, isolateHostContent, returnToHost, LOCALE, endpoint, api, act: communityAct, CSS, RS_CSS, RESONANCE_SHELL_CSS, STYLE_ID, guarded,
    Transcript, RunList, RunRow, BotDetail, MentionText, MachineZone, ProposalCard, ProposalList, TeamApprovalCard, TeamApprovalList, QuestionCard, QuestionList, NewRoomForm, TaskBoard, Composer, NewBotForm, BrainSection, PendingRow, normalizeCommunity, community, Onboarding, ComputerView };
  API.__setReact = (R) => { React = R; };
  API.__setReactDOM = (R) => { ReactDOM = R; };
  API.__setRemote = (r) => { try { setRemote(r); } catch (e) { } };
  if (root && root.__ModuleLoader__ && root.__ModuleLoader__.load) {
    root.__ModuleLoader__.load({
      id: NS,
      factory: function (require) {
        const React_ = require("react");
        API.__setReact(React_);
        try { API.__setReactDOM(require('react-dom')); } catch { }
        return {
          inject: ["slots", "remote", "layout"],
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
