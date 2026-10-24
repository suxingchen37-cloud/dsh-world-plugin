// 能力：控制台 —— 本机网页控制台（前端以能力形式回归的第一版）。
//
// 定位：所有能力的只读展示面 + 本机执行的审批面。两条边界写死在这里：
//   1) 对兄弟能力：状态只读（org.json / brain.json / community 状态文件 / computer.json），
//      写操作只走其公开接口（engine.call('computer_respond') 与 engine.setAutonomy）。
//      这是全插件唯一的 facade 例外，规范见 docs/CAPABILITY-SPEC.md §8。
//   2) 只绑 127.0.0.1；POST 校验 Origin（浏览器跨站 POST 必带 Origin，拒掉就是拒掉了
//      CSRF；无 Origin = 本机进程，本来就能读盘，不是要防的对象）。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCapabilities } from '../../index.js';
// facade 例外（全插件唯一）：console 调用 computer 能力的公开接口，不碰它的内部实现。
import { call as computerCall, setAutonomy } from '../computer/engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, 'web');
const COMMUNITY_FILE = process.env.DSH_AGENT_COMMUNITY_STATE
  || path.join(os.homedir(), '.dsh', 'agent-community', 'state.json');

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const tailLines = (file, n) => {
  try { return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n); } catch { return []; }
};

export function register(rt) {
  // 挂载痕迹：端口与时间写进自己的状态文件，"控制台在哪个端口"从盘上可答
  try { rt.state('console').save({ startedAt: new Date().toISOString(), pid: process.pid }); } catch { }

  const server = http.createServer((req, res) => {
    try { route(req, res); } catch (e) {
      rt.crash('console-http', e);
      try { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"internal"}'); } catch { }
    }
  });
  server.unref();

  const PORT_BASE = Number(process.env.DSH_LOCAL_COMPUTER_CONSOLE_PORT || 47941);
  let bound = null;
  const listenAt = (i) => {
    if (i >= 5) {
      server.listen(0, '127.0.0.1', () => announce('随机端口'));
      return;
    }
    server.once('error', (e) => {
      if (e && e.code === 'EADDRINUSE') listenAt(i + 1);
      else rt.crash('console-listen', e);
    });
    server.listen(PORT_BASE + i, '127.0.0.1', () => announce(String(PORT_BASE + i)));
  };
  const announce = (port) => {
    bound = Number(port);
    rt.log('info', `local-computer: console up on http://127.0.0.1:${bound}`);
    try {
      fs.writeFileSync(path.join(HERE, 'web', '.port'), String(bound));
    } catch { }
  };
  listenAt(0);

  // ---- 路由 -----------------------------------------------------------------
  function route(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    // 浏览器跨站 POST 必带 Origin：在名单外的一律 403（防 CSRF）。
    // 无 Origin = curl/本机进程；它本就能读这台机器的盘，不是这条边界要防的对象。
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'cross-origin posts are refused' }));
      }
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': req.headers.origin ?? '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      return res.end();
    }

    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      let body;
      try { body = fs.readFileSync(path.join(WEB_DIR, file)); } catch { return send(res, 404, { error: 'asset missing' }); }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(body);
    }

    if (req.method === 'GET' && url.pathname === '/api/panel') return void send(res, 200, panel());
    if (req.method === 'POST' && url.pathname === '/api/send') {
      // 用户消息进房间。走 agent-community 的服务（真产品路径），绝不直接写它的状态文件。
      return void withBody(req, res, async (j) => {
        const text = String(j.text ?? '').trim();
        if (!j.roomId || !text) return send(res, 400, { error: '需要 roomId 和 text' });
        const svc = rt.community();
        if (!svc || typeof svc.sendMessage !== 'function') return send(res, 503, { error: 'agent-community 服务未加载，聊天不可用' });
        await svc.sendMessage({ roomId: j.roomId, text: text.slice(0, 4000), sender: { kind: 'user', name: '我' } });
        return send(res, 200, { ok: true });
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/answer') {
      // 回答 Bot 的问题（选项或自由文本，或跳过）
      return void withBody(req, res, async (j) => {
        const svc = rt.community();
        if (!svc || typeof svc.answerBotQuestion !== 'function') return send(res, 503, { error: 'agent-community 服务未加载' });
        const arg = { questionId: j.questionId };
        if (j.skip) arg.skip = true; else arg.value = String(j.value ?? '');
        await svc.answerBotQuestion(arg);
        return send(res, 200, { ok: true });
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/approve') {
      // 团队工具审批：approveBotToolCall 是服务上唯一的位置参数方法 (callId, outcome)
      return void withBody(req, res, async (j) => {
        const svc = rt.community();
        if (!svc || typeof svc.approveBotToolCall !== 'function') return send(res, 503, { error: 'agent-community 服务未加载' });
        const outcome = /reject|deny|no/i.test(String(j.outcome ?? '')) ? 'rejected' : 'allowed-once';
        svc.approveBotToolCall(j.callId, outcome);
        return send(res, 200, { ok: true, outcome });
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/remember') {
      // 用户的"记住"：私聊 → 收进该 Bot 的本子；群聊 → 收进团队那本。
      // 实际收割逻辑在 brain 能力（rt.request 通道），这里只负责把话送对地方。
      return void withBody(req, res, async (j) => {
        const text = String(j.text ?? '').trim();
        if (!j.roomId) return send(res, 400, { error: '需要 roomId' });
        if (!text && j.action !== 'retire') return send(res, 400, { error: '要记的内容是空的' });
        const communityRaw = readJson(COMMUNITY_FILE) ?? {};
        const room = (communityRaw.rooms ?? []).find(r => r.id === j.roomId);
        let scope = 'team', botId, botName = '团队';
        if (room?.directBotId) {
          const bot = (communityRaw.bots ?? []).find(b => b.id === room.directBotId);
          scope = 'bot';
          botId = room.directBotId;
          botName = bot?.name ?? '';
        } else {
          botId = (await rt.request('prime-id')) ?? 'user';
        }
        const out = await rt.request('remember', {
          text, scope, botId, botName,
          action: j.action, entryId: j.entryId, reason: j.reason,
        });
        return send(res, 200, out ?? { ok: false, error: 'brain 能力未挂载' });
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/respond') {
      return void withBody(req, res, (j) => {
        if (!j.approvalId || !['allow-once', 'always', 'deny'].includes(j.verdict)) {
          return send(res, 400, { error: '需要 approvalId 和 verdict(allow-once/always/deny)' });
        }
        // 人在页面上的表态是"人"这一侧的结论：与 agent 自答写同一份账本，但 resolvedBy
        // 不同——审计上永远分得清是谁批的。读一次、改一次、写一次。
        const file = rt.stateFile('computer.json');
        const t = readJson(file);
        const item = (t?.pending ?? []).find(p => p.approvalId === j.approvalId);
        if (!item) return send(res, 404, { error: 'unknown approvalId' });
        item.resolved = j.verdict;
        item.resolvedAt = new Date().toISOString();
        item.resolvedBy = 'user';
        if (j.verdict === 'allow-once') item.granted = true;
        if (j.verdict === 'always') t.permissions = { ...(t.permissions ?? {}), [item.action]: 'always' };
        t.audit = [...(t.audit ?? []), { at: item.resolvedAt, kind: 'responded', action: item.action, approvalId: item.approvalId, verdict: j.verdict, approvedBy: 'user', resolvedBy: 'user' }].slice(-500);
        fs.writeFileSync(file, JSON.stringify(t, null, 2));
        return send(res, 200, { ok: true, verdict: j.verdict });
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/autonomy') {
      return void withBody(req, res, (j) => {
        if (typeof j.autonomy !== 'boolean') return send(res, 400, { error: 'autonomy 必须是布尔' });
        return send(res, 200, setAutonomy(j.autonomy));
      });
    }
    return send(res, 404, { error: 'no such endpoint' });
  }

  // ---- 面板聚合（对兄弟能力一律只读）---------------------------------------
  function panel() {
    const org = readJson(rt.stateFile('org.json')) ?? {};
    const brain = readJson(rt.stateFile('brain.json')) ?? { entries: [], ledger: [] };
    const computer = readJson(rt.stateFile('computer.json')) ?? {};
    const communityRaw = readJson(COMMUNITY_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const rooms = communityRaw?.rooms ?? [];
    const svc = rt.community();

    // Bot 的问题与工具审批：服务把它们记在内存账本（不落 state.json），只在还有
    // 活着的 resolver 等待时展示——服务内部结构变了就显示为空，绝不报错。
    const approvals = [];
    const questions = [];
    if (svc) {
      try {
        const byRoom = svc.ledger?.byRoom;
        if (byRoom && typeof byRoom.forEach === 'function') {
          byRoom.forEach((rows, roomId) => {
            for (const e of rows ?? []) {
              if (e.type === 'approval' && e.outcome == null) {
                const raw = typeof e.args === 'string' ? e.args : (() => { try { return JSON.stringify(e.args ?? ''); } catch { return ''; } })();
                approvals.push({
                  id: e.callId ?? e.id, roomId, memberName: e.botName ?? '', toolName: e.toolName ?? '',
                  reason: raw.slice(0, 300),
                  risk: /write|delete|remove|unlink|rename|move|patch|apply|exec|shell|bash|cover|overwrite/i.test(e.toolName + ' ' + raw)
                    ? 'irreversible' : 'reversible',
                  createdAt: e.at ?? '',
                });
              }
              if (e.type === 'question' && e.status === 'pending') {
                questions.push({
                  id: e.questionId ?? e.id, roomId, memberName: e.botName ?? '',
                  question: e.question ?? '', options: Array.isArray(e.options) ? e.options : [],
                  allowFreeText: e.allowFreeText !== false, createdAt: e.at ?? '',
                });
              }
            }
          });
        }
        const pend = svc.approvalBridge?.pending;
        if (pend && typeof pend.keys === 'function') {
          const live = new Set([...pend.keys()]);
          for (let i = approvals.length - 1; i >= 0; i--) if (!live.has(approvals[i].id)) approvals.splice(i, 1);
        }
        const qpend = svc.questionBridge?.pending;
        if (qpend && typeof qpend.keys === 'function') {
          const live = new Set([...qpend.keys()]);
          for (let i = questions.length - 1; i >= 0; i--) if (!live.has(questions[i].id)) questions.splice(i, 1);
        }
      } catch { }
    }

    return {
      now: new Date().toISOString(),
      capabilities: loadCapabilities().map(c => ({
        name: c.manifest.name, title: c.manifest.title, description: c.manifest.description,
        version: c.manifest.version, surfaces: c.manifest.surfaces,
        state: c.manifest.state, tools: c.manifest.tools ?? [],
      })),
      org: {
        primeBotId: org.primeBotId ?? null,
        companyRoomId: org.companyRoomId ?? null,
        ranks: org.ranks ?? {},
        domains: org.domains ?? {},
      },
      community: communityRaw ? {
        available: true,
        demoMode: !!communityRaw.meta?.demoMode,
        bots: (communityRaw.bots ?? []).map(b => ({
          id: b.id, name: b.name, description: b.description ?? '', avatar: b.avatar?.seed ?? '🤖',
          model: `${b.provider ?? '?'}/${b.model ?? '?'}`, mentionOnly: !!b.mentionOnly,
        })),
        rooms: rooms.map(r => ({
          id: r.id, name: r.name, memberIds: r.memberIds ?? [], directBotId: r.directBotId ?? null,
          objective: r.taskState?.objective ?? null, isGroup: !r.directBotId,
        })),
        messages: (communityRaw.messages ?? []).slice(-60).map(m => ({
          id: m.id, roomId: m.roomId, roomName: rooms.find(r => r.id === m.roomId)?.name ?? '',
          sender: m.sender?.name ?? m.sender?.kind ?? '?', senderKind: m.sender?.kind ?? 'bot',
          botId: m.sender?.botId ?? null, text: m.text ?? '', at: m.createdAt ?? '',
          kind: m.kind ?? null, durationMs: m.durationMs ?? null,
        })),
        runs: (communityRaw.runs ?? []).slice(-40).map(r => ({
          id: r.id, botId: r.botId, roomId: r.roomId, status: r.status ?? null,
          startedAt: r.startedAt ?? null, finishedAt: r.finishedAt ?? null,
          running: ['queued', 'claimed', 'running', 'summarizing'].includes(String(r.status || '').toLowerCase()) && !r.finishedAt,
        })),
        approvals, questions,
      } : { available: false, reason: 'agent-community 状态文件不存在（本插件不创建它）', file: COMMUNITY_FILE },
      brain: {
        entries: (brain.entries ?? [])
          .filter(e => e.status !== 'retired' && !(e.expiresAt && String(e.expiresAt) < today))
          .slice(-40).reverse(),
        ledger: (brain.ledger ?? []).slice(-30).reverse(),
      },
      computer: {
        autonomy: computer.autonomy === true,
        sandbox: computer.sandbox ?? null,
        permissions: computer.permissions ?? {},
        pending: (computer.pending ?? []).filter(p => !p.resolved && !p.consumed && !p.granted),
        audit: (computer.audit ?? []).slice(-20).reverse(),
      },
      diag: {
        mount: tailLines(path.join(rt.stateDir, 'host-apply.log'), 3),
        crashes: tailLines(path.join(rt.stateDir, 'crash.log'), 5).map(l => { try { return JSON.parse(l); } catch { return l; } }),
      },
    };
  }

  const send = (res, code, obj) => {
    let body;
    try { body = JSON.stringify(obj); } catch { return send(res, 500, { error: 'unserialisable' }); }
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  const withBody = (req, res, fn) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      try { fn(j); } catch (e) { rt.crash('console-post', e); send(res, 500, { error: 'internal' }); }
    });
  };

  return {
    dispose() {
      try { server.close(); server.closeAllConnections?.(); } catch { }
      try { fs.rmSync(path.join(WEB_DIR, '.port'), { force: true }); } catch { }
    },
  };
}
