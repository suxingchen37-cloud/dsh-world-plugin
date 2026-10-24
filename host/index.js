// dsh-local-computer —— 宿主入口（cordis 插件契约）。
//
// 这个文件只做一件事：装配 runtime，扫描 host/capabilities/，把声明了 host 面的能力
// 逐个 register 进来，退出时统一 dispose。它不包含任何具体业务——加能力、删能力都
// 不需要改这个文件（规范见 docs/CAPABILITY-SPEC.md）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRuntime, writeMountLog, crash } from './runtime.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPS_DIR = path.join(HERE, 'capabilities');
const BUILD = '2026-10-25.1';

export const name = 'dsh-local-computer';
// Cordis 对每个 `ctx.<service>` 读取都按这份声明解析：未声明的读取直接抛
// `cannot get property "x" without inject`。agentCommunity 与 tools 是能力的两根拐杖，
// 声明在这里，能力代码永远不需要知道 cordis 的这些细节。
export const inject = ['agentCommunity', 'tools'];

/**
 * 扫描能力目录。独立导出以便测试：注册表是纯数据（manifest 校验），不碰 ctx。
 * 返回 [{ dirName, dir, manifest }]，顺序按目录名稳定排序。
 * 跳过：_template（脚手架）、没有 manifest.json 的目录、manifest 解析失败的目录
 * （解析失败记 crash.log，绝不中断整个扫描）。
 */
export function loadCapabilities(capsDir = CAPS_DIR) {
  let names = [];
  try { names = fs.readdirSync(capsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch (e) { crash('caps-scan', e); return []; }
  const found = [];
  for (const dirName of names.sort()) {
    if (dirName.startsWith('_')) continue;          // _template 等脚手架
    const dir = path.join(capsDir, dirName);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
    catch (e) { crash('caps-manifest', new Error(`${dirName}: ${String(e && e.message || e)}`)); continue; }
    if (manifest?.name !== dirName) {
      crash('caps-manifest', new Error(`${dirName}: manifest.name (${manifest?.name}) 与目录名不一致，已跳过`));
      continue;
    }
    if (!Array.isArray(manifest.surfaces) || !manifest.surfaces.length) {
      crash('caps-manifest', new Error(`${dirName}: manifest.surfaces 缺失，已跳过`));
      continue;
    }
    found.push({ dirName, dir, manifest });
  }
  return found;
}

// capsDir 仅测试用：验证故障隔离时指向临时目录。cordis 只传 ctx。
export function apply(ctx, capsDir = CAPS_DIR) {
  const rt = createRuntime(ctx);
  const capDisposers = [];
  let disposed = false;

  // 能力是动态发现的（注册表模式的价值就在这里），加载是异步的；apply 必须同步返回
  // 清理函数，所以清理函数要能追上"还没加载完"的情况——disposed 标志让迟到的注册
  // 直接放弃，泄漏的 interval/tool 由 runtime 自身的 dispose 兜底。
  (async () => {
    const caps = loadCapabilities(capsDir);
    const hostCaps = caps.filter(c => c.manifest.surfaces.includes('host'));
    for (const cap of hostCaps) {
      if (disposed) return;
      try {
        // Windows 上动态 import 一个带空格/中文的绝对路径必须走 file:// URL，裸路径会炸。
        const mod = await import(pathToFileURL(path.join(cap.dir, 'index.js')).href);
        if (disposed) return;
        const res = typeof mod.register === 'function' ? await mod.register(rt) : null;
        if (res && typeof res.dispose === 'function') capDisposers.push(res.dispose);
        rt.log('info', `local-computer: capability mounted: ${cap.manifest.name} (${(cap.manifest.tools ?? []).length} tools)`);
      } catch (e) {
        // 故障隔离：一个能力坏掉只禁用它自己，其他能力照常挂载
        crash('capability:' + cap.manifest.name, e);
        rt.log('error', `local-computer: capability ${cap.manifest.name} failed to mount: ${String(e && e.message || e)}`);
      }
    }
    if (!disposed) {
      writeMountLog(`apply() mounted pid=${process.pid} build=${BUILD}`
        + ` capabilities=${hostCaps.map(c => c.manifest.name).join(',') || 'none'}`);
    }
  })().catch(e => crash('caps-load', e));

  return () => {
    disposed = true;
    for (const d of capDisposers) { try { d?.(); } catch { } }
    capDisposers.length = 0;
    rt.dispose();
  };
}
