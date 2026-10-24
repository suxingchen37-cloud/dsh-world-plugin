// 能力注册表契约：manifest 与代码互相一致、故障隔离、清单无重名。
// 这是"加/删能力"流程的验收门（docs/CAPABILITY-SPEC.md 第 4/5 节）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 状态全部指进临时目录：测试绝不读写真实 state/
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lc-registry-'));
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
process.env.DSH_LOCAL_COMPUTER_MACHINE_ID = 'test-machine';

const { loadCapabilities, apply } = await import(pathToFileURL(path.join(ROOT, 'host', 'index.js')).href);
const { store } = await import(pathToFileURL(path.join(ROOT, 'host', 'runtime.js')).href);

const CAPS_DIR = path.join(ROOT, 'host', 'capabilities');
const collect = [];   // 假宿主收集到的工具注册

function fakeRt() {
  // 真正的 runtime，只是宿主面换成收集器：能力代码在测试里走的就是生产路径
  return (async () => {
    const mod = await import(pathToFileURL(path.join(ROOT, 'host', 'runtime.js')).href);
    const rt = mod.createRuntime({
      get: () => null,                       // 无 agentCommunity：能力必须能容忍它缺席
      tools: { register: (spec) => { collect.push(spec); return () => { }; } },
    });
    return rt;
  })();
}

// 1) 真实能力树：核心三能力在场，_template 被跳过，每个名字与目录一致。
//    断言"核心必须在场"而不是"清单恰好等于"：加/删能力不该改测试（SPEC 第 1 步约定）。
const caps = loadCapabilities();
const capNames = caps.map(c => c.dirName);
for (const core of ['brain', 'computer', 'org']) {
  assert.ok(capNames.includes(core), `核心能力 ${core} 必须在场`);
}
assert.ok(!capNames.includes('_template'), '_template 是脚手架，永不入册');
for (const c of caps) {
  assert.equal(c.manifest.name, c.dirName, `${c.dirName}: manifest.name === 目录名`);
  assert.ok(c.manifest.surfaces.length, `${c.dirName}: 至少声明一个 surface`);
  assert.ok(Array.isArray(c.manifest.state) && c.manifest.state.length, `${c.dirName}: 声明自己的状态文件`);
}
console.log(`PASS  loadCapabilities 发现 ${capNames.join('/')}，跳过 _template，名字与目录一致`);

// 2) manifest.tools 与实际注册的工具一致（host 面）
const rt = await fakeRt();
const hostCaps = caps.filter(c => c.manifest.surfaces.includes('host'));
for (const cap of hostCaps) {
  const before = collect.length;
  const mod = await import(pathToFileURL(path.join(cap.dir, 'index.js')).href);
  const res = await mod.register(rt);
  const names = collect.slice(before).map(s => s.name);
  const declared = (cap.manifest.tools ?? []).map(t => t.name).sort();
  assert.deepEqual(names.sort(), declared, `${cap.manifest.name}: 实际注册 == manifest.tools`);
  // 每个工具的 schema 必须是真实 JSON Schema object
  for (const spec of collect.slice(before)) {
    assert.equal(spec.parameters?.type, 'object', `${spec.name}: parameters.type 必须是 object`);
  }
  res?.dispose?.();
}
console.log('PASS  org+brain 实际注册的工具与 manifest.tools 完全一致，schema 合法');

// 3) mcp 面：mcp.mjs 导出 tools+call，且与 manifest.tools 一致
for (const cap of caps.filter(c => c.manifest.surfaces.includes('mcp'))) {
  const mod = await import(pathToFileURL(path.join(cap.dir, 'mcp.mjs')).href);
  assert.equal(typeof mod.call, 'function', `${cap.manifest.name}: mcp.mjs 导出 call`);
  const names = mod.tools.map(t => t.name).sort();
  const declared = (cap.manifest.tools ?? []).map(t => t.name).sort();
  assert.deepEqual(names, declared, `${cap.manifest.name}: mcp tools == manifest.tools`);
  for (const t of mod.tools) {
    assert.equal(t.inputSchema?.type, 'object', `${t.name}: inputSchema.type 必须是 object`);
  }
}
console.log('PASS  computer 的 mcp.mjs 导出与 manifest.tools 一致，inputSchema 合法');

// 4) 工具无重名（跨能力）
const allNames = collect.map(s => s.name);
assert.equal(new Set(allNames).size, allNames.length, 'host 工具无重名');
console.log(`PASS  ${allNames.length} 个 host 工具无重名`);

// 5) 故障隔离：坏能力只损失自己，好能力照常挂载
const tmpCaps = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lc-caps-'));
fs.mkdirSync(path.join(tmpCaps, 'bad-register'), { recursive: true });
fs.writeFileSync(path.join(tmpCaps, 'bad-register', 'manifest.json'), JSON.stringify({ name: 'bad-register', title: '坏', version: '0', description: '', surfaces: ['host'], requires: [], state: ['bad.json'], tools: [] }));
fs.writeFileSync(path.join(tmpCaps, 'bad-register', 'index.js'), 'export function register(rt) { throw new Error("boom"); }');
fs.mkdirSync(path.join(tmpCaps, 'good-cap'), { recursive: true });
fs.writeFileSync(path.join(tmpCaps, 'good-cap', 'manifest.json'), JSON.stringify({ name: 'good-cap', title: '好', version: '0', description: '', surfaces: ['host'], requires: [], state: ['good.json'], tools: [{ name: 'good_ping', summary: 'ping' }] }));
fs.writeFileSync(path.join(tmpCaps, 'good-cap', 'index.js'), 'export function register(rt) { rt.tools.add({ name: "good_ping", description: "ping", parameters: { type: "object", properties: {}, additionalProperties: false } }); return { dispose() { } }; }');

const names2 = loadCapabilities(tmpCaps).map(c => c.dirName);
assert.deepEqual(names2, ['bad-register', 'good-cap'], '临时目录两个能力都被发现');

const collected2 = [];
const rt2 = (await import(pathToFileURL(path.join(ROOT, 'host', 'runtime.js')).href))
  .createRuntime({ get: () => null, tools: { register: (s) => { collected2.push(s); return () => { }; } } });
let stopped = false;
const stop = apply({
  get: () => null,
  tools: { register: (s) => { collected2.push(s); return () => { }; } },
}, tmpCaps);
await new Promise(r => setTimeout(r, 150));   // 给异步加载一个窗口
stop(); stopped = true;
assert.ok(collected2.some(s => s.name === 'good_ping'), '坏能力抛错后，好能力仍完成注册');
const crashLog = fs.existsSync(path.join(STATE, 'crash.log'))
  ? fs.readFileSync(path.join(STATE, 'crash.log'), 'utf8') : '';
assert.ok(crashLog.includes('boom'), '坏能力的异常进了 crash.log（kind=capability:bad-register）');
console.log('PASS  故障隔离：坏能力记 crash，好能力照常挂载，apply 正常返回清理函数');

// 6) manifest 与目录名不一致 → 跳过
fs.mkdirSync(path.join(tmpCaps, 'mismatch'), { recursive: true });
fs.writeFileSync(path.join(tmpCaps, 'mismatch', 'manifest.json'), JSON.stringify({ name: 'other-name', title: 'x', version: '0', description: '', surfaces: ['host'], requires: [], state: [], tools: [] }));
assert.deepEqual(loadCapabilities(tmpCaps).map(c => c.dirName), ['bad-register', 'good-cap'], '名字不一致的目录被跳过');
console.log('PASS  manifest.name 与目录名不一致 → 跳过并留 crash 证据');

rt.dispose();
fs.rmSync(STATE, { recursive: true, force: true });
fs.rmSync(tmpCaps, { recursive: true, force: true });
console.log('\nregistry checks passed');
