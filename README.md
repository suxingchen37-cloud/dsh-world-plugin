# dsh-local-computer · 共振

给 DeepSeek Harness 的一个插件，两件事：

1. 把 **bot 团队**搬进一个叫「共振」的整页界面：名册、等级、群聊、私聊、任务卡、执行记录、每 bot 的外置大脑（Obsidian）、笔记本（带三个时间的规则）。
2. 给 agent 一套**受闸门约束的本机执行**工具（跑命令、读写文件、列目录），每一次都先挂起等你批准。

模型不在插件里配置：所有 bot 跟随 profile 里的 `agent-default-model`（当前实测是 DeepSeek 账号 / deepseek-flash）。

## 需要什么

- DeepSeek Harness `>= 0.4`（`engines.dsh`）
- Node.js `>= 22.19`（MCP 那半边是个 stdio 子进程）
- profile 里要有出厂的 `agent-community` 插件（本插件的页面读它的状态、调它的服务）

## 安装

官方安装器（推荐）：

```
plugin_manager action=install_bundle target="<这个目录的绝对路径>"
```

它会把这个包按 `link:` 依赖加进 profile、登记 `dsh.profile.bundles`，并做兼容性检查。

手工方式（不改 profile 的 package.json）：把本目录 junction 到
`~/.dsh/profiles/desktop/node_modules/dsh-local-computer`，本包自带 `dsh.bundle.patch`，宿主会自己挂载。

装完**重启一次客户端**：宿主是主进程加载的，只刷新页面不会换宿主。

## 第一次启动会发生什么

- 页面读取 `~/.dsh/agent-community/state.json`（**只读**，绝不写它）。
- 自动创建两个东西：一个叫「总理」的 bot（不可删除、唯一能新建 bot 的角色），一个叫「公司大群」的群（全员在内，总理当 leader）。
- 插件自己的状态写在 `state/`（审批票据、长期允许、笔记本、审计）；`state/ui-endpoint.json` 里有一次性的访问 token，**不要提交、不要外传**。

## 安全边界

- 本机执行是 **fail-closed**：没有本地签发的票据，命令一律不跑；票据一次性，用过即废；越出授权根目录直接拒绝。
- 「自主运行」开关决定 **agent 能不能自己批自己的工单**。开着 = 它能自批；关掉 = 每条都停下来问你。
- 页面写操作需要一次性 nonce（30 秒、用完即废）+ 可信来源，跨站页面既拿不到 CORS 头也拿不到 nonce。

## 已知限制（诚实清单）

- **`cordis.patch.yml` 里的 MCP 那一行还是本机绝对路径**（node 解释器、server.mjs、cwd）。换一台机器要改这三行，否则「本机执行」起不来；其余功能不受影响。
- 页面靠固定端口段 `47831–47835` 找宿主（`/health` 是唯一免 token 的探活路由）。这段端口全被占时宿主会退到随机端口，页面就找不到它。
- 「项目空间」这一层还没有后端，页面里是按房间名临时归类；「能力索引」里"由任务换模型"做不到，全部固定 DeepSeek。
- 单机、单用户。没有多账号、没有远端同步。

## 开发

```
node test/test_brain.mjs      # 笔记本：三个时间 / 检索 / 冲突 / 永不删
node test/test_wire.mjs       # 页面与宿主之间的契约（可跑 19 项）
node test/test_swarm.mjs      # 团队面板与动作接线
node test/test_ui.mjs         # 入口 + 整页渲染
node test/test_loader.mjs     # 宿主真实加载姿势（这条最要命）
node mcp/test_client.mjs      # MCP stdio 握手 + 授权流程
node test/live.mjs            # 本地调试页：http://127.0.0.1:8783/
```

调试页起在 8783，宿主占 47900，**绝不要占 47831 段**——那是真客户端的端口。

## 许可

MIT
