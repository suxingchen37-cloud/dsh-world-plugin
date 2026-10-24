# attic —— 已退役的「共振」前端留档

2026-10-25 后端能力化重构时移出。**前端已从插件中移除，将来会以新能力的形式回归**；
这里的东西只是参考，不参与加载、不被打包。

## 将来重做前端时必须知道的契约（血泪换来的，别再踩一遍）

1. **加载方式**：宿主把 client bundle 当**普通脚本**求值，不是 ESM。文件里绝不能出现
   `export` / `import` 语句（`attic/test_loader.mjs` 就是防回归的检查，曾因 ESM 导致
   "web boot: 1 entry did not activate" 全页起不来）。
2. **自注册**：bundle 末尾调 `window.__ModuleLoader__.load({ id, factory })`，
   `factory(require)` 返回 `{ inject, apply }`。
3. **inject 声明**：客户端侧必须声明 `inject: ['slots', ...]`，否则 cordis 直接抛
   `cannot get property without inject`。
4. **接缝**：`slots.inject('sidebar.panellist', ...)` 挂侧栏入口，
   `slots.register({ id: 'world', label }, Component)` + main 槽接管整屏。
5. **宿主半区的接缝在服务端**：前端通过 loopback HTTP（旧实现在 git 历史的 lib/index.js，
   commit fadcb55 附近）拿数据。新架构下，前端回归时应新增一个 `console/` 能力目录
   （manifest 声明自己的 surfaces 与 state，register 里起自己的 loopback 服务），
   数据接口按需从能力里查询，**不要**恢复旧的单体 endpoint。
6. **防御性**：`apply(ctx)` 必须吞掉一切宿主侧异常（`attic/test_loader.mjs` 第 5-6 节的
   hostile/broken ctx 检查）——这个模块永远不能成为 web boot 失败的原因。

## 文件清单

| 文件 | 原用途 |
|---|---|
| `client.js` | 「共振」整屏页（3171 行，React 19） |
| `test_loader.mjs` | client bundle 的加载契约（5 项检查，全部仍有参考价值） |
| `test_motion.mjs` | 动效与 reduced-motion 契约（CSS 内嵌在 client.js） |
| `render-fixture.mjs` / `test_render_full.mjs` / `test_swarm.mjs` | 页面渲染回归（fixture*.html 是道具） |
| `test_ui.mjs` / `test_wire.mjs` | 旧宿主 loopback endpoint 的单元与接缝测试 |
| `fixture*.html` / `*.out.txt` | 渲染道具与输出快照 |
