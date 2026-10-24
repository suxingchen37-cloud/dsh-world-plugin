// Bot 自己的本子：记过什么、定过什么规矩、哪天不再作数。
//
// Obsidian 是给人看的一面镜子；这个文件才是工具读写的真相之源——把渲染好的 Markdown
// 反解析回结构化条目，会丢掉让一条笔记可信的那些东西（谁写的、说的是哪天、是否过期）。
//
// 这里的规则是用户定的，不是默认值：
//   - 每条三个时间：写下 / 关于 / 过期。过期的条目是历史，不再是现行事实。
//   - 一个 Bot 永远只能碰自己的条目；团队条目全员可读，只有总理可写。
//   - 什么都不删除。下线的条目进归档，注明被谁取代。
//   - 每次整合都在账本留一行：谁、何时、改了什么、为什么。
//
// 同文件后半部是每 Bot 独立的 Obsidian 记忆映射：每个 bot 在 vault 里有自己的目录，
// 永远只写自己目录里——这是"外置大脑"安全而不互相污染的原因。
//
//   Bots/<bot>/身份.md            职业、人设（systemPrompt）、模型、权限
//   Bots/<bot>/规则.md            这个 bot（或用户）拍板的现行规矩，带三个时间
//   Bots/<bot>/归档.md            下线条目——这里的东西永不删除
//   Bots/<bot>/账本.md            一次改动一行：谁、何时、改了什么、为什么
//   Bots/<bot>/记忆/<YYYY-MM>.md  每条记忆一节，新的在前
//   Bots/<bot>/任务/<room>.md     这个 bot 在这个房间里认领的任务卡与回报
//   Bots/_索引.md                 每个 bot 一行，[[wikilinks]] 让图谱看见整个团队
//
// 写入是增量且幂等的：文件只在渲染内容变化时才重写。
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['rule', 'log'];
export const SCOPES = ['bot', 'team'];
export const ACTIONS = ['embed', 'merge', 'retire', 'fuse'];

const nowIso = () => new Date().toISOString();
const idOf = () => 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

export function emptyBrain() { return { version: 1, entries: [], ledger: [] }; }

export function loadBrain(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return emptyBrain(); }
  let j;
  try { j = JSON.parse(raw); } catch { return emptyBrain(); }
  if (!j || !Array.isArray(j.entries)) return emptyBrain();
  j.ledger = Array.isArray(j.ledger) ? j.ledger : [];
  return j;
}

export function saveBrain(file, brain) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(brain, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// --- 文本打分 ----------------------------------------------------------------
// 中文没有空格，按词切分什么都找不到。CJK 取二元组、拉丁取整词，是不用模型调用
// 也依然够用的便宜版本。
const SYNONYMS = [
  ['评审', '例会', 'review', '周会', '会议'],
  ['交付', '成片', '成品', 'delivery', '交付物'],
  ['抖音', 'douyin', 'tiktok'],
  ['分辨率', '清晰度', '720p', '1080p', 'resolution'],
  ['水印', 'watermark'],
  ['提醒', '待办', 'todo', '日程'],
  ['费用', '成本', '花销', 'cost'],
  ['剧本', '脚本', '分集'],
  ['分镜', 'storyboard', '镜头表'],
];
const SYN_GROUPS = SYNONYMS.map(g => g.map(s => s.toLowerCase()));

function expand(term) {
  for (const group of SYN_GROUPS) if (group.some(w => term === w || term.includes(w) || w.includes(term))) return group;
  return [term];
}

export function terms(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set();
  for (const w of s.split(/[^a-z0-9_\u4e00-\u9fff]+/)) if (w.length >= 2) out.add(w);
  const cjk = s.match(/[一-鿿]+/g) ?? [];
  for (const run of cjk) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  return out;
}

function overlap(a, b) {
  const ta = terms(a), tb = terms(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const x of ta) {
    if (tb.has(x)) { hit++; continue; }
    for (const y of expand(x)) if (tb.has(y)) { hit++; break; }
  }
  return hit / Math.min(ta.size, tb.size);
}

// --- 读取 --------------------------------------------------------------------
export function live(brain, now = nowIso()) {
  return brain.entries.filter(e => e.status !== 'retired' && !(e.expiresAt && String(e.expiresAt) < now.slice(0, 10)));
}

export function expired(brain, now = nowIso()) {
  const today = now.slice(0, 10);
  return brain.entries.filter(e => e.status !== 'retired' && e.expiresAt && String(e.expiresAt) < today);
}

/** 召回：自己的条目 + 团队那本。过期与下线的默认不出现，除非明确要看。 */
export function recall(brain, { botId, query = '', tags = [], limit = 5, includeExpired = false, includeRetired = false, now = nowIso() } = {}) {
  let pool = brain.entries.filter(e => e.scope === 'team' || (botId ? e.botId === botId : true));
  if (!includeRetired) pool = pool.filter(e => e.status !== 'retired');
  if (!includeExpired) pool = pool.filter(e => !(e.expiresAt && String(e.expiresAt) < now.slice(0, 10)));
  const wantTags = new Set(tags.map(t => String(t).replace(/^#/, '').toLowerCase()).filter(Boolean));
  const scored = pool.map(e => {
    let score = 0;
    const why = [];
    if (query) {
      const s = overlap(query, `${e.text} ${e.tags.join(' ')}`);
      if (s > 0) { score += s * 100; why.push(`相关度 ${Math.round(s * 100)}%`); }
    }
    const hitTags = e.tags.filter(t => wantTags.has(String(t).toLowerCase()));
    if (hitTags.length) { score += hitTags.length * 40; why.push(`标签 ${hitTags.join('、')}`); }
    if (!query && !wantTags.size) score += 1; // 完全没有查询条件：按新旧列
    if (e.expiresAt) { score += 12; why.push(`到 ${e.expiresAt} 前有效`); }
    return { entry: e, score, why };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score || String(b.entry.writtenAt).localeCompare(String(a.entry.writtenAt)));
  return scored.slice(0, Math.max(1, Math.min(20, limit)));
}

// --- 冲突识别 ----------------------------------------------------------------
// 机器能自己判断的：同话题、近重复、日期已过、或者两条的范围词说明它们根本不打架。
// 机器判断不了的，留成问题抛给调用方——bot 就是模型，它已经在跑了。
const PREFERENCE = /(喜欢|偏好|习惯|风格|口味|讨厌|不喜欢|prefer|style|like|dislike)/i;
const CONDITION = /(如果|当|仅在|只在|针对|对于|条件下|if |when |only )/;
// 点名了平台/项目的规则和一刀切的规则不是同一类话，谁也不能盖谁——它们各自为真，范围不同。
const SCOPE_WORDS = /(抖音|douyin|tiktok|快手|b站|bibili|哔哩哔哩|小红书|视频号|公众号|微信|微博|淘宝|亚马逊|amazon|netflix|youtube|这个群|该项目|本项目)/i;
const FACTUAL_DATE = /\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}[日号]|周[一二三四五六日天]|明天|后天|下周/;

const scoped = t => (CONDITION.test(String(t)) ? 1 : 0) + (SCOPE_WORDS.test(String(t)) ? 1 : 0);

const nums = t => (String(t).match(/\d+(?:\.\d+)?p?/gi) ?? []).map(x => x.toLowerCase());

export function classifyConflict(oldEntry, newText) {
  const sim = overlap(oldEntry.text, newText);
  if (sim < 0.18) return null;
  const oldScope = scoped(oldEntry.text), newScope = scoped(newText);
  if (oldScope !== newScope) {
    return { relation: 'scoped', sim, advice: '两条各自带条件/范围，不该谁盖谁：把新情况写成带条件的第二条，或合并成一条说清适用范围。' };
  }
  // 两句几乎一样但数字对不上的话，不是重复——恰恰是旧规矩必须下线的那种情况，
  // 所以要先于"重复"检查。
  const a = nums(oldEntry.text), c = nums(newText);
  const datesDiffer = FACTUAL_DATE.test(oldEntry.text) !== FACTUAL_DATE.test(newText)
    || (FACTUAL_DATE.test(oldEntry.text) && FACTUAL_DATE.test(newText) && oldEntry.text !== newText);
  if ((a.length && c.length && a.join(',') !== c.join(',')) || datesDiffer) {
    return { relation: 'fact', sim, advice: '同一件事的两个说法（日期或数字对不上）：新的生效，旧的归档并注明被谁取代。' };
  }
  if (PREFERENCE.test(oldEntry.text) || PREFERENCE.test(newText)) {
    return { relation: 'preference', sim, advice: '这是偏好冲突，没有对错，必须问用户，不能自动覆盖。', needsUser: true };
  }
  if (sim > 0.82) return { relation: 'duplicate', sim, advice: '几乎是同一件事：融合成一条更完整的说法，别留两份。' };
  return { relation: 'unknown', sim, advice: '可能是冲突也可能不是。要么融合（两条都成立、合起来更完整），要么整改（旧的下线）。拿不准就问用户。' };
}

/** 这个 bot 的本子里，新写的这条可能与之打架的全部条目。 */
export function findConflicts(brain, { botId, text, excludeId = null, now = nowIso() }) {
  return live(brain, now)
    .filter(e => (e.scope === 'team' || e.botId === botId) && e.id !== excludeId && KINDS.includes(e.kind))
    .map(e => ({ entry: e, ...(classifyConflict(e, text) ?? {}) }))
    .filter(x => x.relation)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5);
}

// --- 写入 --------------------------------------------------------------------
function ledger(brain, row) {
  brain.ledger.push({ at: nowIso(), ...row });
  if (brain.ledger.length > 500) brain.ledger.splice(0, brain.ledger.length - 500);
}

export function add(brain, { botId, botName = '', text, kind = 'rule', tags = [], scope = 'bot', about = null, expires = null, by = 'agent' }) {
  const entry = {
    id: idOf(), botId, botName,
    text: String(text || '').trim().slice(0, 500),
    kind: KINDS.includes(kind) ? kind : 'rule',
    tags: [...new Set(tags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean))].slice(0, 8),
    scope: SCOPES.includes(scope) ? scope : 'bot',
    writtenAt: nowIso(),
    aboutDate: about || null,
    expiresAt: expires || null,
    status: 'live',
    supersededBy: null,
    mergedFrom: [],
    writtenBy: by,
  };
  brain.entries.push(entry);
  ledger(brain, { action: 'add', botId, entryIds: [entry.id], summary: entry.text.slice(0, 80), by });
  return entry;
}

/** 下线，绝不删除：条目保持可读，打上标记，说明被什么取代。 */
export function retire(brain, id, { by = 'agent', reason = '', supersededBy = null } = {}) {
  const e = brain.entries.find(x => x.id === id);
  if (!e || e.status === 'retired') return null;
  e.status = 'retired';
  e.retiredAt = nowIso();
  e.retiredReason = reason.slice(0, 200);
  e.supersededBy = supersededBy;
  ledger(brain, { action: 'retire', botId: e.botId, entryIds: [e.id], summary: reason.slice(0, 80) || '下线', by });
  return e;
}

/** merge/fuse：存活条目是新文本，来源全部下线并指向它。 */
export function integrate(brain, { ids, text, by = 'agent', reason = '', action = 'merge', keepId = null, tags = [], about = null, expires = null, botId = null }) {
  const sources = brain.entries.filter(e => ids.includes(e.id));
  if (!sources.length) return null;
  const first = sources[0];
  const merged = add(brain, {
    botId: botId ?? first.botId, botName: first.botName, text,
    kind: first.kind, tags: tags.length ? tags : [...new Set(sources.flatMap(s => s.tags))],
    scope: first.scope, about, expires, by,
  });
  merged.mergedFrom = sources.map(s => s.id);
  for (const s of sources) {
    if (keepId && s.id === keepId) { retire(brain, s.id, { by, reason: '已被自己改写，见 ' + merged.id, supersededBy: merged.id }); continue; }
    retire(brain, s.id, { by, reason: reason || (action === 'fuse' ? '融合' : '整合'), supersededBy: merged.id });
  }
  ledger(brain, { action, botId: merged.botId, entryIds: ids.concat([merged.id]), summary: (reason || text).slice(0, 80), by });
  return merged;
}

/** 页面与工具回答"什么改过、为什么"共用的那一个调用。 */
export function ledgerFor(brain, { botId = null, limit = 30 } = {}) {
  return brain.ledger.filter(r => !botId || r.botId === botId).slice(-limit).reverse();
}

// --- 搭在 bot 的个性化指令上 -------------------------------------------------
// 服务合并的是部分更新，模型看到的只有 bot 记录本身，所以从本子进 run 的唯一通道就是
// systemPrompt。区块追加在标记以下，展示人设前再剥掉：用户打的那段字永远保持原样，
// 这个区块可以随时重生成或摘除，不碰他的原文。
export const NOTES_MARK = '\n\n<!-- dsh-local-computer:notebook -->';
export const NOTES_HEAD = '\n\n## 你自己记下的现行规则（自动带上，不用抄进个性化指令）\n';

export function stripNotes(prompt) {
  const s = String(prompt ?? '');
  const i = s.indexOf(NOTES_MARK);
  return i < 0 ? s : s.slice(0, i);
}

export function notesBlock(brain, botId, now = new Date().toISOString(), { maxEntries = 5, maxChars = 700 } = {}) {
  const rows = live(brain, now)
    .filter(e => (e.botId === botId || e.scope === 'team') && e.kind === 'rule')
    .slice(0, maxEntries);
  let body = '';
  let used = 0;
  for (const e of rows) {
    const tail = [e.aboutDate ? '（关于 ' + e.aboutDate + '）' : '', e.expiresAt ? '（' + e.expiresAt + ' 前有效）' : ''].join('');
    const line = '- ' + e.text + tail + '\n';
    if (used + line.length > maxChars) break;
    body += line; used += line.length;
  }
  // 记住的习惯：注入给每一个 Bot（哪怕它本子还空着）。这是"对话即记忆"的关键——
  // 用户顺嘴说"记住"，Bot 自己动手立规矩、查冲突、一句话确认，不需要任何按钮。
  const usage = '用户说「记住…」「记一下…」「以后都…」「以后别…」，或表达了想让你长期遵守的规矩/偏好时，立刻用 brain_rule 记到你自己的本子（它会先查冲突；打架了就如实告诉他和谁打架、怎么改），并用一句话确认记了什么。一次性的事用 brain_remember，别把临时的记成规矩；团队那本只有总理能写，全公司的规矩就提醒他找总理。';
  if (!body) return NOTES_MARK + NOTES_HEAD + usage + '\n';
  return NOTES_MARK + NOTES_HEAD + body + '\n' + usage;
}

// --- Obsidian 镜像 -----------------------------------------------------------
const esc = s => String(s ?? '').replace(/\|/g, '｜');

export function rulesDoc(bot, brain, now = nowIso()) {
  const own = live(brain, now).filter(e => e.botId === bot.id || e.scope === 'team');
  const rows = own.map(e => [
    `## ${e.text.split('\n')[0].slice(0, 60)}`,
    '',
    `- 内容：${e.text}`,
    `- 类型：${e.kind === 'rule' ? '规则' : '记事'}${e.scope === 'team' ? '（团队共享）' : ''}`,
    `- 标签：${e.tags.length ? e.tags.map(t => '#' + t).join(' ') : '—'}`,
    `- 写下：${String(e.writtenAt).slice(0, 16).replace('T', ' ')}`,
    `- 说的是：${e.aboutDate || '不限某天'}`,
    `- ${e.expiresAt ? `有效期至：${e.expiresAt}` : '有效期：长期'}`,
  ].join('\n')).join('\n\n');
  return `---\nbot: ${bot.name}\nkind: rules\n---\n\n# ${bot.name} · 现行规则与记事\n\n`
    + (rows || '_还没有条目。_')
    + `\n\n> 过期或被取代的条目不在这份里，去 [[归档]] 看；改动的来龙去脉去 [[账本]] 看。\n`
    + `> 要给 ${bot.name} 加新规矩：在 [[收件箱]] 里一行一条写下来，保存后几秒自动进本子。\n`;
}

export function archiveDoc(bot, brain) {
  const dead = brain.entries.filter(e => e.botId === bot.id && e.status === 'retired');
  const rows = dead.map(e => [
    `## ${e.text.split('\n')[0].slice(0, 60)}`,
    '',
    `- 下线于：${String(e.retiredAt ?? '').slice(0, 16).replace('T', ' ')}`,
    `- 原因：${e.retiredReason || '—'}`,
    e.supersededBy ? `- 被取代为：\`${e.supersededBy}\`` : null,
    `- 原文：${e.text}`,
  ].filter(Boolean).join('\n')).join('\n\n');
  return `---\nbot: ${bot.name}\nkind: archive\n---\n\n# ${bot.name} · 归档（只增不删）\n\n`
    + (rows || '_没有下线过任何条目。_') + '\n';
}

export function ledgerDoc(bot, brain) {
  const cn = { add: '新增', embed: '嵌入', merge: '整合', retire: '下线', fuse: '融合' };
  const rows = ledgerFor(brain, { botId: bot.id, limit: 100 });
  const body = rows.map(r => `- ${String(r.at).slice(0, 16).replace('T', ' ')} · ${cn[r.action] ?? r.action} · ${r.entryIds.join(' ')} · ${esc(r.summary)}`).join('\n');
  return `---\nbot: ${bot.name}\nkind: ledger\n---\n\n# ${bot.name} · 账本\n\n`
    + (body || '_还没有改动记录。_')
    + '\n\n> 每条规则是怎么来的、被什么取代的，都记在这里。删了条目也能从这里查回来。\n';
}

// ---- 每 Bot 的 Obsidian 记忆 ------------------------------------------------
export const FRONT = (bot) => [
  '---',
  `bot: ${bot.name}`,
  `botId: ${bot.id}`,
  `model: ${bot.provider}/${bot.model}`,
  `reasoningEffort: ${bot.reasoningEffort}`,
  `permission: ${bot.permission}`,
  `mentionOnly: ${bot.mentionOnly}`,
  `memoryNamespace: ${bot.memoryNamespace || bot.profileId || ''}`,
  `workspace: ${bot.workspace || ''}`,
  '---',
].join('\n');

const slug = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60) || '未命名';
export const botDir = name => path.posix.join('Bots', slug(name));

export function identityDoc(bot) {
  return `${FRONT(bot)}\n\n# ${bot.name}\n\n`
    + `> ${bot.description || '（没有写一句话定位）'}\n\n`
    + `## 个性化指令\n\n${bot.systemPrompt ? bot.systemPrompt.trim() : '_这位还没有写个性化指令。_'}\n\n`
    + `## 这台机器上的位置\n\n`
    + `- 独立工作区：\`${bot.workspace ?? '—'}\`\n`
    + `- 记忆命名空间：\`${bot.memoryNamespace || bot.profileId || '—'}\`\n`
    + `- 只在被 @ 时说话：${bot.mentionOnly ? '是' : '否'}\n`;
}

export function memoryDoc(bot, entries) {
  const byMonth = new Map();
  for (const e of entries) {
    const m = String(e.at ?? e.createdAt ?? '').slice(0, 7) || '未知月份';
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(e);
  }
  const months = [...byMonth.keys()].sort().reverse();
  const body = months.map(m => `## ${m}\n\n` + byMonth.get(m)
    .sort((a, b) => String(b.at ?? b.createdAt).localeCompare(String(a.at ?? a.createdAt)))
    .map(e => `- **${String(e.at ?? e.createdAt).slice(0, 16).replace('T', ' ')}** · ${e.kind === 'note' ? '自己记的' : '任务收尾'} — ${e.text ?? e.summary ?? ''}`)
    .join('\n')).join('\n\n');
  return `---\nbot: ${bot.name}\nkind: memory\n---\n\n# ${bot.name} · 记忆\n\n`
    + (body || '_还没有记忆条目。_') + '\n';
}

export function taskDoc(bot, room, assignments) {
  const body = assignments.map(a => [
    `## ${a.task || a.subject || a.id}`,
    '',
    `- 状态：${a.status ?? '—'}`,
    `- 轮次：R${a.round ?? '?'}`,
    a.report ? `- 回报：${a.report}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');
  return `---\nbot: ${bot.name}\nroom: ${room.name}\nkind: tasks\n---\n\n# ${room.name} · ${bot.name} 的任务\n\n`
    + (body || '_这个群里这位没有任务卡。_') + '\n';
}

export function indexDoc(bots) {
  return `---\nkind: index\n---\n\n# Bots 索引\n\n`
    + bots.map(b => `- [[${botDir(b.name)}/身份|${b.name}]] — ${b.description || b.model}`).join('\n')
    + '\n\n> 每个 bot 只写自己目录的约定，是为了让它们的记忆不互相污染：见各目录下的 身份.md。\n';
}

/** 一份快照的完整写入计划。纯函数：这里绝不碰磁盘。 */
export function planWrites(vaultRoot, snapshot) {
  const bots = snapshot?.bots ?? [];
  const rooms = snapshot?.rooms ?? [];
  const memories = snapshot?.memories ?? snapshot?.botMemories ?? [];
  const plan = [];
  const add = (rel, content) => plan.push({ path: rel, abs: path.join(vaultRoot, ...rel.split('/')), content });

  for (const b of bots) {
    add(`${botDir(b.name)}/身份.md`, identityDoc(b));
    const own = memories.filter(m => m.botId === b.id || m.namespace === (b.memoryNamespace || b.profileId));
    const grouped = new Map();
    for (const e of own) {
      const m = String(e.at ?? e.createdAt ?? '').slice(0, 7) || '未知月份';
      if (!grouped.has(m)) grouped.set(m, []);
      grouped.get(m).push(e);
    }
    for (const [m, list] of grouped) add(`${botDir(b.name)}/记忆/${m}.md`, memoryDoc(b, list));
    if (!grouped.size) add(`${botDir(b.name)}/记忆/README.md`, memoryDoc(b, []));
    // bot 自己写的本子，镜像在派生视图旁边：它现在信什么、下线过什么、每一步怎么来的
    if (snapshot.brain) {
      add(`${botDir(b.name)}/规则.md`, rulesDoc(b, snapshot.brain));
      add(`${botDir(b.name)}/归档.md`, archiveDoc(b, snapshot.brain));
      add(`${botDir(b.name)}/账本.md`, ledgerDoc(b, snapshot.brain));
    }
    for (const r of rooms) {
      const mine = (r.assignments ?? []).filter(a => a.botId === b.id);
      if (mine.length) add(`${botDir(b.name)}/任务/${slug(r.name)}.md`, taskDoc(b, r, mine));
    }
  }
  if (bots.length) add('Bots/_索引.md', indexDoc(bots));
  return plan;
}

/** 干跑 diff：会改什么，一个字节都不写。 */
export function diffPlan(plan) {
  return plan.map(p => {
    let current = null;
    try { current = fs.readFileSync(p.abs, 'utf8'); } catch { }
    return { ...p, action: current === null ? 'create' : current === p.content ? 'unchanged' : 'update' };
  });
}

/**
 * 应用计划。拒绝一切落在 <vaultRoot>/Bots 之外的路径，坏名字永远写不进 vault 其他地方；
 * 永不删除：被移除的 bot 故意把笔记留在原地。
 */
export function applyPlan(plan, { vaultRoot, dryRun = false } = {}) {
  const guard = path.resolve(vaultRoot, 'Bots');
  const done = [];
  for (const item of diffPlan(plan)) {
    const abs = path.resolve(item.abs);
    if (abs !== guard && !abs.startsWith(guard + path.sep)) {
      done.push({ ...item, action: 'refused-outside-bots' });
      continue;
    }
    if (item.action === 'unchanged' || dryRun) { done.push(item); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, item.content, 'utf8');
    done.push(item);
  }
  return done;
}
