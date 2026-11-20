# 测试指南

> **2026-11-02 重写。** 上一版停在「121 项通过（2026-10-19）」，且清单里
> 没有 `workspace` / `recurrence` / `ics-convert` 这几个最核心的测试文件。
> 本文档的数字是**实际跑出来的**（命令见下，任何人都能复现）。

## 跑测试

```bash
# 后端（20 个文件，446 通过，约 5 秒）
cd apps/server && pnpm test

# 前端（13 个文件，115 通过）
cd apps/renderer && pnpm test

# 类型检查（两边都是 0 错误；CI 里这一步是硬门禁）
pnpm -C apps/server typecheck     # tsc --noEmit
pnpm -C apps/renderer typecheck   # tsc --noEmit

# 生产构建
pnpm -C apps/server build
VITE_API_URL= pnpm -C apps/renderer build
```

> 仓库里**没有** `run-tests.sh`（2026-06 的文档引用过它，从未存在）。
> `scripts/run-all-tests.sh` 是发布用的旧脚本，不走 vitest，别拿它当测试入口。

### 关于跳过

v0.3（P3）删掉了 `e2e-bridge.test.ts` / `e2e-full.test.ts` —— 它们锁的是已退役的
`events.md` / `kanban` 双文件架构。**现在 vitest 没有 skip**，20 个文件全跑。

需要打真实 CalDAV 的验证走两个手工脚本（见文末），不要在 CI 里跑。

---

## 后端测试文件清单

| 文件 | 用例数 | 锁定的核心问题 |
| ---- | ------ | -------------- |
| `workspace.test.ts` | 53 | 逐条容错解析、序列化往返、`validateItem`、`filterItems` 各 scope、清单聚合、子任务进度、`uid` 往返 |
| `workspace-api.test.ts` | 35 | HTTP 层 CRUD、字段白名单、`topLevel` / `list` / `expand` 参数、`/lists` 与改名、级联删除、`remind` |
| `recurrence.test.ts` | 30 | RRULE 解析与展开：BYDAY / BYMONTHDAY / INTERVAL / COUNT / UNTIL、短月跳过 |
| `ics-convert.test.ts` | 28 | md ↔ ics：字段映射、RRULE 完整透传、全天 DTEND 排他、标签多行 CATEGORIES、折行、`uid` / `X-WORKBENCH-PROJECT` / UTC 时间戳 |
| `caldav-sync.test.ts` | 23 | 模拟 CalDAV：UID 落盘、增量拉取、冲突不覆盖、字段级合并、按 UID 范围 force、RECURRENCE-ID 跳过、老数据认领、日历发现回退、HTTP 路由 |
| `notifications.test.ts` | 9 | 六个推送渠道的请求格式、失败如实报错、提醒去重 / 24h 宽限 / 失败退避、深层密钥掩码 |
| `zh-time.test.ts` | 67 | 中文时间解析（明天/下周三/3月5日/半小时后/每周一三五…） |
| `nlp-parse.test.ts` | 18 | 快速创建接口：本地规则优先、AI 兜底、三种返回格式、密钥不外泄 |
| `webdav-sync.test.ts` | 25 | 模拟 WebDAV：ETag 乐观锁、冲突不覆盖、pull 前备份、条目级合并（并集 / 较新优先 / 冲突报告 / 笔记合并）、**PUT/HEAD ETag 命名空间不一致的网关（OneDrive/SharePoint）基线与比较同源** |
| `buildICSContent.test.ts` | 15 | ICS 文本拼装（VEVENT 结构、转义、嵌套 VCALENDAR） |
| `config-plugins.test.ts` | 29 | 配置优先级、掩码值不覆盖真值、插件清单扫描与校验 |
| `caldav-degraded.test.ts` | 5 | CalDAV 不可用时服务仍可启动、状态标记为 degraded |
| `caldav.test.ts` | 4 | CalDAV 基础连接（无服务器时也走降级路径） |
| `workspace-store.test.ts` | 25 | 数据核心：读失败不静默当空、round-trip 保真（frontmatter v2 / 未知字段 / 未知块）、并发 50 次不丢、锁排队超时不执行、写前后自校验、历史脏数据不阻塞无关写入、图校验（孤儿/环/区间/提醒） |
| `backups.test.ts` | 21 | 备份只读接口：列表排序 / `itemCount` 容错（坏备份为 null）/ 预览 sha 与差异 / 固定 24h / 路径穿越拒绝 / 只读环境不固定 / 导出原始字节 / 20 份与 50MB 轮转 |
| `restore.test.ts` | 14 | 恢复状态机：sha 校验 / 坏备份 / abort / resume / 维护期拒绝 / drain 超时保留 marker / 启动自愈 / 提醒 sent 裁剪 |
| `storage-check.test.ts` | 6 | 原子写 + 崩溃注入（`WORKSPACE_CRASH_AFTER_TMP=1` 子进程 SIGKILL 后旧文件完好、tmp 可清理）、存储自检不抛不 exit、只清自己的旧 tmp |
| `app-create.test.ts` | 18 | `createApp` 装配顺序：认证先于静态/SPA、`/API` 大小写、`%61pi` 编码绕过 400、`/api//`、未知 API JSON 404、OPTIONS 204、`Origin: null`、非法 JSON 400、async rejection → JSON 500、静态 `api/` 不可匿名读取、只读/维护闸门白名单 |
| `sync-overview.test.ts` | 10 | 同步中心只读概览：未配置也返回、配置不可达地址也不联网（<2s）、事件/冲突环各 20 条、超长消息截断、`lastError` 取最近错误、`inFlight` 归零、reset 清空、维护态、恢复 marker → `restorePending` |
| `auth.test.ts` | 9 | token 生命周期：env 优先/长度/空白拒绝、生成 `0600`、复用不重写、`0644` 自动收紧、损坏文件改名重建、不可写目录降级为内存 token、`tokenMatches` 空值恒 false |

> `app-create.test.ts` 是唯一直接 `createApp()` 的测试：它不测业务逻辑，只锁住
> 「顺序」这一层。顺序错了，其它测试全绿也没用（未授权请求会拿到 200 的页面）。

另有几个**不是 vitest 用例**的脚本：

- `scripts/run-e2e.sh` — **推荐入口**：起一个隔离服务（临时 `WORKSPACE_FILE` /
  `config.json` / 随机 `API_TOKEN`，CalDAV 指向必然连不上的地址），再依次跑下面两个验收脚本。
  必须这样跑：v0.3 起 `/api/*` 需要 Bearer token，手跑会整片 401；而且脚本会写数据，
  绝不能指向真实的 `workspace.md`。
- `acceptance.e2e.mjs` — 全功能验收（92 项：健康、NLP、快速创建、周期、schema 防护、更新删除、插件、配置脱敏、降级）
- `workspace-acceptance.e2e.mjs` — 统一数据源专项验收（32 项）
- `scripts/upgrade-drill.sh` — v0.2.x → v0.3.0 升级演练（token 自动生成、鉴权、坏块容错、frontmatter 保真、编码路径拦截、同步概览）
- `cleanup-remote.ts` — 清理远端测试数据

### 几个值得单独记住的回归点

- **`workspace.test.ts` 里有一条坏记录不影响其余** —— 容错解析的核心卖点，
  破坏了这条，一条畸形数据就能让 500 条全读不出来
- **`recurrence.test.ts` 的「每周一三五」** —— 早期 WEEKLY 推进步长写 +7 天，
  会跳过同周的周三周五，测试抓到的
- **`recurrence.test.ts` 的「每月31号」** —— 短月不该溢出成 3/3，应按 RFC 5545 跳过
- **`ics-convert.test.ts` 的全天 DTEND** —— 必须是次日，同日会导致零长度事件
- **`workspace-store.test.ts` 的「新建不改存量 id」** —— 旧 kanban 用行序当 id，
  新建任务 unshift 到队首会让存量 id 整体错位。现在是显式 `id` 字段 + 指纹比对
- **`caldav-sync.test.ts` 的 UID 落盘** —— 拉取时丢掉远端 UID，回推就会在服务器上
  新建一份，手机上出现重复日程。这条测试用模拟服务器锁住它
- **`caldav-sync.test.ts` 的冲突不覆盖** —— 两边都改过时必须报 conflict 并保留本地，
  静默覆盖会丢掉另一台设备上的修改

## 前端测试文件

`apps/renderer/src/__tests__/`，共 13 个文件 / 115 项：

| 文件 | 覆盖 |
| ---- | ---- |
| `ui-smoke.test.tsx` | 模块化 UI 冒烟（导航、占位模块、页面渲染） |
| `workspace-ui.test.tsx` | 任务/日历读统一数据源的渲染路径、点击编辑、截止日当天不算逾期 |
| `date-utils.test.ts` | 本地日期工具：纯日期按本地日解释、逾期边界、addDays/addHours 跨月跨年 |
| `reminders.test.ts` | 提醒时间换算、预设映射、到点筛选、24h 宽限、完成/取消过滤、稍后提醒 |
| `FilterBar.test.tsx` | 事件筛选条 |
| `i18n.test.ts` | **zh-CN 与 en-US 的 key 完全一致**（少一个 key 就失败） |
| `calendarStore.test.ts` / `syncStore.test.ts` | store 行为 |
| `LoadingSpinner.test.tsx` / `SyncStatusBar.test.tsx` | 组件渲染 |
| `resilience.test.tsx` | 后端不可达横幅（不假装保存）、恢复后横幅消失、500 页 3 步手工恢复、错误边界捕获子树异常 |
| `auth-ui.test.tsx` | token 存取/清理、`createApiClient` 注入 `Authorization`、AuthGate 200 放行 / 401 显示令牌页 / 断网不挡路 |
| `sync-center.test.tsx` | 同步中心：未配置引导、已配置字段、冲突/事件分区、恢复挂起三方向按钮、加载失败不白屏 |

## 手工验收

```bash
cd apps/server && pnpm dev      # :3001
cd apps/renderer && pnpm dev    # :5173
```

必须走 HTTP。**直接双击 `dist/index.html` 用 `file://` 打开会因 ES module / CORS /
ServiceWorker 报一堆错**，那不是 bug。

建议按这条路径手工过一遍：

1. 日历页顶部一句话创建：「明天下午3点和老王开项目评审会」→ 草稿先预览 → 确认
2. 同一事件出现在任务看板（因为它有 `start` 和 `kind: task`）
3. 任务页勾选完成 → 回到工作台，待办数 -1
4. 任务页加子任务 → 父任务出现 `1/3` 计数与进度条
5. 清单切换条：收件箱 / 各清单数量与看板一致
6. 导出 ICS → 用手机日历导入 → 检查「每周一三五」还是三条独立事件（不能退化成每周）
7. WebDAV 面板：测试连接 → 推送 → 改一个文件 → 拉取（会给出「以本地 / 以远端 / 合并」三个选项）
8. 事件/任务设一个 1 分钟后的提醒 → 到点右下角弹卡片 →「稍后 10 分钟」再生效
9. 通知页：填一个通用 Webhook（可指向本地临时服务）→ 保存 → 发送测试 → 立即检查并推送

## 环境坑

- **`Y:\` 这类网络映射盘**：`pnpm install` 可能产出损坏的 `node_modules`
  （目录能列出但 `tsc` / `tsx` 报 `Input/output error`）。遇到时在 WSL 内跑，
  或把仓库复制到本地磁盘验证（本项目实际验证是在本地副本里做的）
- **端口**：后端与 Electron 主进程都硬编码 3001，
  `apps/renderer/.env` 的 `VITE_API_URL` 必须一致
- **MCP/pnpm 垫片**：在 `\\wsl$\...` 路径上做回收站删除会失败，
  导致 `pnpm install` 直接退出、`node_modules` 不完整 —— 报
  `Cannot find module 'react'` 多半是这个，不是代码问题

## 未覆盖 / 未验证

- Electron 桌面端实际启动
- 真实 CalDAV 服务器上的 push / pull 往返（测试用本地模拟服务端，未连真实 Radicale）
- 真实 WebDAV 服务商（坚果云 / Nextcloud）—— 测试用的是本地模拟服务端
- Android 打包运行
- CalDAV 删除传播（墓碑记录，功能本身未实现，见 SYNC_MANAGEMENT.md）
- Docker 镜像已在本机构建并跑通（`node:22-alpine`，253MB）：静态页面、`/api`、
  数据卷写入、推送渠道状态都验证过；**真实渠道推送**需要你自己的 Webhook / Key 才能验证
- `docker compose` 插件本机未安装，compose 文件按官方语法编写但未实际执行
- 非 root 运行已验证：entrypoint 以 root 给 /data 改属主后 `su-exec app`，
  node 进程 uid=100（`ps` 可见）

---

**Last Updated**: 2026-11-02
