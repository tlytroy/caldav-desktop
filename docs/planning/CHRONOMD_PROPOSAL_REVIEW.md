# ChronoMD 提案评估与架构决策建议

> 日期：2026-11-02
> 评估对象：用户提出的 ChronoMD 产品/架构方案（Markdown 唯一数据源、Task/Event/Time Block、VTODO、SQLite 索引、Python/FastAPI、AI Command Layer、Docker/NAS）
> 对照物：当前代码库（Node/TS + React，单 `workspace.md`）与 `docs/planning/v0.3-plan.md`
> 结论：**方向大体正确，但不能按提案直接重写；先完成 v0.3 数据安全/认证，再用 v0.4 spike 决定数据层**

---

## 0. 结论摘要

| 判断 | 内容 |
| ---- | ---- |
| **强烈赞同** | MD 是唯一事实源、ICS 是投影；Task/Event/Time Block 分离；VTODO；稳定 UID；AI Command Layer；索引可重建；Docker/NAS；PWA |
| **可以采纳但延后** | 多日历集合、时间块、AI 审计/撤销、Git 历史、SQLite 全文索引、项目实体 |
| **现在不能做** | 一任务一文件（多文件仓库）整体重写；Python/FastAPI 重写；SQLite 作为事实源；把 sync 元数据写进 MD |
| **需要数据验证** | 单文件 vs 多文件、SQLite 索引是否需要、时区模型（floating vs TZID） |
| **路线** | v0.3（18–24 人日，不变）→ v0.4 语义 + VTODO + AI 层 → v0.4.5 数据层 spike → 再决定多文件/索引 |

一句话：**ChronoMD 的产品判断是对的，但它描述的是 v1.0 架构；当前项目已经在 v0.2.x，不能为了架构美学把 30k 行、456 个测试和已跑通的同步/推送全部推倒。**

---

## 1. 与当前架构对齐的部分（应采纳）

| 提案 | 当前状态 | 评价 |
| ---- | -------- | ---- |
| MD 是唯一权威数据源，ICS 是投影 | 已是（`REF/DATA_SOURCE.md`、`MD_ICS_BRIDGE.md`） | ✅ 完全一致 |
| 任务/日程/时间块分离 | 当前只有 `kind: task/event`，任务带 `start` 会被当 VEVENT | ✅ 方向正确，是当前最大语义债 |
| 任务用 VTODO，不硬塞 VEVENT | 当前只导出 VEVENT（`ics-convert.ts` 只有 `BEGIN:VEVENT`） | ✅ 应尽快补 |
| 稳定 UID，不用标题/路径 | 当前有 `id` + `uid`，CalDAV 已持久化 | ✅ 已具备，需扩展到多文件场景 |
| ETag/版本/来源/冲突日志 | 当前有 ETag、字段指纹、三选一合并 | ✅ 基础在，缺「来源」与审计 |
| AI 不直接乱改文件，先校验 | 当前 quick create 走 API + schema 校验 | ✅ 已有雏形，缺通用 command layer |
| 索引丢失可从 MD 重建 | 当前无索引；若加必须遵守 | ✅ 原则正确 |
| Docker/NAS/PWA | 已实现并验证 | ✅ 一致 |
| 不要直接改 Radicale 存储 | 当前走 CalDAV 协议 | ✅ 一致 |

---

## 2. 关键分歧

### 2.1 单文件 `workspace.md` vs 一任务一文件

**提案主张**：每个任务/日程/项目一个 MD 文件，理由是可读、Obsidian 友好、WebDAV 冲突粒度细、AI 改小文件、避免单文件过大。

**当前架构**：一个 `workspace.md`，`##` 块 + 字段行，单文件原子写、单锁、单文件 WebDAV、备份恢复简单、AI 一次看到全量上下文。

#### 多文件的真实成本（不是「拆文件」那么简单）

| 问题 | 具体后果 |
| ---- | -------- |
| 跨文件事务 | 创建任务 + 3 个子任务 + 项目关联 = 5 个文件；崩溃/冲突时半写，需要 journal 或「索引即事实源」（与提案矛盾） |
| 文件即路径 | 重命名/移动/大小写/非法字符/中文编码；路径不能当 ID，仍需索引 |
| 文件监控 | 5k 文件 chokidar 事件风暴；rename 识别；外部 AI 一次改 100 个文件的 debounce |
| WebDAV 目录同步 | PROPFIND 全目录、逐文件 ETag、删除/移动传播；NAS 上小文件 RTT 远高于单文件 |
| 一致性 | 任务引用不存在的项目、子任务 parent 丢失、重复 ID，需要全库校验 |
| 备份/恢复 | 单文件是「复制一个文件」；多文件要保证目录快照一致 |
| AI | 全库上下文需要检索/索引；AI 改错文件/删文件的影响面更大 |
| 迁移 | 当前块格式 → YAML frontmatter 是**数据格式迁移**，不是目录调整；所有解析/序列化/测试/同步状态要重做 |

#### 单文件的真实成本

- 合并粒度粗：WebDAV 只能整文件（当前有 `.bak` + 三选一 + 条目级 union merge 缓解）。
- 文件变大：1 万条约几 MB；解析/序列化在 Node 里仍是毫秒级，但每次写全量。
- AI 上下文：全量塞给模型会贵；需要检索/摘要（与多文件一样需要索引）。
- Obsidian 图谱不友好。

#### 建议

1. **v0.3 不动数据层**。当前 18–24 人日的锁/原子写/round-trip/备份恢复，是任何数据层的前提；先拿到「不丢数据」。
2. **v0.4.5 做 2 周 spike**，用数据决定：
   - 写一个 `workspace.md ↔ vault/` 双向转换器（仅 CLI/测试，不做 UI）；
   - 合成 1k / 5k / 20k 条数据，测解析、写入、内存、WebDAV 单次变更、两客户端冲突率、AI token；
   - 原型「多文件 + journal + 索引」的创建/删除/恢复，验证跨文件一致性；
   - 输出 ADR：继续单文件 / 迁移多文件 / 混合（单文件主库 + 导出 vault）。
3. **无论选哪条，先做 `vault 导出`**（单向）：用户可以把 `workspace.md` 导出为「一任务一文件」的 Obsidian 仓库；这满足透明/可读，不立即承担多文件写入的复杂度。
4. 若最终选多文件：作为 **v0.5 大版本**，提供迁移工具 + 回滚（导出前快照），不要混在 v0.3 里。

**判断**：提案的多文件方向在产品上成立，但它是 v1.0 数据层，不是当前迭代能安全吞下的改动。**现在切 = 重写，不是演进。**

---

### 2.2 Node/TypeScript vs Python/FastAPI

**提案**：后端 Python + FastAPI，理由是 MD 解析、ICS、AI 数据处理适合 Python。

**现实**：

- 当前后端约 1.8 万行 TS（含测试），17 个测试文件、360 个测试；前端约 1.3 万行、96 个测试。
- CalDAV/WebDAV、同步状态机、冲突合并、提醒调度、六种推送、Docker 静态托管都已跑通。
- Python 的优势主要在 AI/数据科学库；但 LLM 调用是 HTTP，Markdown/ICS 解析在 TS 生态同样成熟（当前已实现）。
- 重写 Python 意味着：重写 30k 行、重跑 456 个测试、重新踩 CalDAV/ETag/时区/推送的坑；双语言还会增加构建/部署/招聘/调试成本。

**建议**：

- **不重写**。继续 Node/TypeScript 单后端。
- 如果未来需要 Python 的特定库（如本地 OCR/向量检索），做成**可选 sidecar**（独立进程、HTTP/gRPC），不让它碰事实源。
- SQLite 索引与语言无关；Node 可用 `better-sqlite3`（注意 Alpine 原生编译）或 Node 22 的 `node:sqlite`（实验性），先评估。

**判断**：Python 不是这个产品的关键差异；**AI 能力取决于 command layer 与 schema，不取决于后端语言**。

---

### 2.3 SQLite 索引

**提案**：SQLite 只做索引/缓存，丢失可从 MD 重建；FTS5 全文搜索。

**评价**：原则正确，但现在加是过早优化：

- 当前数据量小，前端已能过滤/搜索；没有性能数据证明需要。
- 加索引 = 文件监控 + 增量更新 + 重建 + 迁移 + Docker 原生依赖 + 测试；成本不低于一个功能。
- 若做多文件，索引从「可选」变「必需」；所以**索引决策跟随数据层决策**。

**建议**：

- v0.3 不做。
- v0.4 若单文件超过 ~5k 条或搜索明显卡顿，再加「可重建索引」；先做 JSON/内存索引，不够再 SQLite。
- 若加 SQLite：只存 `id → path/fields` 与 FTS，启动时校验 MD mtime/哈希；删除 DB 必须能全量重建；禁止业务写入只写 DB。

---

### 2.4 Task / Event / Time Block 语义

**提案**：三者分离；任务有 `scheduled`（计划执行）与 `due`（截止）；时间块是独立对象，关联任务；完成时间块不等于完成任务。

**评价**：**这是提案中最有价值的部分**。当前模型的问题：

- `kind: task` 只要有 `start` 就被当事件同步（`calendarItems` 过滤 start），任务与日程语义混淆；
- 没有「计划执行时间」与「截止时间」的区分；
- 没有时间块，无法表达「14:00–16:00 写报告」与「18:00 截止」并存。

**建议**（可单文件实现，不需要多文件）：

- 新增 `scheduled`（可选，本地时间）与 `timeblock` 类型/关联字段；
- `task` 不再因为 `start` 自动变 VEVENT；`start/end` 只属于 event/timeblock；
- 时间块：`kind: timeblock` + `taskId`（或 `parent`），独立完成状态；
- 数据迁移：现有带 `start` 的 task 视为「task + 一个 timeblock」或保留兼容，SDS 里定；
- UI：日历显示 event + timeblock；「未安排任务」单独视图。

这是 v0.4 的核心，不需要等数据层重写。

---

### 2.5 VTODO

**提案**：任务用 VTODO，三个日历集合（Events/Tasks/Time Blocks），验证客户端兼容性。

**评价**：**正确且优先级高**。当前只导出/同步 VEVENT，due-only 任务根本不进 CalDAV；这是真实功能缺口。

**建议**：

- v0.4 先做**一个 Tasks 集合**的 VTODO（`STATUS:NEEDS-ACTION/IN-PROCESS/COMPLETED/CANCELLED`、`COMPLETED`、`DUE`、`PRIORITY`、`PERCENT-COMPLETE` 可选）；
- 不急于三个集合；先验证 Radicale + 至少一个手机客户端（iOS/Android）的 VTODO 读写/完成回写；
- 建兼容性矩阵（客户端 × 读取 × 完成回写 × 重复 × 子任务）；
- 时间块仍用 VEVENT，通过 `RELATED-TO`/内部 ID 关联；完成时间块不改任务状态；
- 当前 CalDAV 同步引擎需支持 VTODO 解析/生成与字段映射，工作量中等（不是「加个 BEGIN」）。

---

### 2.6 把 `sync` 元数据写进 MD

**提案**：每个对象记 `sync.md_revision/ics_revision/last_sync_source/etag`。

**反对**：

- 每次同步都改 MD → 触发文件监控/WebDAV 上传 → 又触发同步，**正是提案自己警告的循环**；
- 同步元数据是缓存/日志，不是用户数据；写进 MD 会污染 diff、备份、AI 上下文；
- 多设备会互相覆盖 revision。

**建议**：

- UID 留在 MD（身份），`sync` 状态放 `.sync-state.json`/SQLite（按 UID 键）；
- 需要审计时写 `.sync-history.jsonl`（追加日志），不写事实源；
- 记录 `last_sync_source` 可以在状态/日志里，不一定进 MD。

---

### 2.7 时区

**提案**：IANA TZID、VTIMEZONE、全局时区规范。

**当前**：本地墙钟时间（无 Z、无 TZID），对单时区个人使用最简单，但跨时区/旅行/多设备可能错。

**评价**：两种语义都合理，取决于产品：

- **Floating（当前）**：9:00 就是当地 9:00；适合「起床/通勤/写报告」等个人 routine；不适合跨时区会议。
- **TZID（提案）**：会议固定 instant；需要时区库、VTIMEZONE、DST 规则、UI 时区选择。

**建议**：

- v0.3 保持 floating，文档写清语义（不要假装是绝对时间）。
- v0.4 给 event 增加可选 `tzid`（默认本地），ICS 导出 `TZID` + `VTIMEZONE`；task 的 `due` 可保持 floating。
- 迁移：无 `tzid` 的旧数据按本地时区解释；提供「固定为某时区」的显式操作，不自动改。
- 提案里用 `+08:00` 偏移不是完整 TZID（夏令时/历史规则会丢）；若做，用 IANA ID。

---

### 2.8 重复规则与 `after_completion`

**提案**：结构化 repeat（frequency/interval/byday/end/mode），`after_completion` 扩展。

**评价**：方向对，但要注意：

- `after_completion` **不是 RRULE**；把它塞进 `repeat` 再导出 ICS 会让外部客户端按固定规则生成错误实例。
- 当前 `recurrence` 是 RRULE 字符串，简单但无法表达「完成后 N 天」和「跳过某次/改单次」。

**建议**：

- 结构化 `repeat`：`{ frequency, interval, byday, until, count, mode: "fixed" | "after_completion" }`；
- ICS 导出：`fixed` 用 RRULE；`after_completion` 不导出 RRULE（或导出单次 + 文档说明），由 ChronoMD 内部生成下一次；
- 「改单次/跳过」需要例外实例模型（EXDATE / RECURRENCE-ID / override），单独 SDS（v0.4/v0.5），不要和简单重复混在一起；
- 当前 RRULE 子集保留兼容，迁移时转换。

---

### 2.9 AI Command Layer

**提案**：AI 不直接写文件，输出 JSON command，后端校验后写入；权限分级、审计、撤销。

**评价**：**强烈赞同**。这是比「让 AI 直接改 MD」更稳的产品能力。

**建议**：

- v0.4 增加 `/api/ai/command`：`{ action, data, dryRun? }`，action 覆盖 create/update/complete/delete/query/plan；
- 复用现有 schema 校验；批量操作二次确认；返回 diff；
- 审计：`.change-log.jsonl`（追加、可按 id 查、保留 N 天），支持 undo（用备份/diff）；
- 外部 AI（ChatGPT/Claude/本地 Agent）直接读写文件仍支持，但走文件监控 + 校验 + 备份；这是「高级模式」，默认关闭；
- 权限：只读 / 可写 / 高危（批量删除）三档，token 作用域后续再做。

---

### 2.10 Git 版本历史

**提案**：后台 Git，自动提交，AI 批量修改可回滚。

**评价**：有价值，但不是核心：

- 每次写入都 commit 会产生大量提交；需要 debounce/批量；
- NAS 上 git 进程/仓库体积/并发要测；
- 与备份功能重叠。

**建议**：v0.4 可选；默认用现有 `.workspace-backups` + 恢复；Git 作为「导出/版本浏览」高级功能，不阻塞。

---

### 2.11 多容器 / SQLite 并发

**提案**：frontend、backend、radicale、sync-worker 四个容器；SQLite WAL + 单写队列。

**评价**：对个人 NAS 过重：

- 当前一个容器同时提供 API + 静态前端 + 推送调度，已经跑通；
- 前后端拆容器会引入 CORS、反向代理、认证、版本匹配；
- sync-worker 与 backend 共写 SQLite/文件需要锁/队列，正是当前 v0.3 在解决的复杂度；
- Radicale 可作为独立容器（外部依赖），但不必由 ChronoMD 打包。

**建议**：

- 保持「一个应用容器 + 可选 Radicale 容器」；
- 后台任务用进程内调度（现有 scheduler）；真的需要水平扩展再拆 worker；
- 若未来拆 worker：单写者队列 + SQLite WAL + 文件锁，别让两个进程随意写同一 MD。

---

### 2.12 单用户 vs 多用户

**提案**：先单用户，但底层不写死，未来家庭共享/权限。

**评价**：合理。当前 token 是单用户；数据模型没有 `owner`。

**建议**：

- v0.3 保持单用户 token；
- 数据字段预留 `owner?`（可选、不写入旧数据），API 层不假设「只有一个用户」但也不实现多用户；
- 真做多用户需要账号/ACL/共享日历/审计，是独立大版本；不要用「多 token」假装多用户。

---

## 3. 对提案数据格式的逐项意见

| 提案字段/设计 | 评价 | 建议 |
| ------------- | ---- | ---- |
| 每文件 YAML frontmatter | Obsidian 友好，但与当前块格式不兼容 | 作为 v0.5 数据层选项；先做导出 |
| `id` + `ics_uid` | 好，稳定身份 | 保留；`id` 内部、`uid` 外部；不要用文件名 |
| `type: task/event` | 好 | 增加 `timeblock`；`scheduled` 与 `due` 分离 |
| `status` 字符串 | 好 | 映射 ICS `NEEDS-ACTION/IN-PROCESS/COMPLETED/CANCELLED`；保留 `done` 兼容 |
| `calendar: work` | 名字作键，重命名会牵连所有任务 | 用稳定 `calendarId`，配置映射名称/颜色 |
| `project: easa-mc7` | 同上 | 用 `projectId`；项目文件/实体 v0.4 |
| `duration` + `start/end` | 冗余，易不一致 | 二选一：`start+end` 或 `start+duration`，SDS 定 |
| `reminders: [{minutes}]` | 相对提醒易用，但跨设备/改期要重算 | 存「相对 + 基准」或绝对 `remind`；当前已有绝对字段，迁移时统一 |
| `repeat` 结构化 | 好 | `mode` 分离；`after_completion` 不导出 RRULE |
| 子任务用 Markdown checkbox | 人类可读，但解析易与结构化子任务冲突 | 保持 `parent` 子条目；UI 渲染成 checkbox；不把自由 checkbox 当事实源（导入除外） |
| `sync` 块 | 会触发同步循环 | 移到状态文件/日志，不写 MD |
| `system/sync-state.json` | 好 | 状态可重建；日志追加 |
| `config/*.yaml` | 与当前 `config.json` 双格式 | 不引入 YAML 配置；保持 JSON，减少解析面 |
| `notes/daily` | 好 | v0.5+；当前 notes 是 workspace notes |
| Git 历史 | 好但可选 | v0.4 可选，不阻塞 |

---

## 4. 路线图重排（建议）

| 版本 | 内容 | 估时 |
| ---- | ---- | ---- |
| **v0.2.5** | 数据核心（原子写/锁/round-trip）+ 只读备份浏览 | 9–12 人日 |
| **v0.3.0** | 认证 + 恢复 + 只读同步中心 + 发布演练 | 9.5–11.5 人日 |
| **合计** | | **18.5–23.5 人日** |
| **v0.4.0** | Task/Event/Time Block 语义 + VTODO 集合 + AI Command Layer + 文件监控 + 未安排任务视图 | 4–6 周 |
| **v0.4.5** | 数据层 spike（单文件 vs 多文件 + 索引）→ ADR | 2 周 |
| **v0.5.0** | 若 spike 通过：多文件迁移（含回滚）；否则：单文件 + 索引/导出 vault | 6–10 周 |
| **v0.6.0** | 多用户/家庭共享（如需要） | 独立评估 |

**关于「8–12 周」**：作为全职、单人、无兼容性阻塞的 MVP 估算偏乐观；以当前进度和测试要求，**6–9 个月（业余）**更现实。不要把「产品愿景」当成「本次迭代范围」。

---

## 5. 必须提前验证的风险（spike 清单）

1. **VTODO 兼容性**：Radicale + iOS/Android/Thunderbird 的读取、完成回写、重复、提醒；列矩阵。
2. **多文件一致性**：创建任务+子任务+项目关联，崩溃/并发下的 journal 方案。
3. **WebDAV 目录同步**：5k 文件首次/增量/删除/重命名耗时；NAS SMB vs 本地卷。
4. **单文件极限**：1k/5k/20k 条解析、写入、内存、AI token；何时必须索引。
5. **时区**：floating vs TZID 的跨设备行为；DST；全天事件。
6. **SQLite 在 Alpine/Docker**：原生编译、并发、WAL、重建。
7. **AI 误操作**：批量删除/移动的 undo、审计、权限。
8. **多容器**：是否真的需要；单容器能否支撑。

---

## 6. 需要 owner 决策的问题

1. 是否有 **Obsidian 现有 vault** 必须直接兼容？还是「可导出」即可？
2. 数据规模预期：几百 / 几千 / 几万条？是否有 10 年数据？
3. 是否经常跨时区/旅行？会议需要固定 instant，还是墙钟即可？
4. 家庭共享/多用户是「以后可能」还是「1 年内必须」？
5. 是否接受 v0.3 先做安全/数据，把语义/VTODO 放到 v0.4（约 1–2 个月后）？
6. 是否接受「不重写 Python，继续 Node/TS」？
7. 是否接受「多文件先做 2 周 spike，数据说话」？

---

## 7. 我对提案的总体评分

| 维度 | 评分 | 说明 |
| ---- | ---- | ---- |
| 产品定位 | 9/10 | MD-first + AI + 自托管，差异化清晰 |
| 领域模型 | 8/10 | Task/Event/TimeBlock、VTODO 判断准确；子任务/时区/重复细节需打磨 |
| 数据层方案 | 5/10 | 多文件方向可辩，但低估跨文件事务/监控/迁移；单文件被过早否定 |
| 技术选型 | 4/10 | Python/FastAPI 重写缺乏必要性；四容器对个人 NAS 过重 |
| 路线/估算 | 4/10 | 8–12 周严重低估；六阶段并行风险高 |
| 与当前代码衔接 | 3/10 | 几乎按「绿地项目」设计，未复用现有 30k 行/456 测试/同步能力 |

**总评**：作为**产品愿景**很有价值；作为**下一版开发计划**不能直接执行。正确做法是：把其中的「语义模型、VTODO、AI 层」吸收到 v0.4；把「多文件/Python/SQLite」放进 spike 和 ADR，用数据决策；v0.3 继续做数据安全/认证，不被架构迁移打断。

---

## 8. 本次已更新的文档

- `docs/planning/CHRONOMD_PROPOSAL_REVIEW.md`（本文）
- `docs/planning/v0.3-plan.md`（定稿；§10：与 ChronoMD 的关系）
- `docs/planning/reviews/decision-log.md`（D20–D26）
- `docs/planning/README.md`（加入提案评估与数据层决策门禁）
- `REF/DATA_SOURCE.md`（新增「单文件决策与重估条件」）
- `README.md`（路线图加入评估链接）
