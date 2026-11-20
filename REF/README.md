# REF 文档索引（先看这里，别拿老物料开工）

本目录混了三类材料。**类型不同，可信度不同** —— 照着设计稿写代码会踩坑。

## ⭐ 当前有效（代码就是按这些写的）

| 文档 | 内容 | 权威性 |
| ---- | ---- | ------ |
| [DATA_SOURCE.md](DATA_SOURCE.md) | 统一数据源 `workspace.md`：文件格式、字段表、清单/子任务、完整 API、开发铁律 | **最高**，与 `apps/server/src/workspace.ts` 一一对应 |
| [MD_ICS_BRIDGE.md](MD_ICS_BRIDGE.md) | 唯一的格式转换层（md ↔ ics）：字段映射、时区与 RRULE 规则、导入导出接口 | **最高**，与 `apps/server/src/ics-convert.ts` 对应 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 模块化框架 + 数据层 + 活跃模块表 + 遗留文件清单 | 高（开头有「文档与代码差异说明」表，先看那张表） |
| [../docs/SYNC_MANAGEMENT.md](../docs/SYNC_MANAGEMENT.md) | 两条同步通道（WebDAV / CalDAV）与当前真实行为 | 高 |
| [../docs/TESTING.md](../docs/TESTING.md) | 测试清单、真实通过数、环境坑 | 高 |

## 🧭 规划与评估（不是现状，别照着当 API）

| 文档 | 内容 |
| ---- | ---- |
| [../docs/planning/README.md](../docs/planning/README.md) | 计划/评审/SDS 流程与门禁 |
| [../docs/planning/CHRONOMD_PROPOSAL_REVIEW.md](../docs/planning/CHRONOMD_PROPOSAL_REVIEW.md) | ChronoMD 提案评估：单文件 vs 多文件、Node vs Python、VTODO、AI 层；**数据层决策门禁** |
| [../docs/planning/v0.3-plan-v0.4.md](../docs/planning/v0.3-plan-v0.4.md) | v0.3 计划（数据安全/认证/恢复/同步中心） |
| [../docs/planning/reviews/decision-log.md](../docs/planning/reviews/decision-log.md) | 已定决策 D1–D26（冲突时以这里为准） |

> 这些文档描述「准备做什么」，不是当前代码行为；当前行为以本目录前三份为准。

## 📐 设计稿（描述了想法，不等于现状）

| 文档 | 状态 |
| ---- | ---- |
| [DASHBOARD_DESIGN.md](DASHBOARD_DESIGN.md) | 工作台设计稿。开头有实现状态对照表，**看那张表就够了**，下半部分是 2026-08 的想法 |
| ARCHITECTURE.md 里的「目录结构设计」「模块接口定义」章节 | 原始设计稿，实际是单文件模块，差异见该文开头表格 |

## 🗄 历史 / 第三方参考（**不要照着改本项目**）

| 材料 | 说明 |
| ---- | ---- |
| `md-ics-bridge.ts` / `routes/md-bridge.ts` / `routes/kanban.ts` 相关描述 | 旧「双文件 + 双向绑定」架构，2026-10-26 废弃，v0.3（P3）已删除代码 |
| [work-dazi-toolkit/](work-dazi-toolkit/) | **外部**参考实现（zip 解压），思路来源。它的 `工作搭子看板.md` 格式与本项目现行格式**不同** |
| `work-dazi-toolkit.zip` | 同上，原始下载包 |

## 三条最容易搞错的点

1. **数据文件只有一个**：`workspace.md`。
   看到 `events.md`、`工作搭子看板.md` 一律是历史遗留（只有一次性迁移脚本会读）。
2. **模块之间不做同步**。日历 / 看板 / 工作台都是对同一份数据的筛选，
   不存在「绑定字段」「级联删除」「解绑」。
3. **`kind` 只是标签不是隔离**。`kind: task` 且有 `start` 的条目
   同时出现在看板和日历，同一个 id。

---

**Last Updated**: 2026-11-02
