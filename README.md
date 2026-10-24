# dsh-world-plugin（包名 `dsh-local-computer`）

DeepSeek Harness 的**能力化后端**：组织（总理/公司大群/等级制）、笔记本记忆、
本机执行与授权闸门。能力以目录为单位注册——**加/删能力不改任何宿主代码**，
规范见 [docs/CAPABILITY-SPEC.md](docs/CAPABILITY-SPEC.md)。

> 仓库名 `dsh-world-plugin` 与包名 `dsh-local-computer` 不一致是历史原因；
> **安装、bundle patch、local-plugins 目录用的都是包名 `dsh-local-computer`**。

## 依赖（必须先装）

```
dsh-plugin-agent-collaboration  →  提供 ctx.agentCommunity（Bot 名册、房间、run）
  └─ @dsh-plugin-agent-community/{agent-community,ui-agent-community,tool-agent-community}
```

本插件 `inject: ['agentCommunity', 'tools']`。没有这个服务，名册/房间/派活不可用；
org/brain 的工具会优雅降级（工具报"团队服务还没就绪"），computer（MCP）不受影响。

## 结构

| 路径 | 作用 |
|---|---|
| `host/index.js` | 宿主入口（cordis 契约）：装配 runtime → 扫描 `host/capabilities/` → 逐个 register → 统一 dispose。无业务 |
| `host/runtime.js` | 共享设施：crash/log（模块级，根治旧版 `writeCrash is not defined`）、原子状态库（损坏自动隔离）、agentCommunity 访问器+patch、工具注册、事件/询问总线 |
| `host/capabilities/org/` | 能力：组织。总理引导、公司大群、等级制、`apply_new_bot` + 5 个 `org_*` 工具；服务层守卫"只有总理能建 Bot" |
| `host/capabilities/brain/` | 能力：笔记本。5 个 `brain_*` 工具、规则注入 bot 系统提示、Obsidian 镜像（粗定时器，一天三遍）；纯逻辑在 `rules.mjs` |
| `host/capabilities/computer/` | 能力：本机执行。审批队列/授权闸门/daemon 调度（`engine.mjs` + `gate.mjs`），经 `mcp.mjs` 暴露为 9 个 `computer_*` MCP 工具 |
| `host/capabilities/console/` | 能力：控制台（前端回归第一版）。loopback HTTP（默认 47941）+ 原生网页：能力总览、名册、笔记本、审批与审计；对兄弟能力只读，写只走公开接口（facade 例外见 SPEC §8） |
| `host/capabilities/_template/` | 新能力脚手架（注册表自动跳过） |
| `mcp/server.mjs` | MCP stdio 通用壳：按 manifest 动态聚合 mcp 面能力，协议层与 dsh 客户端兼容 |
| `core/daemon.mjs` | 执行守护进程契约（保留原实现，语义不变） |
| `docs/CAPABILITY-SPEC.md` | **能力开发规范：加能力 5 步 / 删能力 2 步 / runtime API 全表** |
| `attic/` | 已退役的「共振」前端留档（将来重做前端时的加载契约参考） |
| `install.mjs` | 安装：两枚 junction + 把 MCP 块写进 profile 的 cordis.patch.yml |

## 安装

```powershell
# 1) 依赖
dsh plugin --profile desktop add dsh-plugin-agent-collaboration

# 2) 本体：建两枚 junction，并把 MCP 块写进 profile 的 cordis.patch.yml
node install.mjs
```

重启请用界面右下角的**重启按钮**（不要强杀主进程，会弹「应用已停止」的假崩溃框）。

## 数据

- 每能力独立状态（`state/` 下）：`org.json`（总理/大群/等级）、`brain.json`（笔记本）、
  `computer.json`（执行账本：票据/权限/审计）
- 旧版把组织字段混在 `computer.json` 里；首次挂载自动迁移到 `org.json`
  （原文件留 `.pre-org-migration` 底）
- 票据完成 7 天后自动清理，audit/账本各有 500 行上限，crash.log 有 512KB 上限
- **默认全自动**（产品主人 2026-10-25 决策）：run-command / write-file / read-file /
  list-directory 四个动作免审批直接执行，总闸（autonomy）默认开，审计照记
  （approvedBy=standing）。想回到逐条审批：把 `state/computer.json` 的 `permissions`
  清空即可，闸门与票据流程原样保留
- `computer_*` 九个工具直接在宿主进程内注册（无写死路径的 MCP 子进程块，换机可装）；
  外部 MCP 客户端仍可用 `mcp/server.mjs`（`install.mjs --with-mcp` 写入 profile）

## 测试

```powershell
node test/test_brain.mjs       # 8 项：三时间/召回/冲突/退役/融合/隔离/镜像/降级
node test/test_consent.mjs     # 5 项：fail-closed/伪造票据/常驻授权/一次性/复现
node test/test_registry.mjs    # 6 项：manifest 契约/工具一致性/故障隔离/重名（新）
node test/test_state.mjs       # 6 项：原子写/损坏隔离/票据清理/迁移/单次有效（新）
node mcp/test_client.mjs       # 9 项：握手/清单/闸门/审批闭环/围栏/autonomy 冻结
node test/live.mjs             # 冒烟：宿主 11 工具 + MCP 9 工具 + 完整审批闭环
node test/preview.mjs          # 控制台预览（mock 数据），开它打印的地址
node test/test_obsidian.mjs    # 需要真实 agent-community 状态，没有则 SKIP
```

所有路径都从 `import.meta.url` 解析，换机器不需要改代码。

## 还没验证

- 真机上跑 `install.mjs` 并重启 DeepSeek（本机暂未装 DSH 主程序；安装脚本已适配新结构）。
- 审批流在真实对话里的表现（agent 向用户要授权的措辞是否自然）。
