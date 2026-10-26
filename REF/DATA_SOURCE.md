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
| `kind` | `task` \| `event` | **只是标签，不是隔离** |
| `title` | 字符串 | 取自 `##` 标题 |
| `start` | `YYYY-MM-DDTHH:mm:ss` | **本地时间，不带时区后缀** |
| `end` | 同上 | 必须晚于 start |
| `due` | `YYYY-MM-DD` | 任务截止日期 |
| `allDay` | bool | 全天条目 |
| `done` | bool | 完成状态 |
| `priority` | `high` \| `mid` \| `low` | |
| `recurrence` | RRULE | 见下 |
| `project` | 字符串 | 项目 / 分类 |
| `tags` | 逗号分隔 | |
| `description` | 字符串 | |
| `location` | 字符串 | |
| `status` | confirmed/tentative/cancelled/needs-action | |

### kind 不是隔离

`kind: task` 的条目**同时**出现在看板与日历（只要它有 `start`）。
`kind: event` 的条目只出现在日历。

这正是解决「日历比看板任务多」的关键：它们本来就是同一个池子。

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

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/workspace/items` | 列表（scope / kind / start / end / expand） |
| POST | `/api/workspace/items` | 创建（schema 校验） |
| PUT | `/api/workspace/items/:id` | 更新（字段白名单） |
| DELETE | `/api/workspace/items/:id` | 删除 |
| GET | `/api/workspace/validation` | 校验报告 |
| GET | `/api/workspace/info` | 文件位置与统计 |
| GET | `/api/workspace/recurrence/options` | 周期规则选项 |
| GET | `/api/workspace/recurrence/preview` | 预览周期展开结果 |
