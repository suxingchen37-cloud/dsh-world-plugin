# CAPABILITY-SPEC —— 能力开发规范（写给维护本插件的 AI 与人）

> 本插件（包名 `dsh-local-computer`）的后端是**能力注册表**架构：
> `host/index.js` 只负责装配，一切业务都在 `host/capabilities/<名字>/` 里。
> **加一个能力 = 复制模板改一个目录；删一个能力 = 删目录。宿主与 MCP 壳零改动。**

## 1. 目录契约

```
host/capabilities/<name>/
├── manifest.json     # 必需。能力名片：注册表和 AI 都从这里认识它
├── index.js          # surfaces 含 "host" 时必需。导出 register(rt)
└── mcp.mjs           # surfaces 含 "mcp" 时必需。导出 tools 数组 + call(name, args)
```

- `<name>` 必须与 `manifest.json` 里的 `name` 完全一致，否则整个目录被跳过（记 crash.log）。
- 下划线开头的目录（如 `_template`）是脚手架，注册表自动跳过。
- 缺 manifest、manifest 解析失败、surfaces 缺失：跳过该目录，不影响其他能力。

### manifest.json 字段

```jsonc
{
  "name": "org",                    // = 目录名
  "title": "组织",                  // 人看的名字
  "version": "1.0.0",
  "description": "一句话说清做什么、给谁用",
  "surfaces": ["host"],             // "host" = 深聊内的 Bot 工具；"mcp" = MCP stdio 工具；可同时声明
  "requires": ["agentCommunity"],   // 需要的服务（现只有 agentCommunity）
  "state": ["org.json"],            // 本能力独占的状态文件（state/ 目录下）
  "migrates": ["computer.json"],    // 可选：一次性迁移的数据来源（迁移逻辑须留底、只跑一次）
  "tools": [                        // 信息性清单：人/AI 不读代码就能知道它提供什么
    { "name": "org_roster", "summary": "查全公司名册" }
  ]
}
```

`tools` 是**声明清单**，真正的 schema 在代码里；两处必须保持一致（`node test/test_registry.mjs` 会校验）。

## 2. register(rt) 契约

```js
export function register(rt) {
  // …注册工具、定时器、事件挂钩…
  return { dispose() { /* 可选：释放 rt 之外的资源 */ } };
}
```

- `register` 抛错 → **只禁用本能力**，crash.log 记一行，其他能力照常挂载（故障隔离）。
- 返回值可省略；`dispose` 会在宿主卸载时被调用。

### runtime API 全表

| API | 作用 |
|---|---|
| `rt.state(name)` | 本能力的状态库 → `{ file, load(), save(obj) }`。原子写（tmp+rename）；损坏文件自动改名为 `.corrupt-<时间戳>` 隔离并留 crash 证据，`load()` 返回 null。**只能开自己 manifest 里 `state` 声明的文件。** |
| `rt.stateFile(name)` | state 目录下某文件的绝对路径（brain 等自带格式化器的能力用它 + 自己的 load/save） |
| `rt.tools.add(spec)` | 注册一个 Bot 工具。spec：`{ name, description, parameters, async execute(args, exec) }`；输出自动包成 JSON 文本。schema 必须是**真实 JSON Schema 类型**（`type: "json"` 会被 dsh 拒绝——曾让五条工具同时注册失败） |
| `rt.caller(exec)` | 解析 agent-community 会话 id → `{ roomId, botId }`；团队外调用返回 null。所有"只有团队内 Bot 能用"的工具先查这个 |
| `rt.community()` | 拿 agentCommunity 服务（listBots/createRoom/postTeamMessage/queueRoomRun/controlRun/…）。服务未加载返回 null，**必须判空** |
| `rt.communityPatch(fn)` | 包装/守卫 agentCommunity 的方法（如 org 的"只有总理能建 Bot"）。幂等，WeakSet 保证不会重复包 |
| `rt.on(event, fn)` / `rt.emit(event, payload)` | 事件总线（无返回值）。现有事件：`team-ledger`（org → brain：任命等团队流水） |
| `rt.provide(event, fn)` / `await rt.request(event, payload)` | 询问总线（有返回值，第一个提供者说了算）。现有询问：`rank-of`(botId) → 等级、`prime-id` → 总理 id。**request 可能返回 undefined（对方能力缺席），调用方必须 fail-closed 兜底** |
| `rt.interval(ms, fn)` | 定时器（已 unref，fn 抛错自动记 crash 不杀进程），宿主 dispose 时统一清理 |
| `rt.defaultModel()` | profile 的 `agent-default-model`（provider/model/reasoningEffort）或 null。新建 Bot 必须填模型，否则它永远跑不起来 |
| `rt.log(level, ...)` / `rt.crash(kind, err)` | 日志走宿主 logger；crash 追加 state/crash.log（自动裁剪到 512KB） |

## 3. 三条铁律

1. **只动自己的状态。** 能力之间不共享状态文件、不互相 import。要协作：`rt.on/emit`
   （通知）、`rt.provide/request`（询问）、或把共享逻辑下沉进 `host/runtime.js`。
2. **工具 schema 用真实 JSON Schema 类型**（string/number/boolean/object/array/null），
   `required` 写全，`additionalProperties: false`。
3. **任何异步路径都不许把异常抛进宿主。** 工具 execute 内部 try/catch 并返回
   `{ ok: false, error }`；runtime 的定时器与钩子已自带兜底。

## 4. 加一个能力（5 步）

1. `cp -r host/capabilities/_template host/capabilities/<新名字>`
2. 改 `manifest.json`：name=目录名、title/description、surfaces、state、tools 清单
3. 改 `index.js`：把示例工具换成真实现（需要 MCP 就加 `mcp.mjs`）
4. `node test/test_registry.mjs` —— manifest 校验、重名检查、工具清单一致性必须全绿
5. `node test/test_state.mjs` —— 若新增了状态文件，为它补一个原子写/损坏隔离用例

## 5. 删一个能力（2 步）

1. 删掉 `host/capabilities/<名字>/` 整个目录（状态文件 `state/<name>.json` 保留在盘上，
   除非用户明确要清）
2. `node test/test_registry.mjs` —— 别的能力不受影响即完成

## 6. 升级一个能力

- 改行为：直接改该目录内代码，**不改** `host/index.js` / `mcp/server.mjs` / 其他能力。
- 改状态结构：在 `register` 开头做就地迁移（读旧结构 → 写新结构 → 覆盖前留
  `.bak` 或在 manifest 的 `migrates` 里声明来源）；迁移必须幂等（跑两遍无害）。
- 改完跑全部测试：`node test/test_brain.mjs && node test/test_consent.mjs && node test/test_registry.mjs && node test/test_state.mjs && node mcp/test_client.mjs`。

## 7. 测试要求

- 新能力至少有一个 `test_<能力名>.mjs`：register 能挂载、工具能执行、dispose 能清理。
- 纯逻辑（打分、冲突分类、渲染）放进 `<能力>/rules.mjs` 这类独立模块，测试直接 import，
  不需要起宿主。
- 涉及状态文件的，加进 `test/test_state.mjs` 的原子写/损坏隔离用例。

## 8. console 面（前端如何回归）

前端以 **console 能力**（`host/capabilities/console/`）的形式存在：register 里起一个
只绑 127.0.0.1 的 HTTP 服务，静态页在 `console/web/`（原生 HTML/CSS/JS，无构建链）。

- **facade 例外（全插件唯一）**：console 允许调用兄弟能力的**公开接口**
  （如 `import { call } from '../computer/engine.mjs'`），并对其状态文件**只读**；
  其他能力之间仍然互相禁止。想给自己的能力加页面面板：在 manifest 的 `tools` 外
  提供公开导出，或发事件到 runtime 总线，console 来订阅。
- **安全基线**：只绑 loopback；POST 校验 Origin（跨站浏览器的 POST 必带 Origin，
  名单外一律 403）；写操作只经 computer 的公开接口，`resolvedBy` 落 `'user'`，
  审计上永远与 agent 自答可区分。
- 本地看效果：`node test/preview.mjs`（mock 社区 + 种子审批票），开它打印的地址。
  接入真实 DSH 时走 `install.mjs`，控制台随插件挂载自动起服务。
