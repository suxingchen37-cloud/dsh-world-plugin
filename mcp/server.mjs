// dsh-local-computer —— MCP stdio 服务端（通用壳）。
//
// 这里没有具体业务：启动时按能力注册表的同一套规则（复用 host/index.js 的
// loadCapabilities）发现声明了 mcp 面的能力，聚合它们的 tools，把 tools/call
// 路由给属主。以后加一个 mcp 能力 = 加一个目录，这个文件零改动。
//
// 协议层（换行分隔的 JSON-RPC 2.0 over stdio）与 dsh 的 MCP 客户端保持兼容。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCapabilities } from '../host/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---- 发现 mcp 面的能力 ------------------------------------------------------
const CAPS = [];
const ROUTE = new Map();          // tool name -> { capability, call }
for (const cap of loadCapabilities(path.join(ROOT, 'host', 'capabilities'))) {
  if (!cap.manifest.surfaces.includes('mcp')) continue;
  try {
    const mod = await import(pathToFileURL(path.join(cap.dir, 'mcp.mjs')).href);
    if (typeof mod.call !== 'function' || !Array.isArray(mod.tools)) {
      process.stderr.write(`[dsh-local-computer] ${cap.manifest.name}: mcp.mjs 必须导出 tools 数组与 call(name,args)，已跳过\n`);
      continue;
    }
    CAPS.push({ name: cap.manifest.name, tools: mod.tools });
    for (const t of mod.tools) {
      if (ROUTE.has(t.name)) {
        process.stderr.write(`[dsh-local-computer] 工具重名 ${t.name}：${ROUTE.get(t.name).capability} 优先，${cap.manifest.name} 的被忽略\n`);
        continue;
      }
      ROUTE.set(t.name, { capability: cap.manifest.name, call: mod.call, spec: t });
    }
  } catch (e) {
    // 故障隔离与宿主侧一致：一个 mcp 能力坏掉只禁用它自己
    process.stderr.write(`[dsh-local-computer] ${cap.manifest.name} 加载失败：${String(e && e.message || e)}\n`);
  }
}
const TOOLS = [...ROUTE.values()].map(r => r.spec);

let version = '0.0.0';
try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? version; } catch { }

// ---- MCP stdio 传输：换行分隔的 JSON-RPC 2.0 --------------------------------
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  if (msg.id === undefined) return;                      // 通知不需要回复
  const p = msg.params ?? {};
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, {
        protocolVersion: p.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dsh-local-computer', version, title: '本机执行（能力化后端）' },
        instructions: '本机执行能力：所有动作先过授权闸门。遇到 permission_pending 就把 approvalId 交给用户，用户在对话里表态后用 computer_respond 记录结论，再带 id 重试。',
      });
    case 'tools/list':
      return reply(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const owner = ROUTE.get(p.name);
      if (!owner) return replyErr(msg.id, -32602, 'unknown tool');
      try {
        const r = await owner.call(p.name, p.arguments ?? {});
        return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }], isError: !!r.error || r.status === 'refused' });
      } catch (e) {
        return reply(msg.id, { content: [{ type: 'text', text: 'tool failed: ' + (e?.message ?? String(e)) }], isError: true });
      }
    }
    case 'ping': return reply(msg.id, {});
    default: return replyErr(msg.id, -32601, 'method not found: ' + msg.method);
  }
}
process.stderr.write(`[dsh-local-computer] mcp stdio up v${version}; capabilities=[${CAPS.map(c => c.name).join(',')}] tools=[${TOOLS.map(t => t.name).join(',')}] state=${process.env.DSH_LOCAL_COMPUTER_STATE || path.join(ROOT, 'state')}\n`);
