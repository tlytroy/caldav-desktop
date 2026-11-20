# 开源复用审计（v0.3）

> 决策依据：D35「不重复造轮子」。
> 原则：能用成熟开源库解决的，不自己写；自己写只保留两类——(a) 领域数据格式（`workspace.md`），(b) 开源库覆盖不到的交互语义。

## 1. 依赖准入标准

新增运行时依赖必须同时满足：

| 项 | 要求 |
| --- | --- |
| 许可 | MIT / ISC / BSD-2/3 / Apache-2.0；禁止 GPL/AGPL（本项目可能闭源分发） |
| 维护 | 近 12 个月有发布；GitHub ≥ 1k star 或属于 npm 官方/大厂维护 |
| 运行环境 | 纯 JS，无原生编译；Node 22 可用；ESM 或 CJS 均可 |
| 体积 | unpacked < 1 MB（超出的需在本文档写明理由） |
| 离线 | `pnpm install --frozen-lockfile` 可离线复现；不引入运行时网络依赖 |
| 测试 | 替换后原有测试全绿；行为差异写进 `docs/UPDATE_LOG.md` |

## 2. 已完成替换

### 2.1 RRULE 展开：手写 → `rrule`

| 项 | 内容 |
| --- | --- |
| 替换文件 | `apps/server/src/recurrence.ts` |
| 库 | `rrule@2.8.1`，BSD-3-Clause，687 KB，依赖 `tslib` |
| 改动 | `expandRecurrenceDates()` 内部改为 `new RRule({...}).between()`；对外的 `parseRRule` / `formatRRule` / `describeRRule` / `expandEventInstances` 签名不变 |
| 适配层 | 本地日期时间 ↔ UTC 伪时间轴（`toPseudoUtc` / `pseudoUtcYmd`），避免时区/夏令时漂移 |
| 收益 | 不再自己处理「每月 31 号遇 2 月」「2 月 29 日」「INTERVAL + BYDAY」等边界；文件 420 → 371 行 |
| 验证 | `recurrence.test.ts` 30 项、`ics-convert.test.ts` 28 项、`workspace-api.test.ts` 35 项全绿 |

## 3. 评估后不替换

### 3.1 中文自然语言时间：保留 `apps/server/src/nlp/zh-time.ts`（不换 `chrono-node`）

`chrono-node@2.10.3`（MIT）对纯日期表达很准，但对本项目的组合语义覆盖不足。实测（基准时间 2026-11-03 10:41）：

| 输入 | 自家解析 | chrono-node | 结论 |
| --- | --- | --- | --- |
| 每月1号交房租 | 12-01 全天 + monthly | `null` | chrono 不支持中文重复规则 |
| 每周一三五晚上8点健身 | 11-09 20:00 + weekly | 只取「周一」 | 同上 |
| 下下周一 | 11-16 | 11-09（少一周） | chrono 中文相对周解析有偏差 |
| 明年1月1日 | 2027-01-01 | 2026-01-01 | chrono 把「明年」当今年 |
| 12/25 聚餐 | 12-25 全天 | `null` | chrono 不认 `12/25` |
| 明早站会 | `null`（待修） | 11-04 06:00 | 唯一 gap，已单独修 |

结论：**保留自家解析器**，它是领域语义（重复规则 + 全天判定 + 标题剥离）的一部分，不是通用日期解析。后续若要支持英文/日文输入，再把 chrono 作为多语言前置解析器接入。

### 3.2 其他候选（暂不替换）

| 模块 | 候选 | 结论 | 理由 |
| --- | --- | --- | --- |
| `storage-check.ts` 原子写 | `write-file-atomic@8`（ISC, 12 KB） | 暂缓 | 现有实现带 Windows EPERM/EBUSY 重试与 `WORKSPACE_CRASH_AFTER_TMP` 崩溃注入钩子（S3 验收项），替换需重做故障注入；等 P9 后单独评估 |
| `workspace-lock.ts` | `async-mutex@0.5`（MIT, 63 KB） | 暂缓 | 需要「排队超时即取消、绝不落盘」（D30）与 AsyncLocalStorage 重入检测，库只提供互斥原语，仍要包一层；收益小于风险 |
| 跨进程锁 | `proper-lockfile@4` | 不做 | D12 明确单进程；引入文件锁反而增加 NAS/SMB 上的不确定性 |
| frontmatter 解析 | `gray-matter@4` | 不做 | 会把 frontmatter 重新序列化，破坏 `frontmatterRaw` 原样保留（P2 验收项） |
| 字段校验 | `zod@4`（6 MB） | 暂缓 | 校验规则带中文错误文案与 `GraphIssue` 结构，且体积大；v0.4 若做外部 API 再评估 |
| WebDAV 客户端 | `webdav@5` | 暂缓 | 现有 `fetch` + `If-Match` 逻辑已覆盖需求并有 30 项测试；迁移收益有限 |

## 4. 下一批候选（v0.3.1 / v0.4）

| 场景 | 候选 | 何时 |
| --- | --- | --- |
| 安全响应头 | `helmet` | P5 认证同批 |
| 限流 | `express-rate-limit` | v0.3.1（D17） |
| 结构化日志 | `pino` + `pino-http` | v0.3.1 |
| 时区 | `@js-temporal/polyfill` 或 `luxon` | v0.4 引入 `tzid` 时（D25） |
| 全文搜索 | `minisearch`（纯 JS，可离线） | v0.4 若 workspace 规模超 5k 条 |
