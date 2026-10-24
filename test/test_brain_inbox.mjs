// 收件箱（Obsidian 双向）契约：解析、收割走查冲突流程、被拒不覆盖、全链路回写。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lc-inbox-'));
const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lc-vault-'));
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
process.env.DSH_LOCAL_COMPUTER_MACHINE_ID = 'test-machine';
process.env.DSH_OBSIDIAN_VAULT = VAULT;

// ---- 1) parseInbox：剥掉列表/编号/标题/引用/注释，只留真规矩 ----------------
const { parseInbox, consumeInbox, rejectBlock, INBOX_HINT } = await import(
  pathToFileURL(path.join(ROOT, 'host', 'capabilities', 'brain', 'inbox.mjs')).href);
const lines = parseInbox([
  INBOX_HINT.trim(),
  '',
  '## 随手记',
  '- 交付成片一律 1080p',
  '* 评审前先跑一遍冒烟',
  '1. 每周五下午三点例会',
  '> 这是引用，忽略',
  '<!-- 注释，忽略 -->',
  '',
  '封面必须有水印',
].join('\n'));
assert.deepEqual(lines, ['交付成片一律 1080p', '评审前先跑一遍冒烟', '每周五下午三点例会', '封面必须有水印'],
  '解析只留真规矩，剥掉前缀与噪音');
console.log('PASS  parseInbox：剥掉列表/编号/标题/引用/注释，只留真规矩');

// ---- 2) consumeInbox：没收割冲突 → 收；有冲突 → 原样退回，绝不覆盖 ----------
const { emptyBrain, add } = await import(
  pathToFileURL(path.join(ROOT, 'host', 'capabilities', 'brain', 'rules.mjs')).href);
const brain = emptyBrain();
add(brain, { botId: 'b1', text: '交付成片一律 1080p', kind: 'rule' });   // 预置一条旧规矩

const res = consumeInbox(brain, {
  botId: 'b1', botName: '验收员',
  lines: ['评审前先跑一遍冒烟', '交付成片一律 720p', '封面必须有水印'],
});
assert.equal(res.added.length, 2, '无冲突的两条收入');
assert.ok(brain.entries.some(e => e.text === '评审前先跑一遍冒烟' && e.writtenBy === 'user'));
assert.equal(res.rejected.length, 1, '和 1080p 打架的 720p 被拒');
assert.equal(res.rejected[0].conflicts[0].relation, 'fact', '冲突分类是 fact（数字对不上）');
assert.ok(brain.entries.every(e => e.text !== '交付成片一律 720p'), '绝不自动覆盖旧规矩');
const block = rejectBlock(res.rejected);
assert.ok(block.includes('交付成片一律 720p') && block.includes('fact'), '退回块带原句与冲突分类');
console.log('PASS  consumeInbox：无冲突收入（by:user），有冲突退回且不覆盖');

// team 作用域
const res2 = consumeInbox(brain, { botId: 'prime', botName: '团队', scope: 'team', lines: ['全公司周五发周报'] });
assert.equal(res2.added[0].scope, 'team', '团队收件箱写入 team 作用域');
console.log('PASS  团队收件箱 → team 作用域条目');

// ---- 3) 全链路：真 vault + 真 brain 状态 + 镜像回写 --------------------------
// community fixture：brain 的镜像与快照都依赖它
const COMMUNITY = path.join(STATE, 'community.json');
fs.writeFileSync(COMMUNITY, JSON.stringify({
  bots: [{ id: 'b1', name: '验收员', description: '', avatar: { seed: '🧪' }, provider: 'deepseek-account', model: 'deepseek-flash', permission: 'read-only', mentionOnly: false, profile: { profileId: 'bot-qa', memoryNamespace: 'bot-qa' }, systemPrompt: '' }],
  rooms: [], messages: [], runs: [], botMemories: [],
}, null, 2));
process.env.DSH_AGENT_COMMUNITY_STATE = COMMUNITY;

// 预置 brain.json：一条旧规矩，制造一个必被拒的候选
const BRAIN_FILE = path.join(STATE, 'brain.json');
{
  const b = emptyBrain();
  add(b, { botId: 'b1', botName: '验收员', text: '交付成片一律 1080p', kind: 'rule' });
  fs.writeFileSync(BRAIN_FILE, JSON.stringify(b, null, 2));
}

const { createRuntime } = await import(pathToFileURL(path.join(ROOT, 'host', 'runtime.js')).href);
const rt = createRuntime({ get: () => null, tools: { register: () => () => { } } });
const brainMod = await import(pathToFileURL(path.join(ROOT, 'host', 'capabilities', 'brain', 'index.js')).href);
const reg = brainMod.register(rt);

const botInbox = path.join(VAULT, 'Bots', '验收员', '收件箱.md');
fs.mkdirSync(path.dirname(botInbox), { recursive: true });

// 第一轮扫描：收件箱还不存在 → 播种
await reg.scanInboxes('test');
assert.ok(fs.existsSync(botInbox), '首次扫描为每个 Bot 播种收件箱');
assert.ok(fs.readFileSync(botInbox, 'utf8').startsWith('>'), '播种内容带说明头');

// 用户写两行：一条能收，一条与旧规矩打架
fs.writeFileSync(botInbox, [
  INBOX_HINT,
  '评审前先跑一遍冒烟',
  '交付成片一律 720p',
].join('\n'), 'utf8');
await reg.scanInboxes('test');

const saved = JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8'));
assert.ok(saved.entries.some(e => e.text === '评审前先跑一遍冒烟'), '能收的进了 brain.json');
assert.ok(!saved.entries.some(e => e.text === '交付成片一律 720p'), '打架的没进');
const ledgerRow = saved.ledger.find(r => r.by === 'user' && r.action === 'add');
assert.ok(ledgerRow, '账本记了一笔 by:user');

// 收件箱被清空（只剩说明头）
assert.ok(fs.readFileSync(botInbox, 'utf8').trimEnd() === INBOX_HINT.trimEnd(), '收件箱已清空只留说明头');
// 被拒的退到 收件箱-退回.md
const rejectFile = path.join(VAULT, 'Bots', '验收员', '收件箱-退回.md');
assert.ok(fs.existsSync(rejectFile), '退回文件存在');
assert.ok(fs.readFileSync(rejectFile, 'utf8').includes('交付成片一律 720p'));
// 立即镜像：规则.md 几秒内就有了新规矩
const rulesMd = fs.readFileSync(path.join(VAULT, 'Bots', '验收员', '规则.md'), 'utf8');
assert.ok(rulesMd.includes('评审前先跑一遍冒烟'), '镜像立即回写 规则.md');
assert.ok(rulesMd.includes('收件箱'), '规则.md 里有收件箱指引');
console.log('PASS  全链路：写收件箱 → 收割进本子 → 冲突退回 → 立即镜像回 规则.md');

// 再扫一轮：内容没变（哈希护栏）→ 不重复收割
await reg.scanInboxes('test');
const saved2 = JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8'));
assert.equal(saved2.entries.filter(e => e.text === '评审前先跑一遍冒烟').length, 1, '哈希护栏：不重复收割');
console.log('PASS  哈希护栏：同一份内容不会被收割两次');

reg.dispose?.(); rt.dispose();
fs.rmSync(STATE, { recursive: true, force: true });
fs.rmSync(VAULT, { recursive: true, force: true });
console.log('\ninbox checks passed');
