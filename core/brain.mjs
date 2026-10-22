// The bot's own notebook: what it learned, what it decided, and when any of it stops being true.
//
// Obsidian stays the human-facing mirror; this file is the source of truth the tools read and
// write, because parsing rendered Markdown back into structured entries would lose exactly the
// things that make a note trustworthy (who wrote it, which day it is about, whether it expired).
//
// The rules encoded here are the user's, not defaults I picked:
//   - three times per entry: written, about, expires. An expired entry is history, never current fact.
//   - a bot may only ever touch its own entries; team entries are readable by all, writable by the prime.
//   - nothing is ever deleted. A retired entry moves to the archive with what replaced it.
//   - every integration writes a line to the ledger: who, when, what changed, why.
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

// --- text scoring -----------------------------------------------------------
// Chinese has no spaces, so a plain word split finds nothing. Bigrams over CJK plus words over
// latin/digits is the cheap version that still works, and it costs no model call.
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

// --- reading ----------------------------------------------------------------
export function live(brain, now = nowIso()) {
  return brain.entries.filter(e => e.status !== 'retired' && !(e.expiresAt && String(e.expiresAt) < now.slice(0, 10)));
}

export function expired(brain, now = nowIso()) {
  const today = now.slice(0, 10);
  return brain.entries.filter(e => e.status !== 'retired' && e.expiresAt && String(e.expiresAt) < today);
}

/** Recall: this bot's own entries plus the team book. Expired and retired are out unless asked. */
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
    if (!query && !wantTags.size) score += 1; // no query at all: newest-first listing
    if (e.expiresAt) { score += 12; why.push(`到 ${e.expiresAt} 前有效`); }
    return { entry: e, score, why };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score || String(b.entry.writtenAt).localeCompare(String(a.entry.writtenAt)));
  return scored.slice(0, Math.max(1, Math.min(20, limit)));
}

// --- conflict detection -----------------------------------------------------
// What the machine can tell on its own: same topic, near duplicate, a date that has passed, or a
// scope word that means the two are not actually fighting. What it cannot tell is left as a
// question for the caller — the bot is the model, and it is already running.
const PREFERENCE = /(喜欢|偏好|习惯|风格|口味|讨厌|不喜欢|prefer|style|like|dislike)/i;
const CONDITION = /(如果|当|仅在|只在|针对|对于|条件下|if |when |only )/;
// A rule that names a platform/project is not the same kind of statement as a blanket one, so the
// two must never overwrite each other — they are both true, for different scopes.
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
  // Two near-identical sentences whose numbers disagree are not duplicates — that is the case
  // where an old rule has to be retired, so it has to be checked before the duplicate test.
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

/** Everything in this bot's book that the new line might be fighting with. */
export function findConflicts(brain, { botId, text, excludeId = null, now = nowIso() }) {
  return live(brain, now)
    .filter(e => (e.scope === 'team' || e.botId === botId) && e.id !== excludeId && KINDS.includes(e.kind))
    .map(e => ({ entry: e, ...(classifyConflict(e, text) ?? {}) }))
    .filter(x => x.relation)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5);
}

// --- writing ----------------------------------------------------------------
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

/** Retire, never delete: the entry stays readable, marked, and says what replaced it. */
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

/** merge/fuse: the surviving entry is new text, the sources are retired and point at it. */
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

/** The one call the page and the tools both use to answer "what changed and why". */
export function ledgerFor(brain, { botId = null, limit = 30 } = {}) {
  return brain.ledger.filter(r => !botId || r.botId === botId).slice(-limit).reverse();
}

// --- riding on the bot's instructions ---------------------------------------
// The service merges partial updates and the model only ever sees the bot record, so the only
// channel from this notebook into a run is systemPrompt. The block is appended below a marker and
// stripped again before the page shows the persona, so what the user typed stays exactly what he
// typed, and the block can be regenerated or removed without touching his words.
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
  if (!body) return '';
  return NOTES_MARK + NOTES_HEAD + body + '要改先用 brain_rule，别直接堆新的。';
}

// --- the Obsidian mirror ----------------------------------------------------
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
    + `\n\n> 过期或被取代的条目不在这份里，去 [[归档]] 看；改动的来龙去脉去 [[账本]] 看。\n`;
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
