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
cd apps/server && pnpm vitest run \
  src/__tests__/ics-file.test.ts \
  src/__tests__/kanban-id.test.ts \
  src/__tests__/webdav-sync.test.ts \
  src/__tests__/zh-time.test.ts \
  src/__tests__/nlp-parse.test.ts
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

### `src/__tests__/webdav-sync.test.ts` — WebDAV 同步（17 项）

用 Node `http` 模块模拟一个最小 WebDAV 服务端（`PROPFIND` / `MKCOL` / `PUT` / `GET` / `HEAD`），
不需要真实服务器。

| 用例 | 锁定的问题 |
| ---- | ---------- |
| 读取环境变量 | 配置加载 |
| `normalizeEtag` 去弱标记与引号 | `W/"abc"` 与 `"abc"` 比较需归一 |
| 未配置时 status / push 的表现 | 错误信息要可操作（提示设置 `WEBDAV_URL`） |
| 首次 push 创建远端目录并上传双文件 | 递归 `MKCOL` |
| push 后同步状态记录两个文件 | `.webdav-state.json` |
| status 反映真实远端状态 | 含 ETag、上次同步时间、是否变更 |
| 远端无变化时走 ETag 乐观锁 | `forced === false`，即带 `If-Match` |
| **远端被其他设备修改时检测冲突且不覆盖** | 核心数据安全点：不能静默覆盖别人的修改 |
| force 可强制覆盖冲突 | 用户决策路径 |
| 可只同步指定文件 | `files` 参数 |
| 本地文件缺失时报错且不影响其他文件 | 单文件失败不阻断整批 |
| pull 时覆盖本地并备份原文件 | `.bak` 内容是拉取前的本地版本 |
| **远端无变化时跳过，不冲掉本地改动** | 避免无意义覆盖 |
| pull force 强制覆盖 | — |
| 连接测试正常路径 / 认证失败 | 401 要给出明确提示 |

**当前状态：121 项全部通过（2026-10-19 验证）。**

### `src/__tests__/zh-time.test.ts` — 中文时间解析（63 项）

| 用例组 | 锁定的问题 |
| ------ | ---------- |
| 中文数字转换 | 十/十五/二十三/三十五、两=2 |
| 时长解析 | 2小时/半小时/一个半小时/45分钟 |
| 相对日期 | 明天/后天/大后天/今天（已过则顺延）/昨天 |
| 星期 | **下周三、下下周一、周四、周一（已过→下周一）**、周日、这周末 |
| 绝对日期 | 3月5日（已过→明年）/12月20日/2026-11-05/11-8 |
| 时间与时段 | 下午3点→15:00/晚上8点→20:00/2点半/15:30/只有时段→默认 |
| 相对时间 | 半小时后/2小时后/45分钟后/三天后 |
| 时长推导结束 | 持续2小时/一个半小时/无时长默认1小时 |
| 重复规则 | 每天/每周三/每月5号/每年 |
| 标题提取 | 剔除时间描述保留核心、保留「和」等中文用词 |
| 异常输入 | 非法日期/非法时间/空串/纯符号不崩溃且不产生 Invalid Date |

关键回归点（都是实测踩过的坑）：
- **周日=0 与周一开头的周混用会整体错位一天**
- `Date.setHours(now.getHours() + 0.5)` 对小数会截断（20.5 → 20），
  「半小时后」必须换算成分钟
- 「今天」本身不是完整日期，不能当成全天事件
- 「每月5号」这种"N 号"表达需要单独识别，否则整句解析失败

### `src/__tests__/nlp-parse.test.ts` — 自然语言解析 API（18 项）

用 Node `http` 模拟 OpenAI 兼容服务，不需要真实 API Key。

| 用例组 | 锁定的问题 |
| ------ | ---------- |
| 本地规则优先 | **能本地解析时完全不发 AI 请求**（断言 requestCount === 0） |
| AI 兜底 | 本地解析不了长句时调用 AI；forceAI 可强制 |
| AI 返回格式兼容 | tool_calls / json_object / ```json 代码块 三种都能解析 |
| 降级与容错 | AI 401 → 降级回本地并附 `fallbackReason`；AI 返回乱码 → 降级；AI 说不是事件 → 422 |
| 参数校验 | 空文本/缺字段/超长文本 400 |
| **状态接口不泄露密钥** | `/api/nlp/status` 响应体不含 API Key |

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
| `webdav-sync.test.ts` | 17/17 通过 |
| `zh-time.test.ts` | 63/63 通过 |
| `nlp-parse.test.ts` | 18/18 通过 |
| ICS 导入导出 HTTP 端到端（含去重、replace、下载头、日期过滤、异常输入） | 25/25 通过 |
| WebDAV 同步端到端（模拟服务端，52 项含逐条细分断言） | 52/52 通过 |
| 看板 id 漂移专项（未提交的一次性脚本） | 20/20 通过 |
| Python 参考实现 `parse_kanban.py` | 正常产出 ICS |

未验证项（需要你在本地跑）：

- Electron 桌面端实际启动
- 真实 CalDAV 服务器的 push / pull 往返
- **真实 WebDAV 服务器**（坚果云 / Nextcloud 等）—— 测试用的是本地模拟服务端，
  各服务商对 `PROPFIND` / `MKCOL` / `If-Match` 的支持程度可能有差异，
  首次接入建议先用测试按钮确认
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
