// 能力模板 —— 加新能力时复制整个 _template 目录，改名，然后改这个文件。
// 完整规范与"加/删能力"的操作步骤见 docs/CAPABILITY-SPEC.md。
//
// 契约速记：
//   - manifest.json 的 name 必须等于目录名；_template 与缺 manifest 的目录会被注册表跳过。
//   - index.js 导出 register(rt)，返回值可以是 { dispose }（可选）。
//   - register 抛错只禁用本能力并记 crash.log，其他能力照常挂载。
export function register(rt) {
  // 自己的状态：state/<name>.json，原子写、损坏自动隔离。别的能力的状态文件不许碰。
  const myStore = rt.state('my-capability');

  rt.tools.add({
    name: 'example_hello',
    description: '示例工具：返回一句问候。schema 必须是合法 JSON Schema（type 只能是 string/number/boolean/object/array/null 这类真实类型，写 "json" 会被 dsh 拒绝）。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        who: { type: 'string', description: '跟谁打招呼' },
      },
      required: [],
    },
    async execute(args, exec) {
      const c = rt.caller(exec); // ac:<room>:<bot> 会话里的调用者；团队外是 null
      const count = (myStore.load()?.hellos ?? 0) + 1;
      myStore.save({ hellos: count, lastWho: args.who ?? null });
      return { ok: true, hello: `你好，${args.who || '世界'}（第 ${count} 次）`, caller: c };
    },
  });

  // 需要定时器：rt.interval(ms, fn)，已 unref，宿主 dispose 时统一清掉。
  // 需要发消息/建 Bot：rt.community() 拿 agentCommunity 服务，方法列表见 org 能力。
  // 需要和其他能力协作：rt.on/emit（事件）与 rt.provide/request（询问），不要 import 它们。
  return {
    dispose() {
      // 可选：清掉 rt 之外的资源（自建的服务器、子进程等）
    },
  };
}
