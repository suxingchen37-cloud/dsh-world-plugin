// 收件箱 —— Obsidian 双向同步的"进"方向。
// 用户在 vault 的 Bots/<bot>/收件箱.md 里一行写一条规矩；这里把行解析成候选规矩，
// 并走与 brain_rule 相同的查冲突流程。纯逻辑，不碰磁盘（写回由 index.js 的扫描器做）。
import { findConflicts, add as noteAdd } from './rules.mjs';

// 收件箱文件的固定说明头。以 > 开头，解析时天然被忽略。
export const INBOX_HINT = [
  '> **收件箱**：一行写一条规矩，保存后几秒内自动进本子（先查冲突；和旧规矩打架的会被退到 [[收件箱-退回]]，绝不自动覆盖）。',
  '> 以 # 或 > 开头的行会被忽略。已处理的行会被清走；成功的几秒内出现在上面的规则里，账本记一笔（by: 用户）。',
].join('\n') + '\n';

/** 解析收件箱内容为候选规矩行：去空行/标题/引用/注释，剥掉列表与编号前缀。 */
export function parseInbox(content) {
  return String(content ?? '').split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('<!--'))
    .map(l => l.replace(/^[-*•·]\s+/, '').replace(/^\d+[.、)）]\s+/, '').trim())
    .filter(Boolean);
}

/**
 * 把候选行收进本子。与聊天里的 brain_rule 同一条纪律：
 * 没冲突 → 收（by: user）；有冲突 → 绝不自动覆盖，退回并附上与谁打架、怎么改。
 */
export function consumeInbox(brain, { botId, botName = '', scope = 'bot', lines = [] }) {
  const added = [];
  const rejected = [];
  for (const line of lines) {
    const conflicts = findConflicts(brain, { botId, text: line });
    if (!conflicts.length) {
      added.push(noteAdd(brain, { botId, botName, text: line, kind: 'rule', scope, by: 'user' }));
    } else {
      rejected.push({
        line,
        conflicts: conflicts.map(c => ({
          id: c.entry.id, text: c.entry.text, relation: c.relation, advice: c.advice,
        })),
      });
    }
  }
  return { added, rejected };
}

/** 被拒条目写进 收件箱-退回.md 的一个块。 */
export function rejectBlock(rejected, at = new Date()) {
  const stamp = at.toISOString().slice(0, 16).replace('T', ' ');
  return rejected.map(r => [
    `## ${stamp} · 这条没进本子`,
    `- 原句：${r.line}`,
    ...r.conflicts.map(c => `- 打架：「${String(c.text).slice(0, 80)}」（${c.relation}）—— ${c.advice}`),
    '',
  ].join('\n')).join('\n');
}
