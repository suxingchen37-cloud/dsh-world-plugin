// 本机执行的宿主注册面：把 engine 的 9 个 computer_* 工具注册进 ctx.tools，
// 让聊天内的助手与团队 Bot 直接可用。同一份实现也经 mcp.mjs 面向外部 MCP 客户端
// （可选）——这是对远端 "drop the absolute paths" 决策的吸收：不再有写死本机路径的
// MCP 子进程块，换台机器插件照样能装。
import { tools, call } from './engine.mjs';

export function register(rt) {
  for (const t of tools) {
    rt.tools.add({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      async execute(args) {
        return call(t.name, args ?? {});
      },
    });
  }
  return {};
}
