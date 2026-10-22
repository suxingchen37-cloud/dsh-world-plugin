// The external-brain mapping, verified against the user's real community state — dry run only.
// Nothing here may write into his vault.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planWrites, diffPlan, applyPlan, botDir } from '../core/obsidian.mjs';

const say = t => console.log(t);
const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-vault-'));   // a scratch vault, never his
const STATE = 'C:/Users/EDY/.dsh/agent-community/state.json';
const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));

// the same projection the host endpoint builds
const snapshot = {
  bots: raw.bots.map(b => ({
    id: b.id, name: b.name, description: b.description, avatar: b.avatar?.seed, provider: b.provider,
    model: b.model, reasoningEffort: b.reasoningEffort, permission: b.permission, mentionOnly: !!b.mentionOnly,
    workspace: b.workspace, systemPrompt: b.systemPrompt, memoryNamespace: b.profile?.memoryNamespace, profileId: b.profile?.profileId,
  })),
  rooms: raw.rooms.map(r => ({
    id: r.id, name: r.name, objective: r.taskState?.objective ?? null, round: r.taskState?.round ?? 0,
    assignments: (r.taskState?.assignments ?? []).map(a => ({ id: a.id, botId: a.botId, task: a.task, status: a.status, round: a.round })),
  })),
  memories: (raw.botMemories ?? []).map(m => ({ ...m })),
};
assert.ok(snapshot.bots.length >= 2, 'the real state must have bots to test with');

// 1. every bot gets its own folder, and no path crosses into another bot's folder
const plan = planWrites(VAULT, snapshot);
assert.ok(plan.length >= snapshot.bots.length, 'each bot yields at least its identity note');
const dirs = snapshot.bots.map(b => botDir(b.name));
assert.equal(new Set(dirs).size, snapshot.bots.length, 'bot folders are distinct — memory cannot collide');
for (const b of snapshot.bots) {
  const mine = plan.filter(p => p.path.startsWith(botDir(b.name) + '/'));
  assert.ok(mine.length >= 2, `${b.name} has an identity note and a memory note`);
  for (const p of mine) {
    for (const other of dirs) {
      if (other === botDir(b.name)) continue;
      assert.ok(!p.path.startsWith(other + '/'), `${b.name}'s file must never land in ${other}`);
    }
  }
}
say(`PASS  isolation: ${snapshot.bots.length} bots -> ${dirs.join(', ')}; ${plan.length} notes, no cross-folder writes`);

// 2. the identity note really carries the persona, and the index links every bot
const idDoc = plan.find(p => p.path === path.posix.join(botDir(snapshot.bots[0].name), '身份.md'));
assert.ok(idDoc.content.includes(snapshot.bots[0].systemPrompt.slice(0, 20)), 'persona text is stored verbatim');
assert.ok(idDoc.content.includes(`memoryNamespace: ${snapshot.bots[0].memoryNamespace}`), 'the bot keeps its own memory namespace');
const idx = plan.find(p => p.path === 'Bots/_索引.md');
for (const b of snapshot.bots) assert.ok(idx.content.includes(b.name), 'index lists every bot');
say('PASS  identity + index: persona verbatim, own namespace recorded, every bot linked');

// 3. idempotence: re-planning the same state changes nothing
const first = applyPlan(plan, { vaultRoot: VAULT });
assert.ok(first.every(x => x.action === 'create'), 'first pass creates');
const again = diffPlan(planWrites(VAULT, JSON.parse(JSON.stringify(snapshot))));
assert.ok(again.every(x => x.action === 'unchanged'), 'second pass writes nothing new');
say(`PASS  idempotent: ${first.length} created, then ${again.filter(x => x.action !== 'unchanged').length} changed on a re-run`);

// 4. the guard refuses anything outside <vault>/Bots
const hostile = [{ path: '../Outside.md', abs: path.join(VAULT, '..', 'Outside.md'), content: 'x' }];
const res = applyPlan(hostile, { vaultRoot: VAULT });
assert.equal(res[0].action, 'refused-outside-bots', 'a path escaping Bots is refused');
assert.ok(!fs.existsSync(path.join(VAULT, '..', 'Outside.md')), 'and nothing was written');
say('PASS  guard: writes outside <vault>/Bots are refused, not just warned');

// 5. dry run really touches nothing
const before = fs.readdirSync(VAULT).length;
applyPlan(planWrites(VAULT, snapshot), { vaultRoot: VAULT, dryRun: true });
assert.equal(fs.readdirSync(VAULT).length, before, 'dryRun writes nothing');
say('PASS  dry-run leaves the vault untouched');

fs.rmSync(VAULT, { recursive: true, force: true });
console.log('\n5 external-brain checks passed');
