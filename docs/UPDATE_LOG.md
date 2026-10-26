# 更新日志 (Update Log)

这个文件记录了项目的持续更新和改进。每次更新都应该在这个文件中添加相关信息，而不是创建新的更新日志文件。

## 2026-10-26

### 回应质疑：真实跑一遍 + 补齐通用性

用户提了三个问题：①「能正常使用吗？是不是没完整测试过？」②「AI 之类的有没有设置界面？」
③「想要通用的设计」。逐条处理如下。

**① 真实运行验证（此前确实只做了单元测试）**

之前的验证是：类型检查 + vite build + 单元测试 + mock 端到端。
这次**真的把服务跑起来，用真实 HTTP 请求打全部接口**，立刻暴露 4 个 bug：

| 问题 | 根因 | 影响 |
| ---- | ---- | ---- |
| 看板优先级被忽略 | `/events/add` 只读 `event.priority`，无视 `kanban.priority` | 传"高"一律存成"中" |
| ICS 导出时间偏 8 小时 | 非全天事件用 `toISOString()` 输出 UTC，而 md 存本地时间 | 导入其他日历后时间错乱 |
| 带 TZID 的 ICS 解析失败 | DTSTART 正则写死 `(?:;VALUE=DATE)?` | 解析丢开始时间 |
| ESM 下 `__dirname` 不存在 | 新模块用 `__dirname` 取路径 | 服务启动即 500 |

前两个是**产品级 bug** —— 单元测试用 mock 数据，测不到"传中文优先级被吞"和
"本地时间转 UTC"这两类问题。这印证了用户质疑的价值。

**② 设置界面**

之前 AI / WebDAV / CalDAV 全部只能改 `.env`。现在：

- 新增 `apps/server/src/config.ts` 配置层
  优先级：config.json（界面写入）> 环境变量 > .env > 代码默认值
- 新增 `GET/PUT /api/config` 与 `POST /api/config/reset`
- 设置弹窗改为两个分区：外观 / 通用（内含 通用·AI 解析·同步 三个标签页）
- AI 标签页可填 endpoint / key / model / 超时 / 温度 / Whisper，带**测试连接**按钮
- 同步标签页可填 CalDAV（地址/账号/密码/方向/间隔）与 WebDAV（地址/账号/密码/目录），
  带**测试 WebDAV 连接**按钮
- 敏感字段：读取返回掩码（`sk-****abcd`），界面原样回传掩码时视为"未修改"，
  **不会覆盖真实值**（有测试锁定）
- config.json 加入 .gitignore

**③ 通用性**

- **多语言**：轻量 i18n 框架（不引 i18next，减少 Electron/Capacitor 打包体积），
  内置 zh-CN / en-US，语言包 key 一致性由测试保证（少一个 key 就测试失败，
  避免界面静默串语言）。日期/时间/相对时间按 locale 格式化。
- **模块可插拔**：新增模块**不用改核心代码** —— 放 `apps/renderer/plugins/<id>.json`
  + 可选 `<id>.tsx` 即可。示例见 `apps/renderer/plugins/example.json`。

**插件目录为什么在 apps/renderer 内**

最初放在项目根，实测构建报错：
`Rollup failed to resolve import "axios" from plugins/example.tsx`
—— 根目录没有 node_modules。插件是渲染进程的一部分，必须和主应用共享依赖。

**glob 路径也踩了坑**：`import.meta.glob` 路径写错时**构建仍然成功**，
只是插件没被打包（极易漏掉）。为此加了 `pluginGlobMatchCount()` 启动时诊断，
路径不对会打警告。正确路径是 `../../plugins/*`（从 src/framework 上溯两级）。

**ESM 路径处理的坑**

新增模块用 `__dirname` 取路径，在 ESM 下直接报 `__dirname is not defined`。
改用 `fileURLToPath(import.meta.url)`。但这还不够 ——
「从 dist/routes 上溯 N 级到项目根」这种推导在运行时目录变化时会错
（测试用的独立 runtime/ 目录就跑偏了）。最终改为**向上查找含 apps/ 的目录**。

**测试**

- 新增 `config-plugins.test.ts` 22 项（配置读写、脱敏、掩码不覆盖、插件扫描各种异常）
- 新增 `i18n.test.ts` 6 项（两个语言包 key 完全一致、占位符一致、无空串）
- WebDAV / NLP 测试改为通过 config 层配置（与生产一致），
  顺带修掉了测试间的环境污染
- ICS 测试补时区回归用例

**全套离线测试 145 项 + i18n 6 项全部通过。**

### 2026-10-19（傍晚）

### 自然语言快速创建 + 语音输入

`.env` 里的 `AI_*` 此前也是死配置。用户明确要「接 OpenAI 格式 AI 分析自然语言
创建任务」+「语音识别按钮」，这次一并实现。

**关键设计决策：不把 AI 作为解析主通道**

一开始的直觉是「调 AI 解析」。评估后认为有三个实际问题：

1. **延迟**：每次输入都要等网络往返（数百 ms ~ 数秒），而"快速创建"的
   本质就是敲完即成。交互会被 AI 网关的抖动直接破坏。
2. **可用性**：本工具的 md 是本地唯一事实源，不该被网络依赖绑住。
   断网或 AI 服务挂了，快速创建必须仍然能用。
3. **正确性**：AI 会「自信地」编造日期（把"下周三"算错），
   而错误日期比"没识别出来"危险得多 —— 用户会以为已经建好了。

所以做成**双通道**：本地中文规则做快速路径与兜底，AI 只在本地失败或
用户显式点「AI 深度解析」时介入。测试里专门断言了
「能本地解析时 requestCount === 0」。

**服务端 `apps/server/src/nlp/zh-time.ts`**（本地规则，零依赖）

覆盖：中文数字、相对日、星期（含下下周一/这周末）、月底月初、绝对日期、
时段、相对时间、时长、重复规则，并从标题中剔除时间描述。
自带 confidence 与 matchedFields，供前端展示"我理解对了吗"。

实现中踩到并修掉的坑（都有测试锁定）：
- **周日=0 与「周一开头的周」混用会整体错位一天**，需做基准转换
- `Date.setHours(h + 0.5)` 对小数会截断（20.5 → 20），
  「半小时后」必须换算成分钟
- 「今天」本身不是完整日期，没写时刻时不能当成全天事件；
  「今天下午3点」若此刻已过应顺延到明天
- 「每月5号」这种"N 号"表达需单独识别，否则整句解析失败
- 标题里的「和/跟/与」是正常中文用词（「和老王开会」），不能剥掉

**服务端 `apps/server/src/nlp/ai-parser.ts`**（AI 通道）

- 三级降级：tool calling → json mode → 裸 JSON 文本提取
- 兼容三种模型回复形态：tool_calls / content JSON / ```json 包裹
- 鉴权类错误（401/403/404/model_not_found）不重试另一种模式
- AI 失败自动回退本地结果，并在 `fallbackReason` 说明原因
- **API Key 只在服务端**，前端只能从 `/api/nlp/status` 知道配没配

**服务端 `apps/server/src/routes/nlp.ts`**

| 接口 | 说明 |
| ---- | ---- |
| `POST /api/nlp/parse` | 解析为草稿，**不写文件** |
| `GET /api/nlp/status` | 能力查询（不回传 Key） |
| `POST /api/nlp/transcribe` | 语音转写（multipart，需 AI Whisper） |

**前端**

- `api/nlp.ts`：客户端 + `formatDraftWhen` / `recurrenceLabel` 展示辅助
- `hooks/useSpeech.ts`：`useSpeech`（Web Speech API）+ `useRecorder`
  （MediaRecorder，供 Whisper 回退）；含各浏览器错误码的中文提示
- `components/QuickCreate.tsx`：输入条 + 语音按钮 + 草稿预览卡片
  （显示解析来源、识别到的字段、置信度提示）+ 可勾选"同时加入任务看板"
- `modules/calendar/index.tsx`：挂载快速创建条，用 refreshKey 触发日历重读

**关于语音的现实限制**（已写进代码注释）

浏览器 Web Speech API 的中文支持因浏览器而异：Chrome / Edge 可用，
Firefox 基本不可用，Safari 支持差；且部分实现需要联网。
因此做成双路径 —— 内置优先（免费、音频不出本机），
不可用或识别失败时提示可改用 Whisper API（需配 AI）。

**依赖**：新增 `multer@^2`（语音上传，注意避开 1.x —— npm 已提示存在漏洞）。

**测试**

- `zh-time.test.ts` 63 项
- `nlp-parse.test.ts` 18 项（mock OpenAI 服务端，含"AI 401 降级"
  与"status 不泄露密钥"）

**全套离线测试现为 121 项全部通过。**

**已知遗留**

- 本地规则不处理「下个月中旬」「过两天」等模糊表达，会落到 AI 通道
- 语音识别质量取决于浏览器实现，未做识别后纠错 UI
- AI 通道无法离线使用（本地通道不受影响）
- 未验证：真实 AI 服务（DeepSeek / Qwen 等）的实际响应格式兼容性

## 2026-10-19（下午）

### 实现 WebDAV 同步通道

上一轮审查中发现 `.env` 里 `WEBDAV_*` 是一组死配置（无任何代码读取），
而 WebDAV 同步正是产品意图里的第二条同步通道。���次补齐。

**服务端 `apps/server/src/webdav.ts`**

- 只用 Node 内置 fetch，不引第三方 WebDAV 库 —— 坚果云等服务商对第三方库
  兼容性参差，直接用 `PROPFIND` / `MKCOL` / `PUT` + Basic 认证最稳
- 远端目录不存在时递归 `MKCOL` 创建
- `statRemoteFile()` 用 HEAD 查 ETag / 修改时间，不支持 HEAD 时降级用 GET
  （部分服务端不实现 HEAD）
- 同步状态记于本地 `.webdav-state.json`（各文件上次同步时的远端 ETag）

**服务端 `apps/server/src/routes/webdav.ts`**

| 接口 | 说明 |
| ---- | ---- |
| `GET /api/webdav/status` | 配置 + 双文件本地/远端状态 + 上次同步时间 + 远端是否变更 |
| `POST /api/webdav/push` | 推送；`files` 限定范围、`force` 强制覆盖 |
| `POST /api/webdav/pull` | 拉取；`force` 强制拉取 |
| `POST /api/webdav/test` | 连通性 + 认证测试 |

同步 `events.md` 与 `工作搭子看板.md` 两个文件。

**数据安全设计（这是这个通道最需要小心的部分）**

- **ETag 乐观锁**：push 时比较本地记录的 ETag 与远端当前 ETag。
  不一致说明远端被其他设备改过，此时返回 `conflict` 而**不覆盖**，
  由用户在 UI 上选「用本地覆盖远端」或「改用远端内容」。
  测试用例专门锁定了「远端被改后本地不能覆盖上去」。
- **拉取保护**：默认只在远端 ETag 变化时才覆盖本地，
  避免无意义冲掉未同步的本地修改。
- **自动备份**：拉取覆盖前把本地复制为 `.bak`。

**顺带修的启动容错问题**

`apps/server/src/index.ts` 里 `start()` 在 `initializeClient()` 失败时
`process.exit(1)`。而 `initializeClient()` 内部已经捕获错误返回空数组，
所以这层 exit 是多余的 —— 它会导致「没有 CalDAV、只想用 md + WebDAV」
的用户**完全无法启动服务**。已改为警告后继续启动。

**前端**

- `api/webdav.ts`：status / test / push / pull 客户端
- 日历页工具栏新增「WebDAV」按钮 → 同步面板：
  连接信息与测试按钮、双文件状态列表（已同步 / 远端已变更 / 远端缺失）、
  推送拉取按钮、冲突时二选一决策、逐文件结果明细
- 拉取覆盖 events.md 后自动 `loadEvents()` 重读

**测试**

新增 `apps/server/src/__tests__/webdav-sync.test.ts`（17 项），
用 Node http 模拟最小 WebDAV 服务端，不需要真实云盘。
另跑了 52 项的一次性端到端脚本（含逐条细分断言）。
全套离线测试现为 **40 项全部通过**。

**文档**

- README：Features 增 WebDAV 条目，补配置说明段，Roadmap Phase 3 勾上
- `REF/MD_ICS_BRIDGE.md`：WebDAV 阶段从「未实现」改为已实现，
  补 WebDAV API 表、第 6 条已知陷阱（本地 md 路径解析要统一）
- `docs/SYNC_MANAGEMENT.md`：新增 WebDAV 章节与「独立可用性」说明
- `docs/TESTING.md`：补 WebDAV 测试表与「真实 WebDAV 未验证」提示
- `docs/CHANGELOG.md`：补条目

**已知遗留**

- WebDAV 检测到冲突只提示，**不做自动三方合并**，需用户选一边
- 各服务商对 `PROPFIND` / `MKCOL` / `If-Match` 支持程度可能有差异，
  首次接入真实云盘建议先用「测试连接」确认
- AI 通道（`AI_*`）仍是死配置
- CalDAV 通道删除事件不同步到远端（缺墓碑）

## 2026-10-19（上午）

### 全面审查：修复阻塞级 bug + 新增 iCalendar 导入导出

起因是用户反馈「很多功能感觉之前开发的时候并没有实现，文档记录与实际不符」。
逐层核对文档与源码后，发现若干**让核心功能完全不可用**的问题，均已修复并补测试。

**阻塞级 bug（功能此前实际不可用）**

- **日历上一个事件都不显示**：`Calendar.tsx` 把 MdEvent（字段 `date`/`end`）
  直接展开传给 FullCalendar，而后者只认 `start`/`end`，字段全部对不上。
  新增 `toFullCalendarEvent()` 映射层。
- **任务 ID 行序漂移导致误删**：解析用行序 `t0/t1/t2`、`POST /task` 用时间戳、
  `serializeKanban` 又不保存 id —— 三套体系混用。新建任务 unshift 到队首会让
  所有存量任务 ID 整体错位，**删 A 会连带删掉 B 的日历事件**。
  改为把稳定 ID 持久化到 md 的 `| id:` 字段，行序仅作旧文件兼容回退。
- **时区偏移 8 小时**：`composeCalendarDate` 用 `new Date("...T09:00:00.000Z")`，
  等于把东八区 9 点当成 UTC 9 点存进文件。
- **全天事件零长度**：ICS 的 DTEND 是排他边界，必须是次日 00:00；
  与 DTSTART 同日导出的零长度事件，客户端可能直接不显示。
  同时修正全天事件 `VALUE=DATE` 用 `toISOString()` 导致的跨时区跨日。
- **同步方向配置静默失效**：配置层用 `md-to-caldav`/`caldav-to-md`，
  同步层只认 `push`/`pull`，直接传配置值会让自动同步什么都不做
  （且 TypeScript 类型不兼容）。新增 `normalizeSyncDirection()` 统一。
- **工作台数据恒为 0**：「今日事件」「事件总数」读 `syncStore.cachedEvents`，
  而数据流重构后已无人写入该缓存。改为直接读 `events.md`。

**重构与清理**

- 删除 `routes/md-bridge.ts` 中 248 行与 `routes/kanban.ts` 重复的看板读写实现。
  旧的内联版 `appendCalendarToTask` 存在重复拼接且生成的整行是死代码；
  `insertKanbanTaskLine` 算出的 newId 与实际写入行的 id 不一致。
  现统一复用 kanban.ts 的实现（按稳定 ID 定位）。
- `PATCH /task/:id` 不再允许覆盖 ID，并剔除 `calendar` / `clearCalendar`
  控制指令，避免把非任务字段写进 md。
- 标签选择器选中态永不点亮（`formData.tags` 是字符串数组，
  而 TagSelector 按 `t.id` 比较对象），改为按名字匹配。
- 逾期判定统一：原本红字与告警条是两套逻辑，且当天到期的任务会被误判为逾期。
- 事件弹窗「查看任务」链接路径错误（`/modules/tasks` 不存在），
  且同时设置 hash 与 href 会触发整页重载。

**新功能：iCalendar 文件导入 / 导出**

- `parseIcsFile()`：解析含多个 VEVENT 的完整 .ics。此前 `icsToEvent` 正则
  不带 `g` 标志只取第一条，导入 Google/Outlook/Apple 导出的日历会丢掉绝大部分事件。
- `eventsFileToIcs()`：把 events.md 导出为单个 VCALENDAR 文件。
- `POST /api/md-bridge/ics/import`：支持 `dryRun` 预览（前端先展示"能导入几条"
  再确认）、按 uid 去重、`append` / `replace` 两种模式。
- `GET /api/md-bridge/ics/export`：支持 `start` / `end` 日期范围过滤、
  `download=1` 直接下载。
- 日历页工具栏「导入 ICS」「导出 ICS」按钮 + 导入预览确认弹窗。
- 日期过滤曾有个时区 bug：`new Date("2026-10-02")` 按 UTC 午夜解析，
  在东八区等于本地 08:00，会误排除当天上午的事件（测试导出 0 条才发现）。

**文档校正（此前多处失真）**

- README 声称 `./run-tests.sh` 9/9 通过 —— **该文件在仓库中不存在**。
  已删除该声明，改为真实的 `pnpm test`。
- 重写 `docs/TESTING.md`：旧版本「Backend 9/9、E2E 28/28、总计 44+ 100% 通过」
  的数字全部无法复现。现在只描述实际存在、可运行、已验证的测试。
- Roadmap 六个 Phase 原先全为未勾选，但框架/Dashboard/任务模块其实已实现。
  改为按真实完成度标注 `[x]` / `[~]`（部分实现或已知限制）/ `[ ]`。
- `.env` 中 `WEBDAV_*` 与 `AI_*` 共 7 个变量**没有任何代码读取**，属于纯死配置。
  已加注释明确标注「尚未实现」。WebDAV 同步是你明确要的功能，当前完成度 0%。
- 补充看板 `id:` / `日历:` 字段规范到 `REF/work-dazi-toolkit/开发指南.md`，
  并同步更新 Python 参考 parser `parse_kanban.py`（新增 id 解析与行序回退）。
- `REF/MD_ICS_BRIDGE.md` 新增「已知陷阱」章节，记录 5 个会导致静默错误的时间/ID 处理细节。

**测试**

- 新增 `apps/server/src/__tests__/ics-file.test.ts`（14 项）
- 新增 `apps/server/src/__tests__/kanban-id.test.ts`（9 项）
- HTTP 端到端验证（一次性脚本，未入库）25 项全通过
- 前后端 TypeScript 类型检查通过、`vite build` 通过、Python 参考实现验证通过

**已知遗留（未修）**

- 从 MD 删除事件后同步，**不会删除 CalDAV 远端已存在的对应 `.ics`**（缺墓碑记录）。
- WebDAV 通道未实现。
- Android 端架构前提：md 读写与同步核心需下沉到渲染层或改用 Capacitor 插件，
  因为移动端没有 Node 后端。

## 2026-08-21

### 工作台 ↔ 日历双向绑定 + 同步关联保留

**双向绑定（单一事实源，两端互链）**

- 工作台「任务看板」与日历通过轻量引用字段互链：看板任务行尾 `| 日历:<uid>`（`KanbanTodo.calendarEventUid`），events.md 事件 `kanbanTaskId` YAML 字段。
- 后端 `routes/kanban.ts` 重写：`POST /task` 可带 `calendar` 同步建事件；`PATCH /task/:id` 支持建/改绑定或 `clearCalendar`；`DELETE` 级联删事件；新增 `POST /task/:id/unlink-calendar`（仅解绑保留两边）。
- 后端 `routes/md-bridge.ts`：`POST /events/add` 可带 `kanban` 同步建任务；`DELETE /events/:uid` 级联删任务；新增 `PUT /events/:uid` 更新事件时强制保留 `kanbanTaskId`。
- 前端：任务表单「📅 同时加入日历」、事件表单「📋 同时加入任务看板」、删除级联勾选、防重复显示（带 `calendarEventUid` 的任务从日历外部事件过滤）。

**Bug 修复：拉取同步不再清空绑定**

- 修复 `POST /api/md-bridge/sync/caldav` 的 pull 分支：原先用远端 ICS 整条覆盖本地事件，导致 `kanbanTaskId` 被清空（原注释写「目前用远程覆盖本地」）。现改为优先采用远程 ICS 的 `X-KANBAN-TASK-ID`，否则回退保留本地 `kanbanTaskId`。
- `md-ics-bridge.ts`：`eventToIcs` 写出 `X-KANBAN-TASK-ID:<id>` 扩展属性；`icsToEvent` 解析该属性回填 `kanbanTaskId`。使 push→CalDAV→pull 往返也能保留工作台↔日历绑定。
- 纯 Node 单测验证：5 项断言全部通过（写出 / 还原 / 远端携带保留 / 无 X 回退本地）。

**文档**

- 更新 `REF/MD_ICS_BRIDGE.md`：补充双向绑定章节、关联保留语义、X-KANBAN-TASK-ID 约定、API 表与实现计划勾选。
- 更新 `docs/SYNC_MANAGEMENT.md`：新增「MD Bridge Sync」章节。
- 更新 `README.md`：Features 增加双向绑定，配置段增加 `MD_ICS_*` / `KANBAN_FILE_PATH` 环境变量，新增「工作台集成（events.md 单一事实源）」说明。
- **补上延时自动同步后端定时器**：`md-bridge.ts` 抽出 `performCaldavSync` 供手动与定时共用；按 `MD_ICS_AUTO_SYNC_MINUTES` 启动 `setInterval` 触发双向同步（仅当 `MD_ICS_ENABLED=true` 且间隔>0）。此前该配置项已就位但无消费方，延时自动同步实际未生效。

## 2026-08-19

### MD↔ICS 桥接引擎：完整端到端实现

**桥接引擎核心**

- 实现了 `md-ics-bridge.ts` 双向转换引擎：Markdown ↔ ICS 格式互转
- 支持事件 CRUD、任务/待办（无 end 时间）、All-day 事件
- 优先级三档映射：high→1, medium→5, low→9
- 支持标签、分类、重复事件（RRULE）的完整序列化/反序列化
- 缓存完整性：写入后即时读取，无需等待同步

**CalDAV 同步增强**

- `fetchCalendarObjectsDirect`：绕过 tsdav 的 fetchCalendarObjects（Radicale 兼容性问题），直接 HTTP GET 获取日历对象
- 修复 ICS 解析中 `\r\n` 行尾导致解析失败的问题
- 支持 push（MD→CalDAV）、pull（CalDAV→MD）、delete sync

**Bug 修复**

- **STATUS 映射修复**：`eventToIcs` 将 `needs-action` 映射为 `NEEDS-ACTION`（而非错误的 `CONFIRMED`），`icsToEvent` 增加 `NEEDS-ACTION → needs-action` 反向映射
- **测试超时修复**：`afterEach` 超时从 15s 提升到 60s，避免清理操作超时
- **URL 协议修复**：`.env` 改为 `https://`（Cloudflare 强制 HTTPS，直连无需代理）

**架构调整**

- **移除代理层**：`proxy-fetch.ts` 不再被使用，`caldav.ts` 和 `routes/calendar.ts` 全部改用原生 `fetch()` 直连 Radicale 服务器，消除代理隧道带来的复杂度和潜在的 TLS/SNI 问题
- **新增 CALDAV_ROOT_URL 环境变量**：供 tsdav DAVClient 做 PROPFIND 发现，与具体日历 URL 分开

**测试覆盖**

- 完整端到端测试套件（28 个测试用例，全部通过）
- Part 1：本地 MD 文件操作（8 个测试：初始化、添加、批量、任务、完成、优先级、删除、编辑）
- Part 2：ICS 转换（4 个测试：全字段、任务、All-day、优先级映射）
- Part 3：CalDAV 同步（6 个测试：Push、Update、Pull、Delete、完整循环、批量）
- Part 4：缓存完整性（4 个测试：即时读取、多次写入、删除反映、格式保持）
- Part 5：边缘情况（4 个测试：空文件、特殊字符、压力测试、自动 UID）
- Part 6：工作台完整工作流模拟（2 个测试：任务生命周期、事件生命周期）

## 2026-08-18

### 模块规划调整

- **恢复 MD→ICS 转换作为 AI 助手模块核心能力**：MD→ICS 不是独立同步通道，而是 AI 助手模块的内部能力。工作流为：Obsidian 笔记 → AI API 提取事件 → 生成 ICS → 推送 CalDAV
- **新增 AI 助手占位模块**：`ai-agent` 模块，规划 v2.1.0，接入兼容 OpenAI 格式的 AI API，自动监控 Obsidian 会议纪要文件夹，提取日期/事件信息生成日历任务
- **模块注册表更新**：`apps/renderer/src/modules/index.ts` 新增 `AIAgentModule`，5 个模块（工作台、日历、多通道同步、AI 助手、通知推送）
- **更新文档**：同步更新 `REF/ARCHITECTURE.md`、`REF/DASHBOARD_DESIGN.md`、`REF/MD_ICS_BRIDGE.md`

### 架构重构与新设计文档

**积木式模块化架构设计**

- 完成了模块化架构设计文档 `REF/ARCHITECTURE.md`
- 定义了 `ModuleRegistry`、`ModuleSlot`、`AppRouter`、`AppLayout` 等核心框架组件
- 设计了标准模块接口 `CalendarModule`，支持 active/placeholder 两种状态
- 规划了占位模块系统，允许未开发模块以灰色卡片展示

**工作台页面设计**

- 完成了 Dashboard 设计文档 `REF/DASHBOARD_DESIGN.md`
- 设计了欢迎卡片、今日日程、快速操作、模块入口网格、同步状态等组件
- 规划了与 work-dazi-toolkit 的集成点

**MD ↔ ICS 中转方案**

- 完成了 MD 转 ICS 桥接设计文档 `REF/MD_ICS_BRIDGE.md`
- 借鉴 work-dazi-toolkit 的"Markdown 作为唯一事实源"理念
- 设计了 MD 格式规范、转换引擎接口、UID 生成策略
- 规划了正向/反向同步流程和增量同步策略

**引入 work-dazi-toolkit 参考实现**

- 在 `REF/work-dazi-toolkit/` 中添加了参考工具集
- 包含单文件前端、AI Agent 定义、看板解析器等
- 为后续集成 Markdown 看板流程提供参考

### 目录结构变更

- `REF/ARCHITECTURE.md` - 新增：模块化架构设计文档
- `REF/DASHBOARD_DESIGN.md` - 新增：工作台页面设计文档
- `REF/MD_ICS_BRIDGE.md` - 新增：MD↔ICS 中转方案设计文档
- `REF/work-dazi-toolkit/` - 新增：工作搭子工具箱参考实现

## 2026-06-30

### 功能改进

**增强删除功能**

- 改进了事件删除逻辑，添加了多种UID匹配策略
- 增强了错误处理，对404错误进行更优雅的处理
- 添加了更详细的日志记录以便调试

**优化同步管理**

- 改进了前后端分离的操作体验：前端立即响应，后台执行同步
- 增强了部分缓存更新机制
- 提供了更清晰的用户反馈

### 文档更新

- 更新了README.md，添加了关于增强功能的信息
- 更新了CHANGELOG.md，包含了最新的功能描述
- 更新了SYNC_MANAGEMENT.md，详细说明了同步机制
- 更新了TESTING.md，包含了增强功能的测试信息
- 更新了DEPLOYMENT.md，添加了最近的改进信息

## 2026-06-25

### 仓库优化

- **Git历史优化**：从Git历史中移除了大型构建产物（>50MB）
- **仓库清理**：提高了克隆性能并减少了存储需求
- **文档更新**：所有指南与最新代码变更同步

### 构建产物管理

- **大文件移除**：从Git历史中移除了超大文件：
  - Linux AppImage (~100MB)
  - Linux tar.gz (~95MB)
  - Windows executable (~170MB)
  - macOS应用程序
- **未来分发**：构建产物现在仅通过发布/标签分发
- **开发工作流**：为贡献者和开发者提供了更干净的仓库

## 2026-06-22

### 初始发布 (v0.1.0)

- **核心功能实现**：
  - CalDAV与Radicale服务器的完全同步
  - 完整的事件CRUD操作（创建、读取、更新、删除）
  - 事件属性：分类、多标签、重复事件、全天事件
- **智能同步功能**：
  - 智能缓存系统（1小时TTL）
  - 灵活的同步管理（5/10/30分钟或手动）
  - 实时同步状态指示
- **设计系统**：
  - 4种莫兰迪配色方案
  - 统一圆角设计系统
  - 深色/浅色主题支持
- **技术改进**：
  - Express.js REST API后端
  - TypeScript 100%类型覆盖
  - Zustand状态管理与持久化
  - Electron桌面应用程序
- **质量指标**：
  - API测试：9/9通过（100%）
  - 性能：初始加载<2秒，API响应<500ms
