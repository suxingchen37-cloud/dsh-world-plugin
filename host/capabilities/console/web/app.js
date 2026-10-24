// 共振 · 潮流版前端。2s 轮询 /api/panel；新鲜交互：Ctrl+K 指令面板、@ 联想、
// 消息 hover 一键入本子、乐观上屏、弹簧开关与角标。
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeShort = (iso) => String(iso ?? '').replace('T', ' ').slice(5, 16);
const RANK_NAME = { boss: '总理', direction: '管方向', officer: '小官', execution: '组长' };

let P = null, activeRoom = null, rememberMode = false, firstRun = true, failures = 0;
const localPending = [], sessionCards = [], seenMsgIds = new Set();

async function refresh() {
  try {
    P = await (await fetch('/api/panel', { cache: 'no-store' })).json();
    failures = 0;
  } catch {
    if (++failures >= 2) $('#offlineBanner').innerHTML = `<div class="offline">连接断了 · 每 2 秒自动重试，不用做什么</div>`;
    return;
  }
  render();
}
setInterval(refresh, 2000);
refresh();

async function post(url, body) {
  return (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
}

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
  const el = $('#modeBadge');
  if (P.community.demoMode) { el.textContent = '演示模式'; el.className = 'mode-badge'; }
  else { el.textContent = '已接通模型'; el.className = 'mode-badge live'; }
}

// ---- 左栏：房间（未读角标 badge-pop）----
function renderRooms() {
  const unreadOf = (rid) => P.community.messages.filter(m => m.roomId === rid && m.senderKind === 'bot' && !seenMsgIds.has(m.id)).length;
  $('#roomList').innerHTML = P.community.rooms.map(r => {
    const last = [...P.community.messages].reverse().find(m => m.roomId === r.id);
    const bot = r.directBotId ? P.community.bots.find(b => b.id === r.directBotId) : null;
    const unread = unreadOf(r.id);
    return `<div class="room-item ${r.id === activeRoom ? 'active' : ''}" data-room="${esc(r.id)}">
      <div class="r-ico">${r.isGroup ? '群' : (bot?.avatar ?? '●')}</div>
      <div class="r-name"><b>${esc(r.name)}</b><span>${esc(last ? last.text.slice(0, 24) : (r.objective || '还没有消息'))}</span></div>
      ${unread ? `<span class="pill ${firstRun ? 'on' : ''}">${unread}</span>` : ''}
    </div>`;
  }).join('');
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
  $('#roomMembers').textContent = members.join(' / ');
}

// ---- 待审批：渐变描边悬浮胶囊 ----
function renderBanner() {
  $('#bannerZone').innerHTML = P.computer.pending.map(p => `
    <div class="banner">
      <span class="k">待审批</span>
      <span class="mono" style="color:var(--ink)">${esc(p.action)}</span>
      <span class="grow">${esc(JSON.stringify(p.args?.command ? { command: p.args.command, args: p.args.args } : p.args))}</span>
      <button class="btn-ghost" style="color:var(--acc2);border-color:color-mix(in srgb,var(--acc2) 50%,transparent)" data-respond="${esc(p.approvalId)}" data-verdict="allow-once">允许一次</button>
      <button class="btn-ghost" style="color:var(--bad);border-color:color-mix(in srgb,var(--bad) 45%,transparent)" data-respond="${esc(p.approvalId)}" data-verdict="deny">拒绝</button>
    </div>`).join('');
  document.querySelectorAll('[data-respond]').forEach(b => b.onclick = async () => {
    const out = await post('/api/respond', { approvalId: b.dataset.respond, verdict: b.dataset.verdict });
    toast(out.ok ? (b.dataset.verdict === 'deny' ? '已拒绝' : '已放行') : (out.hint || out.error || '没成'), out.ok ? 'ok' : 'warn');
    refresh();
  });
}

// ---- 消息流 ----
function renderStream() {
  const msgs = P.community.messages.filter(m => m.roomId === activeRoom);
  for (const m of msgs) seenMsgIds.add(m.id);
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
      <div class="ava">${me ? '我' : esc(bot?.avatar ?? '●')}</div>
      <div class="msg-body">
        ${!me ? `<div class="hover-acts"><button data-remember="${esc(m.botId)}" data-text="${esc(m.text)}">入本子</button><button data-copy="${esc(m.text)}">复制</button></div>` : ''}
        <div class="msg-meta"><span class="who">${esc(m.sender)}</span>
          ${m.durationMs ? `<span class="dur">${(m.durationMs / 1000).toFixed(1)}s</span>` : ''}
          <span>${timeShort(m.at)}</span></div>
        <div class="bubble">${esc(m.text)}</div>
      </div>
    </div>`);
  }
  for (const c of sessionCards.filter(c => c.roomId === activeRoom)) {
    parts.push(`<div class="syscard warn"><div class="sc-title">${esc(c.title)}</div><p>${esc(c.body)}</p></div>`);
  }
  for (const q of questions) {
    parts.push(`<div class="syscard exc"><div class="sc-title">${esc(q.memberName)} 在问你</div>
      <p>${esc(q.question)}</p>
      <div class="q-opts">${(q.options ?? []).map(o => `<button data-answer="${esc(q.id)}" data-value="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      ${q.allowFreeText ? `<div class="q-free"><input id="q-free-${esc(q.id)}" placeholder="或者自己说…"><button class="q-opts-go" style="display:none"></button></div>` : ''}
    </div>`);
  }
  for (const a of teamApprovals) {
    parts.push(`<div class="syscard warn"><div class="sc-title">${esc(a.memberName)} 请求执行工具</div>
      <p><span class="badge" style="font-size:9px;padding:1px 7px;border-radius:999px;border:1px solid var(--line2);color:var(--muted)">${esc(a.toolName)}</span> <span class="mono" style="font-size:10px;color:var(--muted)">${esc(a.reason)}</span></p>
      <div class="q-opts"><button data-approve="${esc(a.id)}" data-outcome="allow">允许</button><button class="ghost" data-approve="${esc(a.id)}" data-outcome="reject">拒绝</button></div>
    </div>`);
  }
  for (const m of localPending.filter(m => m.roomId === activeRoom)) {
    parts.push(`<div class="msg me pending"><div class="ava">我</div>
      <div class="msg-body"><div class="msg-meta"><span class="who">${esc(m.sender)}</span><span>${timeShort(m.at)}</span></div>
      <div class="bubble">${esc(m.text)}</div></div></div>`);
  }
  const st = $('#stream');
  st.innerHTML = parts.join('') || `<div class="empty"><b>这里还空着</b><p>说句开场白，或者用「记」把规矩写进本子。</p></div>`;
  if (firstRun) { firstRun = false; }
  st.scrollTop = st.scrollHeight;
  bindStreamActions();
  for (let i = localPending.length - 1; i >= 0; i--) {
    if (msgs.some(m => m.senderKind === 'user' && m.text === localPending[i].text)) localPending.splice(i, 1);
  }
}

function bindStreamActions() {
  document.querySelectorAll('[data-answer]').forEach(b => b.onclick = async () => {
    await post('/api/answer', { questionId: b.dataset.answer, value: b.dataset.value });
    toast('已回复', 'ok'); refresh();
  });
  document.querySelectorAll('[data-answerfree]').forEach(b => b.onclick = async () => {
    const el = $('#q-free-' + b.dataset.answerfree);
    await post('/api/answer', { questionId: b.dataset.answerfree, value: el?.value ?? '' });
    toast('已回复', 'ok'); refresh();
  });
  const frees = document.querySelectorAll('.q-free input');
  frees.forEach(el => el.onkeydown = (e) => {
    if (e.key === 'Enter') { const id = el.id.replace('q-free-', ''); post('/api/answer', { questionId: id, value: el.value }).then(() => { toast('已回复', 'ok'); refresh(); }); }
  });
  document.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    await post('/api/approve', { callId: b.dataset.approve, outcome: b.dataset.outcome });
    toast(b.dataset.outcome === 'allow' ? '已放行' : '已拒绝', 'ok'); refresh();
  });
  document.querySelectorAll('[data-remember]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const out = await post('/api/remember', { roomId: activeRoom, botId: b.dataset.remember, text: b.dataset.text });
    toast(out.ok ? `已入本子：${out.entry.text.slice(0, 24)}` : (out.needs_decision ? '和旧规矩打架了，没收' : (out.error ?? '没成')), out.ok ? 'ok' : 'warn');
  });
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard?.writeText(b.dataset.copy); toast('已复制', 'ok');
  });
}

function renderTyping() {
  const running = P.community.runs.filter(r => r.running && r.roomId === activeRoom);
  const names = running.map(r => P.community.bots.find(b => b.id === r.botId)?.name).filter(Boolean);
  $('#typing').hidden = !names.length;
  $('#typing').innerHTML = names.length
    ? `<span class="d-typing"><i></i><i></i><i></i></span><span>${esc(names.join('、'))} 正在处理</span>` : '';
}

function renderAutonomy() {
  const sw = $('#autonomySwitch');
  sw.setAttribute('aria-checked', String(P.computer.autonomy));
  sw.onclick = async () => { await post('/api/autonomy', { autonomy: !P.computer.autonomy }); toast(P.computer.autonomy ? '已冻结自主执行' : '自主执行已打开'); refresh(); };
}

function targetOf(roomId, overrideBotId) {
  if (overrideBotId) {
    const bot = P.community.bots.find(b => b.id === overrideBotId);
    return { scope: 'bot', botId: overrideBotId, botName: bot?.name ?? '' };
  }
  const room = P.community.rooms.find(r => r.id === roomId);
  if (room?.directBotId) {
    const bot = P.community.bots.find(b => b.id === room.directBotId);
    return { scope: 'bot', botId: room.directBotId, botName: bot?.name ?? '' };
  }
  return { scope: 'team', botId: P.org.primeBotId ?? 'user', botName: '团队' };
}

// ---- 发送 / 记住（乐观上屏）----
const input = $('#input');
function send() {
  let text = input.value.trim();
  if (!text || !activeRoom) return;
  // 引用追问：直播副屏里点过的那一行，带着上下文一起发
  if (!$('#quoteline').hidden) {
    text = `〔${$('#quoteText').textContent}〕` + text;
    $('#quoteline').hidden = true;
  }
  input.value = ''; input.style.height = 'auto';
  if (rememberMode || /^(?:记住|记一下)[：:]/.test(text)) {
    text = text.replace(/^(?:记住|记一下)[：:]\s*/, '');
    return doRemember(text);
  }
  localPending.push({ roomId: activeRoom, sender: '我', senderKind: 'user', text, at: new Date().toISOString() });
  renderStream();
  post('/api/send', { roomId: activeRoom, text }).then(() => refresh());
}
async function doRemember(text, overrideBotId) {
  const t = targetOf(activeRoom, overrideBotId);
  const out = await post('/api/remember', { roomId: activeRoom, text, ...t });
  if (out.ok) { toast(`已入本子：${out.entry.text.slice(0, 26)}`, 'ok'); }
  else if (out.needs_decision) {
    const c = (out.candidates ?? [])[0];
    sessionCards.push({ roomId: activeRoom, title: '这条没记成', body: `「${text}」和本子里的「${String(c?.text ?? '').slice(0, 40)}」打架了（${c?.relation ?? ''}）。${c?.advice ?? ''}换个说法再记，或在本子里把旧的下线。` });
    renderStream();
  } else toast(out.error ?? '没记成', 'warn');
  refresh();
}

// ---- @ 联想弹层（autocomplete）----
const pop = $('#mentionPop');
let popItems = [], popIdx = 0;
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  const m = /@([\w\u4e00-\u9fa5]*)$/.exec(input.value);
  if (m && P?.community?.available) {
    const q = m[1].toLowerCase();
    popItems = P.community.bots.filter(b => !q || b.name.toLowerCase().includes(q));
    if (popItems.length) {
      popIdx = 0;
      pop.innerHTML = popItems.map((b, i) => `<div class="mi ${i === 0 ? 'on' : ''}" data-i="${i}">
        <span class="ava">${esc(b.avatar)}</span><b>${esc(b.name)}</b>
        <span class="desc">${esc(b.model.split('/').pop() ?? '')}${b.mentionOnly ? ' · 仅@时说话' : ''}</span></div>`).join('');
      pop.hidden = false;
      pop.querySelectorAll('.mi').forEach(el => el.onclick = () => pickMention(+el.dataset.i));
      return;
    }
  }
  pop.hidden = true;
});
function pickMention(i) {
  const b = popItems[i]; if (!b) return;
  input.value = input.value.replace(/@([\w\u4e00-\u9fa5]*)$/, `@${b.name} `);
  pop.hidden = true; input.focus();
}
input.addEventListener('keydown', (e) => {
  if (!pop.hidden && popItems.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      popIdx = (popIdx + (e.key === 'ArrowDown' ? 1 : popItems.length - 1)) % popItems.length;
      pop.querySelectorAll('.mi').forEach((el, i) => el.classList.toggle('on', i === popIdx));
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); pickMention(popIdx); return; }
    if (e.key === 'Escape') { pop.hidden = true; return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// ---- Ctrl+K 命令面板（palette）----
const pal = $('#palette'), palInput = $('#paletteInput'), palList = $('#paletteList');
let palFiltered = [], palIdx = 0;
function openPalette() {
  pal.hidden = false; palInput.value = ''; buildPalette('');
  setTimeout(() => palInput.focus(), 30);
}
function closePalette() { pal.hidden = true; }
function buildPalette(q) {
  const all = [
    ...P.community.rooms.map(r => ({
      ico: r.isGroup ? '群' : (P.community.bots.find(b => b.id === r.directBotId)?.avatar ?? '●'),
      c: `去 ${r.name}`, s: r.isGroup ? '群聊房间' : '私聊',
      run: () => { activeRoom = r.id; sessionCards.length = 0; localPending.length = 0; render(); },
    })),
    ...P.community.bots.map(b => ({
      ico: '记', c: `记一条规矩给 ${b.name}`, s: '直接入本子 · 走查冲突',
      run: () => { const dm = P.community.rooms.find(r => r.directBotId === b.id); if (dm) { activeRoom = dm.id; } rememberMode = true; $('#rememberBtn').classList.add('active'); render(); input.placeholder = '记住模式：写一条规矩，回车收进本子（Esc 退出）'; input.focus(); },
    })),
    { ico: '▤', c: '打开本子', s: '现行规则与账本', run: () => openSheet() },
    { ico: '⏻', c: P.computer.autonomy ? '冻结自主执行' : '打开自主执行', s: '本机执行总闸', run: async () => { await post('/api/autonomy', { autonomy: !P.computer.autonomy }); refresh(); } },
  ];
  palFiltered = all.filter(x => !q || x.c.toLowerCase().includes(q.toLowerCase()));
  palIdx = 0;
  palList.innerHTML = palFiltered.map((x, i) => `<div class="pi ${i === 0 ? 'on' : ''}" data-i="${i}">
    <span class="ico">${esc(x.ico)}</span><span class="c">${esc(x.c)}<small>${esc(x.s)}</small></span><span class="key">↵</span></div>`).join('')
    || '<div class="pi"><span class="c muted">没有匹配的指令</span></div>';
  palList.querySelectorAll('.pi[data-i]').forEach(el => {
    el.onclick = () => { closePalette(); palFiltered[+el.dataset.i]?.run(); };
    el.onmouseenter = () => { palIdx = +el.dataset.i; mark(); };
  });
  function mark() { palList.querySelectorAll('.pi').forEach((el, i) => el.classList.toggle('on', i === palIdx)); }
  palList._mark = mark;
}
palInput.addEventListener('input', () => buildPalette(palInput.value.trim()));
palInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    palIdx = (palIdx + (e.key === 'ArrowDown' ? 1 : Math.max(palFiltered.length - 1, 0))) % Math.max(palFiltered.length, 1);
    palList._mark?.();
    palList.querySelectorAll('.pi')[palIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') { e.preventDefault(); closePalette(); palFiltered[palIdx]?.run(); }
  else if (e.key === 'Escape') closePalette();
});
$('#paletteScrim').onclick = closePalette;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); }
});

// ---- toast ----
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// ---- 本子抽屉 ----
function openSheet() {
  const t = targetOf(activeRoom);
  const rules = P.brain.entries.filter(e => t.scope === 'team' ? e.scope === 'team' : (e.botId === t.botId || e.scope === 'team'));
  const ledger = P.brain.ledger.slice(0, 20);
  const ACT = { add: '新增', embed: '嵌入', merge: '整合', retire: '下线', fuse: '融合' };
  $('#sheetBody').innerHTML = `
    <span class="sheet-grip"></span>
    <h3>${esc(t.botName)}的本子</h3>
    <p class="hint">${t.scope === 'team' ? '团队共享那本 · 只有你能写' : '他自己的本子 · 团队规矩也一并显示'}</p>
    ${rules.map(e => `<div class="rule-row">
      <span class="txt">${esc(e.text)}${e.scope === 'team' ? ' <span class="badge team">团队</span>' : ''}${e.expiresAt ? ` <span class="badge" style="color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)">${esc(e.expiresAt)} 前有效</span>` : ''}</span>
      <span class="meta">${timeShort(e.writtenAt)}</span>
      <button class="btn-ghost" data-retire="${esc(e.id)}">下线</button>
    </div>`).join('') || '<p class="empty">本子还空着。聊天里说「记住…」就有了。</p>'}
    <h4>账本（最近 ${ledger.length} 条）</h4>
    ${ledger.map(r => `<div class="rule-row"><span class="txt muted" style="font-size:12px">${esc(r.summary)}</span><span class="meta">${esc(ACT[r.action] ?? r.action)} · ${timeShort(r.at)}</span></div>`).join('') || '<p class="muted" style="font-size:11px">还没有改动</p>'}
  `;
  document.querySelectorAll('[data-retire]').forEach(b => b.onclick = async () => {
    const out = await post('/api/remember', { roomId: activeRoom, action: 'retire', entryId: b.dataset.retire, reason: '用户在本子里下线' });
    toast(out.ok ? '已下线，进归档' : (out.error ?? '没成'), out.ok ? 'ok' : 'warn');
    openSheet(); refresh();
  });
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }

// ---- 现场副屏（最小可用：审计流水 + 干活中的 Bot，点行可引用追问）----
const monitor = $('#monitor');
$('#monitorX').onclick = () => { monitor.hidden = true; };
$('#monitorShow').onclick = () => { monitor.hidden = false; renderMonitor(); };
$('#quoteX').onclick = () => { $('#quoteline').hidden = true; };
$('#monitorDrag').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const move = (ev) => { monitor.style.width = Math.min(460, Math.max(220, window.innerWidth - ev.clientX)) + 'px'; };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});
function renderMonitor() {
  if (monitor.hidden || !P?.community?.available) return;
  const runs = P.community.runs.filter(r => r.running);
  const audit = P.computer.audit.slice(0, 14);
  $('#monitorBody').innerHTML = `
    <div class="m-sec">干活中</div>
    ${runs.map(r => { const b = P.community.bots.find(x => x.id === r.botId); return `
      <div class="m-run" data-run="${esc(r.id)}" data-text="【追问 · ${esc(b?.name ?? '')} 的任务】${esc((r.prompt ?? '').slice(0, 60))}">
        <div class="rn"><b>${esc(b?.name ?? '?')}</b><span class="st">RUNNING</span></div>
        <div class="task">${esc(r.prompt ?? '')}</div>
      </div>`; }).join('') || '<div class="m-empty">没有人正在干活</div>'}
    <div class="m-sec">审计 · 最近</div>
    ${audit.map(a => `<div class="m-line" data-text="【追问 · 审计 ${timeShort(a.at)}】${esc(a.action ?? a.kind)} ${a.kind === 'refused' ? '为什么被拒？' : '这是什么操作？'}">
      <span class="at">${timeShort(a.at)}</span>
      <span class="${a.kind === 'refused' ? 'st-bad' : 'st-ok'}">${esc(a.action ?? a.kind)}</span>
      <span>${a.kind === 'refused' ? 'refused' : (a.exitCode != null ? 'exit ' + a.exitCode : esc(a.kind))}</span>
    </div>`).join('') || '<div class="m-empty">还没有审计</div>'}
  `;
  document.querySelectorAll('.m-run,.m-line').forEach(el => el.onclick = () => {
    $('#quoteText').textContent = el.dataset.text;
    $('#quoteline').hidden = false;
    input.focus();
  });
}
// 把渲染挂进主循环：render() 的最后一步
const _render = render;
render = function () { _render(); renderMonitor(); };

// ---- 绑定 ----
$('#sendBtn').onclick = send;
$('#notebookBtn').onclick = openSheet;
$('#sheetScrim').onclick = closeSheet;
$('#rememberBtn').onclick = () => {
  rememberMode = !rememberMode;
  $('#rememberBtn').classList.toggle('active', rememberMode);
  input.placeholder = rememberMode ? '记住模式：写一条规矩，回车收进本子（Esc 退出）' : '发消息，@ 点名谁回 · Ctrl+K 万能指令';
  input.focus();
};
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && rememberMode) { rememberMode = false; $('#rememberBtn').classList.remove('active'); input.placeholder = '发消息，@ 点名谁回 · Ctrl+K 万能指令'; }
});
