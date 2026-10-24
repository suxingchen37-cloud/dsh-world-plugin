// MCP 面的适配文件：能力注册表（mcp/server.mjs）按 manifest 发现 mcp 面能力后
// 载入这个文件，拿 tools 与 call。实现全部在 ./engine.mjs —— 这里永远只是一层皮。
export { tools, call } from './engine.mjs';
