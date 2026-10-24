// 状态库契约：原子写、损坏隔离、审批票据清理、org 的一次性迁移。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lc-state-'));
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
process.env.DSH_LOCAL_COMPUTER_MACHINE_ID = 'test-machine';

const { store } = await import(pathToFileURL(path.join(ROOT, 'host', 'runtime.js')).href);

// 1) 原子写：save 后无 .tmp 残留，load 读回同样的对象
{
  const s = store('alpha');
  const obj = { hello: '世界', n: 42, nested: { ok: true } };
  s.save(obj);
  assert.equal(fs.existsSync(s.file + '.tmp'), false, 'save 后不留 .tmp');
  assert.deepEqual(s.load(), obj, 'load 读回写入的对象');
  console.log('PASS  状态原子写：无 .tmp 残留，读回一致');
}

// 2) 损坏隔离：坏 JSON → load 返回 null，文件改名 .corrupt-*，crash.log 留证据
{
  const s = store('beta');
  fs.writeFileSync(s.file, '{ 这不是 JSON');
  assert.equal(s.load(), null, '损坏文件 load 返回 null');
  const dir = fs.readdirSync(STATE);
  assert.ok(dir.some(f => f.startsWith('beta.json.corrupt-')), '损坏文件被改名隔离');
  const crashLog = fs.readFileSync(path.join(STATE, 'crash.log'), 'utf8');
  assert.ok(crashLog.includes('corrupt-state'), 'crash.log 留了 corrupt-state 证据');
  console.log('PASS  损坏隔离：改名 .corrupt-*，crash.log 有证据，绝不静默当空文件');
}

// 3) 缺文件 → load 返回 null（调用方自带默认）
{
  const s = store('gamma');
  assert.equal(s.load(), null, '缺文件 load 返回 null');
  console.log('PASS  缺文件 load 返回 null（默认值由调用方给）');
}

// ---- computer 引擎：票据清理 ------------------------------------------------
// 先造一份含旧/新已处理票据的账本，再让引擎第一次 load 时清走旧的。
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const engine = await import(pathToFileURL(path.join(ROOT, 'host', 'capabilities', 'computer', 'engine.mjs')).href);
{
  const legacy = {
    machineId: 'test-machine', grants: {}, permissions: {}, autonomy: true,
    pending: [
      { approvalId: 'ap_old', action: 'run-command', createdAt: new Date(NOW - 8 * DAY).toISOString(), resolved: 'deny', resolvedAt: new Date(NOW - 8 * DAY).toISOString(), resolvedBy: 'agent' },
      { approvalId: 'ap_fresh', action: 'write-file', createdAt: new Date(NOW - DAY).toISOString(), resolved: 'allow-once', resolvedAt: new Date(NOW - DAY).toISOString(), resolvedBy: 'agent', granted: true, consumed: true, consumedAt: new Date(NOW - DAY).toISOString() },
      { approvalId: 'ap_wait', action: 'run-command', createdAt: new Date(NOW - 3 * DAY).toISOString() },
    ],
    audit: [],
  };
  fs.writeFileSync(path.join(STATE, 'computer.json'), JSON.stringify(legacy, null, 2));
  await engine.call('computer_status', {});         // 触发 load → prune → save
  const after = JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8'));
  const ids = after.pending.map(p => p.approvalId);
  assert.ok(!ids.includes('ap_old'), '8 天前的已处理票据被清走');
  assert.ok(ids.includes('ap_fresh'), '1 天前的已处理票据保留');
  assert.ok(ids.includes('ap_wait'), '未处理的票据永远保留');
  console.log('PASS  审批票据清理：完成超 7 天的清走，其余保留');
}

// ---- org 的一次性迁移：旧 computer.json 里的组织字段搬进 org.json -------------
{
  const legacy = {
    machineId: 'test-machine', grants: {}, pending: [], audit: [], permissions: {},
    primeBotId: 'bot-prime', companyRoomId: 'room-1',
    ranks: { 'bot-a': 'officer' }, domains: { 'bot-a': '工作' },
  };
  fs.writeFileSync(path.join(STATE, 'computer.json'), JSON.stringify(legacy, null, 2));

  const { register } = await import(pathToFileURL(path.join(ROOT, 'host', 'capabilities', 'org', 'index.js')).href);
  const { createRuntime } = await import(pathToFileURL(path.join(ROOT, 'host', 'runtime.js')).href);
  const rt = createRuntime({ get: () => null, tools: { register: () => () => { } } });
  const reg = register(rt);
  reg?.dispose?.(); rt.dispose();

  const org = JSON.parse(fs.readFileSync(path.join(STATE, 'org.json'), 'utf8'));
  assert.equal(org.primeBotId, 'bot-prime', 'primeBotId 迁到 org.json');
  assert.equal(org.companyRoomId, 'room-1', 'companyRoomId 迁到 org.json');
  assert.deepEqual(org.ranks, { 'bot-a': 'officer' }, 'ranks 迁到 org.json');
  assert.deepEqual(org.domains, { 'bot-a': '工作' }, 'domains 迁到 org.json');

  const computer = JSON.parse(fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8'));
  assert.equal(computer.primeBotId, undefined, '组织字段从 computer.json 摘除');
  assert.equal(computer.machineId, 'test-machine', '执行账本的字段原样保留');
  assert.ok(fs.existsSync(path.join(STATE, 'computer.json.pre-org-migration')), '迁移前留了底');

  // 幂等：再跑一次 register 不改写、不报错
  const reg2 = register(rt);
  reg2?.dispose?.(); rt.dispose();
  const org2 = JSON.parse(fs.readFileSync(path.join(STATE, 'org.json'), 'utf8'));
  assert.equal(org2.primeBotId, 'bot-prime', '二次 register 幂等');
  console.log('PASS  org 迁移：字段搬家、原文件摘除、留底、幂等');
}

// ---- 全自动（默认）与审批模式（可切回）--------------------------------------
{
  process.env.DSH_LOCAL_COMPUTER_ROOT = path.join(STATE, 'sandbox');
  const eng2 = await import(pathToFileURL(path.join(ROOT, 'host', 'capabilities', 'computer', 'engine.mjs')).href + '?fresh=' + NOW);
  const sandboxFile = path.join(STATE, 'sandbox', 'hello.txt');
  fs.mkdirSync(path.join(STATE, 'sandbox'), { recursive: true });

  // 全自动（默认档位，只对全新账本生效；旧账本沿用自己写过的档位）
  fs.rmSync(path.join(STATE, 'computer.json'), { force: true });   // 模拟全新安装
  assert.equal((await eng2.call('computer_status', {})).autonomy, true, '全新账本 autonomy 默认开');
  const auto = await eng2.call('computer_write_file', { path: sandboxFile, content: '你好' });
  assert.equal(auto.status, 'ok', '全自动模式：直接执行，不需要审批');
  assert.equal(fs.readFileSync(sandboxFile, 'utf8'), '你好');
  const st1 = await eng2.call('computer_status', {});
  assert.equal(st1.lastAudit.at(-1).approvedBy, 'standing', '审计记的是常驻授权（无人审批）');

  // 切回审批模式：清空常驻授权（等同把 permissions 清空），票据流程原样可用
  const stFile = path.join(STATE, 'computer.json');
  const cur = JSON.parse(fs.readFileSync(stFile, 'utf8'));
  cur.permissions = {};
  fs.writeFileSync(stFile, JSON.stringify(cur, null, 2));

  const first = await eng2.call('computer_write_file', { path: sandboxFile, content: '你好' });
  assert.equal(first.status, 'permission_pending', '审批模式：第一次返回待审批 + 票据');
  assert.ok(first.approvalId, '返回 approvalId');

  const mid = await eng2.call('computer_respond', { approvalId: first.approvalId, verdict: 'allow-once' });
  assert.ok(mid.ok, 'autonomy 默认开：票据被批准');

  const second = await eng2.call('computer_write_file', { path: sandboxFile, content: '你好', approvalId: first.approvalId });
  assert.equal(second.status, 'ok', '带票据重试：写入成功');

  const third = await eng2.call('computer_write_file', { path: sandboxFile, content: 'again', approvalId: first.approvalId });
  assert.equal(third.status, 'refused', '同一票据第二次使用被拒绝（单次有效）');
  assert.ok(String(third.reason).startsWith('already-asked-and-denied-for-this-task'));
  console.log('PASS  全自动默认直通（审计记 standing）；切回审批模式后票据闭环原样可用');
}

fs.rmSync(STATE, { recursive: true, force: true });
console.log('\nstate checks passed');
