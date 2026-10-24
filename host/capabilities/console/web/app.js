// 共振 · 聊天前端。2 秒轮询 /api/panel；资产取自 frontend-pattern-library（见交付说明）。
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeShort = (iso) => String(iso ?? '').replace('T', ' ').slice(5, 16);
const RANK_NAME = { boss: '总理', direction: '管方向', officer: '小官', execution: '组长' };
const KIND_CN = { executed: '已执行', refused: '已拒绝', responded: '已表态', retired: '已撤销', 'corrupt-state': '账本损坏', autonomy: '自主开关' };

let P = null;                 // 最新 panel
let activeRoom = null;
let rememberMode = false;     // 📌 记住模式：发送改为入本子
let firstRun = true;          // 首屏 fade-stagger 只跑一次
let failures = 0;             // 连续轮询失败 → 离线横幅
const localPending = [];      // 乐观上屏：自己发的、还没被轮询确认的消息
const sessionCards = [];      // 会话内系统卡（记住的冲突回执等），切房间清空
const seenMsgIds = new Set();

// ---- 轮询 ----
async function refresh() {
  try {
    P = await (await fetch('/api/panel', { cache: 'no-store' })).json();
    failures = 0;
  } catch {
    if (++failures >= 2) renderOffline();
    return;
  }
  render();
}
setInterval(refresh, 2000);
refresh();

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

// ---- 离线横幅（offline-banner）----
function renderOffline() {
  $('#offlineBanner').innerHTML = `<div class="offline">连接断了 · 每 2 秒重试中，不用做什么</div>`;
}

// ---- 渲染分发 ----
function render() {
  if (!P?.community?.available) {
    $('#stream').innerHTML = `<div class="empty"><b>团队还没就绪</b><p>${esc(P?.community?.reason ?? 'agent-community 未加载')}</p></div>`;
    return;
  }
  renderMode();
  renderRooms();
  if (!activeRoom || !P.community.rooms.some(r => r.id === activeRoom)) {
    activeRoom = (P.community.rooms.find(r => r.isGroup) ?? P.community.rooms[0])?.id ?? null;
  }
  renderHead();
  renderBanner();
  renderStream();
  renderTyping();
  renderAutonomy();
}

function renderMode() {
  $('#modeBadge').textContent = P.community.demoMode ? '演示模式 · 模型未接通' : '已接通模型';
}

// ---- 房间与名册 ----
function renderRooms() {
  const unreadOf = (rid) => P.community.messages.filter(m => m.roomId === rid && m.senderKind === 'bot' && !seenMsgIds.has(m.id)).length;
  const list = P.community.rooms.map(r => {
    const last = [...P.community.messages].reverse().find(m => m.roomId === r.id);
    const bot = r.directBotId ? P.community.bots.find(b => b.id === r.directBotId) : null;
    const unread = unreadOf(r.id);
    return `<div class="room-item ${r.id === activeRoom ? 'active' : ''}" data-room="${esc(r.id)}">
      <div class="r-ico">${r.isGroup ? '群' : (bot?.avatar ?? '●')}</div>
      <div class="r-name"><b>${esc(r.name)}</b><span>${esc(last ? last.text.slice(0, 24) : (r.objective || '还没有消息'))}</span></div>
      ${unread ? `<span class="pill ${firstRun ? 'on' : ''}">${unread}</span>` : ''}
    </div>`;
  }).join('');
  const roster = P.community.bots.map(b => {
    const rank = b.id === P.org.primeBotId ? 'boss' : (P.org.ranks[b.id] || 'execution');
    const running = P.community.runs.some(x => x.running && x.botId === b.id);
    return `<div class="bot-item" title="${esc(b.description)}（${esc(b.model)}）">
      <div class="b-ava">${esc(b.avatar)}<i class="${running ? 'busy' : ''}"></i></div>
      <div class="b-name">${esc(b.name)}</div>
      ${running ? '<span class="badge ok">干活中</span>' : `<span class="badge ${rank === 'boss' ? 'accent' : ''}">${RANK_NAME[rank] ?? rank}</span>`}
    </div>`;
  }).join('');
  $('#roomList').innerHTML = list;
  $('#roster').innerHTML = roster;
  document.querySelectorAll('.room-item').forEach(el => el.onclick = () => { activeRoom = el.dataset.room; sessionCards.length = 0; localPending.length = 0; render(); });
}

// ---- 房间头 ----
function renderHead() {
  const room = P.community.rooms.find(r => r.id === activeRoom);
  if (!room) return;
  $('#roomName').textContent = room.name;
  const members = room.memberIds.map(id => P.community.bots.find(b => b.id === id)?.name).filter(Boolean);
  $('#roomSub').textContent = room.isGroup
    ? (room.objective ? `目标：${room.objective}` : '公司大群')
    : `与 ${members.join('、')} 的私聊`;
  $('#roomMembers').textContent = members.join(' · ').toUpperCase();
}

// ---- 本机执行待审批横幅 ----
function renderBanner() {
  $('#bannerZone').innerHTML = P.computer.pending.map(p => `
    <div class="banner">
      <b>待审批</b>
      <span class="mono">${esc(p.action)}</span>
      <span class="grow mono">${esc(JSON.stringify(p.args?.command ? { command: p.args.command, args: p.args.args } : p.args))}</span>
      <button class="btn ok" data-respond="${esc(p.approvalId)}" data-verdict="allow-once">允许一次</button>
      <button class="btn bad" data-respond="${esc(p.approvalId)}" data-verdict="deny">拒绝</button>
    </div>`).join('');
  document.querySelectorAll('[data-respond]').forEach(b => b.onclick = async () => {
    const out = await post('/api/respond', { approvalId: b.dataset.respond, verdict: b.dataset.verdict });
    toast(out.ok ? `已${b.dataset.verdict === 'deny' ? '拒绝' : '放行'}` : '没成：' + (out.hint || out.error), out.ok ? '' : 'warn');
    refresh();
  });
}

// ---- 消息流 ----
function renderStream() {
  const msgs = P.community.messages.filter(m => m.roomId === activeRoom);
  for (const m of msgs) seenMsgIds.add(m.id);
  const target = targetOf(activeRoom);
  const questions = P.community.questions.filter(q => q.roomId === activeRoom);
  const teamApprovals = P.community.approvals.filter(a => a.roomId === activeRoom);
  const parts = [];
  for (const m of msgs) {
    if (m.kind === 'application' || m.kind === 'appoint' || m.kind === 'conflict') {
      const t = { application: ['增员申请', 'exc'], appoint: ['任命公告', 'do'], conflict: ['规则冲突', 'warn'] }[m.kind];
      parts.push(`<div class="syscard ${t[1]}"><div class="sc-title">${t[0]}</div><p>${esc(m.text)}</p></div>`);
      continue;
    }
    const bot = m.botId ? P.community.bots.find(b => b.id === m.botId) : null;
    const me = m.senderKind === 'user';
    parts.push(`<div class="msg ${me ? 'me' : ''}">
      <div class="ava">${me ? '主' : esc(bot?.avatar ?? '●')}</div>
      <div class="msg-body">
        <div class="msg-meta"><span class="who">${esc(m.sender)}</span>
          ${m.durationMs ? `<span class="dur">${(m.durationMs / 1000).toFixed(1)}s</span>` : ''}
          <span>${timeShort(m.at)}</span></div>
        <div class="bubble">${esc(m.text)}</div>
      </div>
    </div>`);
  }
  // 会话内回执卡（记住的冲突等），本房间相关的才显示
  for (const c of sessionCards.filter(c => c.roomId === activeRoom)) {
    parts.push(`<div class="syscard warn"><div class="sc-title">${esc(c.title)}</div><p>${esc(c.body)}</p></div>`);
  }
  for (const q of questions) {
    parts.push(`<div class="syscard exc"><div class="sc-title">${esc(q.memberName)} 在问你</div>
      <p>${esc(q.question)}</p>
      <div class="q-opts">${(q.options ?? []).map(o => `<button class="btn primary" data-answer="${esc(q.id)}" data-value="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      ${q.allowFreeText ? `<div class="q-free"><input id="q-free-${esc(q.id)}" placeholder="或者自己说…"><button class="btn" data-answerfree="${esc(q.id)}">回复</button></div>` : ''}
    </div>`);
  }
  for (const a of teamApprovals) {
    parts.push(`<div class="syscard warn"><div class="sc-title">${esc(a.memberName)} 请求执行工具</div>
      <p><span class="badge ${a.risk === 'irreversible' ? 'warn' : ''}">${esc(a.toolName)}</span> <span class="mono">${esc(a.reason)}</span></p>
      <div class="q-opts"><button class="btn ok" data-approve="${esc(a.id)}" data-outcome="allow">允许</button>
      <button class="btn bad" data-approve="${esc(a.id)}" data-outcome="reject">拒绝</button></div>
    </div>`);
  }
  // 乐观上屏：自己发的、还没被轮询确认的
  for (const m of localPending.filter(m => m.roomId === activeRoom)) {
    parts.push(`<div class="msg me pending"><div class="ava">主</div>
      <div class="msg-body"><div class="msg-meta"><span class="who">${esc(m.sender)}</span><span>${timeShort(m.at)}</span></div>
      <div class="bubble">${esc(m.text)}</div></div></div>`);
  }
  const body = parts.join('') || `<div class="empty"><b>这里还空着</b><p>说句开场白，或者记住一条规矩。</p></div>`;
  const st = $('#stream');
  if (firstRun) { st.classList.add('first-run'); setTimeout(() => { st.classList.remove('first-run'); firstRun = false; }, 900); }
  st.innerHTML = body;
  st.scrollTop = st.scrollHeight;
  bindStreamActions();
  // 乐观消息已被轮询确认（真实消息里出现同文本）→ 清掉
  for (let i = localPending.length - 1; i >= 0; i--) {
    if (msgs.some(m => m.senderKind === 'user' && m.text === localPending[i].text)) localPending.splice(i, 1);
  }
}

function bindStreamActions() {
  document.querySelectorAll('[data-answer]').forEach(b => b.onclick = async () => {
    await post('/api/answer', { questionId: b.dataset.answer, value: b.dataset.value });
    toast('已回复'); refresh();
  });
  document.querySelectorAll('[data-answerfree]').forEach(b => b.onclick = async () => {
    const el = $('#q-free-' + b.dataset.answerfree);
    await post('/api/answer', { questionId: b.dataset.answerfree, value: el?.value ?? '' });
    toast('已回复'); refresh();
  });
  document.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    await post('/api/approve', { callId: b.dataset.approve, outcome: b.dataset.outcome });
    toast(b.dataset.outcome === 'allow' ? '已放行' : '已拒绝'); refresh();
  });
}

// ---- 干活指示（typing）----
function renderTyping() {
  const running = P.community.runs.filter(r => r.running && r.roomId === activeRoom);
  const names = running.map(r => P.community.bots.find(b => b.id === r.botId)?.name).filter(Boolean);
  $('#typing').hidden = !names.length;
  $('#typingNames').textContent = names.map(n => n + ' 正在处理').join('　·　');
}

function renderAutonomy() {
  const sw = $('#autonomySwitch');
  sw.setAttribute('aria-checked', String(P.computer.autonomy));
  sw.onclick = async () => { await post('/api/autonomy', { autonomy: !P.computer.autonomy }); toast(P.computer.autonomy ? '已冻结自主执行' : '自主执行已打开'); refresh(); };
}

// ---- 目标（记住进谁的本子）----
function targetOf(roomId) {
  const room = P.community.rooms.find(r => r.id === roomId);
  if (room?.directBotId) {
    const bot = P.community.bots.find(b => b.id === room.directBotId);
    return { scope: 'bot', botId: room.directBotId, botName: bot?.name ?? '' };
  }
  return { scope: 'team', botId: P.org.primeBotId ?? 'user', botName: '团队' };
}

// ---- 发送 / 记住 ----
const input = $('#input');
function send() {
  const text = input.value.trim();
  if (!text || !activeRoom) return;
  input.value = ''; input.style.height = 'auto';
  if (rememberMode) return remember(text);
  // optimistic：先上屏（虚线半透明），轮询确认后转正
  localPending.push({ id: 'local-' + Date.now(), roomId: activeRoom, sender: '我', senderKind: 'user', text, at: new Date().toISOString() });
  renderStream();
  post('/api/send', { roomId: activeRoom, text }).then(() => refresh());
}
async function remember(text) {
  const out = await post('/api/remember', { roomId: activeRoom, text });
  if (out.ok) {
    toast(`已入本子：${out.entry.text}`);
  } else if (out.needs_decision) {
    const c = (out.candidates ?? [])[0];
    sessionCards.push({ roomId: activeRoom, title: '这条没记成', body: `「${text}」和本子里的「${String(c?.text ?? '').slice(0, 40)}」打架了（${c?.relation ?? ''}）。${c?.advice ?? ''}换个说法再记一次，或在本子里把旧的下线。` });
    renderStream();
  } else {
    toast(out.error ?? '没记成', 'warn');
  }
}

// ---- toast-stack ----
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// ---- 本子抽屉（sheet）----
function openSheet() {
  const t = targetOf(activeRoom);
  const rules = P.brain.entries.filter(e => t.scope === 'team' ? e.scope === 'team' : (e.botId === t.botId || e.scope === 'team'));
  const ledger = P.brain.ledger.filter(r => t.scope === 'team' ? true : (r.botId === t.botId || true)).slice(0, 20);
  const ACT = { add: '新增', embed: '嵌入', merge: '整合', retire: '下线', fuse: '融合' };
  $('#sheetBody').innerHTML = `
    <span class="sheet-grip"></span>
    <h3>${esc(t.botName)}的本子</h3>
    <p class="hint">${t.scope === 'team' ? '团队共享那本 · 只有你能写' : '他自己的本子 · 团队规矩也一并显示'}</p>
    ${rules.map(e => `<div class="rule-row">
      <span class="txt">${esc(e.text)}${e.scope === 'team' ? ' <span class="badge accent">团队</span>' : ''}${e.expiresAt ? ` <span class="badge warn">${esc(e.expiresAt)} 前有效</span>` : ''}</span>
      <span class="meta">${timeShort(e.writtenAt)}</span>
      <button class="btn bad" data-retire="${esc(e.id)}">下线</button>
    </div>`).join('') || '<p class="empty">本子还空着。聊天里说「记住…」就有了。</p>'}
    <h4>账本（最近 ${Math.min(ledger.length, 20)} 条）</h4>
    ${ledger.map(r => `<div class="rule-row"><span class="txt muted">${esc(r.summary)}</span><span class="meta">${esc(ACT[r.action] ?? r.action)} · ${timeShort(r.at)}</span></div>`).join('') || '<p class="muted" style="font-size:11px">还没有改动</p>'}
  `;
  document.querySelectorAll('[data-retire]').forEach(b => b.onclick = async () => {
    const out = await post('/api/remember', { roomId: activeRoom, action: 'retire', entryId: b.dataset.retire, reason: '用户在本子里下线' });
    toast(out.ok ? '已下线，进归档' : (out.error ?? '没成'), out.ok ? '' : 'warn');
    openSheet(); refresh();
  });
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }

// ---- 绑定 ----
$('#sendBtn').onclick = send;
$('#notebookBtn').onclick = openSheet;
$('#sheetScrim').onclick = closeSheet;
$('#rememberBtn').onclick = () => {
  rememberMode = !rememberMode;
  $('#rememberBtn').classList.toggle('active', rememberMode);
  input.placeholder = rememberMode
    ? '记住模式：写一条规矩，回车收进本子（Esc 退出）'
    : '发消息，@名字 点名谁回；Enter 发送';
  input.focus();
};
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  if (e.key === 'Escape' && rememberMode) { rememberMode = false; $('#rememberBtn').classList.remove('active'); input.placeholder = '发消息，@名字 点名谁回；Enter 发送'; }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});
