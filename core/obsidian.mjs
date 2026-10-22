// Per-bot Obsidian memory: each bot gets its own folder in the vault and may only ever write
// inside it. That is what makes "external brain" safe rather than a shared pile of notes where
// one bot's conclusions become another bot's facts.
//
// Layout inside the vault:
//   Bots/<bot>/身份.md            profession, persona (systemPrompt), model, permission
//   Bots/<bot>/记忆/<YYYY-MM>.md  one section per memory entry, newest first
//   Bots/<bot>/任务/<room>.md     the task cards this bot owns on this room, with reports
//   Bots/_索引.md                 one line per bot, [[wikilinks]] so the graph shows the swarm
//
// Writes are additive and idempotent: a file is only rewritten when its rendered content changed.
import fs from 'node:fs';
import path from 'node:path';

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

/** The full write plan for one snapshot. Pure: nothing here touches the disk. */
export function planWrites(vaultRoot, snapshot) {
  const bots = snapshot?.bots ?? [];
  const rooms = snapshot?.rooms ?? [];
  const memories = snapshot?.memories ?? snapshot?.botMemories ?? [];
  const byBot = new Map(bots.map(b => [b.id, b]));
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
    for (const r of rooms) {
      const mine = (r.assignments ?? []).filter(a => a.botId === b.id);
      if (mine.length) add(`${botDir(b.name)}/任务/${slug(r.name)}.md`, taskDoc(b, r, mine));
    }
  }
  if (bots.length) add('Bots/_索引.md', indexDoc(bots));
  return plan;
}

/** Dry-run diff: what would change, without writing anything. */
export function diffPlan(plan) {
  return plan.map(p => {
    let current = null;
    try { current = fs.readFileSync(p.abs, 'utf8'); } catch { }
    return { ...p, action: current === null ? 'create' : current === p.content ? 'unchanged' : 'update' };
  });
}

/**
 * Apply a plan. Refuses anything outside <vaultRoot>/Bots so a bad name can never write into the
 * rest of the vault, and never deletes: removed bots leave their notes behind on purpose.
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
