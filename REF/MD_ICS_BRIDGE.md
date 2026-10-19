# MD ↔ ICS 桥接方案设计（重构版）

## 核心思路：MD 文件即缓存，编辑即本地，同步即转换

### 核心原则

1. **一个专门的 MD 文件作为所有日历事件的本地缓存** — `events.md` 是唯一的真实数据源（SSOT）
2. **编辑操作全在本地 MD 文件上进行** — 增/删/改事件都直接修改这个 MD 文件的 YAML frontmatter
3. **ICS 是同步时的导出格式** — 仅在需要同步到 CalDAV 服务器时才将 MD 转换为 ICS
4. **WebDAV 可直接同步 MD 文件本身** — 不搭建 CalDAV 也能通过同步 `events.md` 实现多设备
5. **AI 友好** — AI 助手指需要读写一个结构化的 MD 文件，无需理解 ICS 协议

```
┌─────────────────────────────────────────────────────────────────────┐
│                         events.md（唯一数据源）                        │
│                                                                     │
│  ---                                                                 │
│  # 文件格式：YAML frontmatter 中包含所有日历事件                        │
│  events:                                                             │
│    - uid: "uuid-1"                                                   │
│      title: "项目评审会议"                                            │
│      date: "2026-08-18T14:00:00"                                     │
│      end: "2026-08-18T15:30:00"                                      │
│      allDay: false                                                   │
│      status: confirmed                                               │
│      category: "工作"                                                │
│      tags: ["项目", "评审"]                                          │
│      recurrence: "weekly"                                            │
│      description: "项目进度评审会议"                                   │
│      updated: "2026-08-18T10:00:00Z"                                 │
│    - uid: "uuid-2"                                                   │
│      title: "更新项目计划"                                            │
│      date: "2026-08-20"                                              │
│      allDay: true                                                    │
│      status: needs-action                                            │
│      category: "个人"                                                │
│      tags: ["待办"]                                                  │
│      description: "张三：更新项目计划"                                 │
│      updated: "2026-08-18T10:00:00Z"                                 │
│  ---                                                                 │
│                                                                     │
│  # 正文部分：AI 可以写入任何上下文信息                                  │
│  ## 2026-08-18 项目评审会议                                           │
│  - 张三汇报了项目进度，当前完成 80%                                    │
│  - 李四提出了技术方案调整建议                                          │
│  - 决定下周三再做一次评审                                              │
│                                                                     │
└──────────────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌──────────────────────┐
│  同步到 CalDAV   │    │  同步到 WebDAV（可选） │
│  MD → ICS 转换   │    │  直接同步 events.md   │
│  PUT .ics 文件   │    │  无需 ICS 转换        │
└─────────────────┘    └──────────────────────┘
```

## 文件格式规范

### events.md 结构

```
---
events:
  - uid: "string"            # 唯一标识，自动生成或保留
    title: "string"           # 事件标题（必填）
    date: "ISO 8601"          # 开始日期/时间（必填）
    end: "ISO 8601"           # 结束日期/时间
    allDay: boolean           # 是否全天事件
    status: "confirmed" | "tentative" | "cancelled" | "needs-action"
    category: "string"        # 分类
    tags: ["string"]          # 标签列表
    recurrence: "daily" | "weekly" | "monthly" | "yearly"
    description: "string"     # 描述/备注
    updated: "ISO 8601"       # 最后更新时间
    source: "caldav" | "md" | "ai"  # 来源标记
    kanbanTaskId: "string"    # 关联的工作搭子任务 ID（工作台↔日历双向绑定；见下文）
  - ...
---
```

### 设计理由

| 特性                 | 说明                                                |
| -------------------- | --------------------------------------------------- |
| **单一文件**         | 避免碎片化，方便 WebDAV 同步，AI 只需要处理一个文件 |
| **YAML frontmatter** | 标准的 Markdown 元数据格式，所有编辑器/渲染器都支持 |
| **events 数组**      | 一个文件可容纳所有事件，结构清晰                    |
| **正文部分**         | 可自由写入会议纪要、笔记等，AI 可从中提取新事件     |
| **updated 字段**     | 用于冲突检测和增量同步                              |

## 同步策略

### 同步时机：非实时（延时自动 + 手动）

`events.md` 是日历的**唯一事实源（SSOT）**，ICS 只是同步通道、不是首屏数据源：

- 所有编辑（增/删/改，以及工作台↔日历双向绑定）都先落到 `events.md`；UI 首屏直接读 `events.md`，不依赖 CalDAV 在线。
- ICS 同步**不需要实时**：通过「延时自动同步」（`MD_ICS_AUTO_SYNC_MINUTES`，后台定时器触发 `POST /api/md-bridge/sync/caldav`）与「手动同步」（UI 顶部 推送 / 拉取 / 双向同步 按钮）两种方式进行。
- 拉取（CalDAV → MD）把远端事件合并进 `events.md`，但**保留本地关联字段**（见「关联保留语义」），不会把工作台↔日历绑定冲掉。

### 方式一：CalDAV 同步（主力）

```
编辑 events.md
    │
    ▼
用户点击"同步" / 定时自动同步
    │
    ▼
读取 events.md 的 frontmatter
    │
    ▼
遍历 events[] 数组
    │
    ├── 新增事件（无 uid 或 source="md"）
    │   → 生成 UID
    │   → 转换为 ICS
    │   → PUT 到 CalDAV 服务器
    │   → 更新 events.md 中的 uid 和 source="caldav"
    │
    ├── 修改事件（updated 比上次同步新）
    │   → 转换为 ICS
    │   → PUT 更新 CalDAV 服务器
    │
    └── 删除事件（标记 deleted 或从 events 移除）
        → DELETE CalDAV 上的 .ics 文件
```

### 方式二：WebDAV 直接同步（无 CalDAV 场景）

```
无需 ICS 转换，直接同步 events.md 文件本身

本地 events.md  ←→  WebDAV 服务器 /remote/events.md
                        │
                  其他设备同步后
                  读取 events.md 即可
```

**优势**：

- 不需要搭建 CalDAV 服务器
- 不需要 ICS 转换逻辑
- 文件级同步，简单可靠
- 任何支持 WebDAV 的云盘（Nextcloud、ownCloud、Box 等）均可

### 方式三：Git 同步（高级场景）

```
本地 events.md  ←→  Git 仓库（GitHub/GitLab）
                        │
                  利用 Git 的历史记录和冲突解决
                  PR 方式审核 AI 的修改
```

## 工作台 ↔ 日历双向绑定（2026-08-21）

工作台「任务看板」与日历并非两份独立数据，而是通过轻量引用字段**互链**，两端共享同一个事件/任务实体。

### 互链字段

| 位置 | 字段 | 形式 |
| ---- | ---- | ---- |
| 工作搭子看板（`工作搭子看板.md`）任务行 | `calendarEventUid` | 行尾 `\| 日历:<uid>`（如 `- [ ] [高] 写周报 \| 日历:md-event-abc`） |
| `events.md` 事件（YAML frontmatter） | `kanbanTaskId` | `kanbanTaskId: "t3"` |

### 行为

- **工作台加任务 → 同时入日历**：任务表单勾选「📅 同时加入日历」并填日期/时间，创建任务的同时写入对应事件，任务行打上「📅 已加入日历」标识。
- **日历加事件 → 同时入看板**：事件表单勾选「📋 同时加入任务看板」并选优先级，创建事件的同时在看板插入一条任务，事件弹窗显示「📋 已在任务看板」。
- **级联删除**：删任务时勾选「同时删除日历事件」→ 连事件一起删；删事件时勾选「同时删看板任务」→ 连任务一起删。
- **解绑不删除**：`POST /api/kanban/task/:id/unlink-calendar` 只去掉指针，两边数据都保留。
- **编辑不丢链**：`PUT /api/md-bridge/events/:uid` 更新事件时强制保留 `kanbanTaskId`，避免编辑事件把任务关联孤立。

### 关联保留语义（同步不丢绑定）

ICS 标准字段里没有「关联任务」概念，同步时必须特殊处理，否则「延时自动同步 / 手动拉取」会用远端 ICS 覆盖本地事件、把 `kanbanTaskId` 清空：

1. **导出（MD → ICS）**：`eventToIcs` 额外写出自定义扩展属性 `X-KANBAN-TASK-ID:<id>`，使 push 到 CalDAV 的 `.ics` 也携带关联。
2. **导入（ICS → MD）**：`icsToEvent` 解析 `X-KANBAN-TASK-ID` 回填 `kanbanTaskId`；没有该属性的外部真实 CalDAV 事件则为空。
3. **Pull 合并**：`POST /api/md-bridge/sync/caldav` 的 pull 分支更新已有事件时，优先采用远程 ICS 里的 `X-KANBAN-TASK-ID`，否则**回退保留本地已有的 `kanbanTaskId`**——保证任何一次拉取都不会打掉工作台↔日历绑定。

### 防重复显示

日历模块渲染时，带 `calendarEventUid` 的看板任务已从「外部事件叠加层」过滤掉（它们已作为 `events.md` 里的真实事件显示），避免同一条任务在日历中双显。

## 与 AI 助手的协同

### AI 读取数据

```markdown
AI 读取 events.md → 解析 YAML frontmatter → 获得完整的事件列表
→ 可作为上下文用于回答"我今天有什么安排"等查询
```

### AI 写入数据

```markdown
AI 解析用户会议纪要 → 提取事件信息
→ 追加到 events.md 的 events[] 数组
→ 用户确认后触发同步
```

### AI 格式示例

```markdown
---
events:
  - title: "项目评审会议"
    date: "2026-08-18T14:00:00"
    end: "2026-08-18T15:30:00"
    category: "工作"
    tags: ["项目"]
    description: "AI 从会议纪要中自动提取"
    source: "ai"
---
```

## 服务器端 API（简化版）

### 核心接口

| 方法   | 路径                         | 说明                                    |
| ------ | ---------------------------- | --------------------------------------- |
| `GET`  | `/api/md-bridge/events`      | 读取 events.md 返回所有事件             |
| `PUT`  | `/api/md-bridge/events`      | 写入完整 events.md（AI/用户编辑后保存） |
| `POST` | `/api/md-bridge/ics/import` | 导入 `.ics` 文件；`dryRun` 预览 / `mode=append\|replace` |
| `GET`  | `/api/md-bridge/ics/export`  | 导出为单个 `.ics`；`start`/`end` 过滤 / `download=1` |
| `POST` | `/api/md-bridge/sync/caldav` | 将 events.md 同步到 CalDAV              |
| `GET`  | `/api/md-bridge/config`      | 读取同步配置                            |
| `PUT`  | `/api/md-bridge/config`      | 更新同步配置                            |
| `PUT`  | `/api/md-bridge/events/:uid` | 更新单个事件字段（**保留 kanbanTaskId**，避免孤立绑定） |
| `POST` | `/api/md-bridge/events/add`  | 追加事件；可带 `kanban:{priority,project,due?}` 同步建看板任务 |
| `DELETE` | `/api/md-bridge/events/:uid` | 删除事件；若绑定任务则级联删看板任务   |
| `POST` | `/api/kanban/task`           | 建任务；可带 `calendar:{date,time,endDate?,endTime?,allDay?}` 同步建日历事件 |
| `PATCH` | `/api/kanban/task/:id`       | 改任务；支持建/改绑定，或 `clearCalendar:true` 删绑定事件 |
| `DELETE` | `/api/kanban/task/:id`       | 删任务；级联删绑定事件                 |
| `POST` | `/api/kanban/task/:id/unlink-calendar` | 仅解绑，两边数据都保留         |

### WebDAV 通道 API

| 方法 | 路径                  | 说明 |
| ---- | --------------------- | ---- |
| `GET` | `/api/webdav/status`  | 查询配置与双文件本地/远端状态、上次同步时间、远端是否变更 |
| `POST` | `/api/webdav/push`   | 推送 md 到远端；`files` 限定范围、`force` 强制覆盖 |
| `POST` | `/api/webdav/pull`   | 拉取覆盖本地；`force` 强制拉取（默认远端无变化则跳过） |
| `POST` | `/api/webdav/test`   | 连通性 + 认证测试 |

### 数据流

```
前端 / AI
   │
   │  PUT /api/md-bridge/events  (写入 events.md)
   ▼
events.md 文件（服务器端缓存）
   │
   │  POST /api/md-bridge/sync/caldav
   ▼
MD → ICS 转换 → CalDAV PUT
```

## 实现计划

### 第一阶段：核心文件格式与编辑

- [x] `events.md` 格式定义
- [x] MD frontmatter 解析（支持 events 数组）
- [x] MD frontmatter 写入（追加/更新/删除事件，含 `kanbanTaskId` 字段）
- [x] `GET/PUT /api/md-bridge/events` API（PUT 保留关联）

### 第二阶段：CalDAV 同步

- [x] events.md → ICS 批量转换（`allEventsToIcs`）
- [x] 双向同步：push（MD→CalDAV）+ pull（CalDAV→MD，保留本地 `kanbanTaskId`）
- [~] 增量同步（目前按全量 events 遍历；未完成 `updated` 时间戳级别的精细增量）
- [~] 冲突检测（基于 `updated` 时间戳，基础版）
- [x] 工作台↔日历双向绑定（`kanbanTaskId` / `日历:<uid>`，见上文）

### 第三阶段：WebDAV 同步（2026-10-19 已实现）

- [x] WebDAV 客户端（`apps/server/src/webdav.ts`）
      只用 Node 内置 fetch，不引第三方依赖（坚果云等对 WebDAV 库兼容性参差）；
      Basic 认证；远端目录不存在时递归 `MKCOL` 创建。
- [x] 同步 `events.md` 与 `工作搭子看板.md` 两个文件
- [x] **ETag 乐观锁**：push 时若远端自上次同步后被其他设备改动，返回 `conflict`，
      **不静默覆盖**；用户可选择「用本地覆盖远端」或「改用远端内容」。
- [x] **拉取保护**：只在远端确实变化时才覆盖本地；覆盖前自动备份为 `.bak`
- [x] 同步状态记录在本地 `.webdav-state.json`（各文件上次同步时的远端 ETag）
- [x] API：`GET /api/webdav/status`、`POST /api/webdav/push`、`POST /api/webdav/pull`、`POST /api/webdav/test`
- [x] 日历页工具栏「WebDAV」按钮 + 同步面板（文件状态、连接测试、冲突提示）
- [x] 服务端不再因 CalDAV 连接失败而 `process.exit(1)` —— md + WebDAV 通道可独立使用

### 第四阶段：iCalendar 文件导入 / 导出（2026-10-19）

- [x] `parseIcsFile(icsContent)` —— 解析含多个 VEVENT 的完整 .ics 文件
      （此前 `icsToEvent` 只取第一条 VEVENT，导入 Google/Outlook 导出的日历会丢数据）
- [x] `eventsFileToIcs(eventsFile)` —— 导出为单个 VCALENDAR 文件
- [x] `POST /api/md-bridge/ics/import` —— 支持 `dryRun` 预览、按 uid 去重、`append` / `replace` 两种模式
- [x] `GET /api/md-bridge/ics/export` —— 支持 `start` / `end` 日期范围过滤与 `download=1` 直接下载
- [x] 日历页工具栏「导入 ICS」「导出 ICS」按钮 + 导入预览确认弹窗

### 已知边界与后续工作

- **AI 集成**：`.env` 中 `AI_PROVIDER` / `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` 同为预留配置，无代码读取。
- **增量同步**：目前按全量 events 遍历，未做 `updated` 时间戳级别的增量。
- **冲突检测**：CalDAV 通道仅基于 `updated` 的基础版；WebDAV 通道用 ETag 乐观锁（较可靠）。
- **删除传播**：从 MD 删除事件后同步，**不会删除 CalDAV 远端已存在的对应 `.ics`**（缺少墓碑记录）。
- **WebDAV 冲突合并**：检测到冲突时只提示，不做自动三方合并（需用户选一边）。

### 已知陷阱（踩过的坑，改动相关代码前请先读）

1. **全天事件的 DTEND 是排他的**，必须是次日 00:00。与 DTSTART 同日会导出零长度事件，部分客户端直接不显示。
2. **全天事件的 `VALUE=DATE` 不能用 `toISOString()` 生成** —— 那是 UTC 换算，东八区凌晨的事件会落到前一天。应取本地 `getFullYear/getMonth/getDate`。
3. **不要用 `new Date("2026-10-02")` 做日期过滤** —— 它按 UTC 午夜解析，在东八区等于本地 08:00，会误排除当天上午的事件。应构造 `${d}T00:00:00`（本地零点）。
4. **看板任务 id 必须持久化到 md**（`| id:` 字段）。早期用行序 `t0/t1/t2` 定位，而新建任务会 unshift 到队首，导致存量任务 id 整体错位，删 A 会连带删掉 B 的日历事件。
5. **同步方向有两套命名**：配置层 `md-to-caldav` / `caldav-to-md` / `bidirectional`，同步层 `push` / `pull` / `bidirectional`。必须经 `normalizeSyncDirection()` 转换，直接传配置值会导致同步静默不执行。
6. **本地 md 路径解析要统一**：`MD_EVENTS_FILE=./events.md` 是相对**进程 cwd** 的。项目里曾同时存在 `path.resolve(cwd, ...)` 与直接用相对串两种写法（结果相同但语义混乱），新增代码统一走 `resolveLocalPath()`。
