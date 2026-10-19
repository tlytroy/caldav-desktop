# Sync Management & Caching Guide

> ⚠️ **文档状态说明（2026-10-19 校正）**
>
> 本文档上半部分描述的 **localStorage 缓存方案已经不再被写入**。
> 2026-08-21 的数据流重构后，日历模块改读 `events.md`（`useCalendarEvents`
> 不再调用 `setCachedEvents`），`syncStore.cachedEvents` 目前是**只读的空对象**。
> 这也是工作台「今日事件 / 事件总数」恒为 0 的根因（已于 2026-10-19 修复为直接读 events.md）。
>
> 下方「MD Bridge Sync」章节才是当前真实生效的同步机制。
> 上半部分保留作为历史设计说明，其中「缓存过期 1 小时」「事件驱动自动同步」
> 「底部状态栏同步按钮」等描述**与当前实现不符**，不要据此排障。

## Overview

CalDAV Desktop 的同步分两层：本地 `events.md` 作为唯一事实源，
ICS/CalDAV 作为可选的同步通道。详见 `REF/MD_ICS_BRIDGE.md`。

## How Sync Management Works

### Smart Caching System（⚠️ 历史设计，当前未生效）

> 以下内容描述的是重构前的缓存方案，**当前代码不会写入这些缓存**。

The application implements a local caching mechanism to reduce network requests and improve performance:

1. **Local Storage**: Events are cached in browser's localStorage using Zustand state management
2. **Cache Expiration**: Cached data expires after 1 hour
3. **Offline Access**: View cached events even when offline
4. **Seamless Refresh**: Cache automatically refreshes during sync operations
5. **Partial Updates**: Individual events can be removed from cache without clearing entire cache

### Sync Strategies

#### 1. Automatic Sync (Timed Intervals)

配置项：`MD_ICS_AUTO_SYNC_MINUTES`（后端 `.env`，单位分钟，`0` 表示仅手动）。

> 注意：旧文档提到的「5/10/30 分钟下拉选择」是 UI 层的 `syncInterval`，
> 与后端定时器是两套东西。当前 UI 未提供该间隔的可视化配置入口。

#### 2. Manual Sync

日历模块工具栏「推送 CalDAV / 拉取 / 双向同步」三个按钮即时触发。

#### 3. Event-Driven Sync

⚠️ 当前**没有**事件驱动的自动同步。用户创建/修改事件只写 `events.md`，
需要手动点同步或等后端定时器触发。

#### 4. Immediate Feedback with Background Sync

UI 立即反映本地变更，同步是独立动作，不阻塞界面。

## User Interface

### Bottom Sync Status Bar（⚠️ 当前布局下不可见）

旧版有底部同步状态栏。当前模块化布局（`AppLayout`）为左侧边导航 + 内容区，
**没有底部状态栏**。同步入口现在在日历模块顶部工具栏。

### Status Indicators

| 状态 | 位置 |
| ---- | ---- |
| 同步中 | 工具栏按钮图标旋转 |
| 上次同步时间 | 工具栏左侧「上次同步 ...」 |
| 事件总数 | 工作台「数据源」卡片 |

## Configuration Options

### 同步间隔

编辑项目根目录 `.env`：

```
MD_ICS_ENABLED=true
MD_ICS_AUTO_SYNC_MINUTES=5      # >0 启用延时自动同步；0 = 仅手动
MD_ICS_SYNC_DIRECTION=bidirectional
```

`MD_ICS_SYNC_DIRECTION` 接受 `md-to-caldav` / `caldav-to-md` / `bidirectional`
（也兼容 `push` / `pull` / `both`），内部经 `normalizeSyncDirection()` 归一化。

> 历史 bug：配置层与同步层曾用两套命名且直接透传，导致按文档填
> `MD_ICS_SYNC_DIRECTION=md-to-caldav` 时自动同步**静默什么都不做**。已修。

### Manual Sync

在日历页点「推送 CalDAV」/「拉取」/「双向同步」。

## Troubleshooting

### 同步没反应

1. 确认 `MD_ICS_ENABLED=true`
2. 确认 `.env` 中 `CALDAV_ROOT_URL` / `CALDAV_USER` / `CALDAV_PASS` 正确
3. 看后端日志是否有 `[MD Bridge] 已启用延时自动同步`（仅当间隔 > 0）
4. 检查 `MD_ICS_SYNC_DIRECTION` 取值是否有效

### 删除没有传播到远端（已知限制）

从 MD 删除事件后同步，**不会删除 CalDAV 远端已存在的 `.ics` 文件**。
当前 push 只做创建/更新，没有墓碑（tombstone）记录。这是已知遗留问题。

## Technical Implementation

### State Management

`syncStore`（Zustand + persist）当前字段状态：

| 字段 | 状态 |
| ---- | ---- |
| `syncInterval` | 持久化，但当前无 UI 消费方 |
| `lastSyncTime` | 持久化；工作台「上次同步」读它 |
| `isSyncing` / `syncStatus` / `syncError` | 存在但 `useCalendarEvents` 不更新它们 |
| `cachedEvents` | **只读空对象**，无人写入 |
| `cacheTimestamps` | 同上 |

### MD Bridge Sync（当前真实生效）

`events.md` 单一事实源 + ICS 同步通道：

- **首屏数据源**：UI 直接读 `events.md`（`GET /api/md-bridge/events`），不依赖 CalDAV 在线。
- **同步方式**：
  - 延时自动同步：`MD_ICS_AUTO_SYNC_MINUTES` 配置后台定时器，触发 `performCaldavSync`。
  - 手动同步：日历模块顶部「推送 / 拉取 / 双向同步」按钮。
- **非实时**：ICS 仅在同步时生成，编辑先落 MD。
- **关联保留**：pull 时 `kanbanTaskId` 不会被远端覆盖 —— `eventToIcs` 写出
  `X-KANBAN-TASK-ID` 扩展属性，`icsToEvent` 解析回填，pull 合并时优先远程
  X- 属性、否则回退本地 `kanbanTaskId`。

### 文件导入 / 导出（2026-10-19 新增）

| 接口 | 说明 |
| ---- | ---- |
| `POST /api/md-bridge/ics/import` | 导入 `.ics`；`dryRun` 预览、按 uid 去重、`append`/`replace` |
| `GET /api/md-bridge/ics/export` | 导出单个 `.ics`；`start`/`end` 过滤、`download=1` |

## Known Gaps

- 删除不同步到远端（缺墓碑记录）
- 增量同步未实现：目前按全量 events 遍历，未做 `updated` 级增量
- 冲突检测仅为基于 `updated` 的基础版
- WebDAV 通道未实现（`.env` 中的 `WEBDAV_*` 是预留变量，无代码读取）
- localStorage 缓存层形同虚设，可考虑移除或重新接线

---

**Last Updated**: 2026-10-19（校正缓存方案描述失真，新增导入导出与已知问题章节）
**Related Docs**: [README.md](../README.md), [CHANGELOG.md](CHANGELOG.md), [TESTING.md](TESTING.md), [../REF/MD_ICS_BRIDGE.md](../REF/MD_ICS_BRIDGE.md)