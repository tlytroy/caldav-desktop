# 统一数据源（workspace.md）

## 设计原则

**唯一事实源 = 一个文件。**

日历、任务看板、快速创建都只是这个文件的**视图**（不同筛选条件），
而不是各自维护数据再互相同步。

```
workspace.md（唯一事实源）
     │
     ├── scope=calendar + expand=true  →  日历模块
     ├── scope=board                    →  任务看板模块
     └── scope=all                      →  工作台 / AI 工具
```

## 为什么不是两个文件

早期架构用 `events.md`（事件）+ `工作搭子看板.md`（任务）两个文件，
靠双向绑定字段缝合：`kanbanTaskId` ↔ `日历:<uid>`。

这套机制有四个必然的代价：

1. **用户看到的数据不一致** —— 「体检」在日历里有、在看板里没有，
   因为它是纯事件，从未被写进看板。用户无法解释这个差异。
2. **删除语义复杂** —— 删事件要不要删任务？需要级联删除、解绑、孤儿清理。
3. **两个方向的同步状态机** —— 每个同步通道都要处理两个文件的合并逻辑。
4. **绑定键不一致** —— 事件侧用 `kanbanTaskId` 指向任务，任务侧用 `日历:<uid>`
   指向事件。迁移时只查一个方向会漏掉一半绑定。

现在这些全部消失。删一条就是删一条。

## 为什么不是「一任务一文件」（以及何时重估）

有另一种常见方案：每个任务/日程/项目一个 Markdown 文件（YAML frontmatter + 正文），
像一个 Obsidian vault。它的优点很明确：单条 diff 小、Obsidian 可直接浏览、WebDAV 冲突粒度细、
AI 每次只读一个小文件。

当前仍选择**单文件**，不是因为多文件不好，而是因为它的成本被低估：

1. **跨文件事务**：新建任务 + 子任务 + 项目关联会写多个文件；崩溃/并发时可能半写，
   需要 journal 或把索引变成事实源（后者又违背「MD 是唯一事实源」）。
2. **文件系统即数据库**：重命名/移动/大小写/编码/目录结构都要处理；路径不能当 ID，
   仍然需要索引与全库校验。
3. **同步**：WebDAV 目录同步要 PROPFIND、逐文件 ETag、删除/重命名传播；
   NAS 上几千个小文件的 RTT 远高于一个文件。
4. **监控**：几千文件的 watcher 事件、debounce、rename 识别。
5. **迁移**：当前是块格式（`##` + 字段行），改成 frontmatter 是数据格式迁移，
   解析/序列化/测试/同步状态全部要重做。

单文件的代价是合并粒度粗、文件会变大、Obsidian 图谱不友好；当前用
「字段级合并 + `.bak` + 三选一 + 条目级 union merge」缓解，规模到 1 万条仍可接受。

**什么时候重估**（决策 D20）：

- v0.4.5 做一次 2 周数据层 spike，用 1k/5k/20k 条合成数据测：
  解析/写入、内存、WebDAV 单次变更、两客户端冲突率、AI token、迁移成本；
- 同时原型「多文件 + journal + 索引」，验证跨文件一致性；
- 如果产品上必须直接兼容现有 Obsidian vault，或规模超过单文件可接受范围，
  再以 **v0.5 大版本**迁移，并提供导出/回滚，不在 v0.3 里切。

在决策前，**不引入第二个业务数据文件**；`vault/` 导出只能作为投影（只读/可重建），
不能成为事实源。详见 `docs/planning/CHRONOMD_PROPOSAL_REVIEW.md`。

## 文件格式

```markdown
---
schema: workbench/v1
---

## 体检
- id: a1b2c3d4
- kind: task
- start: 2026-10-28T09:00:00
- end: 2026-10-28T10:00:00
- due: 2026-10-28
- priority: mid
- done: false
- recurrence: FREQ=WEEKLY;BYDAY=MO,WE,FR

<!-- notes -->
这里是自由笔记区，可以写项目背景、会议要点等
```

### 字段

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | 8 位小写十六进制 | 稳定标识，永不复用 |
| `uid` | 字符串 | 外部日历（CalDAV / ICS）的 UID；空值 = 用 `id`。拉取时落盘，见下 |
| `kind` | `task` \| `event` | **只是标签，不是隔离** |
| `title` | 字符串 | 取自 `##` 标题 |
| `start` | `YYYY-MM-DDTHH:mm:ss` | **本地时间，不带时区后缀** |
| `end` | 同上 | 必须晚于 start |
| `due` | `YYYY-MM-DD` | 任务截止日期 |
| `remind` | `YYYY-MM-DDTHH:mm:ss` | 提醒时间（本地绝对时间）；空 = 不提醒，见 [../docs/NOTIFICATIONS.md](../docs/NOTIFICATIONS.md) |
| `allDay` | bool | 全天条目 |
| `done` | bool | 完成状态 |
| `priority` | `high` \| `mid` \| `low` | |
| `recurrence` | RRULE | 见下 |
| `list` | 字符串 | 所属清单；**空值 = 收件箱** |
| `parent` | 8 位 id | 父条目（子任务）；子任务也是普通条目，只是指向父级 |
| `project` | 字符串 | 项目 / 分类 |
| `tags` | 逗号分隔 | |
| `description` | 字符串 | |
| `location` | 字符串 | |
| `status` | confirmed/tentative/cancelled/needs-action | |
| `createdAt` / `updatedAt` | ISO 时间 | 由服务端维护 |

### kind 不是隔离

`kind: task` 的条目**同时**出现在看板与日历（只要它有 `start`）。
`kind: event` 的条目只出现在日历。

这正是解决「日历比看板任务多」的关键：它们本来就是同一个池子。

## 外部日历身份（uid）

CalDAV 上的一个对象是用 **UID** 认的，不是用本地 8 位 `id`。

```markdown
## 产品评审
- id: 6df317aa
- uid: 040000008200e00074c5b7101a82e008
- kind: event
- start: 2026-11-03T10:00:00
```

为什么要存下来：如果拉取时把 UID 丢掉，本地改完再推回去，服务器会认为
这是**另一个事件** —— 手机日历里就会出现两条一模一样的日程。

- 纯本地创建的条目没有 `uid`，推送时用 `id` 充当 UID（不写 `uid` 行，md 保持干净）
- 从 ICS / CalDAV 拉来的条目一定带 `uid`，`id` 由 UID 哈希得到（确定性：
  同一 UID 每次拉取得到同一个 id，重复拉取不会产生重复条目）
- `uid` 只影响「与外部日历交换数据」，不影响日历 / 看板 / 工作台的任何视图

## 清单（List）与子任务（parent）

**清单不需要预先定义、也不需要持久化** —— 它只是条目上的一个 `list` 字段值，
每次由条目聚合算出来。空清单没有意义，所以不单独存。

- `list` 为空 = **收件箱**（快速捕获、还没归类的东西），永远排在第一
- 重命名清单 = 批量改条目的 `list` 值（`POST /api/workspace/lists/rename`）
- 清单统计**只装任务**（`kind=task`），且**只算顶层任务**（`parent` 为空的）——
  否则「1 个父任务 + 3 个子任务」会让清单显示 4 条，而看板上只看到 1 条，
  数量对不上，用户会怀疑数据错了

子任务同样是**平铺的独立条目**，只是多一个 `parent` 指向父级 id：

```markdown
## 装修预算
- id: 3f2a91bc
- kind: task
- list: 家庭
- done: false

## 对比三家报价
- id: 7c1d0e42
- kind: task
- parent: 3f2a91bc
- list: 家庭
- done: true
```

不引入嵌套结构的原因：md 里所有条目依然是独立块，**改一条只影响那一段**，
不会因为缩进错位导致整棵树解析失败（对 AI 编辑友好）。
服务端只在展示时组装（`attachSubtaskProgress` / `childrenOf`），
父任务带上 `subtaskTotal` / `subtaskDone` / `progress`。

**删除父任务 = 删除整棵子树**：子任务只靠 `parent` 指向父级，父级删掉后它们
会变成「有 parent 但找不到父级」的孤儿 —— 看板不渲染、清单不统计，用户永远看不到。
所以 `DELETE /items/:id` 会级联删除所有后代，响应里返回 `removedChildren` 数量。

## 三层防护（防 AI 乱改）

### 1. Schema 校验

`schema/item.schema.json` 定义所有字段的类型、枚举与格式。
服务端在写入前校验，非法直接拒绝并说明原因。

### 2. 容错解析

**不用 YAML 库** —— YAML 库遇到畸形输入会整体抛错，一条坏记录会让
全部数据读不出来。这里逐条自解析：每条是独立的 Markdown 块，
解析一条只影响一条。坏条目被标记 `invalid` 并跳过，其余照常工作。

### 3. 写入前备份

每次写入前把当前文件复制到 `.workspace-backups/`，保留最近 10 版。

## AI 接入方式

### 推荐：工具调用（格式由代码保证）

```
list_items({ scope?, kind?, start?, end? })     → 读
create_item({ title, kind?, start?, ... })       → 增
update_item({ id, patch })                      → 改（白名单字段）
delete_item({ id })                             → 删
```

每个工具有 JSON Schema 约束，服务端做字段白名单过滤。
AI **无法**写出格式错误的数据 —— 格式由代码保证，不依赖 AI 自觉。

### 可选：直接编辑文件

也支持。但请注意：

- 改一条 = 只影响那一段（条目是独立块），其它条目不受影响
- 改完跑 `GET /api/workspace/validation` 确认没有坏条目
- 万一全坏了，从 `.workspace-backups/` 回滚

### 不要做的事

不要给 AI「随便改这个 md」的指令后不做校验。说明文档是**软约束**，
工具 schema 才是**硬约束**。

## 周期规则（RRULE）

采用 RFC 5545 子集，因为它能表达「每周一三五」「每月1号」，
且导出 ICS 时可直接映射。

| 界面选项 | RRULE |
| -------- | ----- |
| 不重复 | （无） |
| 每天 | `FREQ=DAILY` |
| 每周 | `FREQ=WEEKLY` |
| 每周一至五 | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| 每周一、三、五 | `FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| 每周末 | `FREQ=WEEKLY;BYDAY=SA,SU` |
| 每月 | `FREQ=MONTHLY` |
| 每月1号 | `FREQ=MONTHLY;BYMONTHDAY=1` |
| 每年 | `FREQ=YEARLY` |

另外支持 `INTERVAL`（每隔几周/几月）、`COUNT`（次数）、`UNTIL`（截止日期）。

**语义细节**：短月没有 31 号时，`FREQ=MONTHLY`（起始于 31 号）会**跳过**
该月（RFC 5545 行为），不会钳位到 28 号。

## 迁移

```bash
# 预览
node scripts/migrate-to-workspace.js --dry-run

# 执行
node scripts/migrate-to-workspace.js
```

迁移会把旧的两个文件合并到 workspace.md：

- 事件 → `kind: event` 条目
- 任务 → `kind: task` 条目（截止日期补成本地零点的时间点）
- **已绑定的对合并成一条**（两个方向都匹配，因为旧架构绑定键不一致）
- 项目与速记 → 自由笔记区

## API

前缀：`/api/workspace`

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/items` | 列表。查询参数见下 |
| POST | `/items` | 创建（schema 校验） |
| PUT | `/items/:id` | 更新（字段白名单） |
| DELETE | `/items/:id` | 删除（级联删除子任务，返回 `removedChildren`） |
| GET | `/validation` | 校验报告（`total` / `valid` / `invalid` / `issues[]`） |
| GET | `/info` | 文件路径与统计 |
| GET | `/lists` | 清单摘要（收件箱恒在首位） |
| POST | `/lists/rename` | 清单改名，返回影响的条目数 |
| GET | `/recurrence/options` | 周期规则选项（界面用） |
| GET | `/recurrence/preview` | 预览周期展开结果 |
| POST | `/ics/import` | 导入 .ics（`dryRun` / `mode` / `kind` / `skipDuplicates`） |
| GET | `/ics/export` | 导出 .ics（`start` / `end` / `scope` / `download` / `expand`） |

### CalDAV 同步 API（前缀 `/api/caldav`）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/status` | 配置、目标日历、上次同步时间、待推送条数（**不发网络请求**） |
| GET | `/calendars` | 服务器上的日历列表（服务器不可用时 200 + `degraded`，不报错） |
| POST | `/sync` | 执行同步：`direction` / `calendarUrl` / `force` |
| POST | `/test` | 连通性测试（PROPFIND，不写任何数据） |

同步行为、增量与冲突规则见 [../docs/SYNC_MANAGEMENT.md](../docs/SYNC_MANAGEMENT.md)。

### 提醒推送 API（前缀 `/api/notifications`）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/channels` | 渠道清单 + 配置状态（不含密钥） |
| GET | `/status` | 调度状态、待推送数、上次推送时间 |
| POST | `/test` | 发测试消息（`channel` 可选） |
| POST | `/check` | 立即检查并推送一次（调试） |

详见 [../docs/NOTIFICATIONS.md](../docs/NOTIFICATIONS.md)。

### GET /items 查询参数

| 参数 | 取值 | 说明 |
| ---- | ---- | ---- |
| `scope` | `all` \| `calendar` \| `board` | 模块视角。calendar=有 `start` 的；board=`kind=task` 的 |
| `kind` | `task` \| `event` | 按标签过滤 |
| `start` / `end` | `YYYY-MM-DD` | 日期范围（本地日历日） |
| `includeDone` | `true`（默认）\| `false` | 排除已完成 |
| `list` | 字符串 | **不传 = 不筛选；传空串 = 只看收件箱** |
| `topLevel` | `false`（默认）\| `true` | 只返回顶层条目（子任务由前端按 `parent` 单独取） |
| `expand` | `false`（默认）\| `true` | 把重复条目展开成实例（日历用），实例 id 为 `<id>@<日期>`，原 id 在 `instanceId`，系列原起点/终点在 `seriesStart` / `seriesEnd` |

排序规则：未完成在前，然后按 `start ?? due` 升序。

## 遗留接口（**已删除**）

v0.3（P3）已删除旧的 `/api/md-bridge/*` 与 `/api/kanban/*` 路由，以及前端
`apps/renderer/src/api/md-bridge.ts`、`api/kanban.ts`。它们读写的 `events.md` /
`工作搭子看板.md` 属于 2026-10-26 就废弃的双文件架构。

| 前缀 | 原用途 | 现状 |
| ---- | ------ | ---- |
| `/api/md-bridge/*` | 读写 `events.md` + CalDAV 同步 | 已删除；现在返回 JSON 404 |
| `/api/kanban/*` | 读写 `工作搭子看板.md` | 已删除；现在返回 JSON 404 |
| `/api/calendar/*` | 直接读写 CalDAV（绕过 md） | 仍保留，仅用于日历列表探测 / 降级状态 |

旧数据迁移用 `scripts/migrate-to-workspace.js`（一次性脚本，独立于服务端）。

## 文件位置与备份

路径解析优先级（**与其它配置相反，环境变量优先**）：

```
WORKSPACE_FILE（环境变量） > config.json 的 paths.workspaceFile > ./workspace.md
```

相对路径基于**进程 cwd** 解析。容器部署时用环境变量指向挂载点。

- 备份目录：与 workspace.md **同目录**下的 `.workspace-backups/`，保留最近 10 版
- `/api/workspace/info` 会返回实际使用的绝对路径 —— 排障先看这里，
  不要猜「文件到底写哪儿了」

## 后续开发的铁律

1. **不要再引入第二个数据文件**。事件、任务、清单、子任务都是 workspace.md 里的条目。
2. **不要在模块之间做同步/绑定**。视图 = 对同一份数据的筛选，不需要缝合。
3. **唯一允许的格式转换是 md ↔ ics**（`ics-convert.ts`）。想加别的导出格式，
   也应该从 workspace 条目直接生成，而不是先转 ics 再转。
4. **新增字段要同步三处**：`schema/item.schema.json`、`workspace.ts` 的
   `WorkbenchItem` + `validateItem`、以及 `apps/renderer/src/api/workspace.ts` 的类型。
   漏一处就会出现「能写不能读」或「校验形同虚设」。
5. **改完跑测试**：`cd apps/server && pnpm test`（当前 312 通过 / 33 跳过）、
   `cd apps/renderer && pnpm test`（75 通过）。数字对不上说明真出问题了。

---

**Last Updated**: 2026-11-02（新增 `uid` 字段与 CalDAV 同步 API，补齐清单/子任务字段、完整 API 表、遗留接口与开发铁律）
**Related**: [MD_ICS_BRIDGE.md](MD_ICS_BRIDGE.md)、[ARCHITECTURE.md](ARCHITECTURE.md)
