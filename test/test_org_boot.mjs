// 组织能力的引导回归：总理必须能被引导出来。
//
// 真机曾经卡在这里：cordis 服务代理在不同调用点给出的是不同的包装对象，补丁用
// WeakMap 记「createBot 真身」时，ensurePrime 拿到的 svc 与补丁拿到的不是同一个对象，
// 取不到真身 → 退回去调用被「只有总理能建 Bot」守卫包住的 createBot → 引导永远失败，
// 控制台一直显示「团队还没就绪」。
//
// 这个测试用一个每次都返回新包装的假服务复现那个形状，断言：
//   1) 引导能建出总理并建好公司大群（不能依赖 WeakMap 的对象身份）；
//   2) 守卫依然拦得住没有内部授权的直接 createBot（不能为了引导把门拆了）。
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { register } from '../host/capabilities/org/index.js';

const crashes = [];
const orgState = { primeBotId: null, companyRoomId: null, ranks: {}, domains: {} };
const patches = [];
const patchedProxies = new WeakSet();
const ticks = [];
let svc = null;

const rt = {
  state(name) {
    return {
      load() { return name === 'org' ? { ...orgState, ranks: { ...orgState.ranks }, domains: { ...orgState.domains } } : null; },
      save(value) { if (name === 'org') Object.assign(orgState, value); },
    };
  },
  stateFile(name) { return path.join(os.tmpdir(), `dsh-org-boot-${process.pid}`, name); },
  crash(kind, error) { crashes.push({ kind, message: String((error && error.message) || error) }); },
  log() { },
  communityPatch(fn) { patches.push(fn); },
  community() {
    if (!svc) return null;
    // 关键：cordis 的 ctx.agentCommunity 每次访问都包一层新的 traceable 代理
    // （cordis createTraceable），方法在读取时绑定到同一个底层服务、Symbol 属性
    // 直接转发到底层。补丁按代理对象去重，所以每个新代理都会再打一次补丁。
    const target = svc;
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        if (typeof prop === 'symbol') return Reflect.get(t, prop, receiver);
        const value = Reflect.get(t, prop, receiver);
        return typeof value === 'function' ? value.bind(t) : value;
      },
      set(t, prop, value, receiver) { return Reflect.set(t, prop, value, receiver); },
    });
    if (!patchedProxies.has(proxy)) {
      patchedProxies.add(proxy);
      for (const fn of patches) fn(proxy);
    }
    return proxy;
  },
  defaultModel() { return { provider: 'deepseek-account', model: 'deepseek-flash' }; },
  interval(ms, fn) {
    ticks.push(fn);
    return () => { const at = ticks.indexOf(fn); if (at >= 0) ticks.splice(at, 1); };
  },
  provide() { },
  emit() { },
  caller() { return null; },
  tools: { add() { } },
};

// 底层服务：createBot 是它自己的实现；补丁会替换它
const bots = [];
const rooms = [];
const service = {
  listBots: () => bots,
  listRooms: () => rooms,
  async createBot(input) {
    const bot = { id: 'bot-' + (bots.length + 1), ...input };
    bots.push(bot);
    return bot;
  },
  async spawnBot() { return { ok: false, error: 'not used' }; },
  async deleteBot() { return { ok: true }; },
  async createRoom(input) {
    const room = { id: 'room-' + (rooms.length + 1), ...input };
    rooms.push(room);
    return room;
  },
  async inviteBot() { return { ok: true }; },
};

// 1) 服务晚于插件挂载才出现（真实启动顺序）：挂载时引导只能放弃
register(rt);
await new Promise((r) => setTimeout(r, 20));
assert.equal(orgState.primeBotId, null, '服务未就绪时不应写出总理');
assert.equal(crashes.length, 0, '服务未就绪时应静默等待，而不是崩溃');

// 2) 服务出现；先由别的调用点看到服务（补丁打在代理 A 上），再让 60s 重试 tick 引导。
//    引导这时拿到的是代理 B——老代码的 WeakMap 在这里取不到 createBot 真身，
//    于是退回调到守卫包装上，总理永远建不出来。
svc = service;
rt.community();
assert.equal(ticks.length, 1, '应有且只有一个引导重试定时器');
ticks[0]();
await new Promise((r) => setTimeout(r, 50));

const primeCrashes = crashes.filter((c) => c.kind === 'prime' || c.kind === 'prime-skip');
assert.deepEqual(primeCrashes, [], '引导总理不应崩溃：' + primeCrashes.map((c) => c.message).join(' | '));
assert.equal(bots.length, 1, '应创建出唯一的总理 Bot');
assert.equal(bots[0].name, '总理', '创建的是总理');
assert.equal(bots[0].provider, 'deepseek-account', '模型跟随 profile 默认');
assert.ok(orgState.primeBotId, '总理 id 应写进 org 账');
assert.equal(orgState.primeBotId, bots[0].id, '写进账的是刚建的总理');

assert.equal(rooms.length, 1, '应创建公司大群');
assert.equal(rooms[0].name, '公司大群', '群名是公司大群');
assert.deepEqual(rooms[0].memberIds, [bots[0].id], '群里先只有总理');
assert.equal(orgState.companyRoomId, rooms[0].id, '群 id 应写进 org 账');

// 3) 守卫仍在：没有内部授权的外部 createBot 必须被拦住
let blocked = null;
try {
  await service.createBot({ name: '偷偷加的' });
} catch (e) {
  blocked = e;
}
assert.ok(blocked, '无授权的 createBot 必须被守卫拦住');
assert.match(String(blocked.message), /只有「总理」可以新建 Bot/, '拒绝话术要能指引调用方');
assert.equal(bots.length, 1, '被拦下的创建不能落库');

console.log('PASS  服务晚到也能引导出总理（不依赖代理对象身份）');
console.log('PASS  总理 id / 公司大群写进 org 账');
console.log('PASS  守卫仍拦住无授权的 createBot');
console.log('\n组织引导 3 项回归全部通过');
