# 计划与设计文档目录

这里放**计划、评审记录、SDS**，与 `REF/`（现状权威说明）和 `docs/`（使用/部署/测试）区分开：

```
docs/planning/
├── README.md                 # 本文件：流程、命名、门禁
├── CHRONOMD_PROPOSAL_REVIEW.md  # ChronoMD 产品/架构提案评估（数据层决策）
├── v0.3-plan-draft.md        # v0.1 初稿（已被 grill 否决，仅存档）
├── v0.3-plan-v0.2.md         # v0.2 评审稿（存档）
├── v0.3-plan-v0.3.md         # v0.3 修订稿（存档）
├── v0.3-plan-v0.4.md         # v0.4 条件关闭稿（存档）
├── v0.3-plan.md              # 定稿 v1.0（当前）
├── v0.3.0-sds.md             # SDS v0.3（两轮复审有条件通过）
├── v0.4-product-decisions.md  # v0.4 产品/架构决策定稿（D36–D42，2026-11-20）
├── v0.4-implementation-plan.md # v0.4 实施计划草案（依据决策推导，未评审）
├── oss-reuse-audit.md        # 自研 vs 开源库审计（D35 落地）
├── oss-landscape.md          # 同类开源项目与可复用模块调研
└── reviews/
    ├── v0.3-plan-grill.md            # 红队结论（主持 + 独立 agent）
    ├── v0.3-plan-grill-host.md       # 主持人问题清单
    ├── v0.3-plan-grill-agent.md      # 独立红队整理版
    ├── v0.3-plan-review-architecture.md  # 评审 A（架构/安全/数据）
    ├── v0.3-plan-review-ops.md           # 评审 B（产品/运维）
    ├── v0.3.0-sds-review-*.md        # SDS 初评（均不通过）
    ├── v0.3.0-sds-rereview-*.md      # SDS 复审（均有条件通过）
    └── decision-log.md               # 关键决策（D1–D35）
```

## 门禁（没有满足就不进入下一阶段）

| 阶段 | 产物 | 通过条件 |
| ---- | ---- | -------- |
| 计划初稿 | `v0.3-plan-draft.md` | 范围、目标、非目标、风险、待决策齐全 |
| Grill | `reviews/v0.3-plan-grill*.md` | 每个「必须回答」的问题有结论或明确 deferred |
| 独立评审 ×2 | `reviews/v0.3-plan-review-*.md` | 架构 / 产品运维两个视角，互不通气；结论为「通过 / 有条件通过」且条件 ≤5 条 |
| 计划修订 | `v0.3-plan-v0.3.md` | 评审条件逐条关闭（需两位评审确认） |
| 条件关闭 | `v0.3-plan-v0.4.md` | 两轮剩余条件全部关闭；CI/数据/认证/恢复可执行 |
| 计划定稿 | `v0.3-plan.md` | 吸收确认意见；条件全部关闭 |
| SDS | `v0.3.0-sds.md` | 接口、数据结构、状态机、错误码、UI、测试、迁移/回滚齐全 |
| SDS 评审 ×2 | `reviews/v0.3.0-sds-review-*.md` | 可实现性、测试可验证性、风险覆盖通过 |
| 实施 | 代码 + 测试 + 文档 | 按 SDS 分 PR；每个 PR 附一个能失败的测试；独立 reviewer 审关键改动 |

## 数据层决策门禁（ChronoMD）

`CHRONOMD_PROPOSAL_REVIEW.md` 提出：继续单文件 `workspace.md`，还是迁移「一任务一文件」仓库。
**在 v0.4.5 spike 完成、ADR 签字之前，禁止改动数据层。** 决策依据：解析/写入性能、WebDAV 冲突、
跨文件一致性、迁移成本、Obsidian 需求、AI 上下文；详见评估文档第 2.1 节。

## 评审原则

1. 评审者**不参与编写**，只提问、找漏洞、给结论。
2. 每条意见必须落到具体文件 / 接口 / 数据 / 场景，不接受「注意安全」这类空话。
3. 评审结论只有三种：**通过 / 有条件通过（列出条件）/ 不通过（说明重写哪部分）**。
4. 所有决策写进 `decision-log.md`，聊天记录不算数。
5. 计划阶段不写实现代码；SDS 阶段不写实现代码。

## 当前状态（2026-11-02）

- [x] 计划初稿 v0.1
- [x] Grill（主持 + 独立红队）
- [x] 决策 D1–D34 确认（owner：全按推荐；两轮评审后修订）
- [x] 计划 v0.2（评审稿）
- [x] 独立评审 ×2（架构 A / 产品运维 B，均为有条件通过）
- [x] 计划 v0.3（修订稿）
- [x] 两轮条件确认（A/B 剩余条件已吸收）
- [x] 计划 v0.4（条件关闭稿）
- [x] ChronoMD 提案评估（D20–D27）
- [x] 两位评审最终确认 → **计划 v1.0 定稿**（`v0.3-plan.md`）
- [x] SDS 初稿（v0.2.5 + v0.3.0，`v0.3.0-sds.md`）
- [x] SDS 评审 ×2（架构 / 实现，均不通过；10 项阻断）
- [x] SDS 修订 v0.2（816 行；吸收 10 项阻断 + 非阻断/测试缺口）
- [x] SDS 复审 ×2（架构 / 实现，均有条件通过；共 9 项阻断）
- [x] SDS 修订 v0.3（955 行；关闭复审阻断 + 测试/PR 拆分）
- [x] 文档收尾（plan A1 / README / UPDATE_LOG / 决策 D30–D34）
- [x] 实施 P1（CI 修复 + `createApp`/`asyncHandler`/错误中间件 + `sync-control` 骨架）
- [x] 实施 P2（数据核心：读取失败抛错、round-trip 保真、`mutateWorkspace`、锁与原子写、只读降级）
- [x] 实施 P3（写调用方迁移 + 退役 md-bridge/kanban + ICS 边界收口）
- [x] 实施 P4（备份只读 API + 备份面板 + 500 页面引导 + 离线横幅）
- [x] 实施 P5（单用户认证：服务端 token + 前端 AuthGate/统一 client + ICS fetch/Blob）
- [x] 实施 P6（Electron 打包：esbuild 后端 + extraResources + 主进程注入 token）
- [x] 实施 P7（恢复状态机：marker/maintenance/abort + 同步暂停与方向选择）
- [x] 实施 P8（同步中心：只读概览 + 事件/冲突环形缓冲 + 页面）
- [x] 实施 P9（发布：Docker 烟测、升级演练、tag）

> 当前：**v0.3.0 已实现完毕（P1–P9）**，v0.3.0 待打 tag 发布。
> P1：`apps/server/src/app.ts`、`errors.ts`、`sync-control.ts`、`__tests__/app-create.test.ts`，
> CI 固定 Node 22 + pnpm 11.8.0 + `--frozen-lockfile`，168 个测试类型错误清零。
> P2：`storage-check.ts`、`workspace-lock.ts`、`workspace-store.ts`，`workspace.ts` 读写重写
> （frontmatter/未知字段/未知块保真、`WorkspaceReadError`），启动存储自检 + 只读降级，
> 新增 `workspace-store.test.ts`(25) / `storage-check.test.ts`(6)，server 409 通过。
> P3：5 个写路由改 `mutateWorkspace` 单事务、删除 `writeWorkspace`、CalDAV 拉取差异落盘、
> 错误中间件抽成 `http-errors.ts`；删除 `md-bridge`/`kanban`/`md-ics-bridge` 三套旧实现
> 与 4 个过时测试，`config.paths` 只剩 `workspaceFile`。server 384 通过（16 文件，0 skip）。
> P4：备份只读接口（列表/预览/导出）、`BackupPanel`、全局 500 页 3 步恢复、离线横幅、
> 统一 `createApiClient` 前置工作；server 407 / renderer 102。
> P5：`apps/server/src/auth.ts`（env → 64 hex 文件 → 生成，损坏改名重建，不可写降级内存 token，
> sha256 + `timingSafeEqual`）、`index.ts` 以 `{auth:{token}}` 启动、前端 `api/token.ts` +
> `api/client.ts` + `AuthGate`，9 处 axios 实例统一，`base.ts` 对注入空串也认，
> ICS 导出改 blob 下载。server 416（18 文件）/ renderer 108（12 文件）。
> P6：`build-bundle.mjs`（esbuild → `dist-server/index.cjs`）、`electron-builder` 的 `extraResources`、
> 主进程随机端口 + `/health` 等待 + `webRequest` 注入 token、preload 仅暴露 base；
> `--dir` 打包产物验证通过（窗口冒烟需有显示环境，列入手工门禁 F10）。
> P7：`restore.ts` 状态机（sha 校验 → 冻结 → drain → 固定快照 → pre-restore → 原子替换 → 重置基线 → 暂停同步）、
> `abort` / `restore/status` / `sync/resume`、启动自愈、提醒 sent 裁剪；前端 BackupPanel 恢复按钮 + 7 个 i18n key。
> P8：`sync-overview.ts`（只读快照，**不联网**）、`sync-control.ts` 的 `recordSyncEvent` /
> `recordSyncConflict` 环形缓冲（各 20 条，重启清空）、`GET /api/sync/overview`，
> 前端 `modules/sync`（替换 git-sync 占位）+ `api/sync.ts` + `syncCenter.*` i18n；
> CalDAV/WebDAV 的 push/pull/merge/冲突点都已接入记录。server 446（20 文件）/ renderer 115（13 文件）。
> P9：版本号统一到 `0.3.0`；升级演练（v0.2.x 数据 + 无 token 启动 → 自动生成 token、
> 坏块不影响好条目、frontmatter 自定义字段保留、`%61pi` 400）；Docker 镜像构建 + 运行烟测；
> 修掉 `rrule` CJS 在 ESM 下的启动崩（测试被 vitest 转换掩盖，只有跑 `dist/` 才暴露）。
> **v0.3.0 实现完毕，待打 tag。**
> P9 后补（2026-11-05）：真实 WebDAV 实测修掉「PUT/HEAD ETag 两套命名空间导致每次 push 误报冲突」；
> 两个验收脚本补 Bearer 认证 + 新增 `scripts/run-e2e.sh` 隔离 runner（92 + 32 全通过）；
> 「放弃本次恢复」补 UI；CI 加 `e2e` job、产物路径改 `dist-server/`。

## v0.4 规划（2026-11-20）

- [x] 用户裁决六项方向问题 → `v0.4-product-decisions.md`（D36–D42）
- [x] 依据决策推导实施计划草案 → `v0.4-implementation-plan.md`（未评审）
- [ ] 实施计划评审（架构 / 产品双视角）→ 评审通过后再写代码

> v0.4 定位：**Desktop-first · Local-first · Markdown-native · Sync-optional**，是成熟度版本而非功能堆积版本。
> 发布节奏：v0.4.0 桌面体验 → v0.4.1 同步正确性（墓碑 + Radicale 基线）→ v0.4.2 生态导入与假入口清理。
> 等待用户配合：Electron GUI 窗口冒烟（8 项）、Radicale 服务器真机 CalDAV 测试。
