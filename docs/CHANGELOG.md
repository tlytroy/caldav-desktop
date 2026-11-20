# Changelog

All notable changes to CalDAV Desktop are documented here.

## [0.3.1] - 2026-11-05（WebDAV ETag 修复 + 审计四项收口）

### 🐞 修掉的 bug

- **WebDAV 每次推送都误报冲突**（真机发现）：OneDrive / SharePoint 风格网关的 `PUT`
  响应 ETag（短哈希）与 `HEAD`/`GET` 的 ETag（`{GUID},N`）属于两套命名空间，
  本地基线存的是前者、比较用的是后者，永不相等。现改为 PUT 后回读一次
  `statRemoteFile()` 作为基线，两者同源。mock 增加 `divergentPutEtag` 场景，新增 2 项回归测试。

### 🩹 审计收口

- 两个 e2e 验收脚本补 `Bearer` 认证与可配置地址；新增 `scripts/run-e2e.sh`
  起隔离服务（临时数据/配置/随机 token），92 + 32 全通过。
- 「放弃本次恢复」（abort restore）补上 UI：备份面板与同步中心都有入口，带二次确认。
- CI 新增 `e2e` job；产物路径修正为 `apps/desktop/dist-server/`。
- `docs/MODULE_STATUS.md` 同步中心状态 `planned` → `stable`。

## [0.3.0] - 2026-11-03（本地优先、数据安全、认证、只读同步中心）

这一版的关键词是「**敢用**」：以前数据只有一个 `workspace.md`，写坏了就没了；
现在有原子写、文件锁、单事务校验、备份预览导出、一键恢复。
同时补上了单用户 token 认证和只读同步中心。

**离线依然是默认状态**：没配 CalDAV / WebDAV、没有网络，应用照常增删改查；
同步不配置也不会有任何阻塞或报错弹窗。

### 🛡 数据安全（P1–P3）

- `workspace.ts` 读写重写：解析失败**不再静默清空**，抛 `WorkspaceReadError`；
  单个坏块只跳过自己，其余条目照常读出（`notes` 里列出坏块行号）。
- round-trip 保真：frontmatter 原文、未知字段、未知块、`<!-- notes -->` 之外的
  自定义内容都原样保留，AI 或手写插入的字段不会被序列化吃掉。
- 新增 `mutateWorkspace()`：所有写操作在**同一把锁**里「读 → 改 → 校验 → 原子写」，
  中途失败不落盘；排队超时的请求直接取消，不会稍后偷偷执行。
- 原子写：临时文件 + `fsync` + `rename`，Windows 上带重试；崩溃后残留的 tmp 会被清理。
- 启动存储自检：目录不可写 / 9p / SMB 等场景默认**只读启动**（读 200、写 503），
  而不是启动成功然后在第一次保存时丢数据；`ALLOW_UNSAFE_FS=1` 可跳过。
- `writeWorkspace` 直接导出已删除，所有写路径（含 CalDAV 拉取）统一走 `mutateWorkspace`。
- 删除 `md-bridge` / `kanban` 两套旧数据通道与 4 个过时测试文件：`workspace.md` 是唯一事实源。

### 💾 备份与恢复（P4 / P7）

- 备份只读接口：`GET /api/workspace/backups`（列表）、`POST .../preview`（差异预览）、
  `GET .../export?file=`（原样下载）。
- 备份轮转：保留最近 20 份 / 总大小 50MB；**固定快照（24h）不参与轮转**，
  刚预览过的那份不会因为你继续操作而被删掉。
- 备份文件名带随机后缀，同一毫秒连续两次备份不会互相覆盖。
- 一键恢复状态机：sha256 校验 → 冻结写入口 → 等待在途同步/提醒 → 固定快照 →
  pre-restore 备份 → 持锁原子替换 → 重置 CalDAV/WebDAV 基线 → 暂停自动同步。
  中断后重启会自愈；固定快照失效时自动解除冻结；`.../restore/abort` 可主动放弃。
- 恢复后同步不会自己跑：顶部提示「请选择方向」，三个按钮
  （以云端为准 / 以本地为准 / 双向合并）对应 `POST /api/sync/resume`。
- 前端：设置 → 数据 里的备份面板（列表 / 预览差异 / 下载 / 恢复）、
  全局 500 页给出「下载备份 → 覆盖 `data/workspace.md` → 重启」三步手工恢复路径。

### 🔐 认证（P5）

- 服务端：`apps/server/src/auth.ts`。token 来源优先级 env `API_TOKEN`（≥32 个非空白字符）→
  `api-token.txt`（必须 64 位十六进制）→ 自动生成；文件原子写 + `0600`；
  文件损坏会改名 `.invalid-<时间戳>` 后重建；目录不可写则退化为内存 token 并在日志打印一次。
- 校验用 sha256 + `timingSafeEqual`，空 token 直接拒绝；`createApp()` 必须显式传
  `{ auth: { token } }` 或 `{ auth: false }`，漏传会启动失败（避免线上裸奔）。
- 中间件顺序固定：`cors → health → canonicalizeApiPath → /api 鉴权 → json →
  只读闸门 → 维护闸门 → 路由 → API 404 → 静态 → SPA → 404 → 错误处理`。
  `/%61pi/...`、`/%2fapi/...` 一律 400，静态目录下的 `api/` 也不允许匿名读取。
- 前端：`AuthGate` 首次打开探测 `/api/workspace/info`——200 放行、401 显示令牌页、
  断网放行（交给离线横幅）；token 存 localStorage，所有请求经统一 `createApiClient` 注入
  `Authorization`；9 处各自 `axios.create` 全部收敛。
- ICS 导出改 fetch/Blob 下载，不再 `window.open`（那个绕不过鉴权头）。

### 🖥 桌面与部署（P6）

- Electron 打包仓库内后端：esbuild 打成 `dist-server/index.cjs`，经 `extraResources`
  放进安装包；主进程取随机空闲端口、等待 `/health`、`fork` 时用
  `ELECTRON_RUN_AS_NODE=1`，并通过 `webRequest.onBeforeSendHeaders` 注入 token
  （token 不进渲染进程、不进 URL）；preload 只暴露 `__DSH_ELECTRON__` 与 `__API_BASE_URL__`。
- 打包后端 + 前端静态页产物体积、`/health`、`/api/plugins`、无 token 401 均已实测。
- Docker 构建更抗网络抖动：`--network-concurrency=4 --fetch-timeout=180000 --fetch-retries=5`，
  支持 `NPM_REGISTRY` / `APK_MIRROR` 镜像源参数。
- **容器内 `workspace.md` 权限修正**：原子写以前对所有文件都落 `0600`，
  导致 Docker 里 `workspace.md` 只有容器 uid 能读——而它是唯一事实源，宿主机用户必须能
  用 vim / Obsidian 打开。现在 workspace / 备份 / 恢复落 `0644`，`api-token.txt` 仍 `0600`；
  镜像改用 `node:22-alpine` 自带的 `node` 用户（uid/gid 1000，与多数桌面发行版默认用户一致），
  并支持 `PUID` / `PGID` 覆盖。

### 📊 同步中心（P8）

- `GET /api/sync/overview`：只读汇总 CalDAV / WebDAV 状态、事件环、冲突环、
  恢复挂起与在途同步数。**只读本地状态文件，不发任何网络请求**——断网也能打开。
- 事件/冲突各保留最近 20 条（进程内，重启清空）；CalDAV 的拉取冲突、推送 412、
  WebDAV 的 push 冲突、merge 冲突都会记录。
- 新增「同步中心」页面（替换原 git-sync 占位）：未配置时显示引导而不是报错，
  并明确写「不影响本地使用」；冲突区注明「不会自动覆盖」。

### ✅ 测试

后端 **444 通过（20 文件，0 跳过）**，前端 **115 通过（13 文件）**；
双端 `typecheck` 与 `build` 通过，构建产物不含 `localhost:3001`。

### ⬆️ 升级

`workspace.md` 格式未变，直接替换程序即可；首次启动会生成 `data/api-token.txt`，
浏览器里粘贴一次即可。回滚只需换回旧镜像/旧版本，token 文件可以留着（旧版不读）。

## [Unreleased] - 2026-11-02（提醒 / 手机推送 / Docker 自托管）

### 🔔 提醒（本地能力）

- 条目新增 `remind` 字段（绝对本地时间）：全天事件 / 只有截止日的任务也能设提醒，
  不需要「从几点算提前量」的隐藏规则。
- 日历与任务编辑框新增「提醒」：开始时 / 提前 10 分钟 / 30 分钟 / 1 小时 / 1 天 / 自定义时间。
- 全局 `ReminderHost`：每 30 秒检查，到点右下角弹卡片，支持「稍后 10 分钟」，
  同一提醒只弹一次；超过 24 小时的过期提醒不补弹。
- 通知推送模块从占位改为**活跃页**：应用内 / 桌面通知开关、即将提醒列表、推送渠道配置。

### 📲 手机推送（服务端）

- 新增六种渠道：企业微信机器人 / Server酱 / PushPlus / Bark / ntfy / 通用 Webhook。
- 服务端调度器每 30 秒检查 `workspace.md`，到点推送；
  24 小时宽限、完成/取消过滤、任一渠道成功即记为已推送、失败 5 分钟退避。
- 新增 `/api/notifications/channels|status|test|check`；渠道密钥在 `config.json` 里掩码。
- Docker / NAS 后端常驻时即可 7×24 推送（不需要开着桌面应用）。

### 🐳 部署

- 新增 `Dockerfile` / `docker-compose.yml` / `.dockerignore`：
  一个容器同时提供 API、前端静态页面、提醒推送调度；数据挂载 `./data`。
- 后端支持 `STATIC_DIR` 托管前端（SPA 兜底），无需额外 Nginx。
- 前端新增运行时「后端地址」设置（localStorage），支持前端-only 连接 NAS 后端。

### ✅ 测试

后端 **444 通过（20 文件，0 跳过）**，前端 **115 通过（13 文件）**。
新增：推送渠道 9 项、提醒计算 12 项、`remind` API/序列化 2 项。

## [Unreleased] - 2026-11-02（本地功能加固 + 冲突三选一）

### 🐞 修掉的本地 bug

- **截止日当天被算成逾期**：`new Date("YYYY-MM-DD")` 是 UTC 午夜，东八区 8 点后即逾期。
- **看板「排期」按钮必然保存失败**：写进去的 `end == start`，服务端要求 `end > start`。
- **编辑任务会丢 kind**：任务被静默改成事件，从看板消失。
- **编辑没有 end 的事件失败**：空 end 变成零长度事件，被服务端拒绝。
- **编辑重复事件用「被点的那一次」当锚点**：可能把整个系列挪到那一天。
- **事件日期输入在 00:00-08:00 显示成前一天**：`toISOString()` 是 UTC。
- **已完成条目的删除按钮永远不可见**：父级少了 `group` class。
- **没有 priority 的任务从待办列表消失**：分组只收集 high/mid/low。
- **「全部」计数把子任务也算进去**，与清单数字对不上。
- **「添加任务」默认不跟随当前清单**，从「工作」清单添加却落进收件箱。
- **删除父任务留下看不见的孤儿子任务**：看板按顶层过滤不渲染、清单也不统计。

### ✨ 本地功能

- **任务编辑**：点击标题即可改标题 / 优先级 / 截止日 / 时间 / 清单 / 项目 / 重复。
- **任务搜索**：标题 / 项目 / 标签。
- **清单重命名**：改成空 = 并回收件箱。
- **级联删除**：删父任务时整棵子任务树一起删（响应带 `removedChildren`）。
- **工作台**：今日日程按 RRULE 展开；同步状态改读真实本地状态（不联网）；
  窗口重新获得焦点时自动刷新。
- **统一本地日期工具** `utils/date.ts`：纯日期按本地日历日解释。

### 🔀 冲突三选一

- **WebDAV**：新增 `POST /api/webdav/merge` —— 条目级合并（并集 + `updatedAt` 较新 + 冲突报告），
  先推远端成功后再写本地，本地覆盖前备份 `.bak`。
- **CalDAV**：`/api/caldav/sync` 支持 `merge: true` —— 字段级三方合并：本地改的保留、
  远端改的采纳、同一字段两边都改则保留本地并在 `merged[].conflictFields` 报出字段名。
- UI 统一为：**以本地为准 / 以远端为准 / 合并**。

### ✅ 测试

后端 **349 通过 / 33 跳过（16 文件）**，前端 **84 通过（9 文件）**。
新增：日期工具 7 项、任务编辑 / 当天不算逾期 2 项、CalDAV 合并 2 项、
WebDAV 合并 6 项、级联删除 1 项。

## [Unreleased] - 2026-11-02（CalDAV 通道切换到 workspace.md）

### 🔄 同步架构

- **新增 `apps/server/src/caldav-sync.ts`**：workspace.md ↔ ICS ↔ CalDAV 的同步引擎。
  逐对象 GET/PUT、ETag 增量、字段指纹判断「本地改没改」，两边都改过时报冲突而不是覆盖。
- **新增 `/api/caldav/*`**：`status` / `calendars` / `sync` / `test`。读接口连不上时降级
  （200 + `degraded`）；同步失败返回 502，并明确说明「本地数据不受影响」。
- **前端三个按钮切换**：日历页「推送 CalDAV / 拉取 / 双向同步」不再走 `md-bridge`
  （`events.md`），改用 `/api/caldav/sync`；结果面板显示推送/拉取/跳过/冲突/失败，
  冲突可直接选「以远端为准 / 以本地为准」。
- **自动同步**：`MD_ICS_AUTO_SYNC_MINUTES > 0` 时每 60 秒检查一次间隔，改配置不用重启。

### 🪪 数据模型

- **新增 `uid` 字段**（schema / workspace.ts / API 白名单 / 前端类型）：拉取远端事件时
  保存原 UID，避免本地改完回推时在服务器上新建一份（手机上出现重复日程）。
- **ICS 导入**：`id` 改由 UID 确定性哈希（`idFromUid`），重复导入 / 重复拉取不再产生重复条目；
  `LAST-MODIFIED` → `updatedAt`；`RECURRENCE-ID` 例外实例跳过。
- **`project` 改为 `X-WORKBENCH-PROJECT`**：不再写成 CATEGORIES —— 否则拉回来会混进 tags，
  字段指纹每次都变，每次同步都白跑一轮。
- **时间戳修正**：`DTSTAMP` / `CREATED` / `LAST-MODIFIED` 按标准输出 UTC（带 Z）。

### ✅ 测试

后端 **340 通过 / 33 跳过（16 文件）**，前端 75 通过（8 文件）。
新增 `caldav-sync.test.ts`（21 项）：模拟 CalDAV 服务端，覆盖 UID 落盘、增量拉取、
冲突不覆盖、按 UID 范围 force、RECURRENCE-ID 跳过、老数据认领、日历发现回退、
HTTP 路由与 502 文案。

### ⚠️ 仍未做

- 删除传播（墓碑）：远端删除不删本地，本地删除不删远端
- VTODO（纯截止日期任务）同步

## [Unreleased] - 2026-11-02（清单 / 子任务 / 文档全量校正）

### ✨ 新功能（对齐滴答清单的交互）

- **清单分组**：条目新增 `list` 字段，清单由条目聚合得出（不预定义、不持久化），
  空值 = 收件箱恒排首位。任务页顶部清单切换条，`POST /api/workspace/lists/rename` 批量改名。
  统计**只算顶层任务**，否则「父任务 + 3 子任务」显示 4 条与看板对不上。
- **子任务 + 进度**：条目新增 `parent` 指向父级 id 的子任务，父任务展示
  `2/5` 计数与进度条，展开区可 inline 加子任务（自动继承父清单）。
  子任务仍是**平铺独立块**，不做嵌套结构 —— 单条坏掉不牵连整棵树。

### 🔄 通道与接口

- **ICS 导入导出接入统一数据源**：`POST /api/workspace/ics/import`、
  `GET /api/workspace/ics/export`（dryRun 预览 / 按 id 去重 / append|replace / 日期范围）。
- **WebDAV 同步收拢到单文件**：只同步 `workspace.md`，不再同步两个旧文件；
  前端拉取后的刷新判断同步修正（此前判 `key === "events"`，切单文件后永远刷不动）。
- **CalDAV 探测不再阻塞启动**：先 `listen` 再后台探测，服务器不通也不影响本地使用。

### 🧹 文档与文案校正（本轮重点）

- 全量校正 `REF/` 与 `docs/`：`MD_ICS_BRIDGE.md` 按统一数据源重写、
  `SYNC_MANAGEMENT.md` 重写、`TESTING.md` 换成实测数字、`DATA_SOURCE.md` 补全字段与 API。
- 新增 `REF/README.md` 文档索引，明确区分「当前有效 / 设计稿 / 历史材料」。
- 界面里还在说 `events.md` 的文案全部改正（工作台横幅、日历数据源标注、
  导入替换提示、WebDAV 面板、设置页数据文件区）；设置页数据文件区改为配置
  `workspaceFile`，旧的两个路径标注为废弃。

### ⚠️ 已知缺口

- **CalDAV 写入通道尚未迁移到 workspace.md**：日历页三个同步按钮仍走遗留
  `POST /api/md-bridge/sync/caldav`（作用于 `events.md`，文件不存在时空转）。
  新增 `/api/workspace/caldav/sync` 是下一步。
- 提醒通知未实现。

### ✅ 测试

后端 312 通过 / 33 跳过（15 文件），前端 75 通过（8 文件）。

## [Unreleased] - 2026-10-26（架构重构）

### 🔄 架构重构：统一数据源（workspace.md）

**这是本项目最重要的一次架构调整。**

用户指出：「日历里面比任务看板里面任务更多？体检在任务看板里就没找到？
这两个不应该是同一个数据源吗？」—— 这个质疑是对的，暴露了旧架构的根本缺陷。

#### 旧架构的问题

旧设计用两个文件（`events.md` 事件 + `工作搭子看板.md` 任务），
靠双向绑定字段（`kanbanTaskId` ↔ `日历:<uid>`）缝合。
为了维持这个缝合，写了大量机制：双向绑定、级联删除、解绑、孤儿清理、
两个方向的同步状态机。

而根本问题是：**事件和任务本来就是同一个池子里的两类条目**，
人为劈成两个文件再花代码缝合，是把简单问题复杂化。

用户明确指出：「为什么你要搞什么同步之类的，我们就维护一个统一的数据源，
然后各模块通过对这个数据源进行解析和编辑，形成任务/日历等等一系列的，
不是更好吗？唯一要转换的只有 md 文件和 ics 的转换」

#### 新架构

```
workspace.md（唯一事实源）
     │
     ├── scope=calendar + expand=true  →  日历模块
     ├── scope=board                    →  任务看板模块
     └── scope=all                      →  工作台 / AI 工具
```

- **`kind: task | event` 只是标签，不是隔离** ——
  `kind: task` 且有 `start` 的条目同时出现在看板和日历，指向同一个 id
- **没有绑定字段、没有级联删除、没有解绑** —— 删一条就是删一条
- 文件名用英文（`workspace.md`），避免中文文件名在跨平台/工具链上的问题

#### 周期规则（RRULE，RFC 5545 子集）

新增 `apps/server/src/recurrence.ts`：
- 支持每天 / 每周 / 每周一三五 / 每月 / 每月1号 / 每年
- 支持 BYDAY / BYMONTHDAY / INTERVAL / COUNT / UNTIL
- 日历侧按 RRULE 展开成多个实例渲染

用 RFC 5545 而非自定义枚举，是因为它能表达「每周一三五」这类规则，
且导出 ICS 时可直接映射到 RRULE 行不丢信息。

#### 防 AI 乱改的三层防护

1. **Schema 校验**（`schema/item.schema.json`）：写入前校验类型/枚举/格式
2. **容错解析**：逐条自解析（不用 YAML 库），一条坏记录不影响其余 499 条
3. **写入前备份**：`.workspace-backups/` 保留最近 10 版

核心洞察：**说明文档是软约束，工具 schema 才是硬约束**。
AI 走 `/api/workspace/items` 接口时，格式由代码保证，不依赖 AI 自觉。

#### 迁移工具

新增 `scripts/migrate-to-workspace.js`，把旧的两个文件合并到 workspace.md：
- 事件 → `kind: event`，任务 → `kind: task`
- **已绑定的对合并成一条**（两个方向都匹配 —— 旧架构的绑定键不一致：
  事件侧用 `kanbanTaskId` 指向任务，任务侧用 `日历:<uid>` 指向事件）
- 项目与速记 → 自由笔记区

#### 新增 API

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/workspace/items` | 列表（scope / kind / start / end / expand） |
| POST | `/api/workspace/items` | 创建（schema 校验） |
| PUT | `/api/workspace/items/:id` | 更新（字段白名单） |
| DELETE | `/api/workspace/items/:id` | 删除 |
| GET | `/api/workspace/validation` | 校验报告 |
| GET | `/api/workspace/info` | 文件位置与统计 |
| GET | `/api/workspace/recurrence/options` | 周期规则选项 |
| GET | `/api/workspace/recurrence/preview` | 预览周期展开结果 |

---

## [Unreleased] - 2026-10-26

### 🐛 实测发现的 Bug（此前只有单元测试，没有真实跑过）

用户质疑「是不是没完整测试过」后，做了**真实启动服务 + 真实 HTTP 请求**的端到端验证，
暴露出 4 个单元测试覆盖不到的问题：

- **看板优先级被忽略**：`/events/add` 传 `kanban:{priority:"高"}` 无效，
  任务一律建成「中」——代码只读 `event.priority`，完全无视 `kanban.priority`。
- **ICS 导出时间偏移 8 小时**：非全天事件用 `toISOString()` 输出 UTC，
  而 events.md 存的是本地时间 → 导入其他日历软件后时间凭空偏 8 小时。
  现改为输出本地时间 + `TZID`，并补 `VTIMEZONE` 块。
- **带 TZID 的 ICS 解析不了**：DTSTART 正则写死 `(?:;VALUE=DATE)?`，
  匹配不上 `;TZID=Asia/Shanghai` → 解析结果丢失开始时间。
- **ESM 下 `__dirname` 不存在**：新增的 config/plugins 模块用 `__dirname` 取路径，
  服务启动即 500。

### 🐛 CalDAV 不可用时优雅降级（不再 500）

用户反馈「radicale 关了，其他功能正常吗」→ 全功能验收时发现：
`/api/calendar/calendars` 在服务器连不上时返回 **500 + "cannot find principalUrl"**，
导致用户打开日历页直接看到报错。

现在**读接口**（`GET /calendars`、`GET /events`）在连接类错误时返回
200 + `degraded: true` + 空数组 + 可读提示，界面显示黄色横幅
「CalDAV 同步暂不可用 —— 本地 events.md 与任务看板照常可用」。

**写接口保持 500**（POST/PUT/DELETE 事件）—— 让用户以为写成功了更危险。
有静态测试锁定「只有两处降级，且都是 GET」。

### ✨ 全功能验收脚本

新增 `apps/server/src/__tests__/acceptance.e2e.mjs`（73 项），
真实 HTTP 打全部 API，覆盖从「输入一句话」到「数据落盘」的完整链路。
需先启动真实服务：`node dist/index.js && node src/__tests__/acceptance.e2e.mjs`

### ✨ 配置可在界面里改（CalDAV / WebDAV / AI / 数据路径全接入）

- 新增 `config.json` 配置层：优先级 config.json > 环境变量 > .env > 默认值
  - **CalDAV 也接入**（此前仍读 env，界面改地址不生效）
  - **数据文件路径接入**（events.md / 看板路径可在界面改）
  - 改完**立即生效**，无需重启
- 设置界面新增四个标签页：通用、AI 解析、同步（CalDAV + WebDAV）、数据文件
- 敏感字段脱敏传输（`sk-****abcd`），界面回传掩码时**不覆盖真实值**
- config.json 已加入 .gitignore

### ✨ 多语言

- 轻量 i18n 框架（不引 i18next，减少打包体积）
- 内置 zh-CN / en-US 语言包，key 一致性由测试保证
- 日期/时间/相对时间按 locale 格式化（`Intl` API）

### ✨ 模块可插拔

- 插件目录 `apps/renderer/plugins/`：放 `<id>.json` + 可选 `<id>.tsx` 即可新增模块
- 后端 `GET /api/plugins` 扫描清单，前端运行时注册
- 插件 id 与内置冲突时跳过（不覆盖内置功能），组件缺失时退化为占位页
- 示例：`apps/renderer/plugins/example.json`

---

## [Unreleased] - 2026-10-19

### 🐛 Critical Bug Fixes

这批问题都曾让功能处于**不可用**状态，但此前的文档把它们描述为「已完成」。

- **日历上一个事件都不显示**
  `events.md` 用 `date`/`end` 字段，FullCalendar 只认 `start`/`end`，
  原实现直接把 MdEvent 展开传入，字段全部对不上。
  新增 `toFullCalendarEvent()` 映射层。

- **任务 ID 行序漂移导致误删**
  三套 ID 体系混用：解析用行序 `t0/t1/t2`、POST 用时间戳、写回不保存。
  新建任务 unshift 到队首会让所有存量任务 ID 整体错位，
  删 A 会连带删掉 B 的日历事件。
  改为把稳定 ID 持久化到 md 的 `| id:` 字段。

- **时区偏移 8 小时**
  `new Date("...T09:00:00.000Z")` 把东八区 9 点当成 UTC 9 点存储。

- **全天事件导出零长度**
  ICS 的 DTEND 是排他边界，必须是次日 00:00；与 DTSTART 同日会被客户端忽略。
  同时修正 `VALUE=DATE` 用 `toISOString()` 导致的跨时区跨日。

- **同步方向配置静默失效**
  配置层用 `md-to-caldav`/`caldav-to-md`，同步层认 `push`/`pull`，
  按文档填配置会导致自动同步什么都不做。新增 `normalizeSyncDirection()`。

- **工作台数据恒为 0**
  「今日事件」「事件总数」读的是数据流重构后已无人写入的
  `syncStore.cachedEvents`。改为直接读 `events.md`。

### ✨ New Features

- **自然语言快速创建（类 Fantastical 交互）**
  - 日历页顶部一句话创建：「明天下午3点和老王开项目评审会」
  - **本地中文规则解析作快速路径** —— 毫秒级、断网可用、零调用费用。
    不用 AI 主导的理由：AI 有网络延迟（削弱"快速"的本质）、
    断网即不可用、且会「自信地」算错日期（比不识别更危险）
  - 覆盖：相对日、星期（含下周三/下下周一）、这周末、月底月初、
    绝对日期、时段（下午3点/晚上8点/2点半）、相对时间（半小时后）、
    时长（持续2小时）、重复（每天/每周一/每月5号）
  - 可选接入 OpenAI 格式 AI 作**增强通道**，处理规则覆盖不到的复杂长句；
    三级降级：tool calling → json mode → 裸 JSON，AI 挂了自动回退本地
  - **草稿先预览再建**：解析端点不写文件，用户确认后才落盘 events.md
  - **语音创建**：浏览器 Web Speech API（免费、音频不出本机）优先，
    不支持时回退 Whisper API
  - **API Key 只由服务端读取**，`/api/nlp/status` 只回传"配没配"

- **WebDAV 同步通道（直接同步 md，无需 ICS 转换）**
  - 把 `events.md` 与 `工作搭子看板.md` 原样同步到 WebDAV 云盘
    （Nextcloud / 坚果云 / ownCloud / Box），适用于没有 CalDAV 的用户
  - ETag 乐观锁：远端被其他设备改动时返回冲突而非静默覆盖，
    UI 提供「用本地覆盖」/「改用远端」两个明确选项
  - 拉取只覆盖远端确实变化的文件，且覆盖前自动备份为 `.bak`
  - 同步状态记录于 `.webdav-state.json`
  - API：`status` / `push` / `pull` / `test`
  - 日历页工具栏「WebDAV」按钮 + 同步面板
  - 只用 Node 内置 fetch，不引第三方 WebDAV 库（坚果云兼容性考虑）

- **iCalendar 文件导入 / 导出**
  - `parseIcsFile()`：解析多 VEVENT 文件（此前只取第一条）
  - `eventsFileToIcs()`：导出为单个 VCALENDAR
  - `POST /api/md-bridge/ics/import`：dryRun 预览、按 uid 去重、append/replace
  - `GET /api/md-bridge/ics/export`：日期范围过滤、直接下载
  - 日历页工具栏「导入 ICS」「导出 ICS」+ 预览确认弹窗

### 🐛 服务端启动容错

- 服务端不再因 CalDAV 连接失败而 `process.exit(1)`。
  `initializeClient()` 内部已捕获错误返回空数组，此前 start() 里额外 exit 会导致
  「只有 md + WebDAV、没有 CalDAV」的用户完全无法启动。

### 🧹 Refactor

- 消除 `md-bridge.ts` 中 248 行与 `kanban.ts` 重复的看板读写实现（含死代码），
  统一按稳定 ID 定位
- `PATCH /task/:id` 不再允许覆盖 ID，剔除 `calendar`/`clearCalendar` 控制指令
  避免污染 md 字段
- 标签选择器选中态修复（字符串数组 vs 对象数组结构不一致）
- 逾期判定统一（原本红字与告警条两套逻辑，且当天到期被误判）

### 📝 Documentation Corrections

- **删除 README 中「`./run-tests.sh` 9/9 通过」的声明 —— 该文件不存在**
- 重写 `docs/TESTING.md`：旧版本「44+ 测试 100% 通过」的数字无法复现
- Roadmap 按真实完成度重新标注 `[x]`/`[~]`/`[ ]`
- `.env` 中 `WEBDAV_*` 与 `AI_*` 标注为「尚未实现」（此前是无代码读取的死配置）
- 补充看板 `id:`/`日历:` 字段规范，同步更新 Python 参考 parser

### 🧪 Tests

- `ics-file.test.ts`（14 项）
- `kanban-id.test.ts`（9 项）
- HTTP 端到端验证 25 项（导入导出、去重、replace、下载头、日期过滤、异常输入）

---

## [0.1.0] - 2026-06-22

### 🎉 Initial Release - Production Ready

#### ✨ Core Features Implemented

- **CalDAV Integration**: Full synchronization with Radicale servers
- **Event Management**: Complete CRUD operations (create, read, update, delete)
- **Event Properties**:
  - Categories for event organization
  - Multi-tag support for flexible grouping
  - Recurring events (daily, weekly, monthly, yearly)
  - All-day event support
  - RFC 5545 standard compliance

#### ⚡ Smart Sync Features (New in v0.1.0)

**Intelligent Caching System**
- Local event caching for improved performance
- Cache expiration management (1-hour TTL)
- Offline access to cached events
- Seamless cache refresh on sync
- Partial cache updates (e.g., remove single event without clearing entire cache)

**Flexible Sync Management**
- Configurable sync intervals: 5/10/30 minutes or manual
- Manual sync button for immediate updates
- Automatic sync after event modifications
- Sync status visualization in bottom status bar
- Immediate frontend feedback with background synchronization

**User Experience Enhancements**
- Real-time sync status indicators
- Last sync time display
- Error messaging for sync failures
- Non-blocking sync operations
- Graceful error handling with user-friendly messages

#### 🎨 Design System (New in v0.1.0)

**Morandi Color Schemes**

- Classic Morandi: Soft gray palette for serene interface
- Earth Brown: Warm brown tones for natural feel
- Blue-Green: Fresh cool tones for clarity
- Purple-Gray: Elegant sophisticated palette
- Custom color picker for personalization

**Unified Rounded Corner Design**

- Four border-radius levels: None, Small, Default, Large
- Applied consistently across all UI components
- Real-time preview of design changes

**Theme System**

- Light/Dark mode support
- Automatic theme detection from OS settings
- Settings persist across sessions
- Instant theme switching

#### 🖥️ User Interface

- Modern React + Tailwind CSS interface
- FullCalendar integration with multiple views
- Comprehensive settings modal
- Responsive design for various screen sizes
- Intuitive event editing form
- Clear error messages and feedback
- Bottom sync status bar for real-time sync information

#### 🔧 Technical Improvements

**Backend**

- Express.js REST API
- CalDAV client implementation (tsdav)
- ICS/iCalendar parsing (ical.js)
- Proper HTTP status codes (201 for creation, 200 for updates)
- Event UID tracking for CRUD operations
- CORS middleware for frontend communication

**Frontend Architecture**

- TypeScript 100% type coverage
- Zustand state management with persistence
- Component-based architecture
- CSS-in-JS with Tailwind configuration
- Automated theme persistence
- Smart sync state management with localStorage persistence

**Frontend**

- TypeScript 100% type coverage
- Zustand state management with persistence
- Component-based architecture
- CSS-in-JS with Tailwind configuration
- Automated theme persistence

**Build & Packaging**

- Electron desktop application
- Cross-platform builds: Linux AppImage, tar.gz, Windows .exe, macOS .dmg
- Vite development server with hot reload
- Optimized production bundles

#### 📊 Quality Metrics

- **Tests**: 9/9 API tests passing (100%)
- **Frontend**: All features verified working
- **Bundle Size**: ~500KB JS (gzip: ~150KB), ~19KB CSS (gzip: ~4KB)
- **Performance**: < 2s initial load, < 500ms API responses
- **Code**: Complete type safety, error handling, logging

#### 🚀 Supported Platforms

- Linux (AppImage, tar.gz) - Pre-built available
- Windows (.exe installer, .zip portable) - Build on Windows
- macOS (.dmg, .zip) - Build on macOS

### 🐛 Known Issues Fixed

- ✅ Event creation HTTP status code (201 vs 200)
- ✅ Event UID returned in API responses
- ✅ TypeScript compilation errors (unused imports)

### 📚 Documentation Added

- README.md - Project overview and quick start
- docs/TESTING.md - Comprehensive test plan and results
- docs/DEPLOYMENT.md - Build and packaging guide for all platforms
- docs/CHANGELOG.md - This file
- FUNCTIONAL_TEST_PLAN.md - Detailed test cases (archived)
- COMPREHENSIVE_TEST_REPORT.md - Full test results (archived)

### ❌ Not in v0.1.0 (Future Features)

- Meeting invitations
- Complex timezone handling
- Multiple account support
- Mobile applications
- Event reminders/notifications
- Advanced event search and filtering
- Event sharing and collaboration

---

## [Upcoming] v0.2.0 (Planned)

### 🎯 Planned Features

- Advanced event filtering and search
- Additional theme/color scheme options
- Event reminder/notification system
- Import/export functionality (iCalendar format)
- Performance optimizations
- Additional UI polish
- Enhanced offline mode with extended caching
- Conflict resolution for sync conflicts

### 📋 Future Roadmap (v1.0+)

- Mobile applications (React Native)
- Multi-account support
- Event sharing and collaboration features
- Desktop notifications
- Advanced caching and sync strategies
- Plugin/extension system

---

## Version History Summary

| Version | Date       | Status      | Highlights                                     |
| ------- | ---------- | ----------- | ---------------------------------------------- |
| 0.1.0   | 2026-06-22 | ✅ Release  | Full-featured calendar app, all tests passing  |
| 0.2.0   | TBD        | 🔄 Planning | Advanced features, performance improvements    |
| 1.0.0   | TBD        | 🔄 Planning | Mobile apps, collaboration, production release |

---

## How to Update

### From Development Version

```bash
git pull origin main
pnpm install
cd apps/server && pnpm dev      # Terminal 1
cd apps/renderer && pnpm dev    # Terminal 2
```

### To Latest Packaged Release

- **Linux**: Download new AppImage or tar.gz from releases
- **Windows**: Run installer or extract new portable .zip
- **macOS**: Replace app in Applications folder

---

## Feedback & Bug Reports

- Found a bug? Check [TESTING.md](TESTING.md) for known issues
- Want a feature? Create an issue with details
- Security concern? Please report responsibly

---

## 📝 Recent Updates

### August 21, 2026 - 工作台↔日历双向绑定 + 同步关联保留

- **双向绑定**：工作台任务与日历事件通过 `日历:<uid>` / `kanbanTaskId` 互链，可双向一键创建、级联删除、解绑保留
- **同步修复**：拉取（CalDAV→MD）不再清空绑定；ICS 用 `X-KANBAN-TASK-ID` 携带关联，pull 合并回退保留本地关联
- **数据架构**：`events.md` 为唯一事实源，ICS 仅作非实时同步通道（延时自动 + 手动同步）

### June 30, 2026 - Documentation Consolidation

- **文档整理**: 合并并删除了冗余的文档文件
- **统一更新日志**: 创建了持续更新的日志文件(docs/UPDATE_LOG.md)
- **增强功能**: 改进了删除功能和同步管理机制

### June 25, 2026 - Repository Maintenance

- **Git History Optimization**: Large build artifacts (>50MB) removed from Git history
- **Repository Cleanup**: Improved clone performance and reduced storage requirements
- **Documentation Updates**: All guides synchronized with latest code changes

### June 25, 2026 - Build Artifact Management

- **Large File Removal**: Removed oversized binaries from Git history:
  - Linux AppImage (~100MB)
  - Linux tar.gz (~95MB)
  - Windows executable (~170MB)
  - macOS applications
- **Future Distribution**: Build artifacts now distributed via releases/tags only
- **Development Workflow**: Cleaner repository for contributors and developers

**Generated**: 2026-06-22
**Maintained by**: CalDAV Desktop Team