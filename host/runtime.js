// dsh-local-computer —— 共享运行时设施。
//
// 每个能力都从这里拿基础设施，能力之间禁止互相 import（见 docs/CAPABILITY-SPEC.md）。
// 这里只放"任何能力都可能需要"的东西：崩溃日志、原子状态库、agentCommunity 访问器、
// 工具注册包装、调用者解析、默认模型探测。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const STATE_DIR = process.env.DSH_LOCAL_COMPUTER_STATE || path.join(ROOT, 'state');

// ---- 崩溃与日志 -------------------------------------------------------------
// 模块级，任何地方（包括定时器回调）都能安全调用。旧版把 writeCrash 定义在 apply() 里，
// 模块级的 mirrorBrainNow 定时器够不着它，crash.log 里那条反复出现的
// "ReferenceError: writeCrash is not defined" 就是这么来的——这里是它的根治处。
const CRASH_LOG = path.join(STATE_DIR, 'crash.log');
const CRASH_LOG_CAP = 512 * 1024;

export function crash(kind, err) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    try {
      const st = fs.statSync(CRASH_LOG);
      // 只裁剪自己：日志满了就留后半段，绝不让一行崩溃记录把文件写成无底的
      if (st.size > CRASH_LOG_CAP) {
        const keep = fs.readFileSync(CRASH_LOG, 'utf8').slice(-CRASH_LOG_CAP / 2);
        fs.writeFileSync(CRASH_LOG, keep);
      }
    } catch { }
    fs.appendFileSync(CRASH_LOG, JSON.stringify({
      at: new Date().toISOString(), kind,
      message: String((err && err.message) || err),
      stack: String((err && err.stack) || '').split('\n').slice(0, 14),
    }) + '\n');
  } catch { }
}

// 这个插件寄宿在 dsh 主进程里，它观察到的任何东西都不许把 dsh 带走：
// 挂上监听器后 Node 会取消 uncaughtException 的致命默认行为，进程得以存活。
let processHooksMounted = false;
export function mountProcessHooks() {
  if (processHooksMounted) return;
  processHooksMounted = true;
  try {
    process.on('uncaughtExceptionMonitor', (err) => crash('uncaught', err));
    process.on('unhandledRejection', (err) => crash('unhandledRejection', err));
  } catch { }
}

// ---- 原子状态库 -------------------------------------------------------------
// 每个能力自己的 JSON 文件（state/<name>.json）。tmp + rename 保证读者永远看不到半个文件；
// 损坏的文件移进 .corrupt-* 隔离并留证据，绝不静默当空文件覆盖回去。
function quarantine(file, err) {
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  const bad = file + '.corrupt-' + at;
  try { fs.renameSync(file, bad); } catch { }
  crash('corrupt-state', new Error(`${file}: ${String((err && err.message) || err)} (moved to ${bad})`));
}

export function store(name, { dir = STATE_DIR } = {}) {
  const file = path.join(dir, name.endsWith('.json') ? name : name + '.json');
  return {
    file,
    load() {
      let raw;
      try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
      try { return JSON.parse(raw); } catch (e) { quarantine(file, e); return null; }
    },
    save(obj) {
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { }
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, file);
      return obj;
    },
  };
}

// ---- 工具注册 ---------------------------------------------------------------
// schema.type 必须是真实 JSON Schema type（'json' 不是，dsh 的工具注册表会拒绝——
// 这曾经让每次挂载都崩掉五条 org_* 注册，见旧 crash.log kind=tool-register）。
const JSON_OUT = { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

// 解析 agent-community 会话 id（ac:<room>:<bot>）为调用者身份；解析不出就不是团队内 Bot。
export function parseCaller(exec) {
  const m = /^ac:([^:]+):([^:]+)(?::g\d+)?$/.exec(String(exec?.agent?.session?.id || ''));
  return m ? { roomId: m[1], botId: m[2] } : null;
}

// ---- 默认模型探测 -----------------------------------------------------------
// agent-community 原样复制 provider/model，缺了它们的新 Bot 永远跑不起来。
// profile 的 agent-default-model 是唯一声明了默认意图的地方，所以优先读它。
export function profileDefaultModel() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profiles = path.join(home, 'profiles');
  let names = [];
  try { names = fs.readdirSync(profiles); } catch { }
  for (const name of names) {
    let lines;
    try { lines = fs.readFileSync(path.join(profiles, name, 'cordis.patch.yml'), 'utf8').split(/\r?\n/); }
    catch { continue; }
    const start = lines.findIndex(l => /^\s*-\s*id:\s*agent-default-model\s*(#.*)?$/.test(l));
    if (start < 0) continue;
    const out = {};
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*-\s*id:/.test(lines[i])) break;
      const m = /^\s*(provider|model|reasoningEffort):\s*['"]?([^'"\s#]+)['"]?/.exec(lines[i]);
      if (m) out[m[1]] = m[2];
    }
    if (out.provider && out.model) return { ...out, profile: name, source: 'profile' };
  }
  return null;
}

// ---- 运行时装配 -------------------------------------------------------------
// apply(ctx) 调一次；返回的 rt 传给每个能力的 register(rt)。
export function createRuntime(ctx) {
  mountProcessHooks();
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { }

  const intervals = [];
  const toolDisposers = [];
  const communityPatches = [];
  const patchedServices = new WeakSet();
  const hooks = new Map();

  const rt = {
    stateDir: STATE_DIR,
    crash,
    state: store,
    stateFile: (name) => path.join(STATE_DIR, name.endsWith('.json') ? name : name + '.json'),

    log(level, ...args) {
      try {
        const l = typeof ctx?.get === 'function' ? ctx.get('logger') : ctx?.logger;
        if (l && typeof l[level] === 'function') l[level](...args);
      } catch { }
    },

    // agent-community 服务访问器。声明的 inject 让 ctx.agentCommunity 可读；ctx.get 与
    // catch 兜底保证服务被改名/扣发时宿主照样活着。communityPatch 注册的包装
    // （如 org 的总理守卫）在这里统一施加，WeakSet 保证幂等。
    community() {
      let svc = null;
      try { if (ctx && ctx.agentCommunity) svc = ctx.agentCommunity; } catch { }
      if (!svc) {
        try { svc = typeof ctx?.get === 'function' ? ctx.get('agentCommunity') : null; } catch { svc = null; }
      }
      if (!svc) return null;
      if (!patchedServices.has(svc)) {
        patchedServices.add(svc);
        for (const fn of communityPatches) {
          try { fn(svc); } catch (e) { crash('community-patch', e); }
        }
      }
      return svc;
    },
    communityPatch(fn) { communityPatches.push(fn); },

    tools: {
      add(spec) {
        try {
          toolDisposers.push(ctx?.tools?.register({ ...spec, output: JSON_OUT }));
        } catch (e) { crash('tool-register', e); }
      },
    },

    caller: parseCaller,
    defaultModel: profileDefaultModel,

    // 能力间解耦的唯一通道：不共享状态、不互相 import，只发事件。
    // 例如 org 任命后 emit('team-ledger', row)，brain 挂钩把它记进团队账本。
    on(event, fn) {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event).push(fn);
    },
    emit(event, payload) {
      for (const fn of hooks.get(event) ?? []) {
        try { fn(payload); } catch (e) { crash('hook:' + event, e); }
      }
    },
    // 有返回值的询问（如 brain 问 org「这个 bot 什么等级」）：第一个提供者说了算；
    // 没人提供时返回 undefined，调用方必须自带 fail-closed 兜底。
    provide(event, fn) {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event).push(fn);
    },
    async request(event, payload) {
      const fn = (hooks.get(event) ?? [])[0];
      if (!fn) return undefined;
      try { return await fn(payload); } catch (e) { crash('hook:' + event, e); return undefined; }
    },

    // 粗粒度唤醒（已 unref，不拦进程退出）；返回停止函数。
    interval(ms, fn) {
      const t = setInterval(() => {
        try { fn(); } catch (e) { crash('interval', e); }
      }, ms);
      try { t.unref?.(); } catch { }
      intervals.push(t);
      return () => { try { clearInterval(t); } catch { } };
    },

    _toolDisposers: toolDisposers,
    dispose() {
      for (const stop of intervals) { try { stop(); } catch { } }
      intervals.length = 0;
      for (const d of toolDisposers) { try { d?.(); } catch { } }
      toolDisposers.length = 0;
    },
  };
  return rt;
}

// 挂载证据：客户端半区不在时（前端已移除，将来以新能力回归），这行日志是
// "host 侧真的挂载了" 的唯一可信信号（与旧 dsh-ui-tidy 同一手法）。
export function writeMountLog(line) {
  try {
    fs.appendFileSync(path.join(STATE_DIR, 'host-apply.log'),
      `${new Date().toISOString()} ${line}\n`);
  } catch { }
}
