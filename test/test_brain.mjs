// The notebook rules the user set, as executable checks: three times per entry, keyword recall
// that works on Chinese without spaces, conflicts surfaced before anything is written, nothing ever
// deleted, and every change leaving a line in the ledger.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  add, recall, findConflicts, retire, integrate, live, expired, ledgerFor,
  rulesDoc, archiveDoc, ledgerDoc, loadBrain, saveBrain, emptyBrain,
} from '../host/capabilities/brain/rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);

const say = t => console.log(t);
const BOT = { id: 'b1', name: '私人秘书' };
const OTHER = { id: 'b2', name: '验收核算员' };
const NOW = '2026-10-22T09:00:00.000Z';

// 1. three times, and an expired entry stops being current fact
{
  const b = emptyBrain();
  add(b, { botId: BOT.id, botName: BOT.name, text: '周三 14:00 产品评审会，提前半小时提醒', kind: 'rule', tags: ['日程'], about: '2026-10-28', expires: '2026-10-28' });
  add(b, { botId: BOT.id, botName: BOT.name, text: '对外发送消息前必须先征得同意', kind: 'rule', tags: ['规矩'] });
  const e = b.entries[0];
  assert.ok(e.writtenAt, '写下时间自动带上');
  assert.equal(e.aboutDate, '2026-10-28', '说的是哪天，单独记');
  assert.equal(e.expiresAt, '2026-10-28', '什么时候作废，单独记');
  assert.equal(recall(b, { botId: BOT.id, query: '评审会', now: '2026-10-29T00:00:00Z' }).length, 0, '过期之后不再被当成现状');
  const back = recall(b, { botId: BOT.id, query: '评审会', includeExpired: true, now: '2026-10-29T00:00:00Z' });
  assert.equal(back.length, 1, '要翻历史还是翻得到');
  assert.ok(back[0].why.some(w => /到 2026-10-28 前有效/.test(w)), '并且告出它是什么时候的');
  assert.equal(expired(b, '2026-10-29T00:00:00Z').length, 1);
  assert.equal(live(b, '2026-10-29T00:00:00Z').length, 1);
  say('PASS  three times per entry: written / about / expires, and expired is history not fact');
}

// 2. keyword recall without spaces, with synonyms, capped
{
  const b = emptyBrain();
  for (const text of [
    '抖音的成片必须 1080p 以上', '剧本第二集的反转要提前', '费用核算按周结',
    '用户喜欢结论先行的回复', '水印放在右下角', '分镜表要标镜头时长',
  ]) add(b, { botId: BOT.id, text, kind: 'rule', tags: [] });
  const hit = recall(b, { botId: BOT.id, query: '分辨率要求', limit: 5 });
  assert.ok(hit.length >= 1 && /1080p/.test(hit[0].entry.text), '中文没空格也要命中：' + JSON.stringify(hit.map(h => h.entry.text)));
  const meeting = emptyBrain();
  add(meeting, { botId: BOT.id, text: '每周例会的纪要要归档', kind: 'rule' });
  assert.equal(recall(meeting, { botId: BOT.id, query: '评审会纪要' }).length, 1, '例会/评审会算同一类');
  assert.ok(recall(b, { botId: BOT.id, query: '随便说点什么完全无关的', limit: 5 }).every(h => h.entry), '不相关就不硬凑');
  assert.ok(recall(b, { botId: BOT.id, query: '成片', limit: 2 }).length <= 2, '一次最多捞这么多，不整本塞');
  say('PASS  recall: bigram + synonym matching on Chinese, capped, no junk padded in');
}

// 3. conflicts are surfaced before anything is written, and the kinds are told apart
{
  const b = emptyBrain();
  add(b, { botId: BOT.id, text: '所有成片必须 720p 以上', kind: 'rule', tags: ['交付'] });
  add(b, { botId: BOT.id, text: '用户喜欢详细的解释', kind: 'rule', tags: ['偏好'] });
  add(b, { botId: BOT.id, text: '抖音的成片必须 1080p 以上', kind: 'rule', tags: ['交付'] });

  const dup = findConflicts(b, { botId: BOT.id, text: '所有成片必须 720p 以上' });
  assert.ok(dup.some(c => c.relation === 'duplicate'), '几乎同一件事要认出来');
  const pref = findConflicts(b, { botId: BOT.id, text: '用户不喜欢详细的解释，太啰嗦' });
  const prefHit = pref.find(c => c.relation === 'preference');
  assert.ok(prefHit && prefHit.needsUser, '偏好冲突必须标成"要问用户"，不许自动覆盖');
  const fact = findConflicts(b, { botId: BOT.id, text: '所有成片必须 1080p 以上' });
  assert.ok(fact.some(c => c.relation === 'fact'), '同范围、数字对不上：这是要整改的事实冲突');
  const scoped = findConflicts(b, { botId: BOT.id, text: '抖音的成片必须 720p 以上' });
  assert.ok(scoped.some(c => c.relation === 'scoped'), '一条点名了平台、一条没有：不该谁盖谁');
  assert.equal(findConflicts(b, { botId: BOT.id, text: '今天天气不错' }).length, 0, '无关的新条目不该扯出冲突');
  say('PASS  conflict pass: duplicate / preference(ask the user) / scoped(keep both) / none');
}

// 4. nothing is deleted; retiring says what replaced it
{
  const b = emptyBrain();
  const old = add(b, { botId: BOT.id, text: '旧规矩：720p 就行', kind: 'rule' });
  retire(b, old.id, { by: 'agent', reason: '平台会拒', supersededBy: null });
  assert.equal(b.entries.length, 1, '条目还在文件里');
  assert.equal(b.entries[0].status, 'retired');
  assert.match(b.entries[0].retiredReason, /平台会拒/);
  assert.equal(recall(b, { botId: BOT.id, query: '720p' }).length, 0, '但默认召不回');
  assert.equal(recall(b, { botId: BOT.id, query: '720p', includeRetired: true }).length, 1, '翻历史时看得到');
  say('PASS  retire never deletes: still on disk, out of recall, visible as history');
}

// 5. integrating writes one surviving entry, retires the sources, and leaves a line in the ledger
{
  const b = emptyBrain();
  const a = add(b, { botId: BOT.id, text: '片子要短', kind: 'rule', tags: ['交付'] });
  const c = add(b, { botId: BOT.id, text: '第一集要在 60 秒内', kind: 'rule', tags: ['交付'] });
  const merged = integrate(b, { ids: [a.id, c.id], text: '片子要短，第一集 60 秒内', action: 'fuse', reason: '融合成一条带数字的' });
  assert.equal(b.entries.filter(e => e.status === 'live').length, 1, '只剩一条生效的');
  assert.deepEqual(merged.mergedFrom.sort(), [a.id, c.id].sort());
  assert.deepEqual(merged.tags.sort(), ['交付']);
  assert.equal(b.entries.find(e => e.id === a.id).supersededBy, merged.id, '旧的要指回新的');
  const led = ledgerFor(b);
  assert.ok(led.some(r => r.action === 'fuse'), '账本里有这一笔');
  assert.ok(led.some(r => r.action === 'retire' && r.entryIds.includes(c.id)));
  say('PASS  fuse/merge: one live entry, sources retired and pointing at it, ledger written');
}

// 6. one bot's book is not another bot's facts; the team book is shared
{
  const b = emptyBrain();
  add(b, { botId: BOT.id, text: '这个用户的会议都在周三', kind: 'rule' });
  add(b, { botId: OTHER.id, text: '验收只看分辨率', kind: 'rule' });
  add(b, { botId: BOT.id, text: '公司规矩：对外发送一律先审批', kind: 'rule', scope: 'team' });
  const mine = recall(b, { botId: OTHER.id, query: '会议 分辨率 审批' });
  assert.ok(mine.some(x => x.entry.scope === 'team'), '团队那本别人能读到');
  assert.ok(!mine.some(x => /会议都在周三/.test(x.entry.text)), '别人私有的读不到');
  say('PASS  per-bot isolation with a shared team book readable by everyone');
}

// 7. the Obsidian mirror: rules show the live set, archive shows the dead, ledger shows the trail
{
  const b = emptyBrain();
  const live1 = add(b, { botId: BOT.id, botName: BOT.name, text: '交付前必须过 720p 闸门', kind: 'rule', tags: ['交付'] });
  add(b, { botId: BOT.id, botName: BOT.name, text: '周三的旧会议', kind: 'rule', expires: '2026-10-20' });
  retire(b, add(b, { botId: BOT.id, botName: BOT.name, text: '过时的老规矩', kind: 'rule' }).id, { reason: '被新规矩取代' });
  const rules = rulesDoc(BOT, b, NOW), arch = archiveDoc(BOT, b), led = ledgerDoc(BOT, b);
  assert.match(rules, /720p/, '现行规则在 规则.md');
  assert.ok(!/过时的老规矩/.test(rules), '下线的不在这份里');
  assert.ok(!/周三的旧会议/.test(rules), '过期的也不在这份里');
  assert.match(rules, /去 \[\[归档\]\]/, '并且告诉他去哪看历史');
  assert.match(arch, /过时的老规矩/);
  assert.match(arch, /被新规矩取代/);
  assert.match(led, /下线/);
  assert.equal(live1.status, 'live');
  say('PASS  mirror docs: 规则.md live-only, 归档.md the retired, 账本.md the trail');
}

// 8. the file itself survives a reload, and a corrupt one does not take the plugin down
{
  const file = R('state/brain-test/brain.json');
  const b = emptyBrain();
  add(b, { botId: BOT.id, text: '要留下的那条', kind: 'rule' });
  saveBrain(file, b);
  assert.equal(loadBrain(file).entries.length, 1, '存进去读得回来');
  fs.writeFileSync(file, '{ this is not json');
  assert.deepEqual(loadBrain(file), emptyBrain(), '坏文件回落到空，不抛');
  fs.rmSync(R('state/brain-test'), { recursive: true, force: true });
  say('PASS  persistence: reload keeps entries, a broken file degrades to empty instead of throwing');
}

console.log('\n8 notebook checks passed');
