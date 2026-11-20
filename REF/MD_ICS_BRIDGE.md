# MD ↔ ICS 转换层（唯一需要格式转换的边界）

> **本文档描述当前实现**（2026-11-02 重写）。
>
> 旧版本叫「MD ↔ ICS 桥接方案」，描述的是 `events.md`（YAML frontmatter 里放
> `events[]` 数组）+ `工作搭子看板.md` 双文件架构。**那套架构已经废弃**，
> 文件格式、字段名、接口路径全部不再是本文档描述的内容。
> 旧实现代码（`apps/server/src/md-ics-bridge.ts`、`routes/md-bridge.ts`、
> `routes/kanban.ts`）已在 v0.3（P3）**删除**，不再是兼容路径 —— 现在只有
> `apps/server/src/ics-convert.ts` 一处转换边界。

## 为什么只剩这一处转换

统一数据源 `workspace.md` 是**我们自己定义的格式**，可以随意演进。
而 ICS 是 **RFC 5545 标准**，Google / Outlook / Apple / 滴答清单 都认它，
不能自定义。

所以整个系统里只有这一个边界需要格式转换：

```
                     workspace.md（唯一事实源）
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   scope=calendar      scope=board         scope=all
   （日历视图）         （看板视图）        （工作台 / AI）
        │                   │                   │
   直接读，不转换       直接读，不转换      直接读，不转换
                            │
                    ┌───────┴────────┐
                    │                │
              导出 .ics         导入 .ics
                    │                │
               CalDAV 服务器    Google/Outlook 导出文件
```

- 日历视图、看板视图、快速创建、AI 工具 —— **全部直接读写 workspace.md，零转换**
- 只有「与外部日历软件交换数据」时才经过 ICS

## 代码位置

| 文件 | 职责 |
| ---- | ---- |
| `apps/server/src/ics-convert.ts` | **唯一转换实现**：`itemToIcsBlock` / `itemsToIcs` / `itemsToIcsMap` / `parseIcsEvents` / `icsEventToItem` |
| `apps/server/src/recurrence.ts` | RRULE 解析/格式化/展开（ICS 与视图共用同一份规则） |
| `apps/server/src/routes/workspace.ts` | `POST /ics/import`、`GET /ics/export` |
| `apps/server/src/caldav-sync.ts` | CalDAV 同步引擎：逐对象 GET/PUT、ETag、字段指纹、冲突判定 |
| `apps/server/src/routes/caldav-sync.ts` | `/api/caldav/*`（status / calendars / sync / test） |
| `apps/server/src/caldav.ts` | 遗留的 tsdav 探测 / 日历列表（同步已不再走它） |

## 字段映射表

导出（workspace → ICS）：

| workspace 字段 | ICS 属性 | 说明 |
| -------------- | -------- | ---- |
| `uid` ?? `id` | `UID` | 有远端 UID 就用它；纯本地条目用 8 位 id。**回推不重复的关键** |
| `title` | `SUMMARY` | 文本转义（`\` `;` `,` 换行） |
| `start` | `DTSTART` / `DTSTART;VALUE=DATE` | 全天条目用 DATE 形式 |
| `end` | `DTEND` | 全天条目**必须写次日 00:00**（见下） |
| `allDay` | `VALUE=DATE` 参数 | |
| `description` | `DESCRIPTION` | |
| `location` | `LOCATION` | |
| `project` | `X-WORKBENCH-PROJECT` | 私有属性；不写 CATEGORIES（否则回读会混进 tags） |
| `tags[]` | `CATEGORIES` × N | **每个标签一行**，不 join |
| `priority` | `PRIORITY` | high=1 / mid=5 / low=9 |
| `status` | `STATUS` | 大写 |
| `recurrence` | `RRULE` | 完整透传，见下 |
| `createdAt` | `CREATED` | UTC（带 `Z`） |
| `updatedAt` | `LAST-MODIFIED` | UTC（带 `Z`）；同时决定 `DTSTAMP` |

`done` / `parent` / `list` 三个字段 **不进 ICS** —— 它们是看板侧语义，
外部日历软件没有对应概念，写进去也是私货，读回来还得处理。

导入（ICS → workspace）：上表反向。另外：

- `UID` 落盘到条目 `uid`；`id` 由 UID **确定性哈希**成 8 位 hex
  （同一份 ICS 重复导入、重复拉取都得到同一个 id，不会产生重复条目）
- `LAST-MODIFIED`（缺省退回 `DTSTAMP`）写进 `updatedAt`，供冲突判定使用
- `RECURRENCE-ID` 的例外实例**跳过**：它与主事件共用 UID，硬导会覆盖主事件
- `SUMMARY` 缺失的 VEVENT 整条跳过（不生成空标题条目）
- 未知属性不报错，也不保留（`IcsEvent.rawBlock` 保留原始块，供将来需要时取用）

## 时间与时区规则

**workspace 里存的是本地时间，不带时区后缀**：`2026-10-28T09:00:00`。

导出时写成**浮动时间**（floating time）：

```
DTSTART:20261028T090000
DTEND:20261028T100000
```

`CREATED` / `LAST-MODIFIED` / `DTSTAMP` 是**时间戳**，按标准写 UTC（带 `Z`）；
只有 `DTSTART` / `DTEND` 是浮动本地时间，两者不要混。

`DTSTART` / `DTEND` 不加 `Z`、不加 `TZID`、不写 `VTIMEZONE`。理由：

1. 加 `Z` 是 UTC —— 东八区 09:00 会变成 `01:00Z`，不带时区解析的客户端
   会显示成 01:00，**凭空差 8 小时**（这个坑踩过）
2. 加 `TZID` 必须配套 `VTIMEZONE` 块，部分客户端（尤其是手机自带日历）
   缺了 `VTIMEZONE` 就按浮动时间处理，写不写结果一样
3. 本工具是单机个人工具，语义上「9 点开会」比「UTC+8 的 9 点」更贴近真实需求

**代价**：如果用户跨时区旅行，浮动时间会跟着当地时区解释，事件时刻相对
「当地时间」不变而不是「绝对时刻」不变。对个人日程这是想要的行为。

`DTEND` 有两个硬规则（都写过测试）：

- **全天事件的 DTEND 是排他边界**，必须写次日。`DTSTART;VALUE=DATE:20261028`
  + `DTEND;VALUE=DATE:20261028` 是**零长度事件**，多数客户端直接不显示
- 结束时间不晚于开始时间时补 +1 小时，避免负时长

## RRULE：完整透传

旧的 `md-ics-bridge.ts` 只取 `FREQ=xxx`，`BYDAY` / `BYMONTHDAY` / `INTERVAL` /
`COUNT` / `UNTIL` **全部丢弃** —— 「每周一三五」导出到别的日历退化成「每周」。

现在 `ics-convert.ts` 直接复用 `recurrence.ts` 的解析结果逐项回写：

```
FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2;COUNT=10;UNTIL=20261231T235959Z
```

`UNTIL` 要补成 `T235959Z` 形式（ICS 规定 UNTIL 是 UTC 时刻）；
workspace 里只存日期，回读时截取日期部分。

## 文本折行

RFC 5545 要求内容行不超过 75 **字节**，超出用「CRLF + 空格」续行。
`foldLine()` 按 75 字符切分（中文 UTF-8 是 3 字节/字，实际字节数会超，
但所有主流客户端都按字符处理，中文长标题实测无问题）。
解析侧 `parseIcsEvents` 先做 `\r\n[ \t] → ""` 展开。

## 接口

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/api/workspace/ics/import` | 导入 .ics 到统一数据源 |
| GET | `/api/workspace/ics/export` | 从统一数据源导出 .ics |

### 导入

```json
POST /api/workspace/ics/import
{
  "icsContent": "BEGIN:VCALENDAR...",
  "mode": "append",        // append（默认）| replace
  "kind": "event",         // event（默认）| task
  "dryRun": false,         // true = 只解析不落盘，返回预览
  "skipDuplicates": true   // 默认 true，按 id 去重
}
```

响应（`dryRun: true` 时）：`{ parsed, toImport, skipped, preview[] }`
响应（正常导入）：`{ imported, skipped, total, filePath }`

- 无法解析出任何 VEVENT 时返回 400，并提示「确认包含 BEGIN:VEVENT 块」
- `replace` 会**清空现有条目**再写入，只留 `notes` 区

### 导出

```
GET /api/workspace/ics/export?start=2026-10-01&end=2026-10-31&scope=calendar&download=1&expand=0
```

| 参数 | 说明 |
| ---- | ---- |
| `start` / `end` | 本地日历日范围过滤 |
| `scope` | `all` / `calendar` / `board` |
| `download=1` | 以附件形式下载（否则返回纯文本） |
| `expand=1` | 把重复条目展开成多条独立事件；**默认不展开**，保留 RRULE 更省空间且可编辑 |

## 历史实现对照（废弃，仅供理解演进）

| 维度 | 旧（`md-ics-bridge.ts`，已废弃） | 新（`ics-convert.ts`） |
| ---- | -------------------------------- | ---------------------- |
| 数据文件 | `events.md` + `工作搭子看板.md` | `workspace.md` 单文件 |
| 文件格式 | YAML frontmatter `events: [...]` | 每条一个 `## 标题` + `- key: value` 块 |
| 文件内 UID | `uid` 字段 | `id` + `uid`（`uid` 保存远端身份，`id` 用于看板/日历） |
| 时区 | `TZID` + `VTIMEZONE` | 浮动本地时间 |
| RRULE | 只保留 `FREQ` | 完整透传 |
| 标签 | `tags.join(",")` | 每标签一行 `CATEGORIES` |
| 绑定关系 | `kanbanTaskId` ↔ `日历:<uid>` 双向绑定 | **没有绑定** —— 同一份数据，不需要绑定 |
| 接口前缀 | `/api/md-bridge/*` | `/api/workspace/*` |

旧代码保留的原因：迁移脚本 `scripts/migrate-to-workspace.js` 需要读旧格式；
`/api/md-bridge/*` 与 `/api/kanban/*` 路由仍挂载，但**前端已不再调用**
（`apps/renderer/src/api/md-bridge.ts`、`kanban.ts` 是遗留文件）。

## 已知限制

- **删除不传播到远端 CalDAV**：缺少墓碑（tombstone）记录，push 只做创建/更新
- **只同步 VEVENT**：纯截止日期任务（VTODO）暂不推
- **重复事件的例外（RECURRENCE-ID）不合并**：为避免覆盖主事件，直接跳过
- **`done` / `parent` / `list` 在外部日历里不可见**：这是设计选择，不是缺陷
- `project` 用私有属性 `X-WORKBENCH-PROJECT` 保存，别的日历看不到（但不会丢）

---

**Last Updated**: 2026-11-02（补 uid / X-WORKBENCH-PROJECT / UTC 时间戳 / CalDAV 同步引擎）
**Related**: [DATA_SOURCE.md](DATA_SOURCE.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[../docs/SYNC_MANAGEMENT.md](../docs/SYNC_MANAGEMENT.md)
