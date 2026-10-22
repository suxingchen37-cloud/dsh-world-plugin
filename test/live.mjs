// Dev-only live harness (NOT part of the shipped plugin).
//
// It runs the two real halves of the plugin — lib/index.js (loopback UI endpoint) and
// mcp/server.mjs (the agent-facing MCP stdio server) — and mounts the real lib/client.js in a
// browser with real React, so the 共振 page can be exercised end to end:
//   agent asks for a local action -> MCP tool blocks -> 待审批 appears live -> you click 允许一次
//   -> the blocked tool call resumes and executes on this machine -> 执行记录 shows the exit code.
//
//   node test/live.mjs            # then open the printed URL
//   curl 'http://127.0.0.1:8783/agent/shell?command=node&args=-e&args=console.log(1)'
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('D:/111/dsh-local-computer');
const NM = path.join(ROOT, 'node_modules');
const STATE = path.join(ROOT, 'state', 'live');
const PORT = Number(process.env.DSH_LOCAL_COMPUTER_DEV_PORT || 8783);

fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(STATE, { recursive: true });
process.env.DSH_LOCAL_COMPUTER_STATE = STATE;
// the dev harness must never occupy the port the real client needs
process.env.DSH_LOCAL_COMPUTER_PORT = process.env.DSH_LOCAL_COMPUTER_PORT || '47900';
process.env.DSH_LOCAL_COMPUTER_ROOT = STATE;

// ---- 1) the real host half ------------------------------------------------
// Opt-in mock community: a self-contained fixture state + a service resolved through ctx.get,
// so a send can be exercised end to end without touching the user's real agent-community state.
let mockSvc = null;
let applyTool = null;
if (process.env.DSH_LIVE_MOCK_COMMUNITY === '1') {
  const file = path.join(STATE, 'community.json');
  const now = () => new Date().toISOString();
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({
    bots: [{ id: 'b1', name: '验收员', description: '回归测试用 bot', avatar: { seed: '🧪' }, provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high', permission: 'read-only', mentionOnly: false, workspace: 'C:/tmp/mock', profile: { profileId: 'bot-mock', memoryNamespace: 'bot-mock' }, systemPrompt: '你是回归测试机器人。' }],
    rooms: [{ id: 'r1', name: '回归测试群', memberIds: ['b1'], connection: { kind: 'group' }, sequence: 1, updatedAt: now(), taskState: { assignments: [] } }],
    messages: [{ id: 'm0', roomId: 'r1', sender: { kind: 'bot', botId: 'b1', name: '验收员' }, text: '机器人已就绪', mentions: [], createdAt: now() }],
    runs: [{
      id: 'run1', botId: 'b1', roomId: 'r1', origin: 'user', prompt: '回归任务', status: 'running',
      startedAt: now(), controlRevision: 1, leaseOwner: 'mock',
      leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
    }], roomReadAt: {},
  }, null, 2));
  process.env.DSH_AGENT_COMMUNITY_STATE = file;
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (s) => fs.writeFileSync(file, JSON.stringify(s, null, 2));
  mockSvc = {
    listBots: () => read().bots.map(b => ({ id: b.id, name: b.name, provider: b.provider, model: b.model })),
    listRooms: () => read().rooms,
    async postTeamMessage(arg) {
      const s = read();
      const msg = { id: 'm-' + Date.now(), roomId: arg.roomId, sender: arg.sender, text: arg.text,
        mentions: (arg.targetNames ?? []).map(n => '@' + n), createdAt: now(),
        sequence: (s.messages ?? []).filter(m => m.roomId === arg.roomId).length };
      s.messages.push(msg);
      write(s);
      return { message: msg };
    },
    queueRoomRun(roomId, botId, prompt, origin) {
      const s = read();
      const run = { id: 'run-' + Date.now(), botId, roomId, sessionId: 'ac:' + roomId + ':' + botId,
        origin, prompt, status: 'queued', controlRevision: 0, createdAt: now() };
      s.runs.push(run);
      write(s);
      return run;
    },
    executor: { nudge() { } },
    async inviteBot(arg) {
      const s = read();
      const r = s.rooms.find(x => x.id === arg.roomId);
      if (r && !(r.memberIds ?? []).includes(arg.botId)) { r.memberIds = [...(r.memberIds ?? []), arg.botId]; write(s); }
      return { ok: true };
    },
    // one live question, in the same in-memory places the real service keeps them
    ledger: { byRoom: new Map([['r1', [{ type: 'question', questionId: 'q1', botName: '验收员', question: '要继续生成大纲吗？', options: ['继续', '先停'], allowFreeText: true, status: 'pending', at: now() }]]]) },
    questionBridge: { pending: new Map([['q1', {}]]) },
    async answerBotQuestion(arg) {
      mockSvc.questionBridge.pending.delete(arg.questionId);
      const row = mockSvc.ledger.byRoom.get('r1')?.find(e => e.questionId === arg.questionId);
      if (row) row.status = arg.skip ? 'skipped' : 'answered';
      return { ok: true };
    },
    async createBot(arg) {
      const s = read();
      const id = 'b-' + Date.now();
      s.bots.push({
        id, name: arg.name, description: arg.description ?? '', avatar: { seed: arg.avatarSeed || '🤖' },
        provider: arg.provider, model: arg.model, reasoningEffort: arg.reasoningEffort,
        permission: arg.permission, mentionOnly: !!arg.mentionOnly, workspace: 'C:/tmp/mock/' + id,
        profile: { profileId: 'bot-' + arg.name, memoryNamespace: 'bot-' + arg.name }, systemPrompt: arg.systemPrompt ?? '',
      });
      write(s);
      return { id };
    },
    async createRoom(arg) {
      const s = read();
      const id = 'r-' + Date.now();
      s.rooms.push({
        id, name: arg.name, directBotId: arg.directBotId, memberIds: arg.memberIds ?? [],
        connection: 'disconnected', sequence: 0, updatedAt: now(), taskState: { assignments: [] },
      });
      write(s);
      return { id };
    },
    async deleteRoom(arg) {
      const s = read();
      const id = arg?.id ?? arg?.roomId;
      s.rooms = s.rooms.filter(r => r.id !== id);
      s.messages = s.messages.filter(m => m.roomId !== id);
      write(s);
      return { ok: true };
    },
    async clearMessages(roomId) {
      const s = read();
      s.messages = s.messages.filter(m => m.roomId !== roomId);
      write(s);
      return { ok: true };
    },
    async updateBot(arg) {
      const s = read();
      const b = s.bots.find(x => x.id === arg.id);
      if (!b) return { ok: false };
      Object.assign(b, {
        name: arg.name ?? b.name, description: arg.description ?? b.description,
        systemPrompt: arg.systemPrompt ?? b.systemPrompt, mentionOnly: arg.mentionOnly ?? b.mentionOnly,
        permission: arg.permission ?? b.permission, avatar: { seed: arg.avatarSeed ?? b.avatar?.seed },
      });
      write(s);
      return b;
    },
    async deleteBot(arg) {
      const s = read();
      s.bots = s.bots.filter(b => b.id !== arg.id);
      s.rooms = s.rooms.filter(r => r.directBotId !== arg.id).map(r => ({ ...r, memberIds: (r.memberIds ?? []).filter(id => id !== arg.id) }));
      write(s);
      return { ok: true };
    },
    async controlRun(arg) {
      const s = read();
      const r = s.runs.find(x => x.id === arg.id);
      if (r) {
        if (arg.action === 'cancel') { r.status = 'cancelled'; r.finishedAt = now(); r.leaseOwner = undefined; }
        if (arg.action === 'steer') r.steer = arg.text;
        r.controlRevision = (r.controlRevision ?? 0) + 1;
      }
      write(s);
      return { ok: true };
    },
    async retryRun(arg) {
      const s = read();
      const r = s.runs.find(x => x.id === arg.id);
      if (r) { r.status = 'queued'; r.finishedAt = undefined; r.controlRevision = (r.controlRevision ?? 0) + 1; }
      write(s);
      return { ok: true };
    },
    async markRoomRead(arg) {
      const s = read();
      const last = s.messages.filter(m => m.roomId === arg.roomId).slice(-1)[0];
      s.roomReadAt = { ...(s.roomReadAt ?? {}), [arg.roomId]: last?.createdAt ?? now() };
      write(s);
      return { roomId: arg.roomId, cleared: true };
    },
    async sendMessage(arg) {
      const s = read();
      s.messages.push({ id: 'm-' + Date.now(), roomId: arg.roomId, sender: { kind: 'user', name: 'user' }, text: arg.text, mentions: [], createdAt: now() });
      write(s);
      setTimeout(() => {
        try {
          const t = read();
          t.messages.push({ id: 'm-' + (Date.now() + 1), roomId: arg.roomId, sender: { kind: 'bot', botId: 'b1', name: '验收员' }, text: '收到：' + arg.text, mentions: [], createdAt: now() });
          write(t);
        } catch { }
      }, 350);
      return { id: 'mock' };
    },
  };
}
const { apply } = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);
const stop = apply({
  logger: { info: (...a) => console.log('[host]', ...a) },
  get: (name) => (name === 'agentCommunity' ? mockSvc ?? undefined : undefined),
  tools: { register(definition) { applyTool = definition; return () => { }; } },
});
let ep = null;
for (let i = 0; i < 60 && !ep; i++) {
  if (fs.existsSync(path.join(STATE, 'ui-endpoint.json'))) ep = JSON.parse(fs.readFileSync(path.join(STATE, 'ui-endpoint.json'), 'utf8'));
  else await new Promise(r => setTimeout(r, 50));
}
if (!ep) throw new Error('host never published an endpoint');
console.log('host endpoint:', ep.url);

// ---- 2) the real MCP half (the agent's tools) ------------------------------
const mcp = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.mjs')], {
  cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, DSH_LOCAL_COMPUTER_STATE: STATE, DSH_LOCAL_COMPUTER_ROOT: STATE },
});
mcp.stderr.on('data', d => console.log('[mcp!]', String(d).trim()));
let buf = '';
const pending = new Map();
mcp.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const w = pending.get(msg.id);
    if (w) { pending.delete(msg.id); w(msg); }
  }
});
let mid = 0;
const rpc = (method, params) => new Promise((res, rej) => {
  const id = ++mid;
  pending.set(id, msg => (msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)));
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live-harness', version: '1' } });
console.log('mcp tools:', (await rpc('tools/list', {})).tools.map(t => t.name).join(', '));

// ---- 3) a tiny static server that can run the plugin's real ESM client ----
const CJS = [
  ['react', 'react/cjs/react.development.js'],
  ['scheduler', 'scheduler/cjs/scheduler.development.js'],
  ['react-dom', 'react-dom/cjs/react-dom.development.js'],
  ['react-dom/client', 'react-dom/cjs/react-dom-client.development.js'],
];

const BOOT = `
window.__cjs = { reg: {}, def(k, fn) { this.reg[k] = fn; }, req(k) {
  if (this.cache && this.cache[k]) return this.cache[k];
  const fn = this.reg[k];
  if (!fn) throw new Error('no such module in the dev loader: ' + k);
  const mod = { exports: {} };
  this.cache = this.cache || {};
  this.cache[k] = mod.exports;
  fn(mod, mod.exports, (r) => this.req(r), { env: { NODE_ENV: 'development' }, platform: 'browser', nextTick: (f) => queueMicrotask(f) });
  this.cache[k] = mod.exports;
  return mod.exports;
} };
`;

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>共振 · live</title>
<script>${BOOT}</script>
${CJS.map(([k, f]) => `<script src="/vendor/${f}"></script>`).join('\n')}
<script>window.__DSH_REACT__ = window.__cjs.req('react');</script>
<script type="importmap">
{ "imports": {
  "react": "/esm/react.js",
  "react-dom": "/esm/react-dom.js",
  "react-dom/client": "/esm/react-dom-client.js"
} }
</script>
<style>html,body,#root{height:100%;margin:0}body{background:#f2f2f4}</style>
</head><body><div id="root"></div>
<script src="/lib/client.js"></script>
<script type="module">
import { createRoot } from 'react-dom/client';
// loaded exactly the way the host loads it: a classic script that publishes its API on window
const API = window.__DSH_LOCAL_COMPUTER__;
const root = document.getElementById('root');
if (!API) { root.textContent = 'client bundle did not publish its API'; }
else {
  // only inject when asked: the default path is exactly what the real client walks —
  // well-known port + origin trust, with no configuration handed to the page
  if (location.search.includes('inject')) window.__LOCAL_COMPUTER__ = ${JSON.stringify(ep)};
  createRoot(root).render(window.__cjs.req('react').createElement(API.WorldPage));
}
</script></body></html>`;

const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, body, type) => { res.writeHead(code, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); };

  if (u.pathname === '/' || u.pathname === '/index.html') return send(200, html, MIME['.html']);
  if (u.pathname === '/lib/client.js') return send(200, fs.readFileSync(path.join(ROOT, 'lib/client.js')), MIME['.js']);

  const v = u.pathname.match(/^\/vendor\/(.+)$/);
  if (v) {
    const key = CJS.find(c => c[1] === v[1])?.[0];
    if (!key) return send(404, 'unknown vendor module');
    const src = fs.readFileSync(path.join(NM, v[1]), 'utf8');
    return send(200, `window.__cjs.def(${JSON.stringify(key)}, function (module, exports, require, process) {\n${src}\n});`, MIME['.js']);
  }
  const e = u.pathname.match(/^\/esm\/(.+)\.js$/);
  if (e) {
    const key = { react: 'react', 'react-dom': 'react-dom', 'react-dom-client': 'react-dom/client' }[e[1]];
    if (!key) return send(404, 'nope');
    // re-export the CJS namespace as a real ESM module so `import * as React from 'react'` works
    const names = ESM_NAMES[key] ?? [];
    return send(200, `const __m = window.__cjs.req(${JSON.stringify(key)});\n${names.map(n => `export const ${n} = __m[${JSON.stringify(n)}];`).join('\n')}\nexport default __m;`, MIME['.js']);
  }

  // ---- the agent side: these routes stand in for the model's tool calls ----
  if (u.pathname === '/agent/shell') {
    const command = u.searchParams.get('command') || process.execPath;
    const args = u.searchParams.getAll('args');
    const approvalId = u.searchParams.get('approvalId') || undefined;
    const t0 = Date.now();
    try {
      // the MCP handler wraps its payload once more: result.result.content
      const r = await rpc('tools/call', { name: 'computer_shell', arguments: { command, args, ...(approvalId ? { approvalId } : {}) } });
      const txt = JSON.parse(r.result.content[0].text);
      return send(200, JSON.stringify({ waitedMs: Date.now() - t0, ...txt }, null, 2), 'application/json');
    } catch (err) { return send(500, String(err && err.message || err)); }
  }
  if (u.pathname === '/agent/apply') {
    if (!applyTool) return send(500, 'apply_new_bot is not registered');
    const out = await applyTool.execute({
      name: u.searchParams.get('name') || '数据助理',
      need: u.searchParams.get('need') || '整理 CSV 数据',
      why: u.searchParams.get('why') || '现有成员都不会数据清洗',
      description: u.searchParams.get('description') || '负责表格清洗',
    }, { agent: { session: { id: 'ac:r1:b1' } } });
    return send(200, JSON.stringify(out, null, 2), 'application/json');
  }
  if (u.pathname === '/agent/read') {
    const r = await rpc('tools/call', { name: 'computer_read_file', arguments: { path: u.searchParams.get('path') || 'package.json' } });
    return send(200, r.result.content[0].text, 'application/json');
  }
  if (u.pathname === '/agent/state') return send(200, fs.readFileSync(path.join(STATE, 'computer.json'), 'utf8'), 'application/json');
  return send(404, 'not found');
});

// the named exports the plugin's client actually touches, re-exported from the CJS build
const ESM_NAMES = {
  react: ['createElement', 'cloneElement', 'createContext', 'forwardRef', 'memo', 'Component', 'PureComponent',
    'Fragment', 'StrictMode', 'isValidElement', 'Children', 'useCallback', 'useContext', 'useEffect', 'useId',
    'useImperativeHandle', 'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState', 'useSyncExternalStore',
    'useTransition', 'startTransition', 'version'],
  'react-dom/client': ['createRoot', 'hydrateRoot'],
  'react-dom': ['createPortal', 'flushSync', 'version'],
};

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n世界 live:  http://127.0.0.1:${PORT}/`);
  console.log(`让 agent 发起一次本机执行:  curl "http://127.0.0.1:${PORT}/agent/shell?command=node&args=-e&args=console.log('hi%20from%20your%20machine')"\n`);
});

const bye = () => { try { server.close(); stop(); mcp.kill(); } catch { } process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
