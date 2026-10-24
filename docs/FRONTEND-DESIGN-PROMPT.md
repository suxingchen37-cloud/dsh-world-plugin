# 「共振」前端设计提示词

> 用法：把下面整段（从「你是…」开始到结尾）复制给任何一个 AI（设计 AI / 编码 AI 皆可）。
> 它包含了产品定义、能力清单、真实数据契约与设计任务，AI 无需再看本仓库其他文件即可开工。

---

你是资深的 AI 产品设计师兼前端工程师，中文是你的第一工作语言。你要为下面这个真实产品
设计（并实现）一套全新的前端界面。先读懂产品与能力，再设计；界面必须能接上文档末尾的
真实数据接口，不许发明不存在的数据。

## 一、产品是什么

「共振」是 DeepSeek 桌面端（DSH）里的一款 **AI 员工团队**产品，对标 Grok Bot：
用户不是"用一个聊天框调模型"，而是**像管理一支团队一样与一群具名 Bot 协作**——
每个 Bot 有名字、头像、人设、模型、等级与职责；它们在一个"公司大群"里办公，
也能和用户 1:1 私聊；干活时用户看得见（运行状态、耗时），干危险的事要先经用户审批；
每个 Bot 有自己的长期记忆（笔记本），规矩不会被遗忘，也不会被悄悄覆盖。
产品运行在本机（localhost 网页），深色优先、跟随系统浅色，全中文界面。

## 二、产品的四块能力（界面必须把它们表达出来）

### 1. 组织（org）——团队即产品
- 等级制：**总理 > 管方向 > 小官 > 组长**；总理由系统自动创建、受保护、唯一能新建 Bot；
  任命/调整等级只归总理。
- **公司大群**：全员在群里办公，总理任 leader，新 Bot 自动进群；群有目标（objective）。
- 群聊路由：**@谁谁答**；不点名则由 leader 回应。
- 增员流程：Bot 干活时发现缺帮手，会发「增员申请」到公司大群 @总理；总理批准后
  新建 Bot 并公告——这些公告以**系统卡片**形式出现在聊天流里（任命公告、增员申请、规则冲突裁定）。
- 名册数据：每个 Bot 的名字、头像、等级、负责范围（domain）、模型、是否"仅@时说话"。

### 2. 笔记本（brain）——会积累的记忆
- 每个 Bot 一本，另有一本**团队共享**（只有总理能写）。
- 三时间：**写下 / 关于哪天 / 何时过期**；过期的自动不再是现行事实。
- 立规矩前自动查冲突：重复要融合、数字对不上要取代、**偏好冲突必须问用户**；
  任何改动不删除，只"下线进归档"，并记一条账本（谁、何时、为什么）。
- 现行规则会自动注入 Bot 的系统提示——所以 Bot "记得住"。
- 对前端的含义：需要一个可读的记忆视图（现行条目 + 改动账本），并且它随聊天实时增长。

### 3. 本机执行（computer）——看得见、管得住的动手能力
- Bot/助手可以在**这台真机器上**执行命令、读写文件（限定在沙箱目录内）。
- **授权闸门**：默认每件事都要审批。流程 = 工具调用被拦下 → 产生一张**待审批票**
  （动作名 + 参数，如 `run-command: node -e …`）→ 用户表态（**允许一次 / 总是允许 / 拒绝**）
  → 放行执行，结果（退出码、耗时、输出截断）写进**审计账本**。
- "总是允许"按**动作**记录为常驻授权，粒度到动作级别（允许了写文件不代表能跑命令）。
- **自主执行开关（autonomy）**：关闭 = 整体冻结，agent 连自己的票都不能答；这是产品的总闸。
- 每笔审批都记录**是谁批的**（人 or agent 自答）——审计上永远可区分。

### 4. 控制台（console）——你正在设计的这一层
- 本机网页，是以上全部能力的产品化界面。当前版本已实现：房间列表 + 聊天流 +
  提问卡 + 审批横幅 + 名册；你可以**推翻重设计**，但必须保留数据契约（见下）。

## 三、必须覆盖的界面与状态（设计任务清单）

1. **房间与导航**：左栏房间列表（群聊 + 私聊），未读数气泡，最后一条消息预览；
   Bot 名册（头像、等级徽章、"干活中"状态）。
2. **聊天流**：用户气泡（右侧）与 Bot 气泡（左侧，带头像/名字/模型徽章/回复耗时）；
   系统卡片（任命/增员/冲突）；时间与日期分组的处理方式。
3. **实时感**：Bot 处理中显示"××正在处理…"（来自运行中的 run）；消息 2 秒轮询到达，
   未读提醒不打断阅读。
4. **提问卡**：Bot 在聊天流里向用户提问（选项按钮 + 自由文本），答完即消失。
5. **审批体验**：本机执行待审批票（置顶横幅或内嵌卡，给出你的方案）；一次性/总是/拒绝
   三种表态；审批后的执行结果要有回执感（审计）。
6. **自主执行总闸**：显眼但克制；关闭时的全局视觉语义（冻结态）。
7. **笔记本视图**：现行规则（区分个人/团队、规则/记事、有效期）+ 改动账本。
8. **能力总览**：每个能力一张"名片"（名称、一句话、工具清单、状态文件）——
   新增能力自动出现，设计中要给它位置。
9. **状态设计**：空房间、无审批、模型未接通（演示模式徽章）、团队服务未就绪、账本损坏告警。
10. **深浅色**：深色为主，浅色完整可用。

## 四、风格与工程约束

- 风格方向：克制、专业、信息密度适中；像"指挥一支团队"，不要玩具感、不要满屏渐变。
  主色可用蓝紫系，但由你定案并说明理由。
- 中文排版是一等公民：标点悬挂、行高、字重层级要讲究。
- 技术：**原生 HTML + CSS + JS，单页，无框架无构建链**（现有代码约 700 行，可全部推翻）。
  所有数据经 `fetch` 从 `/api/panel` 轮询（2s），动作走 POST。
- 产出：`index.html` + `app.css` + `app.js` 三件套（可直接替换现有文件），外加一页
  设计说明（配色令牌、组件清单、你做过的关键取舍）。

## 五、数据契约（界面只能用这些，全部真实存在）

轮询 `GET /api/panel` 返回：

```jsonc
{
  "capabilities": [ { "name": "org", "title": "组织", "description": "…", "version": "1.0.0",
    "surfaces": ["host"], "state": ["org.json"], "tools": [ {"name": "org_roster", "summary": "…"} ] } ],
  "org": { "primeBotId": "b-…", "companyRoomId": "r-…", "ranks": { "<botId>": "officer" }, "domains": { "<botId>": "工作" } },
  "community": {
    "demoMode": false,                       // true = 模型未接通（演示回声），顶部须有徽章
    "bots": [ { "id": "b1", "name": "验收员", "description": "…", "avatar": "🧪",
                "model": "deepseek-account/deepseek-flash", "mentionOnly": false } ],
    "rooms": [ { "id": "r1", "name": "公司大群", "isGroup": true, "directBotId": null,
                 "memberIds": ["b1","b2"], "objective": "让每个 Bot 有活干、有回报" },
               { "id": "dm-b1", "name": "验收员", "isGroup": false, "directBotId": "b1", "memberIds": ["b1"] } ],
    "messages": [ { "id": "m1", "roomId": "r1", "sender": "验收员", "senderKind": "bot|user",
                    "botId": "b1", "text": "…", "at": "2026-10-25T…", "durationMs": 3400,
                    "kind": null | "application" | "appoint" | "conflict" } ],
    "runs": [ { "id": "run1", "botId": "b1", "roomId": "r1", "status": "running",
                "startedAt": "…", "finishedAt": null, "running": true } ],
    "approvals": [ { "id": "call1", "roomId": "r1", "memberName": "验收员", "toolName": "write_file",
                     "reason": "…参数预览…", "risk": "irreversible|reversible", "createdAt": "…" } ],
    "questions": [ { "id": "q1", "roomId": "r1", "memberName": "验收员", "question": "…",
                     "options": ["全跑", "只跑冒烟"], "allowFreeText": true, "createdAt": "…" } ]
  },
  "brain": { "entries": [ { "id": "e1", "text": "交付成片一律 1080p", "kind": "rule|log",
             "scope": "bot|team", "tags": ["交付"], "botName": "验收员", "writtenAt": "…",
             "aboutDate": null, "expiresAt": null } ],
             "ledger": [ { "at": "…", "action": "add|embed|merge|retire|fuse", "summary": "…" } ] },
  "computer": { "autonomy": true, "sandbox": "D:\\…\\sandbox",
    "permissions": { "write-file": "always" },
    "pending": [ { "approvalId": "ap_…", "action": "run-command", "args": { "command": "node", "args": ["-e", "…"] }, "createdAt": "…" } ],
    "audit": [ { "at": "…", "kind": "executed|refused|responded|retired|autonomy", "action": "run-command",
                 "approvedBy": "user|agent|standing", "exitCode": 0, "durationMs": 1200 } ] },
  "diag": { "mount": ["…挂载日志行…"], "crashes": [ { "at": "…", "kind": "…", "message": "…" } ] }
}
```

动作接口（都是 POST + JSON）：

| 接口 | 载荷 | 语义 |
|---|---|---|
| `/api/send` | `{roomId, text}` | 用户向房间发消息（群内 @名字 会路由给被点名的 Bot） |
| `/api/answer` | `{questionId, value}` 或 `{questionId, skip:true}` | 回答 Bot 的提问 |
| `/api/approve` | `{callId, outcome: "allow"\|"reject"}` | 团队工具审批 |
| `/api/respond` | `{approvalId, verdict: "allow-once"\|"always"\|"deny"}` | 本机执行审批表态 |
| `/api/autonomy` | `{autonomy: true\|false}` | 切自主执行总闸 |

## 六、验收标准

- [ ] 只用第五节的字段与接口，没有发明任何数据；
- [ ] 第二节四块能力在界面上都有归宿；第十条各状态都有设计；
- [ ] 深浅色切换不破版；中文排版讲究；
- [ ] 三件套可直接替换现有 `web/` 目录，刷新即用；
- [ ] 设计说明里讲清楚：信息架构为什么这样分、审批体验的取舍、总闸的视觉语义。

---
