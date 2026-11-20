# 更新日志 (Update Log)

这个文件记录了项目的持续更新和改进。每次更新都应该在这个文件中添加相关信息，而不是创建新的更新日志文件。

## 2026-11-20（v0.4 规划固化 + Radicale 真机 CalDAV 往返实测）

### v0.4 产品决策与实施计划
- 用户裁决 6 项方向 → `docs/planning/v0.4-product-decisions.md`（D36–D42）：
  Windows 桌面优先、单机本地优先（NAS 第二形态）、 Radicale 建基线、
  单文件事实源 + 派生索引（v0.4.5 再做 Spike）、成熟度版本而非功能堆积。
- 按决策推导 `docs/planning/v0.4-implementation-plan.md`（草案，未评审）：
  PR 序列 A 桌面交互 / B 派生索引 / C 同步正确性 / D 导入与清理。

### Radicale 真机 CalDAV 往返（12/12 通过）
- 用户提供 Radicale 服务，PROPFIND Depth:0/1 返回 207（日历 AT，含 3 个既有 .ics）。
- 用隔离临时 workspace + 真服务端跑 push/pull：建唯一 UID 事件 → push →
  PROPFIND 找到对象 → GET 验证 UID → 远端改 SUMMARY → pull → 本地标题更新 →
  清理远端对象（DELETE 204）+ `/api/caldav/test` / status 全绿。
- 发现该 Radicale 服务端会在一段时间后自行重建日历集合（期间短暂 404，
  MKCOL 重建后恢复）；这不影响同步逻辑，但真机测试要容忍目标 URL 偶发 404。
- 重要：远端对象的实际文件名由服务端生成，**不能按 UID 猜 .ics 文件名**，
  必须 PROPFIND + GET 按 UID 定位（测试脚本已按此实现）。
- 测试脚本与临时凭据均已删除；远端无测试对象残留。

## 2026-11-05（真实 WebDAV 实测：修掉「每次推送都误报冲突」的 ETag 缺陷 + 审计四项收口）

用户给了一个真实的 WebDAV 账号（某 OneDrive/SharePoint 风格的网盘网关），第一次在**真机**上跑同步链路。
全部测试都在隔离远端目录里做，测完 DELETE 清理，没碰用户真实数据。

### 抓到的真问题：PUT 与 HEAD 的 ETag 属于两套命名空间 → 每次 push 都误报冲突

- 现象：隔离 harness 16 项断言里 2 项红——
  `PUT 返回 ETag 与 status HEAD ETag 一致` 拿到
  `{"etagPush":"<短哈希>","etagStatus":"{<GUID>,1}"}`；
  `二次 push 不误报冲突` 直接 `conflict: true`。
- 根因：这类网关 `PUT` 响应头给短哈希 ETag，`HEAD`/`GET`（经 302 跳到
  某微软个人网盘域名）给 `{GUID},N` 格式。`putRemoteFile()` 把 PUT 的 ETag
  存进 `.webdav-state.json`，下次 push 用 `statRemoteFile()` 的 ETag 去比，永不相等 →
  **每次推送都被判成「远端已被其他设备修改」，用户必须手动 force**。
  mock 单测里 PUT 与 HEAD 的 ETag 同源，所以一直抓不到。
- 修复：`apps/server/src/webdav.ts` 的 `putRemoteFile()` 在 PUT 成功后**不信任响应头 ETag**，
  改为回读一次 `statRemoteFile()` 拿规范 ETag；回读失败才退回 PUT 的 ETag。
  「记录的基线」与「比较用的值」从此同源。
- 已验证该网关的读取 ETag 确实随内容变化（连续三次 PUT 得到三个不同 GUID），
  所以冲突检测在这个后端仍然有效。
- 回归测试：`webdav-sync.test.ts` 的 mock 增加 `divergentPutEtag` 开关，新增 2 项
  （基线与 HEAD 同源、真改动仍能检出冲突），该文件 23 → 25 项。
- 真机复验：harness 从 14 PASS / 2 FAIL 变为 **16 PASS / 0 FAIL**。

### 审计四项收口

1. **验收脚本失效** → 两个 e2e 脚本改为读 `VERIFY_TOKEN`/`API_TOKEN` 并带 `Bearer`，
   `VERIFY_BASE_URL` 可覆盖；新增 `scripts/run-e2e.sh` 起隔离服务
   （临时 `WORKSPACE_FILE` / `config.json` / 随机 token，CalDAV 指向必然连不上的地址），
   并修掉补丁引入的 `parse()` 未 await Promise 的 bug。结果 **92 + 32 全通过**。
2. **恢复逃生口只有 API 没 UI** → `BackupPanel` 的「同步已暂停」横幅与同步中心都加了
   「放弃本次恢复」（`abortRestore()`），带二次确认；新增 4 个 i18n 键（中英对齐）；
   `sync-center.test.tsx` 新增 2 项（点击调用、取消不调用），5 → 7 项。
3. **`docs/MODULE_STATUS.md` 过时** → 同步中心从 `planned` 改 `stable`，
   补 `sync-overview.test.ts`（10）；ICS 计数修正 28/15 → 29/16；WebDAV 行补 ETag 说明。
4. **CI 不含打包产物/验收** → 新增 `e2e` job（build server + `bash scripts/run-e2e.sh`）；
   产物路径 `apps/desktop/dist-electron/` 改为 `dist-server/`（`pnpm build` 只跑 esbuild，
   不跑 electron-builder，原路径永远不存在）。

### 验证

- server：`tsc --noEmit` 0 错误；**20 文件 / 444 通过 / 0 skip**。
- renderer：`tsc --noEmit` 0 错误；**13 文件 / 115 通过**。
- 双端 `build` 通过；产物内无 `localhost:3001`。
- `bash scripts/run-e2e.sh`：92 + 32 全通过。
- 真实 WebDAV（用户提供的网盘网关，隔离目录）：16/16 通过，清理 204。

## 2026-11-03（P9：v0.3.0 发布收尾——版本号、升级演练、Docker 烟测）

P9 是「能不能真的发出去」的检验。这一轮抓到一个**只有跑 `dist/` 才会暴露**的启动崩溃，
说明前面的测试全绿不代表打包后能跑。

### 抓到的真问题：`rrule` 在 ESM 下启动即崩

- 症状：`node apps/server/dist/index.js` 直接
  `SyntaxError: The requested module 'rrule' does not provide an export named 'RRule'`，
  服务根本起不来。而 `vitest` 跑 `recurrence.test.ts` 30 项全绿。
- 原因：`rrule@2.8.1` 是 CJS 包（webpack UMD 产物），`package.json` 里 `main` 指向
  `dist/es5/rrule.js`；我们 `"type": "module"` + `import { RRule } from "rrule"`
  在 Node 原生 ESM 下拿不到具名导出。vitest 会把依赖预打包成 ESM，所以测试发现不了。
- 修复：改成 `import rrulePkg from "rrule"; const { RRule } = rrulePkg;`，
  类型仍用 `import type { Options }`。`typecheck` + `build` + 升级演练全部复验通过。
- 教训（已写进测试文档口径）：**凡是新增 CJS 依赖，必须用 `node dist/index.js` 起一次真服务**，
  不能只看 vitest。

### 版本号与元数据

- 根 `package.json`、`apps/server`、`apps/renderer`、`apps/desktop` 统一 `0.3.0`。
- `apps/desktop/package.json` 补 `description` / `author`（消除 electron-builder 的两条警告）。

### 升级演练（v0.2.x → v0.3.0，脚本 `scripts/upgrade-drill.sh` 手动执行版）

用一份「v0.2.x 风格」数据（无 `uid`、无 `remind`、frontmatter 带自定义字段、故意夹一个缺 `id` 的坏块），
以 `WORKSPACE_FILE` 指向它、**不带任何 token** 启动 `dist/index.js`：

- 启动自动生成 `api-token.txt`（权限 `-rw-------`，长度 64）；不需要任何迁移步骤；
- `GET /api/workspace/items` 无 token → **401**；
- 带 token → 200，**坏块被跳过、两条好条目照常读出**（`count: 2`，`notes` 里列出 16 条诊断）；
- `/%61pi/workspace/items` → **400**（编码绕过被拦），`/API/workspace/items` → **401**；
- 写入一条后，frontmatter 里的 `myCustomField: keep-me` **仍在**（round-trip 保真）；
- `GET /api/sync/overview` 正常返回，`events`/`conflicts` 为空也不报错。

演练中顺便修掉了演练脚本自身的一个错误假设（`priority` 只接受 `high|mid|low`，我一开始写了 `2`），
这也提示：外部/历史数据里若出现非法 `priority`，解析会记一条错误而不是整份失败。

### Docker

- 构建参数收敛：`pnpm install` 加 `--network-concurrency=4 --fetch-timeout=180000 --fetch-retries=5`，
  build 阶段加 `--filter caldav-server... --filter caldav-renderer...`（不装根目录测试工具，少下 100+ 包）。
- 本机 Docker 没有 `buildx` 插件（`docker buildx` → unknown command，`DOCKER_BUILDKIT=1` 报
  "buildx component is missing"），所以 `--mount=type=cache` 方案不可用，已回退为普通层缓存；
  该限制写进了部署文档的排查小节。
- 镜像构建成功（40 步，`caldav-desktop:p9`）；中途若干 `ETIMEDOUT` 由 pnpm 自身重试救回。

### 容器烟测：抓到一个真实缺陷（`workspace.md` 权限）

`docker run -d -p 3999:3001 -v /tmp/cd-data:/data caldav-desktop:p9` 后逐项验证：

| 检查 | 结果 |
| --- | --- |
| `/health` | 200 `{"status":"ok","version":"dev"}` |
| `/`（前端） | 200 `text/html`，`STATIC_DIR` 生效 |
| 无 token `/api/workspace/items` | **401** |
| 带 token 读 / 写 | 200 / 建任务成功 |
| `/api/sync/overview` | 正常，未配置时 `events`/`conflicts` 为空也不报错 |
| 数据卷持久化 | `api-token.txt` + `workspace.md` 都在 `data/` |
| CalDAV 连不上 | 只告警不退出（离线优先） |

**但 `workspace.md` 是 `0600`、属主是容器内 uid 100，宿主机用户 `head` 直接 `Permission denied`。**
这是真缺陷不是小瑕疵：`workspace.md` 就是唯一事实源，用户随时要用 vim / Obsidian / VS Code
打开它改两行——只有容器能读，等于把「本地优先」的产品前提废掉了。

根因：`storage-check.ts` 的 `atomicWriteFile` 把所有落盘文件都写成 `0600`，
而它同时服务于 token（该 0600）和 workspace / 备份 / 恢复（该 0644）。

修复：

- `atomicWriteFile(filePath, content, mode = 0o600)` 新增第三参数，rename 前显式 `chmod`
  （`openSync` 的 mode 会被 umask 削减）；
- `workspace-store.ts` / `restore.ts` 覆盖 workspace 时传 `0o644`，`backups.ts` 落备份也 `0o644`；
- `auth.ts` 的 token 保持默认 `0600`；
- **运行用户改为复用 `node:22-alpine` 自带的 `node` 用户（uid/gid 都是 1000）**，
  1000 正好是绝大多数 Linux 桌面发行版的默认首个用户，bind mount 的 `data/`
  宿主机天然可读写。踩坑记录：先试 `addgroup -g 100` 报 `gid '100' in use`
  （alpine 自带 `users` 组），再试 `-g 1000` 又报 `gid '1000' in use`
  （node 镜像里已属于 node 用户）——所以别新建用户，直接复用；
- `docker-entrypoint.sh` 支持 `PUID` / `PGID` 覆盖（默认 1000 / 1000），
  并且只在 `node` 用户确实写不了 `/data` 时才 `chown -R`，避免备份多时每次启动递归改属主；
- `docker-compose.yml` 显式传 `PUID` / `PGID`。

复测（`caldav-desktop:p9c`，容器内 uid 1000 = 宿主机 `atdoc`）：

```
-rw------- 1 atdoc atdoc  65 api-token.txt     ← 密钥，保持 0600
-rw-r--r-- 1 atdoc atdoc 188 workspace.md      ← 唯一事实源，0644 可读
宿主机 read  → 正常读到 frontmatter
宿主机 write → WRITE_OK
写完后再读接口 → 条目仍在，后端没被搞坏
```

`pnpm -C apps/server test` 修改后仍 **442 通过**（`atomicWriteFile` 默认值没变，
`auth.test.ts` 里 `0600` 的断言依然成立）。

### 文档

- `README.md`：version badge → 0.3.0，Roadmap 增加「v0.3.0（2026-11-03，已完成）」小节并清掉过期的 v0.2.5 行。
- `docs/CHANGELOG.md`：新增 `[0.3.0] - 2026-11-03` 完整条目（数据安全 / 备份恢复 / 认证 / 桌面部署 / 同步中心 / 测试 / 升级）。
- `docs/DEPLOYMENT.md`：补访问令牌获取（`docker compose exec -u root ... cat /data/api-token.txt`）、
  只读挂载与 `ALLOW_UNSAFE_FS=1`、升级与回滚说明。
- `docs/planning/README.md`：P9 勾选，状态改为「**v0.3.0 实现完毕，待打 tag**」。

### 测试

后端 **442 通过（20 文件，0 跳过）**，前端 **113 通过（13 文件）**；双端 `typecheck` / `build` 通过，
`apps/desktop` 的 esbuild 产物 2.03 MB。

## 2026-11-03（P8：同步中心只读概览 + 事件/冲突环形缓冲）

P8 是「看得见同步状态」这一步：不改任何同步算法，只把已有状态**只读地**汇总成一个页面。
关键是**离线优先**——没配同步也完全不影响本地使用，进入同步中心只会看到引导，不会阻塞任何操作；
概览接口**不发任何网络请求**，所以断网时页面照样能打开、能看清上次同步结果和错误。

### 服务端

- 新增 `apps/server/src/sync-overview.ts`：`getSyncOverview()` 汇总 CalDAV（配置/日历/上次同步/本地/待推/已同步/最近错误）、
  WebDAV（配置/远端目录/上次同步/ETag/最近错误）、事件环、冲突环、`restorePending`、`autoSyncSuspended`、
  `maintenance`、`inFlight{caldav,webdav,restore}`。
  - **绝不联网**：WebDAV 侧只读本地 `.webdav-state.json`（刻意不复用 `routes/webdav.ts` 里会 HEAD 远端的 `GET /status`）；
    CalDAV 侧只读 `.caldav-sync-state.json` 与配置。
  - 全部 try/catch 降级：任何状态文件损坏或配置缺失都返回「未配置/无数据」，不抛错、不影响页面渲染。
  - `webdavDirName()` 把配置里的目录（`CalDAV-Desktop`）与旧的整文件路径（`.../events.md`）都归一成目录名。
- `apps/server/src/sync-control.ts` 增加两个进程内环形缓冲（各 20 条，重启清空）：`recordSyncEvent(channel, kind, message)`
  与 `recordSyncConflict({channel, localId, remoteHref, localHash, remoteEtag, summary})`，消息超 500 字符截断。
- `apps/server/src/routes/sync-control.ts` 新增 `GET /api/sync/overview`（与会话内其它接口一样走 token 认证）。
- 记录点接入：CalDAV 的拉取冲突（本地与远端都改过）、推送 412 冲突、每次同步结束的摘要与逐条错误；
  WebDAV 的 push 冲突、push/pull 摘要与逐条错误、merge 冲突与合并统计。

### 前端

- 新增 `apps/renderer/src/modules/sync/index.tsx`（替换原来的 git-sync 占位模块，导航名「同步中心」，order 3）：
  - 两张通道卡片：已配置显示字段与最近状态；未配置显示「未配置不影响本地使用」并给出设置入口。
  - 恢复挂起 / 同步暂停时顶部出现琥珀色提示与三个方向按钮（以云端为准 / 以本地为准 / 双向合并）。
  - 冲突区（琥珀色）明确写出「不会自动覆盖」，事件区倒序显示最近 20 条并注明重启清空。
  - 进页面只拉一次 + 手动刷新，不轮询（离线时不会刷屏报错）。
- 新增 `apps/renderer/src/api/sync.ts`：`fetchSyncOverview()`、`resumeSync(action)`。
- i18n：zh-CN / en-US 各新增约 48 个 `syncCenter.*` 键，key 集合完全一致。

### 测试

- 新增 `apps/server/src/__tests__/sync-overview.test.ts`（10 项）：未配置返回、配置不可达地址也 2 秒内返回（证明不联网）、
  事件环 25→20、冲突环 23→20、超长消息截断、`lastError` 取最近错误、`inFlight` 归零、reset 清空、
  维护态可见、恢复 marker 让 `restorePending` 为真。
- 新增 `apps/renderer/src/__tests__/sync-center.test.tsx`（5 项）：未配置引导、已配置字段、冲突/事件分区、
  恢复挂起三按钮（点击触发 `resumeSync("pull")`）、加载失败不白屏。
- 结果：后端 **442 通过（20 文件，0 跳过）**，前端 **113 通过（13 文件）**；双端 `typecheck` 与 `build` 通过，
  构建产物不含 `localhost:3001`。

### 下一步

P9：发布收尾——Docker 镜像烟测、升级演练（v0.2.x → v0.3.0 数据兼容）、版本号与 tag。

## 2026-11-03（P7：备份恢复状态机 + 恢复后同步方向选择）

P7 把「手工覆盖 workspace.md」变成有状态机保护的一键恢复。恢复是唯一会**整份替换**数据文件的操作，所以流程刻意做得很重。

### 服务端（`apps/server/src/restore.ts`）

- 状态文件：`.restore-state.json`（phase/file/sha256/epoch/error）与 `.sync-suspended.json`（恢复后同步暂停标记）。
- `POST /api/workspace/backups/restore`：必须 `confirm: true` + 预览时拿到的 `sha256`；服务端重新计算并比对（防预览与写入之间换文件）。
- 恢复前校验：解析备份 → 至少一条可解析 → `validateWorkspaceGraph(includeHistorical)`；坏备份直接 400，不动当前文件。
- 执行顺序：`invalidateSyncEpoch` → `setSyncMaintenance(true)` → 停 CalDAV 自动同步 → 暂停提醒调度并**等待本轮 tick 结束** → `waitForInFlightSync(10s)`（CalDAV + WebDAV + reminder）→ 固定快照（防 24h TTL 清掉，重试仍可用）→ pre-restore 备份（失败即中止）→ 持锁原子写 + 重置 CalDAV/WebDAV 基线 + 按新数据裁剪 `sent` + 写暂停标记 → 清 marker、解除冻结、重启提醒调度。
- 失败时保留 marker + maintenance，返回 503；`POST /api/workspace/backups/restore/abort` 可放弃（工作区保持现状、同步仍暂停）。
- 启动自愈 `recoverRestoreOnStartup()`：有 marker 且固定快照仍在 → 保持冻结并跳过定时器；快照已失效 → 自动解除冻结（否则用户永远 503）。
- `POST /api/sync/resume`：`pull | push | bidirectional`，清暂停标记、作废纪元、按选择跑一次同步；未配置 CalDAV 时只解除暂停不发请求。
- `isSyncSuspended()` 接入 CalDAV 手动同步与 WebDAV push/pull/merge（409 `SYNC_SUSPENDED`）；WebDAV 三个写路由用 `res.once("close")` 登记在途活动，恢复会等它们结束。
- 提醒调度：每轮登记 `beginSyncActivity("reminder")`；写回 `sent` 前检查 epoch/maintenance，避免恢复重置后又被旧状态覆盖。

### 前端

- `api/backups.ts` 增加 `getRestoreStatus / restoreBackup / resumeSync`。
- `BackupPanel` 每行新增「恢复」按钮：`window.confirm` 二次确认 → 重新预览取 sha → 调恢复；完成后顶部出现琥珀色「同步已暂停」面板，提供「拉取云端 / 推送本地 / 双向合并」三选一，并显示本次恢复的条数。
- i18n 中英文同步新增 11 个 key（`backup.restore*`、`backup.syncSuspended*`、`backup.resume_*`）。

### 验证

- `apps/server/src/__tests__/restore.test.ts` 14 项：正常恢复、sha 不匹配、坏备份、缺 confirm、abort、resume 非法/未暂停/成功、维护期写入被拒、drain 超时保留 marker、启动自愈两条路径、提醒 sent 裁剪。
- 全量：server **19 文件 / 432 通过 / 0 skip**；renderer **12 文件 / 108 通过**；两端 `tsc --noEmit` 0 错误。

## 2026-11-03（P6：Electron 打包——本机 HTTP 后端 + 主进程注入 token）

P6 把桌面端从「file:// 打开静态页 + 假设 3001 有服务」改成**自带后端、随机端口、同源 HTTP**。

### 主进程（`apps/desktop/main.ts`）

- 生产模式不再 `loadFile`（file:// 是 null origin，CORS/鉴权都不成立）：
  先 `listen(0)` 拿一个空闲端口（重试 3 次），再 fork 打包进 `resources/server/index.cjs`
  的后端，最后 `loadURL("http://127.0.0.1:<port>")`。
- 后端环境：`ELECTRON_RUN_AS_NODE=1`、`execPath=process.execPath`（不要求用户装 Node）、
  `PORT`、`HOST=127.0.0.1`、`API_TOKEN`、`WORKSPACE_FILE=<userData>/workspace.md`、
  `STATIC_DIR=<resources>/renderer`、`PLUGINS_DIR=<resources>/plugins`、`APP_VERSION`。
- token 由主进程 `ensureToken()` 生成/读取 `<userData>/api-token.txt`（`0600`），
  **只存在于主进程**；`webRequest.onBeforeSendHeaders` 仅对 `http://127.0.0.1:<port>/*`
  注入 `Authorization: Bearer …`。渲染进程拿不到 token，也不写 localStorage。
- 启动顺序：fork 后端 → 每 100ms 探 `/health`（最长 15s）→ 成功才建窗口；
  失败弹 `dialog.showErrorBox` 而不是留一个白窗口；退出/`before-quit` 杀子进程。
- 开发模式（未打包）仍连 `localhost:5173`，后端各自跑，保持原 `pnpm dev` 体验。
- `preload.ts` 只暴露 `__DSH_ELECTRON__` 与 `__API_BASE_URL__`（从 `--dsh-api-base=` 读，
  同源兜底），不再暴露任何 Node 能力。

### 打包

- 新增 `apps/desktop/build-bundle.mjs`：esbuild 把 `apps/server/src/index.ts` 打成
  单文件 `dist-server/index.cjs`（CJS / node18 / 2.0MB）。理由：pnpm 的 node_modules
  符号链接结构复制进 Electron 经常缺依赖，单文件没有路径解析问题。
- 为此修掉两处 `import.meta.url` 推导（`apps/server/src/config.ts`、`routes/plugins.ts`）：
  改成 `typeof __dirname === "string" ? __dirname : process.cwd()`，同时兼容 ESM 开发与 CJS 打包。
- `electron-builder.config.json` 增加 `extraResources`：`dist-server → server`、
  `../renderer/dist → renderer`、`../renderer/plugins → plugins`。
- `package.json` 的 `build` 现在包含 `build:server`；新增 devDependency `esbuild@^0.25.0`。
- `/health` 增加 `version`（来自 `APP_VERSION`），供设置页显示。

### 验证

- `npx tsc --noEmit`（desktop）0 错误；`node build-bundle.mjs` 无警告。
- `electron-builder --dir` 成功产出 `dist-electron/linux-unpacked`，其中
  `resources/server/index.cjs`、`resources/renderer/index.html`、`resources/plugins/example.json`
  均在位；`app.asar` 内含 `dist/main.js`、`dist/preload.js`；渲染产物不含 `localhost:3001`。
- 用打包后的目录起后端（`STATIC_DIR=resources/renderer`）：`/health` 200、`/` 200、
  `/api/plugins` 正确扫到 `example`、无 token 的 `/api/*` 401。
- **未做**：无显示环境（无 xvfb），Electron 窗口本身没跑；已列入手工门禁 F10。

## 2026-11-03（P5：单用户认证——服务端 token + 前端 AuthGate + ICS 改 blob）

P5 把「局域网里裸奔的后端」收口成单用户 token 模式（D1/D28）。**默认开启，不存在“忘了配就公开”的状态。**

### 服务端

- 新增 `apps/server/src/auth.ts`：
  - `resolveApiToken()` 顺序：`API_TOKEN`（`^\S{32,}$`，太短/含空白直接报错）→
    `API_TOKEN_FILE` 或 `<数据目录>/api-token.txt`（必须 64 位 hex）→ 生成 32 字节随机 token。
  - 生成时原子写 + `chmod 0600`；已存在的文件若是 `0644` 会自动收紧，失败只警告。
  - 文件损坏/长度不对：改名 `api-token.invalid-<时间戳>` 后重建，不静默使用坏值。
  - 目录不可写：退化为“进程内存 token”，启动日志打印一次并明确提示重启即变。
  - `tokenMatches()` 对两侧都做 sha256 再 `timingSafeEqual`；空串直接 false，
    避免 `sha256("") === sha256("")` 让 `Bearer ` 通过。
- `createApp()` 的 `auth` 从 P1 的 `false` 改为 `{token}`；`index.ts` 启动时先解析 token
  再建 app，`/health` 与静态资源仍公开，其余 `/api/*` 一律 401（顺序由 P1 锁定）。
- 新增 `auth.test.ts` 9 项：env 优先 / 太短 / 含空白 / 生成 `0600` / 复用不重写 /
  `0644` 收紧 / 损坏改名重建 / 不可写目录降级内存 token / 空值比较恒 false。

### 前端

- 新增 `api/token.ts`（localStorage `dsh-api-token`，提供 `isElectron()` 与
  `dsh:auth-required` 事件名）和 `api/client.ts`（`createApiClient(timeout)`，
  请求拦截器注入 `Authorization: Bearer`，401 广播事件）。
- 9 处 `axios.create()` 全部换成 `createApiClient()`：workspace / webdav / backups /
  nlp / calendar / caldav-sync / notifications / 设置页 / 离线横幅。
  Electron 下不注入（由主进程 `webRequest` 负责，P6），避免 token 进渲染进程。
- 新增 `components/auth/AuthGate.tsx`：先探 `/api/workspace/info` —— 200 放行、
  401 显示令牌页、网络错误放行（交给离线横幅，不误报“认证失败”）。
  令牌页给出 Docker 取 token 命令、输入框、清除、连接；连接前先用候选 token 探测，
  成功才落盘并刷新。
- `api/base.ts`：只要注入的 `__API_BASE_URL__` 是字符串就采用（**包括空串**），
  修掉 Electron 随机端口下回退到构建期 `localhost:3001` 的 B3 bug。
- ICS 导出从 `window.open` 改为 `downloadIcs()`（axios `responseType: "blob"` →
  objectURL → `<a download>`），否则带 token 后新窗口必然 401。
- 新增 `auth-ui.test.tsx` 6 项：token 存取清、client 注入头、AuthGate 200/401/断网。

### 验证

- server：`tsc --noEmit` 0；`vitest` **416 通过（18 文件，0 skip）**；`pnpm build` OK。
- renderer：`tsc --noEmit` 0；`vitest` **108 通过（12 文件）**；
  `VITE_API_URL= pnpm build` OK。

### 升级提示

- 老用户升级后第一次访问会看到令牌页。token 在数据目录 `api-token.txt`：
  `docker compose exec -u root caldav-desktop cat /data/api-token.txt`。
- 反代必须转发 `Authorization` 头，否则永远 401。
- 浏览器/PWA 与 Electron 各自保存/注入，互不影响；清除浏览器 localStorage 即可重新输入。

## 2026-11-03（P4：备份只读面板 + 韧性 UI + 第一轮“不重复造轮子”）

P4 只做“出事时能救回来”的那一层，并顺手兑现 D35（优先成熟开源库）。

### 备份只读（v0.2.5 范围）

- 新增 `apps/server/src/backups.ts`：`listBackups` / `previewBackup` /
  `readBackupForExport`。列表按文件名倒序，坏备份的 `itemCount` 为 `null`
  而不是 0（“读不出来”和“空文件”必须能区分）；预览计算 sha256 并把备份
  固定在 `.workspace-backups/.pinned/` 24 小时，避免恢复前被轮转清掉；
  只读环境下只预览不固定。
- 新增 `apps/server/src/routes/backups.ts`：`GET /api/workspace/backups`、
  `POST /preview`、`GET /export`。**没有写接口**——恢复要等 P7 的认证与状态机。
- 备份轮转从 10 份提升到 20 份 / 50 MB；文件名加 6 位随机后缀，解决同一毫秒
  连续写入互相覆盖的问题。
- 前端新增“设置 → 数据文件 → 本地备份”面板：列表、条目数、大小、固定标记、
  预览差异（新增/删除/修改，字段级）、带 Authorization 的下载。

### 韧性 UI

- `ConnectionBanner`：每 30 秒探一次 `/api/workspace/info`，后端不可达或设备
  离线时显示“无法连接后端 / 此时不会保存任何修改”，不假装保存。
- `ErrorFallback` 重写：不再只有“出错了 + 重试”，给出 3 步手工恢复
  （下载备份 → 覆盖 `data/workspace.md` → 重启），并明确“先别删东西”。
- 模块化入口 `App.tsx` 现在包在 `GlobalErrorBoundary` 里（此前只有旧的
  `AppShell` 分支有错误边界，模块化路径崩了就是白屏）。

### 不重复造轮子（D35）

- RRULE 展开从自研 420 行换成 `rrule@2.8.1`（BSD-3，687 KB）：
  `expandRecurrenceDates` 内部走 `new RRule(...).between()`，本地墙上时间用
  “伪 UTC”适配；`parseRRule` / `formatRRule` / `describeRRule` 等对外签名不变。
- 评估了 `chrono-node` 但**没有替换**中文解析器：它缺“每月1号”重复规则、
  “每周一三五”多选周几、“下下周一”相对周、标题剥离等本项目语义，
  换过去会退化。评估过程与结论记在 `docs/planning/oss-reuse-audit.md`。
- 同时修了中文解析器的 3 个真实 bug：「明早/明晚」不识别、「明年1月1日」
  多加一年、「每周一三五」标题残留周几。
- 决策记录：`D8` 改为由 `D35` 取代（允许为替代高风险自研而新增运行时依赖，
  需过 License/体积/Node 22/离线安装检查）。

### 验证

- `pnpm -C apps/server typecheck` 0 错误；`pnpm -C apps/server test`
  **17 文件 / 407 通过 / 0 跳过**；`pnpm -C apps/server build` 通过。
- `pnpm -C apps/renderer typecheck` 0 错误；`pnpm -C apps/renderer test`
  **11 文件 / 102 通过**；`VITE_API_URL= pnpm -C apps/renderer build` 通过。
- 真服务验收脚本：`acceptance.e2e.mjs` 92 通过 / 0 失败，
  `workspace-acceptance.e2e.mjs` 32 通过 / 0 失败。

### 下一步

P5：单用户 Bearer 认证（`resolveApiToken` + `createApp({auth})` 启用）+
前端 token/AuthGate + ICS 导出改 fetch/Blob。P5 与 P6 必须同版本发布。


## 2026-11-03（P3：写入收敛到 mutateWorkspace，退役 md-bridge / kanban）

P3 收尾数据层的「写」并清掉旧架构。P2 已经把 `readWorkspace` 变严格、把写入口
收敛成 `mutateWorkspace`，但业务路由还在用旧的 `writeWorkspace`；同时
`/api/md-bridge/*`、`/api/kanban/*` 两套旧路由仍在挂载，读的是 2026-10-26
就废弃的 `events.md` / `工作搭子看板.md`。这一步把两者都结束掉。

- **5 个写路由改成单事务**（`apps/server/src/routes/workspace.ts`）：
  POST `/items`、PUT `/items/:id`、DELETE `/items/:id`、POST `/ics/import`、
  POST `/lists/rename`。每个都从「外面读一次 → 改数组 → 整体写回」变成一次
  `mutateWorkspace(ws => …)`：
  - id 重复检查搬进锁内。锁外检查在并发下一定失效（两个请求同时读到「不存在」）；
  - 级联删除的子任务计算也在锁内，返回的 `removedChildren` 是真实数字；
  - 404 / 409 / 400 改用 `WorkspaceHttpError`，不再在 handler 里 `res.status(...)`，
    由统一错误中间件输出（响应体保留 `errors` / `editableFields` / `hint`）。
- **删除 `writeWorkspace`**（`apps/server/src/workspace.ts`）：P2 保留它只是为了
  让 P3 能分批迁移。现在业务写只剩 `mutateWorkspace` / `mutateWorkspaceText`，
  测试夹具改为 `fs.writeFileSync(serializeWorkspace(...))` 或 `seedFile()` helper。
- **CalDAV 拉取落盘也进锁**（`apps/server/src/caldav-sync.ts`）：
  拉取循环在锁外（网络慢，不能占着锁），落盘时按 `fingerprintItems` 比对差异，
  只把真正变化的条目在 `mutateWorkspace` 里替换/新增 —— 不会把用户在拉取期间
  新写的条目覆盖掉。提交前 `assertWritable(epochAtStart)`，恢复数据期间拉取
  结果直接丢弃（`SyncEpochError`）。
- **sync 活动登记**：`syncWorkspaceToCalDAV()` 用 `beginSyncActivity("caldav")`
  包住，`finally` 结束。这样 P7 的恢复流程能 `waitForInFlightSync()` 等到真正
  的同步结束，而不是只看定时器有没有停。
- **统一错误中间件拆出**（`apps/server/src/http-errors.ts`）：`createApp` 用它，
  裸 `express()` 的测试也用它。之前测试里没有它，路由抛错会走 Express 默认 HTML
  错误页，前端 `JSON.parse` 直接炸成 `Unexpected token '<'`。
- **退役旧架构**（D19 / D29）：
  - 删除 `apps/server/src/routes/md-bridge.ts`（705 行）、`routes/kanban.ts`（701 行）、
    `apps/server/src/md-ics-bridge.ts`（712 行）；
  - `app.ts` 不再挂载 `/api/md-bridge`、`/api/kanban`（现在命中 `/api` 的 JSON 404）；
  - 删除 `apps/renderer/src/api/md-bridge.ts`、`api/kanban.ts`（生产代码已无引用）；
  - `config.ts` 的 `paths` 只剩 `workspaceFile`；`resolveDataPath()` 只接受
    `"workspace"`，去掉 `MD_EVENTS_FILE` / `KANBAN_FILE_PATH`；
  - `apps/renderer/src/api/webdav.ts`、`components/settings/ConfigSettings.tsx`
    的 `key` / `paths` 类型同步收窄；
  - 示例插件改用 `/api/workspace/items`。
- **测试**：删除 `e2e-bridge.test.ts`、`e2e-full.test.ts`、`kanban-id.test.ts`、
  `ics-file.test.ts`（锁的都是已删除的代码）；`acceptance.e2e.mjs` 重写为
  workspace 原生（85 → 92 项，含「旧接口已 404」断言），并把自然语言用例的
  期望日期从写死的 2026-10-26 改为按「今天」计算 —— 以前隔天跑就全红。
- **验证**：`pnpm -C apps/server typecheck` 0 错误；`pnpm -C apps/server test`
  **384 通过（16 文件，0 跳过）**；`pnpm -C apps/server build` 通过；
  `pnpm -C apps/renderer typecheck` 0；`pnpm -C apps/renderer test` 96 通过；
  `VITE_API_URL= pnpm -C apps/renderer build` 通过且产物无 `localhost:3001`；
  起真服务跑 `acceptance.e2e.mjs` 92/92、`workspace-acceptance.e2e.mjs` 32/32。

下一步 P4：备份只读接口与界面（列表 / 预览 / 导出）、500 页面引导、离线横幅。

## 2026-11-03（P2：数据核心——读取失败不静默、写入原子化、并发有序）

P2 只做一件事：把 `workspace.md` 这个**唯一事实源**读写路径上的容错做到位。
界面和路由行为尽量不动，但数据层从「尽力而为」变成「要么正确、要么明确报错」。

- **读取失败不再当空文件**（`apps/server/src/workspace.ts` `readWorkspace`）：
  以前用 `existsSync` + 兜底 `catch`，把 `EACCES` / `EISDIR`（Docker 挂错卷、NAS 权限）
  当成「文件不存在」，随后任何一次写入都会用空集合覆盖真实数据。现在只有 `ENOENT`
  才返回空；其它错误码抛 `WorkspaceReadError`。另外：有 `##` 块却一条都认不出来时
  直接抛错并提示从 `.workspace-backups` 恢复，绝不静默清空。
- **round-trip 保真**（SDS §2.5）：
  - frontmatter 原样保存（`frontmatterRaw`），`schema: workbench/v2` 不会被降级成 v1；
  - 未知字段（含中文键名 `- 另一个: 值`）收进 `extra`，序列化时按原行序写回；
  - 未知块用 `<!-- workbench:unknown:start/end -->` 包住原样保留，不再被 `<!-- notes -->` 吞掉；
  - 标题/描述里的引号、反斜杠、换行经 `escapeScalar` / `unescapeScalar` 往返；
  - 坏条目保留 `rawBlock` 原样写回，未修改就不会因为一次无关写入被丢掉；
  - 锁定「解析 → 序列化 → 再解析 → 再序列化」幂等。
- **`mutateWorkspace` / `mutateWorkspaceText`**（`apps/server/src/workspace-store.ts`）：
  所有写入走「加锁 → 读取 → 回调 → 序列化 → **回读校验** → 图校验 → 备份 → 原子写」。
  回读校验是关键：如果生成的文本自己都解析不出来，就不落盘（避免写坏事实源）。
- **锁**（`apps/server/src/workspace-lock.ts`）：进程内 FIFO 队列，默认 10s 超时；
  **排队超时的任务会被取消、绝不晚点执行**（否则客户端已收到 503，写入却仍然发生）。
  锁内再次调用 `mutateWorkspace` 抛 `LockReentryError`（要用 `mutateWorkspaceText`）。
  网络 IO 仍在锁外，锁只覆盖读-改-写。
- **图校验**（`validateWorkspaceGraph`）：默认只校验本次改动到的条目（`validate: "changed"`），
  历史脏数据不会让每次写入都 400；改到坏条目本身、或删父任务留下孤儿引用时才拒绝。
  规则：id 唯一、parent 存在、无自环/环、`end > start`、`remind` 格式。
- **原子写**（`apps/server/src/storage-check.ts`）：写临时文件 → `fsync` → `rename`；
  Windows/SMB 的 `EPERM`/`EBUSY` 有限重试（100/200/400/800/1600ms），失败就报错而不是降级直写。
  崩溃注入 `WORKSPACE_CRASH_AFTER_TMP=1` 可验证「旧文件完好、只剩一个可清理的 tmp」。
- **只读降级启动**（D28）：`index.ts` 启动时先做存储自检（真的写一次、rename、读回），
  失败则**不退出**，降级为只读：读接口 200、写接口 503 `WORKSPACE_READ_ONLY`，
  `/api/workspace/info` 返回 `storageSafe: false` / `readOnly: true`，
  并跳过 CalDAV 自动同步与提醒定时器（否则只会刷错误日志）。
  `ALLOW_UNSAFE_FS=1` 是显式逃生门（WARN 后继续可写）。
- **测试**：新增 `workspace-store.test.ts`（25）与 `storage-check.test.ts`（6）。
  服务器测试 378 → **409 通过 / 33 跳过（20 个文件）**；`tsc --noEmit` 与 `pnpm build` 均通过。
  覆盖：读取四态、round-trip 保真、50 并发不丢、同条目并发改两个字段、删除最后一条、
  排队超时不执行、锁重入、写坏文本拒绝落盘、只读/维护拒绝、历史脏数据不阻塞、
  孤儿/环/区间/提醒、崩溃注入与 tmp 清理。

> 兼容期保留：`writeWorkspace` 仍导出（标记 `@internal`），P3 会把所有调用方迁到
> `mutateWorkspace` 后删除它；旧的 `/api/md-bridge`、`/api/kanban` 也留到 P3 一并退役。

## 2026-11-02（P1：应用装配 + 错误契约 + CI 修复）

按 SDS v0.3 §9 完成 P1，**未改变任何业务行为**（路由内容、响应结构、数据格式都没动），
只是把「顺序」和「错误」两件最容易出错的事固定下来。

- **新增 `apps/server/src/app.ts`**：`createApp({ auth, staticDir, trustProxyHops,
  storageReadOnly, routers })`。中间件顺序显式写死为
  `cors → /health → 路径规范化 → /api 认证 → json → 只读闸门 → 维护闸门 → API 路由
  → API 404 → 静态 → SPA → 404 → 错误中间件`。
  - 认证必须在静态与 SPA 之前：此前 `/api/caldav`、`/api/notifications` 两个路由挂在
    静态兜底之后，未带 token 的 `/API/...` 会拿到 200 + `index.html`。
  - SPA 正则改为大小写不敏感 `/^\/(?!api(\/|$)|...)/i`，并在 `sendFile` 前二次校验
    解码后的路径。
  - 路径规范化拒绝 `/%61pi/...`、`/api%2F...`、`%5c`、`//api`（400 `BAD_PATH` /
    `ENCODED_API_PATH`），避免 Express 4 用原始 `req.url` 匹配 `/api`、而
    `express.static` 自行解码导致的鉴权绕过。
- **新增 `apps/server/src/errors.ts`**：`WorkspaceReadError` / `WorkspaceValidationError` /
  `WorkspaceHttpError` / `LockTimeoutError` / `LockReentryError` / `WorkspaceReadOnlyError` /
  `SyncEpochError` / `MergeInvalid` / `MergeConflict` / `MaintenanceError` / `ApiTokenError`。
  统一 4 参数错误中间件映射为 JSON（400/404/409/500/503），500 永不返回绝对路径。
- **新增 `apps/server/src/sync-control.ts`（骨架）**：`currentSyncEpoch` /
  `invalidateSyncEpoch` / `setSyncMaintenance` / `isSyncMaintenance` /
  `setStorageReadOnly` / `isStorageReadOnly` / `assertWritable` /
  `beginSyncActivity("caldav" | "webdav" | "restore")` / `waitForInFlightSync`。
  P1 只提供接口与状态，尚未接入 CalDAV/WebDAV/提醒调度器（P2/P7 接入）。
- **`index.ts` 只保留生命周期**：`createApp({ auth: false, staticDir })`（P5 换成
  `{ token }`，P1 阶段显式 `false`，没有「忘配置就裸奔」的默认值）、先 `listen` 再
  异步探测 CalDAV、`EADDRINUSE` 明确报错、`SIGINT/SIGTERM` 优雅关闭。
- **32 个 async 路由处理器统一包 `asyncHandler`**：Express 4 不会把 Promise rejection
  交给错误中间件，Node ≥15 会因未处理 rejection 直接杀进程，客户端表现为请求挂起。
  现有 try/catch 保留（业务错误仍走原有响应结构），`asyncHandler` 只兜住 catch 之外
  的异常（例如 `requireConfig` 抛错、`loadCalDAVSyncSettings` 读配置失败）。
- **测试**：新增 `apps/server/src/__tests__/app-create.test.ts`（18 个）：认证参数边界、
  `/API` 大小写、编码路径 400、`/api//`、未知 API 404 JSON、OPTIONS 204、`Origin: null`、
  非法 JSON 400、async rejection → JSON 500、静态 `api/` 不可匿名读取、SPA 回落、
  只读/维护闸门白名单。服务器测试 360 → 378 通过（33 跳过不变）。
- **CI（`.github/workflows/test.yml`）**：Node 20 → 22；`npm i -g pnpm` →
  固定 `pnpm@11.8.0`；`pnpm install` → `--frozen-lockfile`；`upload-artifact@v3` →
  v4（v3 已退役）；`actions/*@v3` → v4；构建前端时显式 `VITE_API_URL: ""`，
  防止 `apps/renderer/.env` 里的 `localhost:3001` 被打进产物。**typecheck 保留**。
- **类型检查清零**：`apps/server` 原有 168 个测试文件类型错误（`Response.json()`
  在 TS 5.3 + undici 类型下为 `unknown`、`zh-time.test.ts` 未处理 `null`、
  `config-plugins.test.ts` 引用不存在的 `../framework/plugins.js`）全部修掉，
  `pnpm -C apps/server typecheck` 现为 0 错误；没有放宽 `tsconfig`。
- **`apps/renderer` 补 `typecheck` 脚本**（`tsc --noEmit`），CI 才能实际执行前端类型检查。

验证：`pnpm -C apps/server test` 378 passed / 33 skipped；
`pnpm -C apps/server typecheck` 0；`pnpm -C apps/server build` 通过；
`pnpm -C apps/renderer test` 96 passed；`pnpm -C apps/renderer typecheck` 0。

## 2026-11-02（v0.3.0 SDS 复审与 v0.3 修订）

两轮独立复审（架构/安全/数据、实现/可测试性/运维）均为**有条件通过**，共 9 项阻断；
SDS 从 v0.2（816 行）修订到 v0.3（955 行），仍未写实现代码。

- **复审文件**：`docs/planning/reviews/v0.3.0-sds-rereview-architecture.md`、
  `v0.3.0-sds-rereview-implementation.md`。
- **架构 R1–R4**：恢复无出口（preview 被 maintenance 拦、pinned 过期无法 abort）；
  WebDAV 在飞未纳入恢复排空；`%61pi` 编码路径绕过 auth；WebDAV merge 先 PUT 后校验且丢元数据。
- **实现 1–5**：P5/P6、P7/P8 坏中间版本；恢复失败无出口；reminder tick 跨恢复竞态；
  P2→P3 构建断裂 + `sync-control` 无归属；`%61pi` 不 401。
- **v0.3 修订**：锁排队超时取消；空 workspace/删最后一条合法；`sync-control` 统一
  CalDAV/WebDAV/reminder activity + epoch；路径规范化 400；merge 先校验后 PUT 且保留
  frontmatter/unknown/extra/rawBlock；restore abort/启动清过期 marker；readOnly/maintenance
  覆盖所有写；P5+P6、P7+P8 同发布；测试 S1–S24 / F1–F10 与 P1–P9 重排。
- **决策**：新增 D30–D34；`v0.3-plan.md` A1 顺序改为 canonicalize → auth → static。
- **下一步**：文档收尾（plan/README/UPDATE_LOG/决策日志）后，在新会话按 P1–P9 实施。

## 2026-11-02（v0.3.0 SDS 两轮评审与修订）

v0.3.0 SDS 经两位独立评审，均判定「不通过」，共 10 项阻断。已重写为 v0.2（816 行），
未写实现代码。

- **评审文件**：`docs/planning/reviews/v0.3.0-sds-review-architecture.md`、
  `v0.3.0-sds-review-implementation.md`。
- **主要阻断**：认证/静态资源顺序可绕过；空 token 可通过；WebDAV 合并重复加锁；
  恢复期间普通写与同步回写可覆盖新数据；读失败被当空文件；Electron 包内没有 server；
  `/data` 只读与启动策略冲突；异步错误无统一契约；图校验把历史坏数据变成永久 400；
  恢复/冲突/备份 UI 的数据源缺失。
- **v0.2 关键修订**：`createApp` 认证先于静态与 SPA；token 64-hex 校验 + 原子 0600；
  `prepareMerge`/`commitMerge` 单事务；恢复维护模式覆盖所有写 API + epoch + in-flight 排空；
  `readFileSync` 仅 ENOENT 为空 + 全局 JSON 错误中间件；Electron 用 esbuild 打包 server +
  主进程 `webRequest` 注入 token；D28 只读启动；D29 下线全部 md-bridge/kanban 路由；
  同步中心无网络字段。
- **决策**：D16/D19 修订，新增 D28/D29；`v0.3-plan.md` 的 WebDAV 字段改为 `lastKnownEtag`。
- **下一步**：v0.2 复审通过后，按 P1–P9 在新会话实施。

## 2026-11-02（架构评估：ChronoMD 提案）

评估了「Markdown 唯一数据源 + Task/Event/Time Block + VTODO + AI + NAS」的提案：

- **采纳为方向**：Task/Event/Time Block 语义分离、VTODO 任务集合、AI Command Layer、
  可重建索引、Git 历史（可选）、PWA/自托管。
- **不做**：直接重写 Python/FastAPI；v0.3 切换「一任务一文件」；把 SQLite 当事实源；
  把 sync 元数据写进 MD。
- **理由**：多文件涉及跨文件事务、watcher、WebDAV 目录同步、迁移与全库一致性；
  Python 重写会丢掉 30k 行、456 个测试和已跑通的同步/推送。
- **决策**：D20–D27 写入 `docs/planning/reviews/decision-log.md`；评估见
  `docs/planning/CHRONOMD_PROPOSAL_REVIEW.md`。
- **v0.3 计划定稿**：仍用单 `workspace.md`，18.5–23.5 人日，先数据安全/认证；
  v0.4 做语义/VTODO/AI；v0.4.5 做数据层 spike 再决定多文件。
- 数据源文档补充「为什么不是一任务一文件 / 何时重估」（`REF/DATA_SOURCE.md`）。

## 2026-11-02（提醒 / 手机推送 / Docker 自托管）

### 需求

1. 本地提醒之外，要能接入主流推送（企业微信机器人、Server酱等），方便直接推到手机；
2. 支持 Docker：后端放 NAS / 服务器，其他平台只跑前端连过去；
3. 同时保留前后端打包在一起的本地版本。

### 提醒的数据模型

新增 `remind` 字段，存**绝对本地时间**。没有用「提前 N 分钟」是因为：
全天事件、只有截止日的任务没有明确开始时刻，存偏移量就得定义
「从 0 点算还是 9 点算」的隐藏规则，用户看到的和实际触发的容易对不上。
界面上的预设只是输入辅助，保存前换算成绝对时间。

### 两条提醒通道

- **应用内**：`ReminderHost` 挂在最外层，30 秒轮询 + 聚焦检查，右下角卡片，
  稍后 10 分钟，localStorage 去重。应用没开就不提醒。
- **服务端推送**：`notifications/scheduler.ts` 每 30 秒读 workspace.md，
  到点调用 `push.ts` 发企业微信 / Server酱 / PushPlus / Bark / ntfy / Webhook。
  Docker 下后端常驻 → 7×24。

去重状态放在 workspace 同目录 `.reminder-state.json`；失败 5 分钟后重试；
只要任一渠道成功就记为已推送（避免某渠道配错导致其他渠道重复收）。

### Docker

多阶段构建：build（装全量依赖 + 编译 server/renderer）→ deps（只装生产依赖）→
runtime（node:22-alpine + tzdata，非 root）。前端产物放在 `/app/public`，
server 通过 `STATIC_DIR` 同时托管 API 与页面。数据卷 `./data:/data`。

### 前端-only

新增 `api/base.ts`：`window.__API_BASE_URL__` > localStorage > `VITE_API_URL` > 同源。
设置页「通用 → 后端地址」可改，保存后刷新即可连接 NAS 后端。

### 验证

后端 360 / 前端 96 全绿；本地用 `STATIC_DIR=apps/renderer/dist` 验证了
首页、hash 路由兜底、静态资源与 `/api` 共存。

Docker 镜像已在本机构建并跑通（node:22-alpine，253MB）：

- 容器内首页、静态资源、`/api/workspace`、`/api/notifications/*` 都正常
- 数据卷写入成功（建了一条带 `remind` 的条目，宿主机 `data/workspace.md` 可见）
- 镜像里前端 bundle **没有**被打上 `localhost:3001`（`.dockerignore` 排除了
  `apps/renderer/.env`，构建时再显式 `VITE_API_URL=`）
- node 进程以 `app`（uid 100）运行

### 构建时踩到的三个坑

1. **corepack 下载 pnpm 会卡住**：改成 `npm install -g pnpm@11.8.0`，并显式
   `--registry=$NPM_REGISTRY`；容器 DNS 常先返回 IPv6，加
   `NODE_OPTIONS=--dns-result-order=ipv4first`。
2. **pnpm 依赖是软链**：生产依赖在 `apps/server/node_modules` 下指向
   `../../../node_modules/.pnpm`，只拷根 `node_modules` 会 `ERR_MODULE_NOT_FOUND`，
   两个目录都要拷。
3. **bind mount 属主**：`./data` 属宿主用户，容器内 app 是 uid 100 → 写不进去。
   加 `docker-entrypoint.sh`：root 启动 → `chown -R app:app /data` → `su-exec app` 降权。

## 2026-11-02（本地功能加固 + 冲突三选一）

### 定调：先把本地做好，联网只是尾巴

用户的判断是对的：WebDAV / CalDAV 只是同步 md 与 ICS，大头是本地功能；
而且本地优先意味着「服务器连不上也必须完整可用」。所以这一轮只做三件事：
修本地 bug、补本地缺的交互、把冲突处理统一成三选一。

### 修掉的 bug（都是会让人以为「数据丢了」的那种）

- **截止日当天算逾期**：`new Date("2026-11-02")` 按 UTC 解释，东八区 8 点后
  `due < now` 恒成立。统一收口到 `utils/date.ts` 的本地日比较。
- **「排期」按钮保存必失败**：写 `end == start`，服务端校验 `end > start` 直接拒。
  现在自动 +1 小时，并在看板上给出失败提示。
- **编辑任务丢 kind**：表单没回填 `kind`，保存时默认 `event` —— 任务从看板消失。
- **重复事件编辑挪动系列**：以前点某一次实例就用那天的日期当锚点保存。
  现在服务端在展开时带上 `seriesStart` / `seriesEnd`，编辑回填系列原点。
- **删除父任务留下孤儿**：子任务还在文件里，但看板不渲染、清单不统计，
  用户完全看不到。现在 DELETE 级联删除整棵子树，响应返回 `removedChildren`。

### 补的本地功能

- 任务点击编辑（标题 / 优先级 / 截止 / 时间 / 清单 / 项目 / 重复）
- 任务搜索、清单重命名（空 = 收件箱）
- 工作台今日日程按 RRULE 展开、回到窗口自动刷新、同步状态不再读废弃 store

### 冲突：三选一，且真的能合并

- **WebDAV**：新增 `/api/webdav/merge`，按 id 取并集；同一条目用 `updatedAt` 较新的一版；
  时间相同但内容不同 → 保留本地并报告。先推远端（If-Match）成功后再写本地，防止并发覆盖。
- **CalDAV**：状态文件新增 `fields` 字段快照作为合并基线，实现字段级三方合并；
  两边改同一字段时保留本地，并返回 `conflictFields`。

### 验证

后端 349 / 前端 84 全绿；`pnpm build`（server + renderer）通过。
新增回归：日期工具 7 项、编辑/逾期 2 项、CalDAV 合并 2 项、WebDAV 合并 6 项、级联删除 1 项。

## 2026-11-02（CalDAV 通道迁移到 workspace.md）

### 要解决的问题

README 与 `SYNC_MANAGEMENT.md` 里都记着同一个已知缺口：日历页的「推送 / 拉取 /
双向同步」走的是遗留的 `/api/md-bridge/sync/caldav`，读写的还是废弃的 `events.md`。
于是出现一个很别扭的状态：界面上看到的是 workspace.md 的数据，点同步推上去的却是另一份文件。

### 做了什么

1. 新写同步引擎 `caldav-sync.ts`，不再复用 md-bridge：
   - 逐对象 PUT，`If-Match` 走 ETag；412 就是冲突，不静默覆盖
   - PROPFIND 拿 ETag，未变化的对象不 GET（增量）
   - 状态文件 `.caldav-sync-state.json` 记录「上次同步时的字段指纹 + ETag」
2. 数据模型加 `uid`：远端 UID 必须落盘，否则回推会新建对象（手机日历重复）
3. 前端切到 `/api/caldav/sync`，同步结果显示冲突项和两个选择按钮
4. 设置页加「日历 URL / 读取日历列表 / 测试连接」
5. 自动同步改为服务端定时器（改配置不用重启）

### 迁移时发现的两个坑

- **`project` 写成 CATEGORIES 会污染 tags**：拉回来时 project 变成 tags 里的一项，
  字段指纹每次都不同 → 每次同步都白跑一轮 pull+push。改成 `X-WORKBENCH-PROJECT`。
- **`allDay: false` 与缺省值被当成不同**：远端解析出 false、本地是 undefined，
  指纹不一致，同样导致每轮同步都重复处理。指纹里统一归一化。

### 验证

模拟 CalDAV 服务端（Node http）跑了 21 项：UID 落盘、二次推送不重传、增量 GET、
远端修改合并、本地/远端都改的冲突、按 UID 范围 force、RECURRENCE-ID 跳过、
升级前老条目认领、日历发现回退、路由 502 文案。
真实 Radicale 未连接测试（服务器未开，等联网后跑 `scripts/verify-caldav-live.mjs`）。

## 2026-11-02（清单 / 子任务 / 文档全量校正）

### 「别人拿着老物料开发工具」

用户提出：开发说明和 reference 文档必须跟上代码，否则后续协作时别人照着旧文档
写代码，会写出跟现行架构相冲突的东西。

当时文档的实际状态：

| 文档 | 状态 |
| ---- | ---- |
| `REF/MD_ICS_BRIDGE.md` | 整篇描述 `events.md` 的 YAML frontmatter 格式 —— 那是 2026-10-26 就废弃的架构 |
| `docs/SYNC_MANAGEMENT.md` | 同步对象写成「`events.md` + `工作搭子看板.md` 两个文件」 |
| `docs/TESTING.md` | 停在「121 项通过（2026-10-19）」，且没有 workspace / recurrence / ics-convert 三个核心测试文件 |
| `README.md` | Features 里还写着 localStorage 缓存、底部状态栏、双向绑定、`KANBAN_FILE_PATH` |
| `REF/ARCHITECTURE.md` | 没有数据层章节，还提 `events.md` |
| `.env.example` | 完全没有 `WORKSPACE_FILE`，只有旧的两个文件路径 |

### 处理方式

1. **重写而不是打补丁**：`MD_ICS_BRIDGE.md`、`SYNC_MANAGEMENT.md`、`TESTING.md`
   三篇整体重写；其余做定点校正。
2. **加索引**：新增 `REF/README.md`，把材料分成「当前有效 / 设计稿 / 历史或第三方」，
   并在开头列出三条最容易搞错的点。
3. **数字要能复现**：测试数字全部来自实际执行，文档里写明命令。
4. **顺手修界面文案**：文档改了但界面还在说 `events.md`，等于把老物料发给了用户。
   工作台横幅、日历数据源标注、导入替换提示、WebDAV 面板、设置页数据文件区全部改正。

### 校正过程中抓到的真实 bug

**WebDAV 拉取后界面不刷新。** 前端判断「拉取成功就重读本地数据」用的是
`r.results.some(x => x.key === "events" && x.ok)`。WebDAV 通道切到单文件后，
后端返回的 key 是 `workspace`，这个条件**永远为 false** ——
拉取成功、数据已落盘、界面还是旧的。已改成同时接受 `workspace` / `events`。

`api/webdav.ts` 的类型也同步放宽，避免下次再被类型挡住真实返回值。

**设置页改不了数据文件路径。** 设置页只暴露了 `paths.eventsFile` 与
`paths.kanbanFile`（两个都已废弃），真正生效的 `paths.workspaceFile`
在界面上根本没有入口。已改为配置 `workspaceFile`，旧的两个标注为「仅迁移用」。

### 明确的已知缺口

**CalDAV 写入通道还没迁移到 workspace.md。** 日历页「推送 / 拉取 / 双向同步」
三个按钮仍然调用遗留的 `POST /api/md-bridge/sync/caldav`，它读写的是 `events.md`。
`events.md` 不存在时这三个按钮等于空转。

这不是配置问题，是重构留下的半截工程。修复需要：

1. `apps/server/src/caldav.ts` 补写能力（现在只有 `fetchCalendarObjectsDirect` 读）
2. 新增 `POST /api/workspace/caldav/sync`，用 `itemsToIcsMap()` 逐条 PUT
3. 前端三个按钮改为调新接口

在文档里已如实标注（`docs/SYNC_MANAGEMENT.md` 的 CalDAV 章节），
不写成「已支持」，避免下一个人被误导。

## 2026-10-26（架构重构）

### 用户质疑推动的架构调整

这一轮的所有改动都源于用户的三个质疑，每一个都击中了要害。

#### 质疑一：「为什么日历比任务看板任务更多？体检在看板里找不到？」

**根因不是数据问题，是架构问题。**

旧架构：`events.md`（事件）+ `工作搭子看板.md`（任务）两个文件，
靠双向绑定缝合。我造演示数据时两边分开造，于是「体检」只在 events.md 里。

但更深的问题是：**这种差异用户根本无法解释**。
于是用户说：「这两个不应该是同一个数据源吗，为什么会有差异？」

**改造方案**：单文件条目池（`workspace.md`），事件与任务是同一种记录，
`kind` 只是标签。任务有 `start` 就同时出现在两个视图。

#### 质疑二：「为什么要搞同步？维护一个统一数据源，各模块解析编辑不更好吗？」

用户直接指出了我架构上的根本问题。原话：

> 我们就维护一个统一的数据源，然后各模块通过对这个数据源进行解析和编辑，
> 形成任务/日历等等一系列的，不是更好吗，你搞多个东西，还要搞模块转换？
> 唯一要转换的只有，数据源md文件和ics的转换

**这个批评完全正确。** 我之前的 `agenda.ts` 聚合视图，
某种意义上是在给错误的架构打补丁。该做的是换掉架构本身。

#### 质疑三：「md 文件不是很方便吗？为什么有这个想法，是因为格式可能被AI乱改吗？」

用户自己推导出关键洞察，然后问「那有没有什么更好的推荐，
比如说，既能被AI直接编辑，也能够限制格式的」。

**我的回答**：问题不在于「怎么防止 AI 瞎改」，而在于
**当 AI 瞎改了之后，损失有多大**。

旧架构下 AI 改坏一个 YAML 缩进 → 解析器整体抛错 → 所有数据丢失。
新架构下：

1. **条目是独立的 Markdown 块** —— 改一条只影响那一段
2. **容错解析** —— 一条坏记录被标记 invalid 跳过，其余照常工作
3. **schema 校验** —— 写入前拦截非法值
4. **写入前备份** —— 最坏情况可回滚

核心原则：**让「改坏」这件事变得无关紧要。**

而且工具 schema 是硬约束：AI 走 `POST /api/workspace/items` 时，
字段由 JSON Schema + 服务端白名单双重把关，**它想写错都写不错**。

### 实测抓到的 bug

开发周期规则时，测试抓到两个真实的日期计算错误：

1. **「每周一三五」只出现周一** —— WEEKLY 的推进步长是 +7 天，
   永远只检查到每周第一天，同周内的周三周五被整个跳过。
   修正为逐日推进（+1 天），用 `weekDiff % interval` 判断是哪一周。
2. **「每月31号」短月溢出** —— `setMonth(+1)` 从 1/31 会溢出成 3/3，
   2 月被跳过且月份错位。修正为先置 1 号再推进月份。

另外 API 测试抓到两个防护漏洞：

3. **非法 kind 被静默降级成 task** —— 我写的是
   `kind === "event" ? "event" : "task"`，非法值直接变合法，
   校验形同虚设。改为原样传递让校验拦下。
4. **未知字段被静默丢弃** —— AI 写的乱字段被吞掉，
   看起来「保存成功了」但意图丢了。改为先检查再构造。

### 验证

- 后端离线测试 **255 项**全部通过（新增 workspace 35 + workspace-api 33 + recurrence 30）
- 前端测试 **75 项**全部通过（新增 workspace-ui 6）
- **端到端验收 32 项**全部通过（真实启动服务，核心命题：
  同一个 id 在日历与看板视图里都出现）
- 前后端类型检查、vite build 通过
- 迁移脚本用真实旧数据验证：4 事件 + 3 任务 → 合并成 5 条（2 对绑定合并成 1）

### 遗留

- 旧的 `/api/md-bridge/*` 与 `/api/kanban/*` 路由仍在（兼容期），
  内部实现尚未全部切到 workspace.md
- ICS 导入导出仍走旧路径，需要适配新条目池
- WebDAV 同步的目标文件仍是旧的 events.md，需要改为 workspace.md
- 工作台（Dashboard）仍读旧的 md-bridge 接口

## 2026-10-26（下午）

### 全功能验收 + 修掉 CalDAV 挂掉时页面报错

用户问「radicale 是关了的，但我其他功能都是正常的了吗」——
这是个该早问的问题。于是做了一次**全功能验收**：
写脚本把 11 类功能的 API 全部真实打一遍（73 项断言）。

**结果：67 通过 / 2 失败**，其中一个是真 bug。

#### 真 bug：CalDAV 不可用时返回 500

```
GET /api/calendar/calendars → 500 {"error":"cannot find principalUrl"}
```

用户此刻的状态正是「radicale 关着」—— 也就是说他打开日历页会直接看到报错。
而本工具的设计前提是 **md 是本地唯一事实源，服务器挂了不该影响本地使用**。

修复：
- 读接口（`GET /calendars`、`GET /events`）遇连接类错误 → 返回
  200 + `degraded: true` + 空数组 + 可读提示
- 前端 `fetchCalendars` 识别降级响应并广播状态，日历页显示黄色横幅：
  「CalDAV 同步暂不可用 —— 本地 events.md 与任务看板照常可用」
- **写接口保持 500** —— 让用户以为写成功了更危险

连接类错误的识别：`principalUrl|cannot find|fetch failed|ECONNREFUSED|
ENOTFOUND|ETIMEDOUT|network|502|503|504|getaddrinfo`

#### 另一个失败是我的测试写错了

「下周三下午2点」期望 2026-10-28，但 2026-10-26 是**周日**，
下周三确实应该是 11-04。解析器是对的，测试的期望值错了。

#### 验收覆盖的功能（全部通过）

1. 服务启动与基础可用
2. 自然语言解析（7 种时间表达 + 标题提取 + 全天 + 重复 + 422 降级）
3. 快速创建：解析 → 落盘 → 读回
4. 任务 ↔ 事件 双向绑定（**含优先级与项目正确性**）
5. 看板任务增删改（**含 id 不漂移**）
6. 级联删除
7. iCalendar 导入导出（**含 TZID 不再是 UTC**）
8. 事件编辑（**含 kanbanTaskId 不被覆盖**）
9. 模块插件机制
10. 配置系统（**含脱敏与真值不被覆盖**）
11. WebDAV / AI 未配置时的优雅降级（**含 AI 缺 key 时不声称可用**）

#### 测试

- 新增 `acceptance.e2e.mjs` 73 项（需真实启动服务）
- 新增 `caldav-degraded.test.ts` 5 项（含静态检查：
  确保只有 GET 路由降级，写操作不降级）
- 离线测试 **157 项** + i18n 6 项全部通过

## 2026-10-26（补充）

### 配置全量接入 + 持久化验证

上一轮把 config.json 配置层建起来了，但 **CalDAV 还在读 env**，
数据文件路径也没接进去 —— 用户在界面改了地址不生效。
本轮补齐，并用**真实配置**做了完整验证。

**CalDAV 接入配置层**

```ts
// 之前：硬编码 env 优先，界面改的永远不生效
export let caldavRootUrl = process.env.CALDAV_ROOT_URL || ...
// 现在：config.json > env
```

同时把 `caldavRootUrl` 从**常量改成函数** `getCalDAVRootUrl()` —— 
常量是加载时的快照，界面改完仍要用旧值。DAVClient 也加了配置指纹检测，
地址或凭据变了自动重建客户端并清掉登录态。

**数据文件路径接入**

新增 `paths` 配置段（events.md / 看板文件路径）。
这里**环境变量优先于 config.json**（与其他配置相反）——
路径是部署级配置，容器部署时通常用环境变量指定挂载位置。

**实测发现并修复的 2 个"改了不生效"**

| 问题 | 根因 |
| ---- | ---- |
| WebDAV 远端目录改了没用 | `loadWebDAVConfig()` 里把 remoteDir **写死成常量**，没读配置层 |
| WebDAV 同步用的本地路径不对 | `syncTargets()` 里还在读 `process.env`，没走统一解析 |

**实测方式（这次是完整配置）**

用项目真实的 `.env`（含真实 CalDAV 服务器与凭据）启动服务，
完整跑一遍：改配置 → 读回 → **重启服务** → 再读回。

验证结果：

- 界面改的 AI endpoint / 模型 / 密钥 → 落盘 → **重启后完好**
- 界面改的 WebDAV url / 远端目录 → 重启后完好
- 界面改的数据文件路径 → 立即生效（读到 `changed-events.md`）
- CalDAV 仍从 `.env` 读（config.json 没写该段时）
- 密钥在 API 响应里始终脱敏，磁盘上真值完好
- **改完不需要重启**（config 层有 1 秒缓存 TTL）

**顺带发现：你的 CalDAV 服务器当前返回 502**

```
curl -u root:*** -X PROPFIND https://radical.00771100.xyz/
→ HTTP 502 | 连接 0.27s
```

网络是通的（0.27s 建连），但网关返回 502 —— **服务端自身故障**，
不是代码问题。Radicale 那边可能挂了或反代有问题，需要你那边确认。

**测试**

新增 6 项「配置层与各模块联动」用例，专门防"界面改了不生效"这类回归：
WebDAV 读配置层的 url / remoteDir、AI 读配置层的 model、
CalDAV 的 rootUrl 不被 env 覆盖、数据路径 env 优先于 config.json、路径为绝对路径。

离线测试现为 **152 项全部通过**（+ i18n 6 项）。


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
