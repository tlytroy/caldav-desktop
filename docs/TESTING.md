# Testing Guide

> ⚠️ **本文档已于 2026-10-19 重写。**
> 旧版本声称「`./run-tests.sh` 9/9 通过」「E2E 28/28 通过」「总计 44+ 100%」，
> 但 `run-tests.sh` **在仓库中并不存在**，那些数字无法复现。
> 本文档现在只描述实际存在、可运行、且验证过的测试。

## Running Tests

### Automated Tests

```bash
cd apps/server && pnpm test
```

需要真实 CalDAV 服务器的测试（`caldav.test.ts`、`e2e-bridge.test.ts`、`e2e-full.test.ts`）
要求 `.env` 中已配置 `CALDAV_URL` / `CALDAV_USER` / `CALDAV_PASS`，
不属于离线测试套件。无服务器时只跑离线用例：

```bash
cd apps/server && pnpm vitest run src/__tests__/ics-file.test.ts src/__tests__/kanban-id.test.ts
```

### Manual Frontend Tests

```bash
cd apps/server && pnpm dev      # Terminal 1 (port 3001)
cd apps/renderer && pnpm dev    # Terminal 2 (port 5173)
```

打开 http://localhost:5173/ 。必须走 HTTP，直接双击 `dist/index.html`
用 `file://` 打开会因 ES module / CORS / ServiceWorker 报一堆错。

---

## Offline Test Suite

### `src/__tests__/ics-file.test.ts` — iCalendar 导入导出（14 项）

| 用例 | 锁定的问题 |
| ---- | ---------- |
| 解析出全部 3 条事件 | `icsToEvent` 正则缺 `g` 标志，旧实现只返回第一条 VEVENT，导入 Google/Outlook 导出的日历会丢数据 |
| 解析常规事件字段 | title / uid / CATEGORIES / PRIORITY 映射 |
| 识别全天事件 | `VALUE=DATE` 识别 |
| 保留 RRULE 与看板关联 | `RRULE` → recurrence、`X-KANBAN-TASK-ID` → kanbanTaskId |
| 兼容 CRLF 行尾 | Windows 导出的 .ics |
| 异常输入不崩溃 | 空串 / 非 ICS 文本 / 残缺 VEVENT |
| 跳过没有 SUMMARY 的事件 | 畸形条目容错 |
| DTEND 与 DTSTART 同日时修正为次日 | ICS 的 DTEND 是排他边界，同日会导出零长度事件，客户端可能完全不显示 |
| 全天日期按本地日历日 | `toISOString()` 是 UTC 换算，东八区凌晨事件会落到前一天 |
| 结束不晚于开始时兜底 +1h | 异常区间不产生负时长事件 |
| 导出包含全部 VEVENT | `eventsFileToIcs` |
| 外层只有一层 VCALENDAR | 剥离嵌套包裹时不残留 `VERSION:` |
| 导出→导入往返一致 | 往返保真 |
| 空事件列表产出合法 VCALENDAR | 边界 |

### `src/__tests__/kanban-id.test.ts` — 看板任务 id（9 项）

| 用例 | 锁定的问题 |
| ---- | ---------- |
| id 写入 md 并可回读 | 持久化基础 |
| **新增任务插到队首后存量 id 不变** | 核心回归点。旧实现用行序 `t0/t1/t2`，而新建任务 unshift 到队首会让所有存量 id 整体错位——**删 A 会连带删掉 B 的日历事件** |
| 删除中间任务其余不受影响 | 同上 |
| 无 id 字段的旧文件仍可解析 | 向后兼容 |
| 保留旧文件的日历绑定 | `日历:<uid>` |
| 回退为行序 id 且唯一 | 兼容路径 |
| 项目 / 速记 / 完成态往返 | 其余字段不丢 |

**当前状态：23 项全部通过（2026-10-19 验证）。**

---

## Requires Live Server

以下文件存在但需要可用的 CalDAV 服务器，未在离线环境验证：

- `caldav.test.ts`
- `e2e-bridge.test.ts`
- `e2e-full.test.ts`
- `cleanup-remote.ts`（清理脚本，非测试）

---

## Verification Performed 2026-10-19

本轮修复实际做过的验证：

| 项目 | 结果 |
| ---- | ---- |
| `apps/server` TypeScript 类型检查 | 通过 |
| `apps/renderer` TypeScript 类型检查 | 通过 |
| `vite build` | 通过（产物 541KB 主 chunk，仅有 chunk 体积提示） |
| `ics-file.test.ts` | 14/14 通过 |
| `kanban-id.test.ts` | 9/9 通过 |
| ICS 导入导出 HTTP 端到端（含去重、replace、下载头、日期过滤、异常输入） | 25/25 通过 |
| 看板 id 漂移专项（未提交的一次性脚本） | 20/20 通过 |
| Python 参考实现 `parse_kanban.py` | 正常产出 ICS |

未验证项（需要你在本地跑）：

- Electron 桌面端实际启动
- 真实 CalDAV 服务器的 push / pull 往返
- Android 端打包后运行

---

## Environment Notes

- **Windows 软链陷阱**：`Y:\` 这类网络映射盘上 `pnpm install` 可能产出损坏的
  `node_modules`（目录能列出但 `tsc` / `tsx` 报 `Input/output error`）。
  遇到时改在 WSL 内跑，或换成本地磁盘路径。
- **端口**：后端与 Electron 主进程均硬编码 3001，`apps/renderer/.env` 的
  `VITE_API_URL` 必须与之一致。

---

**Last Updated**: 2026-10-19
