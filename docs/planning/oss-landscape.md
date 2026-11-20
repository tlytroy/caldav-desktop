# ChronoMD 开源借鉴调研（OSS Landscape）

> 调研时间：2026-11-03。范围：同类产品、可直接复用的库、架构与交互。
> 表中 star 数均为当日通过 [ungh.cc](https://ungh.cc) 实测；License 以仓库 `LICENSE` / shields.io 识别为准，无法确认的明确标注“未核实”。
> 结论只针对 ChronoMD 现状：单用户、`workspace.md` 单一事实源、Node 22 + Express 4 + React 18 + FullCalendar 6、Electron 与 Docker 双部署、v0.3 保持单文件。

---

## 0. 一句话结论

**不要换技术栈、不要上 CRDT、不要重写后端。** ChronoMD 现在缺的不是框架，而是三件很具体的事：对 Obsidian 任务语法的**兼容层**、条目内部的**字段级/行级合并**、以及**用户看得见的冲突处理**。这三件事分别能从 Obsidian Tasks（MIT，可直接抄 TypeScript 代码）、node-diff3（MIT，105★ 的小库）、Syncthing / Nextcloud 的冲突副本约定（零代码）拿到，合计约 4–6 人日，收益远大于引入任何新框架。

---

## 1. Top 5：最值得抄的五个东西（按收益/成本排序）

### 1.1 Obsidian Tasks 的 emoji 序列化 + 查询引擎 —— 收益/成本最高

- 仓库：<https://github.com/obsidian-tasks-group/obsidian-tasks>（MIT，4,078★，2026-11-02 仍在推送）
- 抄哪里：
  - `src/TaskSerializer/`：把一行 Markdown 解析成 Task 对象（状态、描述、日期、优先级、重复、ID、依赖），以及反向序列化。
  - `src/Query/`：把 `tasks` 查询块解析成指令列表（filter / sort / group / limit / hide），再对任务数组求值；`src/IQuery.ts` 是指令接口。
  - `src/Suggestor/`：输入 `due `、`priority ` 时的日期/优先级补全，可直接接到我们的快速添加框。
  - `src/Task/`：状态机（TODO / DONE / CANCELLED）与 `Task` 值对象，可对照我们的 `done` 布尔值。
- 为什么值得：这是**唯一一个既开源、又用 TypeScript、又已经把“Markdown 行内任务语法”做到工业级**的实现。我们不需要它整个插件，只需要解析/序列化/查询这三层；它们的代码是 MIT，剥离 `obsidian` 运行时依赖后可以直接 vendor。
- 落地方式：不要改 `workspace.md` 的原生格式，而是做**适配器**——导入时识别 `- [ ]` + emoji 行，导出时生成同样格式。这样 Obsidian 用户可以把 vault 直接拖进来，我们也不丢自己的 `- key: value` 结构化优势。
- 成本：3–5 人日（含单测与适配层）；收益：立刻获得一套被几十万用户验证过的语法与筛选能力。
- 注意：代码里对 `obsidian` 模块（`TFile`、`App`、`Notice`）的引用要替换成我们的接口；保留 MIT 版权头。

### 1.2 node-diff3 行级三方合并 —— 补当前最大的正确性缺口

- 仓库：<https://github.com/bhousel/node-diff3>（MIT，105★，v3.2.1，2026-06-03）
- 现状：`apps/server/src/routes/webdav.ts:138` 的 `mergeWorkspaceText(localText, remoteText)` 只做**条目级**合并——同一个 `id` 两边都改，按 `updatedAt` 取较新的一版；时间相同则保留本地。代码注释已经点明：“这是条目级合并，不是字段级；字段级合并留给 CalDAV 通道”。也就是说：A 设备改标题、B 设备改日期，仍然会丢一边。
- 抄什么：`merge(a, o, b)` 的三方合并与 `diff3Merge` 的逐块结果；前者给最终文本，后者给 UI 展示“哪几段冲突”。
- 建议策略（重要）：
  1. 先按 `##` 条目切分，条目级冲突仍按现有规则处理；
  2. 只有**同一条目、同一字段、两边都变**时，才对该字段值跑 diff3；
  3. 绝不对整个 `workspace.md` 跑 diff3——行级合并会破坏 `##` 块边界和 frontmatter。
- 冲突落盘：写 `<<<<<<< local` / `=======` / `>>>>>>> remote`，同时把该条目标 `conflict: true` 写进合并报告，前端提供三栏视图。
- 成本：2 人日（字段级判断 + diff3 接入 + 单测）；收益：消灭“同步后内容少了但没人知道”的一类投诉。

### 1.3 冲突副本命名 + 冲突列表 UI —— 零依赖，防数据丢失

- 参考：Syncthing 官方文档 <https://docs.syncthing.net/users/syncing.html>（冲突命名规则已核实）；Nextcloud 桌面端冲突说明 <https://docs.nextcloud.com/server/latest/user_manual/en/desktop/conflicts.html>（页面两次抓取失败，仅引用，不引用具体文件名格式）。
- Syncthing 的规则原文是：`<filename>.sync-conflict-<date>-<time>-<modifiedBy>.<ext>`，例如 `workspace.sync-conflict-20261103-101500-laptop.md`；**mtime 较旧的一方被重命名**，冲突副本会继续参与后续同步。
- 我们照抄这个约定：本地/远端无法自动合并时，不覆盖任何一方，生成 `workspace.sync-conflict-YYYYMMDD-HHMMSS-<device>.md`，在 UI 的“冲突”入口列出，提供“保留本地 / 保留远端 / 打开合并”。
- 成本：0.5 人日；收益：用户永远不会“打开发现少了一半”，而且文件名自带时间与设备，客服成本极低。

### 1.4 cmdk 命令面板 —— 一天集成，UX 提升最明显

- 仓库：<https://github.com/pacocoursey/cmdk>（MIT，13,062★；仓库已迁至 `dip/cmdk`，最后推送 2025-10-29）
- 组件结构简单：`<Command>` / `<Command.Input>` / `<Command.List>` / `<Command.Item>`，`shouldFilter={false}` 时接我们自己的搜索（任务标题、事件、命令、设置项）。
- 落地场景：`Ctrl/Cmd+K` 全局跳转；快速新建“任务/事件”；切换视图（月/周/议程）；执行“立即同步”“导出 ICS”。
- 成本：1 人日；注意中文输入法组合期间不要拦截按键（`compositionstart/end`），以及 `Command.Item` 的 `onSelect` 与焦点管理。

### 1.5 croner 加固提醒调度 —— 时区与 DST 不用自己算

- 仓库：<https://github.com/Hexagon/croner>（MIT，2,614★，2026-11-02）
- 能力：`new Cron('0 9 * * *', { timezone: 'Asia/Shanghai' }, cb)`、`nextRun()`、`stop()`；零依赖，处理 DST 跳变。
- 但要先说清楚：**不要给每个提醒建一个 Cron/timer**。正确做法是“单 tick（30s）+ 最小堆”存放所有待触发提醒，croner 只用于“每天 9 点汇总”“每周清理”这类**周期任务**。这样 1 万条提醒也只有 1 个定时器。
- 成本：0.5 人日；收益：跨时区/夏令时不再出现“提醒早一小时/晚一小时”。

---

## 2. 总表

### 2.1 同类产品（日历 / 任务 / 看板）

| 项目 | 链接 | License | ★（核实） | 最近活跃 | 能抄什么（具体到文件/模块/交互） | 采用建议 |
|---|---|---|---|---|---|---|
| Obsidian Tasks | <https://github.com/obsidian-tasks-group/obsidian-tasks> | MIT | 4,078 | 2026-11-02 活跃 | `src/TaskSerializer/` emoji 编解码；`src/Query/` 过滤器/排序/分组；`src/Task/` 模型；`src/Suggestor/` 补全 | **直接用**（核心） |
| Logseq | <https://github.com/logseq/logseq> | AGPL-3.0 | 45,455 | 2026-11-01 活跃 | outliner 的 `TODO/DOING/DONE`、`SCHEDULED:`/`DEADLINE:`、journal 默认入口 | 抄思路 |
| Trilium | <https://github.com/TriliumNext/Trilium> | AGPL-3.0 | 38,666 | 2026-11-02 活跃 | `#label` / `~relation` 属性检索、笔记树与保存的搜索 | 抄思路 |
| Joplin | <https://github.com/laurent22/joplin> | AGPL-3.0-or-later | 56,980 | 2026-11-02 活跃 | 冲突副本 UX、WebDAV/Nextcloud 同步向导、note 与 todo 分型 | 抄思路 |
| Vikunja | <https://github.com/go-vikunja/vikunja> | AGPL-3.0 | 5,939 | 2026-11-02 活跃 | 看板 bucket（视图而非数据）、任务详情抽屉、CalDAV | 抄思路 |
| Super Productivity | <https://github.com/super-productivity/super-productivity> | MIT | 23,336 | 2026-11-01 活跃 | Today/Planner 视图、时间盒、快捷键体系、ICS 集成 | 抄思路 |
| Tasks.org | <https://github.com/tasks/tasks> | GPL-3.0 | 5,709 | 2026-10-30 活跃 | VTODO 字段映射、`RELATED-TO` 子任务、提醒与重复 UI | 抄思路 |
| Nextcloud Deck | <https://github.com/nextcloud/deck> | AGPL-3.0 | 1,435 | 2026-11-03 活跃 | 卡片详情、stack 折叠、标签与截止日 | 抄思路 |
| Nextcloud Tasks | <https://github.com/nextcloud/tasks> | AGPL-3.0 | 710 | 2026-11-01 活跃 | VTODO 列表/搜索/子任务层级 | 抄思路 |
| Nextcloud Calendar | <https://github.com/nextcloud/calendar> | AGPL-3.0 | 1,196 | 2026-11-03 活跃 | 事件弹层、侧栏编辑、时区选择器 | 抄思路 |
| Radicale | <https://github.com/Kozea/Radicale> | GPL-3.0 | 5,169 | 2026-11-01 活跃 | collection 布局、ETag、`sync-token` 增量同步语义 | 抄思路（协议层） |
| Baikal | <https://github.com/sabre-io/Baikal> | GPL-3.0 | 3,355 | 2026-10-19 活跃 | 管理后台、多用户/多集合的配置模型 | 抄思路 |
| cal.com | <https://github.com/calcom/cal.com> | MIT（shields 识别，未读 LICENSE 原文；仓库已改名 cal.diy） | 49,631 | 2026-11-02 活跃 | 可用性编辑器、预约页、时区处理 | 不适用（产品不同） |
| Obsidian Calendar | <https://github.com/liamcain/obsidian-calendar-plugin> | MIT | 2,288 | 2024-06-22 **停更** | 日历年视图、日期点标记 | 不适用（已停更） |
| Wekan | <https://github.com/wekan/wekan> | MIT | 21,150 | 2026-11-02 活跃 | 看板拖拽、卡片 | 不适用（Meteor 老栈） |
| Planka | <https://github.com/plankanban/planka> | PLANKA Community License（非 OSI，未核实 SPDX） | 12,662 | 2026-10-28 活跃 | 看板 UI、卡片活动流 | 不适用（许可） |
| Focalboard | <https://github.com/mattermost-community/focalboard> | 源码 AGPL-3.0 / 编译版 MIT（双轨） | 26,538 | 2026-05-18 放缓 | 看板、属性视图 | 不适用（维护+许可） |
| Motion | <https://www.usemotion.com/> | 闭源 | — | — | AI 排期交互（仅可看，不可抄） | 不适用 |

### 2.2 架构参考（单文件 Markdown 作为事实源）

| 项目 | 链接 | License | ★（核实） | 最近活跃 | 能抄什么 | 采用建议 |
|---|---|---|---|---|---|---|
| Foam | <https://github.com/foambubble/foam> | 未核实（GitHub 无法识别，疑 MIT） | 17,473 | 2026-10-29 活跃 | 单/多文件 Markdown 工作区、wiki-link 解析、VS Code 内图谱 | 抄思路 |
| Quartz | <https://github.com/jackyzha0/quartz> | MIT | 13,511 | 2026-11-01 活跃 | Markdown → 静态站管线、frontmatter 解析、插件式 transformer | 不适用（我们是应用不是站点） |
| SilverBullet | <https://github.com/silverbulletmd/silverbullet> | MIT | 6,433 | 2026-11-01 活跃 | 浏览器内 Markdown 编辑、Space Script、索引 | 抄思路 |
| Joplin | <https://github.com/laurent22/joplin> | AGPL-3.0-or-later | 56,980 | 2026-11-02 活跃 | Electron + 服务端双形态、同步目标配置 | 抄思路（部署） |
| Trilium | <https://github.com/TriliumNext/Trilium> | AGPL-3.0 | 38,666 | 2026-11-02 活跃 | 单机 server + Electron 桌面双形态、数据目录布局 | 抄思路（部署） |

### 2.3 可直接复用的库

| 库 | 链接 | License | ★（核实） | 最近活跃 | 能抄什么 | 采用建议 |
|---|---|---|---|---|---|---|
| chrono-node | <https://github.com/wanasit/chrono> | MIT | 5,300 | 2026-10-12 活跃 | 英文/ISO 日期解析，可做兜底 | 抄思路（不替换自研中文解析） |
| rrule | <https://github.com/jkbrzt/rrule> | BSD-3-Clause | 3,750 | 2024-06-27 放缓 | RRULE 展开（项目已用） | 直接用 |
| ical.js | <https://github.com/kewisch/ical.js> | MPL-2.0 | 1,182 | 2026-11-02 活跃 | ICS 解析/序列化（项目已用） | 直接用 |
| tsdav | <https://github.com/natelindev/tsdav> | MIT | 361 | 2026-10-15 活跃 | CalDAV 客户端（项目已用）；`createDAVClient`/`fetchCalendarObjects`/`updateCalendarObject` | 直接用 |
| webdav-client | <https://github.com/perry-mitchell/webdav-client> | MIT | 816 | 2026-09-19 活跃 | WebDAV 文件读写、`stat` 取 ETag、自定义请求头 | 备用（替换手写 PROPFIND 时） |
| node-diff3 | <https://github.com/bhousel/node-diff3> | MIT | 105 | 2026-06-03 活跃 | 行级三方合并 `merge` / `diff3Merge` | **直接用** |
| automerge | <https://github.com/automerge/automerge> | MIT | 6,706 | 2026-11-02 活跃 | CRDT 文档 | 不适用（见 4.1） |
| yjs | <https://github.com/yjs/yjs> | MIT | 23,012 | 2026-10-23 活跃 | CRDT 文档 | 不适用（见 4.1） |
| Dexie | <https://github.com/dexie/Dexie.js> | Apache-2.0 | 14,675 | 2026-10-30 活跃 | IndexedDB 封装、索引、liveQuery | 备选（离线缓存） |
| idb | <https://github.com/jakearchibald/idb> | ISC | 7,436 | 2026-10-06 活跃 | 轻量 IndexedDB Promise 封装 | 备选（比 Dexie 更小） |
| croner | <https://github.com/Hexagon/croner> | MIT | 2,614 | 2026-11-02 活跃 | 时区/DST 感知的 cron、`nextRun()` | **直接用**（周期任务） |
| node-cron | <https://github.com/node-cron/node-cron> | ISC | 3,286 | 2026-10-22 活跃 | cron 解析与调度 | 备选 |
| cmdk | <https://github.com/pacocoursey/cmdk> | MIT | 13,062 | 2025-10-29 活跃 | 命令面板、键盘导航、过滤 | **直接用** |
| Schedule-X | <https://github.com/schedule-x/schedule-x> | MIT | 2,608 | 2026-11-01 活跃 | `createCalendar`、日/周/月视图、React wrapper | 备选（v0.4 评估） |
| react-big-calendar | <https://github.com/jquense/react-big-calendar> | MIT | 8,764 | 2026-06-01 放缓 | 日历组件 | 不适用（不如 FullCalendar） |
| dnd-kit | <https://github.com/clauderic/dnd-kit> | MIT | 17,773 | 2026-10-31 活跃 | 看板拖拽、可排序列表、键盘传感器 | 备选（做看板时） |
| vite-plugin-pwa | <https://github.com/vite-pwa/vite-plugin-pwa> | MIT | 4,309 | 2026-10-09 活跃 | PWA 注册、Workbox 集成（项目已用） | 直接用 |
| Workbox | <https://github.com/GoogleChrome/workbox> | MIT | 13,040 | 2026-10-29 活跃 | 运行时缓存、Background Sync、离线回退 | 直接用（底层） |

> 说明：`bree`、`@nlpjs`、`dateparser` 等只在正文讨论，未进表，避免给出未核实的 star 数。

---

## 3. 分节调研

### 3.1 数据模型：别人怎么存“一条任务”

| 项目 | 存储单位 | 任务字段怎么放 | 对我们的启示 |
|---|---|---|---|
| Obsidian Tasks | Markdown 列表项 | 全部内联在行里（emoji 标记 + 正文），无数据库；查询在渲染时对全库扫描 | **语法即 API**：用户看得见、可 diff、可手改；我们用 `- key: value`，机器友好但人不够友好，需要适配层 |
| Logseq | 块（block） | `TODO/DOING/DONE` 是块的首个 token；`SCHEDULED:`/`DEADLINE:` 是块属性 | 日记（journal）作为默认入口，比“先建任务再排期”更贴近日常 |
| Trilium | 笔记节点 | 用 `#label=value` / `~relation` 属性，配合保存的搜索 | 属性检索很灵活，但需要索引；我们单文件 + 线性扫描，v0.3 不需要 |
| Joplin | note / todo 两种 | todo 有 `completed`、`due`；正文仍是 Markdown | 类型分离会带来转换成本；我们 `kind: task\|event` 已经等价 |
| Vikunja | 关系库 | tasks + labels + assignees + reminders + kanban buckets | bucket 属于“视图”，不该进任务数据模型——我们做看板时也要守住这条 |
| Super Productivity | 本地 store（NgRx） | task + time tracking + issue provider | “今天”视图与时间盒是留存关键，不是数据模型问题 |
| Tasks.org | CalDAV VTODO | 标准 iCal 字段；子任务用 `RELATED-TO` | 与 ICS/CalDAV 互操作时，字段映射要一次做对 |
| Nextcloud Deck | board / stack / card | 卡片有标题、描述、截止日、标签、评论、附件 | 卡片详情抽屉是“轻量编辑”的最佳形态 |
| Radicale / Baikal | iCalendar collection | 一条 VCALENDAR 一个资源，靠 ETag + sync-token | 同步协议的正确性比 UI 更重要 |

**ChronoMD 与 iCalendar 的字段映射（建议写进 SDS，v0.4 补）**

| ChronoMD | iCalendar | 备注 |
|---|---|---|
| `uid` / `id` | `UID` | `uid` 已是稳定标识，导出时必须用它，不能重新生成 |
| `title` | `SUMMARY` | |
| `start` / `end` / `allDay` | `DTSTART` / `DTEND`，全天用 `VALUE=DATE` | 全天事件不要写 `TZID` |
| `due` | `DUE` | 仅 VTODO |
| `recurrence` | `RRULE` | 已用 rrule，注意 `EXDATE` 尚未支持 |
| `priority` high/mid/low | `PRIORITY` 1/5/9 | iCal 是 0–9，1 最高 |
| `done` | `STATUS:COMPLETED` + `COMPLETED` | 需要完成时间才能正确参与同步 |
| `remind` | `VALARM`（`TRIGGER`） | 相对 `DTSTART` 或 `DUE` |
| `kind: task` / `event` | `VTODO` / `VEVENT` | 同一文件内可混装，但导出时按类型分组更稳 |

**建议新增的字段（都可选，不破坏现有解析）**：`created`（对应 Obsidian `➕`）、`rev`（内容哈希，用来识别“`updatedAt` 相同但内容不同”，比单纯比时间可靠）、`categories`（对应 `CATEGORIES`）、`parent`（对应 `RELATED-TO`，子任务）。`updatedAt` **已经存在**且被 `mergeWorkspaceText` 使用，不要重复加；v0.3 单文件阶段先只补 `rev`，它直接决定合并正确性。

### 3.2 Markdown 任务语法：抄 Obsidian 的 emoji，但别改自己的存储

Obsidian Tasks 的 emoji 语法（官方文档已核实）：

| Emoji | 含义 | ChronoMD 对应 |
|---|---|---|
| `➕` | created | 建议新增 `created`（v0.4） |
| `⏳` | scheduled | 无，可映射到 `start` |
| `🛫` | start | `start` |
| `📅` | due | `due` |
| `✅` | done | `done: true` |
| `❌` | cancelled | 无，建议新增 `status` |
| `⏬` / `🔽` / 无 / `🔼` / `⏫` / `🔺` | lowest / low / normal / medium / high / highest | `priority: low / mid / high`（六档压三档，导入时合并） |
| `🔁` | recurrence，如 `🔁 every week when done` | `recurrence`（RRULE） |
| `🏁` | on completion：`keep` / `delete` | 无，v0.4 可加 |
| `🆔` | id，如 `🆔 dcf64c` | `id` |
| `⛔` | dependsOn，如 `⛔ dcf64c,0h17ye` | 无，v0.4 可加 |

一行真实的样子：

```text
- [ ] 写周报 ⏫ 📅 2026-11-05 🔁 every week when done
```

**必须知道的坑（会直接导致“解析不出来”的 bug）**：

- 用户从网页/微信复制来的行里，空格可能是 **NBSP（U+00A0）**，不是普通空格；解析前统一 `replace(/\u00A0/g, ' ')`。
- `⏫` 有 **Unicode Variation Selector（U+FE0F）** 变体：`⏫` 与 `⏫️` 是两个码点序列；匹配时先 `normalize('NFKC')` 或显式去掉 `\uFE0F`。
- 中文输入法下可能打出全角冒号/全角空格；`due：2026-11-05` 要能容错。
- 日期格式不要只认 ISO：`2026-11-05`、`2026/11/05`、`11月5日` 都要进解析器（我们的 `zh-time.ts` 已覆盖后两种）。

**查询语言**（Obsidian Tasks 的 `tasks` 代码块，可直接抄语义）：

```text
not done
due before tomorrow
path includes Projects
sort by due
group by heading
limit 20
hide backlink
```

我们不需要 100% 兼容，先实现一个子集就够：`not done`、`due before/after/on`、`path includes`、`tag includes`、`priority is`、`sort by due|priority|created`、`group by heading`、`limit`。把它做成 `kind: smartlist` 的条目：

```markdown
## 本周到期
- kind: smartlist
- query: not done
- query: due before sunday
- sort: due
```

**不建议采用**：todo.txt（`(A) 2026-11-05 task +project @context`，没有时间、提醒、重复的正式表达）；org-mode（`SCHEDULED:`/`DEADLINE:`/`:PROPERTIES:` 太重，且与我们的 `- key: value` 冲突）；Dataview（在 Markdown 里跑 JS，安全与可移植性都差）。

### 3.3 日历 UI：保留 FullCalendar 6，别为了“新”而迁移

- **FullCalendar 6**（MIT，项目已用）：生态最全、时区/重复事件/iCal 插件成熟；resource timeline / resource scheduling 是**付费**模块，架构上不要依赖它们，否则自托管版会有许可问题。
- **Schedule-X**（<https://github.com/schedule-x/schedule-x>，MIT，2,608★）：更轻、更现代，`createCalendar({ views: [viewDay, viewWeek, viewMonthGrid], events, callbacks })`，React 用 `@schedule-x/react` 的 `useNextCalendarApp`。缺点是生态小、资源视图/复杂时区能力弱。**结论：v0.4 若包体或移动端性能成为瓶颈再评估，当前不迁移。**
- **react-big-calendar**（8,764★，最后推送 2026-06-01）：比 FullCalendar 更旧、时区插件缺失、维护放缓，**不适用**。
- **Obsidian Calendar 插件**（2,288★，2024-06-22 后停更）：只值得抄“日历年视图 + 日期点标记 + 点击进日记”的交互，代码不要引。
- **Nextcloud Calendar**：值得看的是事件弹层（popover）与右侧栏编辑的分工——快速查看用弹层，重编辑进侧栏；以及时区选择器的默认值策略（跟随系统 vs 固定）。
- **拖拽**：FullCalendar 自带 `draggable` / `droppable`（外部元素拖入日历）；如果做看板，再用 dnd-kit（`DndContext` + `SortableContext` + `useSortable` + `arrayMove`）。两套拖拽不要混在同一个容器里。
- **命令面板**与日历不冲突：cmdk 负责“跳转/新建/执行命令”，FullCalendar 负责“时间网格上的直接操作”。

### 3.4 同步与冲突：条目级合并是对的，但还不够

**现状盘点**

- `mergeWorkspaceText(localText, remoteText)`（`apps/server/src/routes/webdav.ts:138`）按条目 id 对齐：只有一边有 → 保留；两边都有 → 取 `updatedAt` 较新的一版；时间相同 → 保留本地并记入 `conflicts`。报告里只有 `{ id, title }`，所以前端只能提示“N 条冲突，已保留本地”。
- 写入侧已有乐观锁：`putRemoteFile(cfg, filename, content, expectedEtag)`（`apps/server/src/webdav.ts:211`）在有 ETag 时带 `If-Match`，`routes/webdav.ts:487` 捕获 412 并提示“远端已被他人修改”。
- CalDAV 通道已有字段级合并与冲突 UI：`Calendar.tsx:640` 起展示冲突条数与逐条原因，并提供“冲突项以远端为准 / 以本地为准 / 合并双方改动”三个动作。
- `apps/server/src/sync-control.ts` 的 epoch / maintenance / readOnly 已解决“恢复备份与飞行中的同步互相覆盖”，这是很多同类项目没做对的，保留。
- 仍然缺的四块：**md 通道的字段级合并**（同一 id 改不同字段会丢一边）；**冲突副本文件**；**md 冲突的文本级视图**（现在只有计数提示）；notes 用 `<!-- 合并自远端 -->` 直接拼接，多轮同步可能累积重复段落。

**建议补齐的四件事**

1. **把 CalDAV 的字段级合并搬到 md 通道**：以 `updatedAt` + 每字段内容哈希作为基线，逐字段判断“谁改了”；两边改同一字段才进入 diff3。CalDAV 那边已经验证过“基线 + 字段级”的思路，复用它的数据结构即可。
2. **条目内 diff3（node-diff3）**：只在同一 `##` 块内、同一字段上做（见 1.2）。整文件 diff3 会破坏块结构，明令禁止。
3. **冲突副本文件**：自动合并失败时按 Syncthing 命名生成副本（见 1.3），原文件保留本地版本，副本进“冲突”列表；绝不静默覆盖。
4. **冲突 UI**：md 通道也补上列表 + 三栏（本地 / 合并结果 / 远端）+ 三个动作（保留本地、保留远端、手动合并）；notes 的拼接改成“带来源标记的结构化块”，并做去重。参考 Joplin 的提示方式：不阻塞主流程，但在侧栏常驻一个红点。

**协议层参考**

- Radicale 的 collection 布局、ETag、`sync-token` 是 WebDAV 增量同步的事实标准；我们不必实现完整 sync-token，但 `sync-token` 语义（“自某版本以来的变更”）值得做成 `updated` 时间戳 + 全量比对的简化版。
- tsdav 的调用面：`createDAVClient({ serverUrl, credentials, authMethod, defaultAccountType })`、`fetchCalendars`、`fetchCalendarObjects`、`createCalendarObject`、`updateCalendarObject`、`deleteCalendarObject`。我们已经在用，重点是**把 ETag 透传到合并层**，而不是每次全量覆盖。

**为什么不上 CRDT（Yjs / Automerge）**

- CRDT 要求它来拥有文档模型：文本要变成 `Y.Text`、结构要变成 `Y.Map`，落盘再序列化成 Markdown，**往返必然有损**（空行、列表缩进、字段顺序）。
- 单用户场景下，冲突来自“两台设备离线各改一版”，不是“多人同时编辑”；diff3 + 冲突副本足够，且用户能看懂。
- 引入 CRDT 等于重写 `workspace.ts` 与整个同步层，收益与成本完全不成比例。**明确不做。**

### 3.5 提醒与推送：provider 已经够，缺的是调度正确性

**现有 provider（`apps/server/src/notifications/push.ts`）**：wecom、serverchan、pushplus、bark、ntfy、webhook。这套组合覆盖了国内（企微/ServerChan/PushPlus）与自托管（ntfy）与 iOS（Bark），不需要再加。

值得抄的细节：

- **ntfy**（<https://ntfy.sh/>，自托管 <https://github.com/binwiederhier/ntfy>）：消息优先级 1–5、`Tags` 表情、`Click` 跳转、`Actions` 按钮。我们的推送 payload 可以对齐这套语义，前端配置页也能复用“优先级/标签”的概念。
- **Bark**：iOS 的 `group`、`level`、`sound`、`icon` 参数，适合“日程临近”和“每日摘要”分不同 group。
- **企业微信**：markdown 消息有长度上限（约 4096 字节），长日程列表要截断并给“查看详情”链接。
- **ServerChan / PushPlus**：都是“一个 token 换一条推送”，适合做“测试发送”按钮的默认通道。

**调度设计（比选库更重要）**

- 单 tick（30s）+ 最小堆：所有待触发提醒进堆，tick 时弹出到期项。不要 `setTimeout` per reminder（Node 定时器上限、内存、时钟漂移都是坑）。
- 去重键：`${id}:${occurrenceISO}`，触发后写 `lastFiredAt`，进程重启后不会重复推。
- 补发窗口：离线/休眠恢复后，只补发最近 5 分钟内的，避免一次涌出 200 条。
- 时区：存储统一 UTC，展示用用户时区；用户改时区后重算未来 30 天的触发点。
- 免打扰：`quietHours` 配置，落在窗口内的提醒顺延到窗口结束（或直接丢弃，需产品决策）。

**库的选择**

- `croner`：支持 `timezone`、DST、`nextRun()`，零依赖，**推荐**用于周期任务（每日摘要、清理）。
- `node-cron`：3,286★，功能类似但 DST 行为历史上出过问题；作为备选。
- `bree`：worker 线程跑 job，适合 CPU 密集型；我们的提醒是 I/O 型，**不适用**，别为此引入线程模型。

**iCal 提醒映射**：`VALARM` + `TRIGGER:-PT15M` + `ACTION:DISPLAY`；重复提醒用 `REPEAT`/`DURATION`。导出时至少支持“提前 0/5/15/30/60 分钟、提前 1 天”。

### 3.6 认证：抄 *arr / Home Assistant / Vaultwarden 的“令牌页面”，别抄 JWT

**现状**：`apps/server/src/auth.ts`（130 行）已经是一个可用的单用户 Bearer 方案——解析顺序 env → 文件 → 生成，64 位 hex，写文件 `chmod 0600`，比较用 `sha256` + `crypto.timingSafeEqual`，损坏时改名保留现场。**v0.3 阶段这样够用**，不要为了“看起来专业”换 JWT/OAuth。

真正值得补的是“多设备令牌管理”，因为单 token 无法做到“手机丢了只吊销手机”。演进方向如下（v0.4）：

**Token 设计（建议直接照此实现）**

- 格式：`cmd_` + 32 字节随机（base32，约 52 字符），例如 `cmd_JBSWY3DPEHPK3PXP...`；前缀让日志/泄露扫描能识别。迁移期同时接受现有的 64 位 hex token，并在列表里标为 legacy，避免用户被强制重登。
- 存储：只存 `sha256(token)`，加 `prefix`（前 8 字符，用于列表展示）、`name`、`createdAt`、`lastUsedAt`、`lastUsedIp`、`scopes`、`revokedAt`。
- 比较：`crypto.timingSafeEqual`，不要 `===`。
- 展示：创建时**只显示一次**，提供复制按钮与“我已保存”确认；列表只显示前缀。
- 吊销：单个吊销 + “全部吊销”；吊销后立即失效（内存/DB 双写）。
- 限流：按 token/IP 做登录与失败尝试限流；Bearer 失败返回 401 + `WWW-Authenticate: Bearer`。

**UX 参考**

- **Home Assistant 长期访问令牌**（<https://github.com/home-assistant/core>，Apache-2.0，91,902★）：个人资料 → 安全 → 创建令牌 → 命名 → 一次性展示 → 列表显示“最后使用时间”。这套交互是目前最清楚的。
- **Vaultwarden**（<https://github.com/dani-garcia/vaultwarden>，AGPL-3.0，70,074★）：管理后台的“API Key / 设备”页面，强调“重新生成会使旧密钥立即失效”。
- **Sonarr**（<https://github.com/Sonarr/Sonarr>，GPL-3.0，17,523★）：Settings → General → API Key，一个输入框 + “Regenerate”按钮，极简但对单用户足够。

**明确不要**

- JWT：无状态带来的是“无法即时吊销”，单用户也不需要跨服务验签。
- Basic Auth：每次请求带明文密码，且无法按设备吊销。
- 把 token 写进 URL query：会进日志、进 Referer。
- 前端 `localStorage` 存长期 token 可以接受（单用户、同源），但要配 CSP，且提供“退出所有设备”。

### 3.7 部署与离线：Electron / Docker / PWA 三套壳，一套数据目录

- **Electron 本地版**：后端只 bind `127.0.0.1`，端口随机；渲染进程通过 preload 拿一次性 token；参考 Joplin / Trilium 的“桌面壳 + 本地服务”分工。数据目录用 `app.getPath('userData')`，不要写进安装目录。
- **Docker 自托管**：单卷 `/data`（`workspace.md` + `.bak` + 附件 + 配置）；`PUID/PGID` 对齐 NAS 权限；`HEALTHCHECK` 打 `/api/health`；反代（Caddy / Nginx Proxy Manager）负责 TLS；`TRUST_PROXY=1` 让限流拿到真实 IP。参考 Vikunja / Radicale / Baikal 的 compose 写法（它们都把“配置走环境变量、数据走卷”做得很干净）。
- **PWA 离线**：`vite-plugin-pwa` 已接入，`registerType: 'autoUpdate'`；Workbox 运行时缓存策略——API 用 `NetworkFirst`（短超时 + 回退缓存），静态资源用 `StaleWhileRevalidate`；离线写操作进 IndexedDB 队列（`idb` 足够，Dexie 更适合复杂查询），恢复后按 `updated` 时间戳走合并流程。
- **单用户边界**：默认只监听 localhost；一旦 `HOST=0.0.0.0` 就强制要求 token，并在启动日志里打印“已暴露到网络”的警告。这是自托管产品最容易出的安全事故。

---

## 4. 明确不建议抄（以及为什么）

### 4.1 架构层

| 对象 | 链接 | 为什么不抄 | 我们用什么替代 |
|---|---|---|---|
| Yjs | <https://github.com/yjs/yjs> | 要接管文档模型，Markdown 往返有损；单用户冲突频率低；等于重写同步层 | 条目级合并 + 条目内 diff3 + 冲突副本 |
| Automerge | <https://github.com/automerge/automerge> | 同上；且二进制格式，无法直接落成 Markdown | 同上 |
| Logseq | <https://github.com/logseq/logseq> | AGPL、outliner + Datascript，数据模型与我们相反 | 只抄 journal 入口与 `SCHEDULED/DEADLINE` 语义 |
| Trilium | <https://github.com/TriliumNext/Trilium> | AGPL、SQLite/CLS 树，迁移等于重写 | 只抄属性检索与保存的搜索的交互 |
| Joplin | <https://github.com/laurent22/joplin> | AGPL、SQLite + 插件体系，且它的同步是“笔记级” | 只抄冲突副本 UX 与 WebDAV 配置向导 |
| Nextcloud Deck | <https://github.com/nextcloud/deck> | PHP + 框架，代码不可移植 | 只抄交互与字段映射 |
| Nextcloud Tasks | <https://github.com/nextcloud/tasks> | 同上 | 只抄 VTODO 列表与子任务层级 |
| Nextcloud Calendar | <https://github.com/nextcloud/calendar> | 同上 | 只抄事件弹层与侧栏 |
| Vikunja | <https://github.com/go-vikunja/vikunja> | Go 后端，且数据模型是关系库 | 只抄看板 bucket 与任务详情 |
| Radicale | <https://github.com/Kozea/Radicale> | Python 服务端，不是客户端库 | 只抄 ETag / sync-token 协议行为 |
| Baikal | <https://github.com/sabre-io/Baikal> | PHP 服务端 | 只抄管理后台的信息架构 |
| Planka | <https://github.com/plankanban/planka> | **PLANKA Community License，非 OSI**，商用有额外限制 | 看板用 dnd-kit 自建（约 3 人日） |
| Focalboard | <https://github.com/mattermost-community/focalboard> | 维护放缓（2026-05 后基本停）、源码 AGPL / 编译 MIT 双轨，合规判断成本高 | 同上 |
| Wekan | <https://github.com/wekan/wekan> | Meteor 老栈，前端不可复用 | 同上 |

### 4.2 选型层

| 对象 | 链接 | 为什么不抄 | 替代 |
|---|---|---|---|
| react-big-calendar | <https://github.com/jquense/react-big-calendar> | 比 FullCalendar 旧、时区能力弱、2026-06 后少更新 | 保留 FullCalendar 6 |
| Obsidian Calendar 插件 | <https://github.com/liamcain/obsidian-calendar-plugin> | 2024-06 已停更 | 自建“日期点 + 点击进日记” |
| chrono-node | <https://github.com/wanasit/chrono> | 中文规则弱于我们 554 行的自研解析器；换掉会丢“11月5日下午三点”这类表达 | 保留自研，chrono 仅做英文/ISO 兜底 |
| `dateparser`（Python） | <https://github.com/scrapinghub/dateparser> | 违反“不重写 Python / 保持 Node”的技术决策 | 无 |
| `@nlpjs` | <https://github.com/nlpjs/nlp.js> | 包体大、维护弱、中文模型一般 | 无 |
| cal.com 整体 | <https://github.com/calcom/cal.com> | 它是“排期/预约”产品，不是日历+任务；数据模型是 event type / booking | 只抄可用性编辑器与预约页 UI |
| Motion | <https://www.usemotion.com/> | 闭源 | 不适用 |
| JWT 认证 | <https://datatracker.ietf.org/doc/html/rfc7519> | 无法即时吊销，单用户无收益 | 不透明 token + 哈希存储 |
| 整文件 diff3 | <https://github.com/bhousel/node-diff3> | 会破坏 `##` 块与 frontmatter | 条目内 diff3 |
| 为每条提醒建 timer | <https://nodejs.org/api/timers.html> | 定时器数量爆炸、重启丢失 | 单 tick + 最小堆 |

---

## 5. 建议的落地顺序（两周）

| 顺序 | 工作 | 依赖 | 预估 |
|---|---|---|---|
| 1 | 冲突副本命名 + 冲突列表 + 三栏 UI | 无 | 1.5 人日 |
| 2 | `mergeWorkspaceText` 字段级化 + node-diff3（条目内） | 无 | 2 人日 |
| 3 | 审计 If-Match 是否覆盖所有写路径；412 后自动“重拉 → 合并 → 重试” | 2 | 0.5 人日 |
| 4 | cmdk 命令面板（跳转/新建/同步/导出） | 无 | 1 人日 |
| 5 | 调度器改“单 tick + 最小堆”，周期任务换 croner | 无 | 1 人日 |
| 6 | Obsidian emoji 解析器（导入）+ 序列化（导出） | 无 | 2 人日 |
| 7 | 查询引擎子集 + `kind: smartlist` | 6 | 2–3 人日 |
| 8 | Schedule-X / dnd-kit 看板评估（可选） | 7 | 2 人日 |

前三项是**正确性**，中间三项是**体验**，最后两项是**扩展**。正确性没做完之前不要做看板。

---

## 6. 核实说明与许可提示

- **star / 活跃度**：全部通过 `https://ungh.cc/repos/<owner>/<repo>` 于 2026-11-03 读取，字段为 `stars` 与 `pushedAt`；star 会变，引用时请注明日期。
- **License**：优先读 `https://img.shields.io/github/license/<owner>/<repo>.json` 或 `https://img.shields.io/npm/l/<pkg>.json`；Joplin 与 Focalboard 直接读了仓库 `LICENSE` 原文。
- **未核实项**：Foam 的 License（GitHub 无法识别，疑 MIT）；Planka 的 SPDX 标识（仓库为自定义 Community License）；Nextcloud 冲突文件名的精确格式（官方文档页两次抓取失败，正文只引用链接，不给具体字符串）。
- **合规提示**：MIT / BSD / ISC / Apache-2.0 可作依赖或 vendor，需保留版权与许可声明；MPL-2.0（ical.js）是文件级 copyleft，动态依赖没问题，修改其文件需回馈；AGPL / GPL 项目（Logseq、Trilium、Joplin、Vikunja、Radicale、Baikal、Deck、Tasks、Planka 的社区版）**只抄思路，不复制代码**。ChronoMD 若尚未确定许可证，先按“与 AGPL 不兼容”处理，最安全。
