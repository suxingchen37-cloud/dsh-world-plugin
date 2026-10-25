// 共振 · 正式版前端（F2 排版）。2s 轮询 /api/panel。
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeShort = (iso) => String(iso ?? '').replace('T', ' ').slice(11, 16);
const dayOf = (iso) => String(iso ?? '').slice(0, 10);
const RANK_TAG = { boss: 'PRIME', direction: 'DIR', officer: 'OFF', execution: 'TEAM' };
const RANK_NAME = { boss: '总理', direction: '管方向', officer: '小官', execution: '组长' };

let P = null, activeRoom = null, rememberMode = false, failures = 0;
const localPending = [], sessionCards = [], seenMsgIds = new Set();
// 滚动纪律：只有用户本来就在底部（或刚切房间/刚发消息）才自动跟随到底；
// 内容没变化时不重建 DOM——不拽人、不闪烁、不丢选中文字。
let lastStreamSig = '', jumpCount = 0, forceBottom = false;

async function refresh() {
  try {
    P = await (await fetch('/api/panel', { cache: 'no-store' })).json();
    failures = 0;
    $('#offlineBanner').innerHTML = '';
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
  renderRooms();
  if (!activeRoom || !P.community.rooms.some(r => r.id === activeRoom)) {
    activeRoom = (P.community.rooms.find(r => r.isGroup) ?? P.community.rooms[0])?.id ?? null;
  }
  renderHead();
  renderZone();
  renderStream();
  renderTyping();
  renderAutonomy();
  renderMonitor();
}

// ---- 左栏：目录 + 「需要你」置顶 ----
function needsCount() {
  return (P.computer.pending?.length ?? 0) + (P.community.questions?.length ?? 0);
}
function renderRooms() {
  const nb = $('#needbox');
  const n = needsCount();
  nb.hidden = n === 0;
  nb.innerHTML = `<span class="n">${n}</span><b>有 ${n} 件事等你</b><span class="arr">→</span>`;
  nb.onclick = () => {
    const q = P.community.questions[0];
    if (q?.roomId) { window.__switchRoom(q.roomId); return; }
    toast('都在当前房间，往下看');
  };

  const unreadOf = (rid) => P.community.messages.filter(m => m.roomId === rid && m.senderKind === 'bot' && !seenMsgIds.has(m.id)).length;
  const item = (r) => {
    const last = [...P.community.messages].reverse().find(m => m.roomId === r.id);
    const bot = r.directBotId ? P.community.bots.find(b => b.id === r.directBotId) : null;
    const unread = unreadOf(r.id);
    const face = r.isGroup ? '群' : (bot?.name?.[0] ?? '●');
    return `<div class="r ${r.id === activeRoom ? 'on' : ''}" data-room="${esc(r.id)}">
      <span class="ic">${esc(face)}</span>
      <span class="tx"><b>${esc(r.name)}</b><span>${esc(last ? last.text.slice(0, 18) : (r.objective || '还没有消息'))}</span></span>
      ${unread ? `<span class="u">${unread}</span>` : ''}
    </div>`;
  };
  const groups = P.community.rooms.filter(r => r.isGroup);
  const dms = P.community.rooms.filter(r => !r.isGroup);
  $('#roomList').innerHTML = `
    <div class="sec"><i>群聊</i> ${String(groups.length).padStart(2, '0')}</div>
    ${groups.map(item).join('')}
    ${dms.length ? `<div class="sec"><i>私聊</i> ${String(dms.length).padStart(2, '0')}</div>${dms.map(item).join('')}` : ''}`;
  function switchRoom(id) {
    activeRoom = id; sessionCards.length = 0; localPending.length = 0;
    forceBottom = true; lastStreamSig = '';
    document.querySelector('#quoteline').hidden = true;   // 引用条属于旧房间，切换即清
    render();
  }
  document.querySelectorAll('.r[data-room]').forEach(el => el.onclick = () => switchRoom(el.dataset.room));
  // 指令面板/需要你盒子等也走同一出口（暴露给其他调用方）
  window.__switchRoom = switchRoom;
}

// ---- 头部 ----
function renderHead() {
  const room = P.community.rooms.find(r => r.id === activeRoom);
  if (!room) return;
  $('#roomName').firstChild.textContent = room.name + ' ';
  $('#roomKind').textContent = room.isGroup ? 'GROUP' : 'DM';
  $('#roomSub').textContent = room.isGroup
    ? (room.objective ? `目标：${room.objective}` : '全员群聊')
    : `与 ${room.memberIds.map(id => P.community.bots.find(b => b.id === id)?.name).filter(Boolean).join('、')} 的私聊`;
  $('#cast').innerHTML = room.memberIds.slice(0, 5).map(id => {
    const b = P.community.bots.find(x => x.id === id);
    return `<span class="c" title="${esc(b?.name ?? '')}">${esc(b?.name?.[0] ?? '?')}</span>`;
  }).join('') + `<span class="more">${room.memberIds.length} 人</span>`;
}

// ---- 审批条 ----
function renderZone() {
  $('#bannerZone').innerHTML = P.computer.pending.map(p => `
    <div class="zone">
      <span class="k">待审批</span>
      <span class="x">${esc(p.action)} → ${esc(JSON.stringify(p.args?.command ? [p.args.command, ...(p.args.args ?? [])] : p.args))}</span>
      <button data-respond="${esc(p.approvalId)}" data-verdict="allow-once">允许一次</button>
      <button class="ghost" data-respond="${esc(p.approvalId)}" data-verdict="always">总是</button>
      <button class="ghost" data-respond="${esc(p.approvalId)}" data-verdict="deny">拒绝</button>
    </div>`).join('');
  document.querySelectorAll('[data-respond]').forEach(b => b.onclick = async () => {
    const out = await post('/api/respond', { approvalId: b.dataset.respond, verdict: b.dataset.verdict });
    toast(out.ok ? ({ 'allow-once': '已放行这一次', 'always': '这类以后都放行', 'deny': '已拒绝' }[b.dataset.verdict]) : (out.hint || out.error || '没成'), out.ok ? 'ok' : 'warn');
    refresh();
  });
}

// ---- 消息流：说话人栏 + 日期夹线 ----
function renderStream() {
  const st = $('#stream');
  // 在替换内容之前量：用户是否停在底部
  const nearBottom = st.scrollHeight - st.scrollTop - st.clientHeight < 90;
  const msgs = P.community.messages.filter(m => m.roomId === activeRoom);
  const freshBot = msgs.filter(m => m.senderKind === 'bot' && !seenMsgIds.has(m.id)).length;
  for (const m of msgs) seenMsgIds.add(m.id);
  const questions = P.community.questions.filter(q => q.roomId === activeRoom);
  const teamApprovals = P.community.approvals.filter(a => a.roomId === activeRoom);
  const parts = [];
  let lastDay = null;
  const rankOf = (botId) => {
    if (botId === P.org.primeBotId) return 'boss';
    return P.org.ranks?.[botId] || 'execution';
  };
  for (const m of msgs) {
    const d = dayOf(m.at);
    if (d !== lastDay) {
      lastDay = d;
      parts.push(`<div class="day"><span>${d.replace('T', ' ')}</span></div>`);
    }
    if (m.kind === 'application' || m.kind === 'appoint' || m.kind === 'conflict') {
      const t = { application: ['增员申请', 'exc'], appoint: ['任命公告', 'do'], conflict: ['规则冲突', 'warn'] }[m.kind];
      parts.push(`<div class="syscard ${t[1]}"><div class="sc-title">${t[0]}</div><p>${esc(m.text)}</p></div>`);
      continue;
    }
    const me = m.senderKind === 'user';
    const bot = m.botId ? P.community.bots.find(b => b.id === m.botId) : null;
    const feats = [];
    if (m.durationMs) feats.push(`耗时 ${(m.durationMs / 1000).toFixed(1)}s`);
    parts.push(`<div class="m ${me ? 'me' : ''}">
      <div class="who"><b>${esc(m.sender)}</b>${!me && bot ? `<span class="role">${RANK_TAG[rankOf(bot.id)] ?? ''}</span>` : ''}<span class="tm">${timeShort(m.at)}</span></div>
      <div class="cols">
        ${!me ? `<div class="hover-acts"><button data-remember="${esc(m.botId)}" data-text="${esc(m.text)}">入本子</button><button data-copy="${esc(m.text)}">复制</button></div>` : ''}
        <div class="bub">${esc(m.text)}</div>
        ${feats.length ? `<span class="feat">${feats.join(' · ')}</span>` : ''}
      </div>
    </div>`);
  }
  for (const c of sessionCards.filter(c => c.roomId === activeRoom)) {
    parts.push(`<div class="syscard warn"><div class="sc-title">${esc(c.title)}</div><p>${esc(c.body)}</p></div>`);
  }
  for (const q of questions) {
    parts.push(`<div class="q">
      <div class="k">${esc(q.memberName)} · 在问你</div>
      <p>${esc(q.question)}</p>
      <div class="ops">${(q.options ?? []).map(o => `<button data-answer="${esc(q.id)}" data-value="${esc(o)}">${esc(o)}</button>`).join('')}
        <button class="alt" data-skip="${esc(q.id)}">跳过</button></div>
      ${q.allowFreeText ? `<div class="free"><input id="q-free-${esc(q.id)}" placeholder="或者自己说……"></div>` : ''}
    </div>`);
  }
  for (const a of teamApprovals) {
    parts.push(`<div class="q">
      <div class="k bad">${esc(a.memberName)} · 请求执行工具 · ${a.risk === 'irreversible' ? '不可逆' : '可逆'}</div>
      <p>${esc(a.toolName)}</p><div class="cmd">${esc(a.reason)}</div>
      <div class="ops"><button data-approve="${esc(a.id)}" data-outcome="allow">允许</button><button class="alt" data-approve="${esc(a.id)}" data-outcome="reject">拒绝</button></div>
    </div>`);
  }
  for (const m of localPending.filter(m => m.roomId === activeRoom)) {
    parts.push(`<div class="m me pending">
      <div class="who"><b>我</b><span class="tm">${timeShort(m.at)}</span></div>
      <div class="cols"><div class="bub">${esc(m.text)}</div></div>
    </div>`);
  }
  const sig = msgs.length + ':' + (msgs.at(-1)?.id ?? '') + ':' + questions.length + ':' + teamApprovals.length + ':' + sessionCards.length + ':' + localPending.length;
  const unchanged = sig === lastStreamSig && !forceBottom;
  lastStreamSig = sig;
  if (!unchanged) {
    st.innerHTML = parts.join('') || `<div class="empty"><b>这里还空着</b><p>说句开场白，或者用「记」把规矩写进本子。</p></div>`;
    bindStreamActions();
  }
  if (forceBottom || nearBottom) {
    st.scrollTop = st.scrollHeight;      // 本来就在底部（或刚切房间/刚发消息）才跟随到底
    jumpCount = 0; hideJump();
  } else if (freshBot > 0) {
    jumpCount += freshBot; showJump();   // 你在上面看历史：不打扰，挂红点
  }
  forceBottom = false;
  for (let i = localPending.length - 1; i >= 0; i--) {
    if (msgs.some(m => m.senderKind === 'user' && m.text === localPending[i].text)) localPending.splice(i, 1);
  }
}

function bindStreamActions() {
  document.querySelectorAll('[data-answer]').forEach(b => b.onclick = async () => {
    await post('/api/answer', { questionId: b.dataset.answer, value: b.dataset.value });
    toast('已回复', 'ok'); refresh();
  });
  document.querySelectorAll('[data-skip]').forEach(b => b.onclick = async () => {
    await post('/api/answer', { questionId: b.dataset.skip, skip: true });
    refresh();
  });
  document.querySelectorAll('.free input').forEach(el => el.onkeydown = (e) => {
    if (e.key === 'Enter') {
      post('/api/answer', { questionId: el.id.replace('q-free-', ''), value: el.value }).then(() => { toast('已回复', 'ok'); refresh(); });
    }
  });
  document.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    await post('/api/approve', { callId: b.dataset.approve, outcome: b.dataset.outcome });
    toast(b.dataset.outcome === 'allow' ? '已放行' : '已拒绝', 'ok'); refresh();
  });
  document.querySelectorAll('[data-remember]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const out = await post('/api/remember', { roomId: activeRoom, botId: b.dataset.remember, text: b.dataset.text });
    toast(out.ok ? `已入本子：${out.entry.text.slice(0, 22)}` : (out.needs_decision ? '和旧规矩打架了，没收' : (out.error ?? '没成')), out.ok ? 'ok' : 'warn');
  });
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('已复制', 'ok'); });
}

function renderTyping() {
  const running = P.community.runs.filter(r => r.running && r.roomId === activeRoom);
  const names = running.map(r => P.community.bots.find(b => b.id === r.botId)?.name).filter(Boolean);
  const t = $('#typing');
  t.hidden = !names.length;
  t.innerHTML = names.length ? `<span class="dots"><i></i><i></i><i></i></span>${esc(names.join('、'))} 正在处理` : '';
}

function renderAutonomy() {
  const on = P.computer.autonomy === true;
  $('#autonomyLed').className = 'led' + (on ? '' : ' off');
  $('#autonomyText').textContent = on ? '全自动' : '已冻结';
  $('#autonomyBtn').onclick = async () => {
    await post('/api/autonomy', { autonomy: !P.computer.autonomy });
    toast(P.computer.autonomy ? '已冻结自主执行' : '自主执行已打开'); refresh();
  };
}

// ---- 记住（私聊→该 Bot 本子；群聊→团队本子）----
function targetOf(roomId, overrideBotId) {
  if (overrideBotId) return { scope: 'bot', botId: overrideBotId };
  const room = P.community.rooms.find(r => r.id === roomId);
  if (room?.directBotId) return { scope: 'bot', botId: room.directBotId };
  return { scope: 'team', botId: P.org.primeBotId ?? 'user' };
}

const input = $('#input');
function send() {
  let text = input.value.trim();
  if (!text || !activeRoom) return;
  if (!$('#quoteline').hidden) {
    text = `〔${$('#quoteText').textContent}〕` + text;
    $('#quoteline').hidden = true;
  }
  input.value = ''; input.style.height = 'auto';
  if (rememberMode || /^(?:记住|记一下)[：:]/.test(text)) {
    return doRemember(text.replace(/^(?:记住|记一下)[：:]\s*/, ''));
  }
  localPending.push({ roomId: activeRoom, text, at: new Date().toISOString() });
  forceBottom = true;
  renderStream();
  post('/api/send', { roomId: activeRoom, text }).then(() => refresh());
}
async function doRemember(text, overrideBotId) {
  const out = await post('/api/remember', { roomId: activeRoom, text, ...targetOf(activeRoom, overrideBotId) });
  if (out.ok) toast(`已入本子：${out.entry.text.slice(0, 24)}`, 'ok');
  else if (out.needs_decision) {
    const c = (out.candidates ?? [])[0];
    sessionCards.push({ roomId: activeRoom, title: '这条没记成', body: `「${text}」和本子里的「${String(c?.text ?? '').slice(0, 40)}」打架了（${c?.relation ?? ''}）。${c?.advice ?? ''}换个说法再记，或在本子里把旧的下线。` });
    renderStream();
  } else toast(out.error ?? '没记成', 'warn');
  refresh();
}

// ---- @ 联想 ----
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
        <span class="ic">${esc(b.name[0])}</span><b>${esc(b.name)}</b>
        <span class="desc">${esc((b.model ?? '').split('/').pop() ?? '')}</span></div>`).join('');
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
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(popIdx); return; }
    if (e.key === 'Escape') { pop.hidden = true; return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  if (e.key === 'Escape' && rememberMode) { rememberMode = false; $('#rememberBtn').classList.remove('on'); input.placeholder = '发消息，@ 点名谁回……'; }
});

// ---- Ctrl+K 指令面板 ----
const pal = $('#palette'), palInput = $('#paletteInput'), palList = $('#paletteList');
let palFiltered = [], palIdx = 0;
function openPalette() { pal.hidden = false; palInput.value = ''; buildPalette(''); setTimeout(() => palInput.focus(), 30); }
function closePalette() { pal.hidden = true; }
function buildPalette(q) {
  if (!P?.community?.available) return;
  const all = [
    ...P.community.rooms.map(r => ({
      ico: r.isGroup ? '群' : (P.community.bots.find(b => b.id === r.directBotId)?.name?.[0] ?? '●'),
      c: `去 ${r.name}`, s: r.isGroup ? '群聊' : '私聊',
      run: () => { window.__switchRoom(r.id); },
    })),
    { ico: '记', c: '记住一条规矩（当前房间）', s: '直接入本子 · 走查冲突', run: () => { rememberMode = true; $('#rememberBtn').classList.add('on'); input.placeholder = '记住模式：写一条规矩，回车收进本子（Esc 退出）'; input.focus(); } },
    { ico: '本', c: '打开本子', s: '现行规则与账本', run: () => openSheet() },
    { ico: '现', c: P.computer.autonomy ? '冻结自主执行' : '打开自主执行', s: '本机执行总闸', run: async () => { await post('/api/autonomy', { autonomy: !P.computer.autonomy }); refresh(); } },
    { ico: '场', c: $('#monitor').hidden ? '展开现场副屏' : '收起现场副屏', s: '直播干活与审计', run: () => { $('#monitor').hidden = !$('#monitor').hidden; renderMonitor(); } },
  ];
  palFiltered = all.filter(x => !q || x.c.toLowerCase().includes(q.toLowerCase()));
  palIdx = 0;
  palList.innerHTML = palFiltered.map((x, i) => `<div class="pi ${i === 0 ? 'on' : ''}" data-i="${i}">
    <span class="ico">${esc(x.ico)}</span><span class="c">${esc(x.c)}<small>${esc(x.s)}</small></span><span class="key">↵</span></div>`).join('')
    || '<div class="pi"><span class="c muted">没有匹配的指令</span></div>';
  const mark = () => palList.querySelectorAll('.pi').forEach((el, i) => el.classList.toggle('on', i === palIdx));
  palList.querySelectorAll('.pi[data-i]').forEach(el => {
    el.onclick = () => { closePalette(); palFiltered[+el.dataset.i]?.run(); };
    el.onmouseenter = () => { palIdx = +el.dataset.i; mark(); };
  });
}
palInput.addEventListener('input', () => buildPalette(palInput.value.trim()));
palInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!palFiltered.length) return;
    palIdx = (palIdx + (e.key === 'ArrowDown' ? 1 : palFiltered.length - 1)) % palFiltered.length;
    palList.querySelectorAll('.pi').forEach((el, i) => el.classList.toggle('on', i === palIdx));
    palList.querySelectorAll('.pi')[palIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') { e.preventDefault(); closePalette(); palFiltered[palIdx]?.run(); }
  else if (e.key === 'Escape') closePalette();
});
$('#paletteScrim').onclick = closePalette;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); }
});

// ---- 回到最新按钮（看历史时来新消息，不打扰，点了才下去）----
function showJump() { const b = $('#jumpBtn'); b.hidden = false; b.querySelector('.n').textContent = jumpCount; }
function hideJump() { $('#jumpBtn').hidden = true; }
$('#jumpBtn').onclick = () => { const st = $('#stream'); st.scrollTop = st.scrollHeight; jumpCount = 0; hideJump(); };

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
  const room = P.community.rooms.find(r => r.id === activeRoom);
  const botName = t.scope === 'team' ? '团队' : (P.community.bots.find(b => b.id === t.botId)?.name ?? room?.name ?? '');
  const rules = P.brain.entries.filter(e => t.scope === 'team' ? e.scope === 'team' : (e.botId === t.botId || e.scope === 'team'));
  const ledger = P.brain.ledger.slice(0, 20);
  const ACT = { add: '新增', embed: '嵌入', merge: '整合', retire: '下线', fuse: '融合' };
  $('#sheetBody').innerHTML = `
    <span class="sheet-grip"></span>
    <h3>${esc(botName)}的本子</h3>
    <p class="hint">${t.scope === 'team' ? '团队共享那本 · 只有你能写' : '他自己的本子 · 团队规矩也一并显示'}</p>
    ${rules.map(e => `<div class="rule-row">
      <span class="txt">${esc(e.text)}${e.scope === 'team' ? ' <span class="badge team">团队</span>' : ''}${e.expiresAt ? ` <span class="badge exp">${esc(e.expiresAt)} 前有效</span>` : ''}</span>
      <span class="meta">${String(e.writtenAt ?? '').slice(0, 10)}</span>
      <button class="btn-ghost" data-retire="${esc(e.id)}">下线</button>
    </div>`).join('') || '<p class="empty">本子还空着。聊天里说「记住…」就有了。</p>'}
    <h4>账本 · 最近 ${ledger.length} 条</h4>
    ${ledger.map(r => `<div class="rule-row"><span class="txt muted" style="font-size:12px">${esc(r.summary)}</span><span class="meta">${esc(ACT[r.action] ?? r.action)} · ${String(r.at ?? '').slice(5, 16)}</span></div>`).join('') || '<p class="muted" style="font-size:11px">还没有改动</p>'}
  `;
  document.querySelectorAll('[data-retire]').forEach(b => b.onclick = async () => {
    const out = await post('/api/remember', { roomId: activeRoom, action: 'retire', entryId: b.dataset.retire, reason: '用户在本子里下线' });
    toast(out.ok ? '已下线，进归档' : (out.error ?? '没成'), out.ok ? 'ok' : 'warn');
    openSheet(); refresh();
  });
  $('#sheet').hidden = false;
}

// ---- 现场副屏 ----
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
      <div class="m-run" data-text="【追问 · ${esc(b?.name ?? '')} 的任务】${esc((r.prompt ?? '').slice(0, 50))}">
        <div class="rn"><b>${esc(b?.name ?? '?')}</b><span class="st">RUNNING</span></div>
        <div class="task">${esc(r.prompt ?? '')}</div>
      </div>`; }).join('') || '<div class="m-empty">没有人正在干活</div>'}
    <div class="m-sec">审计 · 最近</div>
    ${audit.map(a => `<div class="m-line" data-text="【追问 · 审计 ${String(a.at ?? '').slice(11, 16)}】${esc(a.action ?? a.kind)} ${a.kind === 'refused' ? '为什么被拒？' : '这是什么操作？'}">
      <span class="at">${String(a.at ?? '').slice(11, 16)}</span>
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

// ---- 绑定 ----
$('#sendBtn').onclick = send;
$('#notebookBtn').onclick = openSheet;
$('#sheetScrim').onclick = () => { $('#sheet').hidden = true; };
$('#rememberBtn').onclick = () => {
  rememberMode = !rememberMode;
  $('#rememberBtn').classList.toggle('on', rememberMode);
  input.placeholder = rememberMode ? '记住模式：写一条规矩，回车收进本子（Esc 退出）' : '发消息，@ 点名谁回……';
  input.focus();
};
