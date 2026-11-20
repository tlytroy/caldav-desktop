# 模块状态（MODULE_STATUS）

> 更新：2026-11-05
> 用途：让 AI/开发者知道**哪些能用、哪些是占位、哪些是遗留**；避免把规划当现状。
> 状态：`stable`（有测试、可用）、`partial`（可用但有已知缺口）、`placeholder`（未实现）、`legacy`（保留兼容，勿扩展）、`planned`。

## 后端

| 模块 | 文件 | 状态 | 测试 | 下一步 |
| --- | --- | --- | --- | --- |
| Workspace 模型/解析/序列化 | `apps/server/src/workspace.ts` | stable | `workspace.test.ts`（53） | extras / frontmatter v2 / 未知块 round-trip 已落地 |
| Workspace 仓储（读/写/备份） | `workspace-store.ts`、`workspace-lock.ts`、`storage-check.ts` | stable | `workspace-store.test.ts`（25）、`storage-check.test.ts`（6） | 只读降级 + 备份面板（P4） |
| 备份恢复 | `backups.ts` + `restore.ts` | stable | `backups.test.ts`（21）、`restore.test.ts`（14） | 列表/预览/导出 + 一键恢复 + 放弃恢复（UI + API）+ 启动自愈 |
| 认证 | `auth.ts`、`createApp({auth})`、`api/client.ts`、`AuthGate` | stable | `auth.test.ts`（9）、`app-create.test.ts`（18）、`auth-ui.test.tsx`（6） | 单用户 token；多设备 token 管理 v0.4 |
| 同步中心 | `sync-overview.ts`、`sync-control.ts`、`routes/sync-control.ts` | stable | `sync-overview.test.ts`（10） | 只读概览 + 事件/冲突环形缓冲；不联网 |
| ICS 转换 | `apps/server/src/ics-convert.ts` | partial | `ics-convert.test.ts`（29）、`buildICSContent.test.ts`（16） | v0.4 VTODO |
| CalDAV 同步 | `apps/server/src/caldav-sync.ts` | stable | `caldav-sync.test.ts`（23） | v0.3 写路径收敛；v0.4 VTODO |
| WebDAV 同步 | `apps/server/src/webdav.ts`、`routes/webdav.ts` | stable | `webdav-sync.test.ts`（25） | ETag 基线统一为 HEAD 同源（兼容 OneDrive/SharePoint 网关）；v0.4 内容哈希兜底 |
| 提醒调度/推送 | `notifications/scheduler.ts`、`push.ts` | stable | `notifications.test.ts`（9） | v0.3 恢复 sent 语义 |
| NLP / 快速创建 | `nlp/*`、`routes/nlp.ts` | stable | `nlp-parse.test.ts` | v0.4 AI Command Layer |
| 配置 | `config.ts`、`routes/config.ts` | stable | `config-plugins.test.ts` | v0.3 token 文件/原子写 |
| 插件扫描 | `routes/plugins.ts` | stable | 同上 | — |

> 测试数（2026-11-05）：server 20 文件 / 444 通过 / 0 skip；renderer 13 文件 / 113 通过。
> 端到端验收：`bash scripts/run-e2e.sh`（隔离服务）92 + 32 全通过。

## 前端

| 模块 | 文件 | 状态 | 说明 |
| --- | --- | --- | --- |
| 框架/模块注册 | `framework/*`、`modules/index.ts` | stable | 模块化 UI |
| Dashboard | `modules/dashboard` | stable | 真实同步状态卡 |
| Calendar | `modules/calendar`、`components/Calendar.tsx` | stable | 日/周/月；拖拽未实现 |
| Tasks | `modules/tasks` | stable | 清单/子任务/提醒；排序未实现 |
| Notifications | `modules/notifications` | stable | 应用内 + 六渠道推送 |
| Sync Center | `modules/sync`、`api/sync.ts`、`sync-overview.ts` | stable | 只读概览 + 事件/冲突环；不联网 |
| Settings | `components/settings/*` | stable | 配置/后端地址/备份/后端状态 |
| AI Agent | `modules/placeholder`（占位） | placeholder | v0.4 command layer |

## 桌面 / 部署

| 模块 | 文件 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Electron 主进程 | `apps/desktop/main.ts`、`build-bundle.mjs` | stable | 打包后端 + 随机端口 + 主进程注入 token；窗口冒烟待手工 |
| Electron preload | `apps/desktop/preload.ts` | stable | 只暴露 `__DSH_ELECTRON__` / `__API_BASE_URL__`，不暴露 token |
| Docker | `Dockerfile`、`docker-compose.yml` | stable | v0.3.0 token 文档/健康检查 |
| PWA | `vite.config.ts` | stable | 离线提示 v0.3.0 |

## 明确未实现（别当可用）

- 多文件 vault / SQLite 索引（v0.4.5 决策）
- VTODO、Time Block、项目实体、AI Command Layer（v0.4）
- 多用户/共享、CalDAV 墓碑删除、限流（v0.3.1+）
- 清单排序/颜色/拖拽、重复事件单次编辑（v0.4+）

## 图例

- stable：有测试、主流程可用
- partial：可用但有明确缺口（见「下一步」）
- placeholder：只剩占位 UI
- legacy：仅迁移/兼容保留，勿新增功能
- planned：规划中，尚未实现
