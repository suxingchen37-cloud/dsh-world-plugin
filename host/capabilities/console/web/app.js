// 共振 —— 聊天产品前端。2 秒轮询 /api/panel，本地无框架，无构建。
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeShort = (iso) => String(iso ?? '').replace('T', ' ').slice(5, 16);
const RANK_NAME = { boss: '总理', direction: '管方向', officer: '小官', execution: '组长' };

let P = null;             // 最新 panel
let activeRoom = null;    // 当前房间 id
const seenMsgIds = new Set();

// ---- 轮询 ----
async function refresh() {
  try {
    P = await (await fetch('/api/panel', { cache: 'no-store' })).json();
  } catch { return; }
  render();
}
setInterval(refresh, 2000);
refresh();

// ---- 渲染分发 ----
function render() {
  if (!P?.community?.available) {
    $('#stream').innerHTML = `<div class="empty">${esc(P?.community?.reason ?? 'agent-community 未就绪')}</div>`;
    return;
  }
  renderMode();
  renderRooms();
  renderRoster();
  if (!activeRoom || !P.community.rooms.some(r => r.id === activeRoom)) {
    const company = P.community.rooms.find(r => r.isGroup);
    activeRoom = (company ?? P.community.rooms[0])?.id ?? null;
  }
  renderHead();
  renderBanner();
  renderStream();
  renderTyping();
  renderAutonomy();
}

// ---- 左栏 ----
function renderMode() {
  $('#modeBadge').textContent = P.community.demoMode ? '演示模式 · 模型未接通' : '已接通模型';
  $('#modeBadge').innerHTML = P.community.demoMode
    ? '<span class="badge warn">演示模式 · 模型未接通</span>'
    : '<span class="badge ok">已接通模型</span>';
}

function renderRooms() {
  const unreadOf = (rid) => P.community.messages.filter(m => m.roomId === rid && m.senderKind === 'bot' && !seenMsgIds.has(m.id)).length;
  $('#roomList').innerHTML = P.community.rooms.map(r => {
    const last = [...P.community.messages].reverse().find(m => m.roomId === r.id);
    const bot = r.directBotId ? P.community.bots.find(b => b.id === r.directBotId) : null;
    const unread = unreadOf(r.id);
    return `<div class="room-item ${r.id === activeRoom ? 'active' : ''}" data-room="${esc(r.id)}">
      <div class="r-ico">${r.isGroup ? '👥' : (bot?.avatar ?? '🤖')}</div>
      <div class="r-name"><b>${esc(r.name)}</b><span>${esc(last ? last.text.slice(0, 26) : (r.objective || '还没有消息'))}</span></div>
      ${unread ? `<span class="pill">${unread}</span>` : ''}
    </div>`;
  }).join('');
  document.querySelectorAll('.room-item').forEach(el => el.onclick = () => { activeRoom = el.dataset.room; render(); });

  $('#roster').innerHTML = P.community.bots.map(b => {
    const rank = b.id === P.org.primeBotId ? 'boss' : (P.org.ranks[b.id] || 'execution');
    const running = P.community.runs.some(x => x.running && x.botId === b.id);
    return `<div class="bot-item" title="${esc(b.description)}（${esc(b.model)}）">
      <div class="b-ava">${esc(b.avatar)}</div>
      <div class="b-name">${esc(b.name)}</div>
      ${running ? '<span class="badge accent">干活中</span>' : `<span class="badge ${rank === 'boss' ? 'accent' : ''}">${RANK_NAME[rank] ?? rank}</span>`}
    </div>`;
  }).join('');
}
function renderRoster() { /* 由 renderRooms 一并渲染 */ }

// ---- 房间头 ----
function renderHead() {
  const room = P.community.rooms.find(r => r.id === activeRoom);
  if (!room) return;
  $('#roomName').textContent = room.name;
  const members = room.memberIds.map(id => P.community.bots.find(b => b.id === id)?.name).filter(Boolean);
  $('#roomSub').textContent = room.isGroup
    ? (room.objective ? `目标：${room.objective}` : '公司大群')
    : `与 ${members.join('、')} 的私聊`;
  $('#roomMembers').innerHTML =
    (room.isGroup ? '<span class="badge accent">群</span>' : '<span class="badge">1:1</span>')
    + members.map(m => `<span class="badge">${esc(m)}</span>`).join('');
}

// ---- 本机执行待审批（置顶横幅）----
function renderBanner() {
  const pend = P.computer.pending;
  $('#bannerZone').innerHTML = pend.map(p => `
    <div class="banner">
      <b>本机执行待审批</b>
      <span class="mono">${esc(p.action)}</span>
      <span class="grow mono muted">${esc(JSON.stringify(p.args?.command ? { command: p.args.command, args: p.args.args } : p.args))}</span>
      <button class="btn ok" onclick="respond('${esc(p.approvalId)}','allow-once')">允许一次</button>
      <button class="btn bad" onclick="respond('${esc(p.approvalId)}','deny')">拒绝</button>
    </div>`).join('');
}
window.respond = async (approvalId, verdict) => { await post('/api/respond', { approvalId, verdict }); refresh(); };

// ---- 消息流 ----
function renderStream() {
  const msgs = P.community.messages.filter(m => m.roomId === activeRoom);
  for (const m of msgs) seenMsgIds.add(m.id);
  const questions = P.community.questions.filter(q => q.roomId === activeRoom);
  const teamApprovals = P.community.approvals.filter(a => a.roomId === activeRoom);
  const parts = [];
  for (const m of msgs) {
    if (m.kind === 'application' || m.kind === 'appoint' || m.kind === 'conflict') {
      parts.push(`<div class="syscard"><div class="sc-title">${{ application: '增员申请', appoint: '任命公告', conflict: '规则冲突' }[m.kind] ?? '通知'}</div>${esc(m.text)}</div>`);
      continue;
    }
    const bot = m.botId ? P.community.bots.find(b => b.id === m.botId) : null;
    const me = m.senderKind === 'user';
    parts.push(`<div class="msg ${me ? 'me' : ''}">
      <div class="ava">${me ? '🧑‍💻' : esc(bot?.avatar ?? '🤖')}</div>
      <div class="msg-body">
        <div class="msg-meta"><span class="who">${esc(m.sender)}</span>
          ${bot ? `<span class="badge">${esc((bot.model ?? '').split('/').pop() ?? '')}</span>` : ''}
          ${m.durationMs ? `<span class="dur">${(m.durationMs / 1000).toFixed(1)}s</span>` : ''}
          <span>${timeShort(m.at)}</span></div>
        <div class="bubble">${esc(m.text)}</div>
      </div>
    </div>`);
  }
  for (const q of questions) {
    parts.push(`<div class="syscard qcard"><div class="sc-title">${esc(q.memberName)} 在问你</div>
      <div>${esc(q.question)}</div>
      <div class="q-opts">${(q.options ?? []).map(o => `<button class="btn primary" onclick="answer('${esc(q.id)}', ${JSON.stringify(o).replaceAll('"', '&quot;')})">${esc(o)}</button>`).join('')}
        ${q.allowFreeText ? '' : ''}</div>
      ${q.allowFreeText ? `<div class="q-free"><input id="q-free-${esc(q.id)}" placeholder="或者自己说…"><button class="btn" onclick="answerFree('${esc(q.id)}')">回复</button></div>` : ''}
    </div>`);
  }
  for (const a of teamApprovals) {
    parts.push(`<div class="syscard qcard"><div class="sc-title">${esc(a.memberName)} 请求执行工具</div>
      <div><span class="badge ${a.risk === 'irreversible' ? 'bad' : 'warn'}">${esc(a.toolName)}</span> <span class="mono muted">${esc(a.reason)}</span></div>
      <div class="q-opts"><button class="btn ok" onclick="approve('${esc(a.id)}','allow')">允许</button>
      <button class="btn bad" onclick="approve('${esc(a.id)}','reject')">拒绝</button></div>
    </div>`);
  }
  $('#stream').innerHTML = parts.join('') || `<div class="empty">这个房间还没有消息，打个招呼吧</div>`;
  $('#stream').scrollTop = $('#stream').scrollHeight;
}

function renderTyping() {
  const running = P.community.runs.filter(r => r.running && r.roomId === activeRoom);
  const names = running.map(r => P.community.bots.find(b => b.id === r.botId)?.name).filter(Boolean);
  $('#typing').hidden = !names.length;
  $('#typing').innerHTML = names.map(n => `${esc(n)} <span class="dots">正在处理</span>`).join('　·　');
}

function renderAutonomy() {
  const sw = $('#autonomySwitch');
  sw.setAttribute('aria-checked', String(P.computer.autonomy));
  sw.onclick = async () => { await post('/api/autonomy', { autonomy: !P.computer.autonomy }); refresh(); };
}

// ---- 动作 ----
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
window.answer = async (questionId, value) => { await post('/api/answer', { questionId, value }); refresh(); };
window.answerFree = async (questionId) => {
  const el = $('#q-free-' + questionId);
  await post('/api/answer', { questionId, value: el?.value ?? '' });
  refresh();
};
window.approve = async (callId, outcome) => { await post('/api/approve', { callId, outcome }); refresh(); };

// ---- 输入器 ----
const input = $('#input');
function send() {
  const text = input.value.trim();
  if (!text || !activeRoom) return;
  input.value = ''; input.style.height = 'auto';
  $('#sendBtn').disabled = true;
  post('/api/send', { roomId: activeRoom, text })
    .then(() => refresh())
    .finally(() => { $('#sendBtn').disabled = false; input.focus(); });
}
$('#sendBtn').onclick = send;
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});
