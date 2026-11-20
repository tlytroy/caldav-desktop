# CalDAV Desktop - Cross-Platform Calendar Application

A cross-platform desktop calendar application with full CalDAV support and modern UI design.

Built with the help of AI assistance, this project addresses the lack of standalone CalDAV calendar applications on Windows, providing a lightweight alternative to email clients that bundle calendar functionality.

![Version](https://img.shields.io/badge/version-0.3.1-blue) ![Status](https://img.shields.io/badge/status-local--first-green)

## 🗂 统一数据源

**唯一事实源 = 一个文件：`workspace.md`。**

日历、任务看板、快速创建都只是这个文件的**视图**（不同筛选条件），
不各自维护数据再互相同步。

```
workspace.md（唯一事实源）
     │
     ├── scope=calendar + expand=true  →  日历模块
     ├── scope=board                    →  任务看板模块
     └── scope=all                      →  工作台 / AI 工具
```

- 一条记录带 `kind: task | event`，但 **kind 只是标签不是隔离** ——
  `kind: task` 且有 `start` 的条目**同时**出现在看板和日历，指向同一个 id
- **没有绑定字段、没有级联删除、没有解绑** —— 删一条就是删一条
- 唯一需要格式转换的是 **md ↔ ics**（ics 是标准格式，无法自定义）
- 三层防护防 AI 乱改：schema 校验 / 容错解析（一条坏不影响其余）/ 写入前备份

详见 [REF/DATA_SOURCE.md](REF/DATA_SOURCE.md)。

## ✨ Features

- **单一事实源**: 一个 `workspace.md` 承载事件、任务、清单、子任务；
  日历 / 看板 / 工作台都是它的视图（见上方章节）
- **任务看板（类滴答清单）**:
  - 清单分组：清单由条目聚合得出，无需预设；收件箱恒在首位
  - 子任务 + 进度条：父任务显示 `2/5`，展开可 inline 添加子任务
  - 优先级色块、逾期告警（截止日当天不算逾期）、一键勾选完成
  - **点击标题就地编辑**：标题 / 优先级 / 截止日 / 时间 / 清单 / 项目 / 重复
  - **搜索**（标题 / 项目 / 标签）、清单重命名（改名会批量改条目）
  - 删除父任务时**级联删除子任务**，不留「有 parent 但父级不存在」的孤儿数据
- **CalDAV Sync**（可选通道）: 与 Radicale 等标准 CalDAV 服务器互通（RFC 5545）
  - 同步对象就是 `workspace.md` 本身（不再是遗留的 `events.md`）
  - 逐对象 UID + ETag 增量：没改的条目不重传，ETag 没变的远端对象不下载
  - 拉取时把远端 UID 落盘到 `uid` 字段 —— 本地改完推回去不会在手机上变成两条
  - 两边都改过时**不静默覆盖**：界面给三个选项
    「以远端为准 / 以本地为准 / 字段级合并（本地改的保留，远端改的采纳）」
  - 可配自动同步间隔，进程内定时器按间隔执行（改配置不用重启）
- **提醒（本地 + 手机推送）**:
  - 事件 / 任务可设提醒（`remind` 字段，绝对本地时间；界面提供「开始时 / 提前 10 分钟 / 1 小时 / 1 天 / 自定义」）
  - 应用内：到点右下角弹卡片，可「稍后 10 分钟」；同一提醒只弹一次，超过 24 小时不补弹
  - 手机推送：**企业微信机器人 / Server酱 / PushPlus / Bark / ntfy / 通用 Webhook**
  - Docker / NAS 后端常驻时 **7×24** 推送；不配推送也完全可用（纯本地提醒）
- **自然语言快速创建**（类 Fantastical 交互）:
  - 日历页顶部一句话创建：「明天下午3点和老王开项目评审会」
  - **本地中文规则解析作快速路径** —— 毫秒级、断网可用、零调用费用
  - 覆盖：今天/明天/后天、下周三/下下周一、这周末、3月5日、
    下午3点/晚上8点/2点半、半小时后/2小时后、每天/每周一、持续2小时
  - 可选接入 OpenAI 格式 AI 作为**增强通道**：处理规则覆盖不到的复杂长句
  - **草稿先预览再建**：解析不直接写文件，确认后才落盘 `workspace.md`
  - **语音创建**：浏览器内置语音识别（免费、音频不出本机），
    不支持时可回退到 Whisper API
- **iCalendar 文件导入 / 导出**:
  - 导入任意 `.ics`（Google / Outlook / Apple 导出）到统一数据源，支持先预览再确认
  - 按 id 去重，重复导入不会产生重复条目
  - 可选择追加（append）或替换（replace）两种模式
  - 导出为单个 `.ics`，可按日期范围过滤；RRULE 完整透传
- **WebDAV 同步（直接同步 md，无需 ICS 转换）**:
  - 把 `workspace.md` 原样同步到 WebDAV 服务器（Nextcloud / 坚果云 / ownCloud / Box）
  - 适用于**没有 CalDAV 服务器**的场景：只要有 WebDAV 云盘即可多设备同步
  - ETag 乐观锁：检测到远端被其他设备修改时不静默覆盖，交由用户决策
  - 冲突三选一：**以本地为准 / 以远端为准 / 按条目合并**
    （两边独有的都保留，同一条目取 `updatedAt` 较新的一版；覆盖前备份 `.bak`）
  - 拉取只覆盖「远端确实变化」的文件，覆盖前自动备份为 `.bak`
- **周期规则**: RRULE（RFC 5545 子集）—— 每天 / 每周 / 每周一三五 / 每月1号 / 每年，
  支持 `INTERVAL` / `COUNT` / `UNTIL`，导出 ICS 不丢参数
- **Event Management**: Create, edit, delete events with full CRUD operations
- **Advanced Features**:
  - Event categories for organization
  - Multi-tag support for flexible grouping
  - All-day events（DTEND 排他边界正确处理）
- **Modern Design**:
  - 4 Morandi color schemes + custom colors
  - Unified rounded corner design system
  - Full dark mode support
  - Responsive layout
- **Cross-Platform**: Linux, Windows, macOS (packaged as Electron app), Android (Capacitor)
- **本地优先**: CalDAV / WebDAV 连不上不影响任何本地功能
  （服务端先监听端口，再后台探测远程）


## 🚀 Quick Start

### Prerequisites

- Node.js 20+ LTS
- pnpm
- Linux environment (native or WSL2) for building

### Installation & Development

```bash
# Install dependencies
pnpm install

# Start backend server (port 3001)
cd apps/server && pnpm dev

# Start frontend dev server (port 5173)
cd apps/renderer && pnpm dev
```

Backend API: http://localhost:3001/api/calendar
Frontend: http://localhost:5173/

### Configuration

所有配置都能在**设置界面**里改，保存到项目根目录 `config.json`（已 `.gitignore`）。
也可以用环境变量 / `.env`（优先级：`config.json` > 环境变量 > `.env` > 默认；
**路径类例外，环境变量优先**）。

```
# ===== 统一数据源 =====
WORKSPACE_FILE=./workspace.md        # 事件 + 任务 + 清单 + 子任务，唯一事实源

# ===== CalDAV（可选）=====
CALDAV_ROOT_URL=https://your-radicale-server.com
CALDAV_USER=your_username
CALDAV_PASS=your_password
MD_ICS_SYNC_DIRECTION=bidirectional   # push | pull | bidirectional
MD_ICS_AUTO_SYNC_MINUTES=0            # >0 启用延时自动同步（非实时）
```

> ⚠️ 旧变量 `MD_EVENTS_FILE` / `KANBAN_FILE_PATH` 与旧的
> `events.md`、`工作搭子看板.md` 文件已废弃，仅迁移脚本还会读。
> 详见 [REF/DATA_SOURCE.md](REF/DATA_SOURCE.md)。

### WebDAV 同步配置（可选）

不装 CalDAV 也能多设备同步 —— 直接把 md 文件传到 WebDAV 云盘：

```
WEBDAV_URL=https://dav.example.com/remote.php/dav/files/user
WEBDAV_USER=your_username
WEBDAV_PASS=your_password
WEBDAV_EVENTS_PATH=CalDAV-Desktop          # 只取目录部分
```

配好后日历页工具栏会出现「WebDAV」按钮，可推送 / 拉取 / 测试连接。
详见 [docs/SYNC_MANAGEMENT.md](docs/SYNC_MANAGEMENT.md)。

### AI 解析配置（可选）

自然语言快速创建的**增强通道**。不配也能用（本地规则解析始终可用）：

```
AI_BASE_URL=https://api.deepseek.com/v1    # 任意 OpenAI 兼容端点
AI_API_KEY=sk-xxx
AI_MODEL=deepseek-chat
```

AI 主要用于两处：① 规则解析不了的长句兜底；② 语音转写（Whisper）。
**API Key 只由服务端读取，绝不下发到浏览器。**

## 🐳 两种部署方式

### 方式 A：本地一体（桌面 / 单机）

Electron 打包，前端 + 后端都在本机：

```bash
cd apps/desktop && pnpm build && pnpm package:linux   # 或 package:win / package:mac
```

数据默认 `./workspace.md`；应用没开时不会有提醒（应用内和手机推送都不会）。

### 方式 B：Docker / NAS（自托管）

一个容器同时提供 **API + 前端页面 + 提醒推送调度**：

```bash
# 可选：把推送 / CalDAV 密钥放进 .env，再取消 compose 里的 env_file 注释
cp .env.example .env
docker compose up -d --build

# 打开 http://<NAS 地址>:3001
```

- 数据挂在 `./data`：`workspace.md`（唯一事实源）+ `config.json`
- 手机 / 平板 / 另一台电脑直接用浏览器打开同一个地址（前端由后端托管，PWA 可加到桌面）
- 只想跑前端连远端后端：在「设置 → 通用 → 后端地址」填 `http://nas:3001`
- 后端常驻 → 提醒推送 7×24 生效（不需要开着桌面应用）
- 镜像已本地构建验证（`node:22-alpine`，253MB）；数据卷写入 / 静态页面 / 推送接口都跑通
- ⚠️ 后端目前没有内置登录，暴露到公网前请加反向代理认证 / Tailscale

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)、[docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)。

## 🔗 工作台集成（同一个文件，三种视图）

任务看板、日历、工作台读的是**同一个** `workspace.md`：

- 在任务页加任务 → 有 `start` 就同时出现在日历（同一条记录，同一个 id）
- 在日历页加事件 → 看板里也能看到（`kind: task` 且带日期的条目）
- 勾选完成、改优先级、加子任务 → 所有视图立即一致，因为**只有一份数据**
- 没有绑定字段、没有级联删除、没有解绑、没有跨模块同步

ICS 只在与外部日历软件交换数据时出现（导入 / 导出 / CalDAV 通道）。
设计见 [REF/DATA_SOURCE.md](REF/DATA_SOURCE.md)，格式转换细节见
[REF/MD_ICS_BRIDGE.md](REF/MD_ICS_BRIDGE.md)。

> **同步通道现状**：日历页的「推送 / 拉取 / 双向同步」走
> `/api/caldav/sync`，读写的就是当前这份 `workspace.md`。
> 旧的 `/api/md-bridge/*` 与 `/api/kanban/*` 已在 v0.3（P3）整组删除。
> 行为与边界见 [docs/SYNC_MANAGEMENT.md](docs/SYNC_MANAGEMENT.md)。

## 📦 Builds

Pre-built packages available in `apps/desktop/dist-electron/`:

- Linux: `CalDAV-Desktop-0.3.1-linux.AppImage` (~100MB)
- Linux: `CalDAV-Desktop-0.3.1-linux.tar.gz` (~95MB)
- Windows/macOS: See Deployment section below

### Linux (All Distributions)

#### Build Steps

```bash
# Install dependencies
pnpm install

# Build for Linux
cd apps/desktop
pnpm build

# Package as AppImage and tar.gz
pnpm package:linux
```

#### Outputs

Generated in `apps/desktop/dist-electron/`:

- AppImage: Self-contained executable with no dependencies
- tar.gz: Compressed archive for manual installation

### Windows

```bash
# Package for Windows
cd apps/desktop
pnpm package:win
```

### macOS

```bash
# Package for macOS
cd apps/desktop
pnpm package:mac
```

## 🧪 Testing

### Automated Tests

```bash
cd apps/server && pnpm test      # 20 文件：444 通过
cd apps/renderer && pnpm test    # 13 文件：115 通过
```

没有 skip：P3 删除 `e2e-bridge` / `e2e-full` 后，剩下的都是离线用例。
需要真实 CalDAV 服务器的验收脚本是 `apps/server/src/__tests__/acceptance.e2e.mjs`（手动跑）。

### Test Coverage（核心文件）

| Test file | What it locks down |
| --------- | ------------------ |
| `workspace.test.ts` (53) | 逐条容错解析、序列化往返、校验、scope 筛选、清单聚合、子任务进度 |
| `workspace-store.test.ts` (25) | 读失败不静默、round-trip 保真、并发/锁超时、图校验、原子写 |
| `storage-check.test.ts` (6) | 原子写 + 崩溃注入（子进程 SIGKILL 后旧文件完好）、tmp 清理 |
| `workspace-api.test.ts` (35) | HTTP CRUD、字段白名单、`topLevel` / `list` / `expand`、删父任务级联子任务 |
| `backups.test.ts` (21) | 备份列表/预览/导出、`itemCount` 容错、固定 24h、路径穿越、轮转保护 |
| `recurrence.test.ts` (30) | RRULE 解析展开（每周一三五、短月跳过） |
| `ics-convert.test.ts` (28) | md ↔ ics 字段映射、全天 DTEND 排他、标签多行 CATEGORIES |
| `buildICSContent.test.ts` (15) | ICS 文本拼装（VEVENT 结构、转义、嵌套 VCALENDAR） |
| `webdav-sync.test.ts` (23) | 模拟 WebDAV：ETag 乐观锁、冲突不覆盖、pull 前备份、条目级合并 |
| `caldav-sync.test.ts` (23) | 模拟 CalDAV：UID 落盘、增量拉取、冲突不覆盖、字段级合并、按 UID 范围 force、RECURRENCE-ID 跳过、老数据认领、日历发现回退、HTTP 路由 |
| `caldav-degraded.test.ts` (5) / `caldav.test.ts` (4) | 无服务器时降级、连接基础路径 |
| `notifications.test.ts` (9) | 六种推送渠道格式、失败如实报错、去重、24h 宽限、失败退避、深层密钥掩码 |
| `zh-time.test.ts` (67) | 中文时间解析全量用例 |
| `nlp-parse.test.ts` (18) | 本地规则优先、AI 兜底、密钥不外泄 |
| `config-plugins.test.ts` (29) | 配置优先级、掩码回填、插件扫描 |
| `app-create.test.ts` (18) | createApp 装配顺序、编码路径、只读/维护闸门 |
| `auth.test.ts` (9) | token 生命周期（env/文件/生成/权限/损坏/只读降级） |

完整清单与回归点见 [docs/TESTING.md](docs/TESTING.md)。

### Manual Frontend Tests

Start the dev servers first:

```bash
cd apps/server && pnpm dev      # Terminal 1
cd apps/renderer && pnpm dev    # Terminal 2
```

Then visit http://localhost:5173/ in your browser.

## 📊 Changelog

### [0.1.0] - 2026-06-22

#### 🎉 Initial Release - Production Ready

##### ✨ Core Features Implemented

- **CalDAV Integration**: Full synchronization with Radicale servers
- **Event Management**: Complete CRUD operations (create, read, update, delete)
- **Event Properties**:
  - Categories for event organization
  - Multi-tag support for flexible grouping
  - Recurring events (daily, weekly, monthly, yearly)
  - All-day event support
  - RFC 5545 standard compliance

##### 🎨 Design System (New in v0.1.0)

**Morandi Color Schemes**

- Classic Morandi: Soft gray palette for serene interface
- Earth Brown: Warm brown tones for natural feel
- Blue-Green: Fresh cool tones for clarity
- Purple-Gray: Elegant sophisticated palette
- Custom color picker for personalization

**Unified Rounded Corner Design**

Consistent rounded corners throughout the interface for modern aesthetic.

**Dark Mode**

Full dark mode support with automatic system preference detection.

## 🏗️ Architecture

### Current Architecture (v0.3.0)

```
┌─────────────────────────┐
│  Electron (Desktop)     │
│  React + Tailwind CSS   │
│  FullCalendar           │
└────────────┬────────────┘
             │ JSON/REST API
             ▼
┌─────────────────────────┐
│  Node.js Backend        │
│  Express.js             │
│  CalDAV Client (tsdav)  │
└────────────┬────────────┘
             │ CalDAV/XML
             ▼
        ┌──────────────┐
        │  Radicale    │
        │  Server      │
        └──────────────┘
```

### Planned Architecture (v0.2.0+) — 积木式模块化架构

```
┌──────────────────────────────────────────────────────────┐
│                    App Shell (框架核心)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ 路由系统   │ │ 布局系统   │ │ 主题系统   │ │ ModuleRegistry│  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
├──────────────────────────────────────────────────────────┤
│                   模块注册中心 (Module Hub)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐│
│  │ Calendar │ │  Sync    │ │ Settings  │ │  Dashboard   ││
│  │  Module  │ │  Module  │ │  Module   │ │  Module (新)  ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐│
│  │ [Todos]  │ │[Contacts]│ │ [Notes]  │ │ [Analytics]  ││
│  │ (占位)    │ │ (占位)    │ │ (占位)    │ │  (占位)       ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘│
├──────────────────────────────────────────────────────────┤
│                   共享基础设施层                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐│
│  │ UI组件库  │ │ API层     │ │ Store层   │ │  工具库       ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 双通道同步架构 (v0.2.0+)

```
                          ┌──────────────────────┐
  通道 B (WebDAV) ───────▶│  WebDAV 服务器        │
  MD 文件同步             │  (MD 文件层)          │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │  转换引擎 (Bridge)     │
                          │  MD ↔ ICS 互转        │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
  通道 A (CalDAV) ───────▶│  CalDAV 服务器        │
  ICS 事件同步            │  (日历事件层)          │
                          └──────────────────────┘

  [⚡ 一键同步] = MD → ICS 转换 + 双通道推送
  [⏰ 自动同步] = 可配置间隔，定时执行
  [📝 本地编辑] = 直接修改 MD 文件，下次同步自动转换
```

## 🗂️ Project Structure

```
radicale-desktop/
├── apps/
│   ├── desktop/          # Electron main process
│   ├── renderer/         # React frontend (积木式模块化)
│   │   ├── plugins/      # 外部插件（<id>.json + 可选 <id>.tsx）
│   │   └── src/
│   │       ├── framework/ # 框架核心 (ModuleRegistry, AppRouter, ModuleSlot)
│   │       ├── modules/   # 积木模块 (dashboard / tasks / calendar / notifications / placeholder)
│   │       ├── components/reminders/ # 全局提醒宿主（应用内卡片）
│   │       ├── utils/     # date.ts（本地日期）/ reminders.ts（提醒计算）
│   │       ├── api/       # base.ts 解析 API 地址；workspace.ts 是数据接口客户端
│   │       └── store/     # 主题 / 日历选择等 UI 状态（不存业务数据）
│   └── server/
│       └── src/
│           ├── workspace.ts   # 唯一数据层（解析/序列化/校验/筛选）
│           ├── recurrence.ts  # RRULE
│           ├── ics-convert.ts # 唯一格式转换点
│           ├── config.ts      # 配置优先级
│           ├── caldav.ts / webdav.ts
│           ├── caldav-sync.ts # workspace ↔ CalDAV（uid / ETag / 冲突 / 自动同步）
│           ├── notifications/ # 提醒推送：push.ts（六种渠道）+ scheduler.ts（定时）
│           └── routes/        # workspace / caldav-sync / notifications / webdav / nlp / config …
├── Dockerfile / docker-compose.yml # 自托管（NAS / 服务器）部署
├── docs/                 # 同步、测试、部署、提醒、变更日志
├── REF/                  # 设计文档（先看 REF/README.md 索引）
│   ├── README.md         # ⭐ 文档索引：哪份可信、哪份是历史
│   ├── DATA_SOURCE.md    # ⭐ 统一数据源（当前架构权威说明）
│   ├── MD_ICS_BRIDGE.md  # ⭐ 唯一格式转换层
│   ├── ARCHITECTURE.md   # 模块化框架
│   ├── DASHBOARD_DESIGN.md # 工作台设计稿（含实现状态对照）
│   └── work-dazi-toolkit/ # 外部参考实现（格式与本项目不同）
├── schema/item.schema.json # 字段约束（服务端校验 + AI 工具共用）
├── scripts/migrate-to-workspace.js # 旧双文件 → workspace.md 迁移
└── scripts/verify-caldav-live.mjs   # CalDAV 联网只读自检（服务器就绪后跑）
```

## 🔄 Roadmap

> 状态说明：`[x]` = 代码已实现且有测试覆盖；`[~]` = 部分实现或有已知限制；`[ ]` = 未实现。
> 标 `[~]` 的条目不要当成可用功能。

### v0.2.0 — 积木式模块化重构

- **Phase 1: 框架搭建**
  - [x] 创建 framework/ 核心框架 (ModuleRegistry, ModuleSlot, AppRouter)
  - [x] 实现占位模块系统
  - [x] 实现工作台 Dashboard 页面
- **Phase 2: 模块化改造**
  - [x] calendar / tasks / dashboard 三个活跃模块注册
  - [x] 旧 AppShell 保留为回退路径（`useModularUI` 开关）
  - [ ] settings 独立成模块（当前仍是 SettingsModal 组件）
  - [ ] roadmap 独立成模块
- **Phase 3: 统一数据源**
  - [x] workspace.md 单文件条目池（事件 + 任务同一个池子）
  - [x] 容错解析（一条坏数据不影响其余）+ schema 校验 + 写入前备份
  - [x] iCalendar 文件导入（多事件、dryRun 预览、按 uid 去重）
  - [x] iCalendar 文件导出（单文件 VCALENDAR、可按日期范围过滤）
  - [x] WebDAV 通道（ETag 冲突检测 + 自动备份）
  - [x] 从 events.md + 工作搭子看板.md 迁移（已绑定的对自动合并成一条）
- **Phase 4: CalDAV 同步**
  - [x] MD → ICS 转换（RRULE 完整透传）
  - [x] 通道迁移到 workspace.md（`/api/caldav/sync`，UI 三个按钮已切换）
  - [x] 逐对象 UID + ETag 增量（没变的不重传 / 不下载）
  - [x] 冲突检测：字段指纹 + ETag；两边都改过时列冲突交给用户
  - [x] 冲突三种处理：以远端为准 / 以本地为准 / 字段级合并（合并结果推回远端）
  - [x] 自动同步（按配置间隔，进程内定时器，改配置无需重启）
  - [ ] 删除传播（墓碑）：远端删除暂不删本地，本地删除也暂不删远端
- **Phase 5: 周期规则**
  - [x] RRULE 解析与展开（RFC 5545 子集）
  - [x] 每天 / 每周 / 每周一三五 / 每月 / 每月1号 / 每年
  - [x] INTERVAL / COUNT / UNTIL 支持
  - [x] 日历侧按 RRULE 展开渲染
- **Phase 6: 占位模块**
  - [x] git-sync / ai-agent / notifications 三模块已注册（status=placeholder）
  - [x] 自然语言快速创建（本地规则 + AI 兜底 + 语音输入）
  - [ ] git-sync 实际功能（WebDAV 通道已独立实现，此占位模块可考虑下线或改为 Git 备份）
  - [ ] ai-agent 模块的实际能力（自动从笔记提取事件）
  - [x] notifications 通知推送（应用内提醒 + 六种手机推送渠道，Docker 下 7×24）
- **Phase 7: 清单与子任务**（2026-11-02）
  - [x] `list` 清单分组（聚合得出，不预设）
  - [x] `parent` 子任务 + 父任务进度条
  - [x] 清单改名接口 + 界面入口（改成空 = 并回收件箱）
  - [x] 点击任务编辑（标题 / 优先级 / 时间 / 清单 / 项目 / 重复）
  - [x] 搜索（标题 / 项目 / 标签）
  - [x] 删除父任务级联删除子任务（不留孤儿数据）
  - [x] 条目级提醒（应用内 + 手机推送）
  - [ ] 清单排序 / 颜色 / 拖拽
  - [ ] 清单级默认提醒（每个清单一套默认提前量）

### v0.3.0（2026-11-03，已完成）

- [x] 数据安全：原子写 + 文件锁 + 单事务 `mutateWorkspace` + round-trip 保真
- [x] 读取失败不再静默清空：`WorkspaceReadError` + 500 页 3 步手工恢复
- [x] 备份只读接口（列表 / 预览差异 / 导出）+ 固定快照 24h 不被轮转
- [x] 一键恢复状态机（sha 校验 → 冻结 → drain → 原子替换 → 重置基线 → 暂停同步）+ 中断可 abort
- [x] 单用户认证：`api-token.txt`（0600）+ 前端 AuthGate + 统一 axios client
- [x] 只读同步中心：本地状态快照，**不发网络请求**，没配同步也照常用
- [x] Electron 打包后端（esbuild 单文件 + 随机端口 + 主进程注入 token）

### v0.3.1（2026-11-05，已完成）

- [x] WebDAV ETag 基线统一为 HEAD 同源：修掉 OneDrive/SharePoint 风格网关上「每次推送都误报冲突」
- [x] 验收脚本补 Bearer 认证 + `scripts/run-e2e.sh` 隔离 runner（92 + 32 全通过）
- [x] 「放弃本次恢复」补 UI（备份面板 + 同步中心），恢复卡住时有逃生口
- [x] CI 增加 e2e job；产物路径修正为 `apps/desktop/dist-server/`

### v0.4+ (规划中)

- ~~自然语言快速创建事件（类 Fantastical 交互）~~ ✅ 已于 2026-10-19 实现
- ~~CalDAV 写入通道迁移到 workspace.md~~ ✅ 2026-11-02 完成
- ~~Docker / NAS 自托管（后端 + 前端 + 提醒推送）~~ ✅ 2026-11-02 完成
- **v0.4**：Task / Event / Time Block 语义分离 + VTODO（纯截止日期任务）+ AI Command Layer
- **v0.4.5**：数据层 spike（单文件 vs 一任务一文件）→ ADR 后再决定是否迁移
- CalDAV 删除传播（墓碑记录）
- AI 从笔记批量提取事件
- 多 CalDAV 账号支持
- 离线模式增强
- Android 端适配（**架构前提**：md 读写与同步核心需下沉到渲染层或改用 Capacitor 插件，因为移动端没有 Node 后端）

### 架构方向（2026-11-02 评估）

产品定位对齐「Markdown 唯一数据源 + 日历/任务 + AI」；但**不按提案直接重写**：

- 保留 Node/TypeScript（不重写 Python/FastAPI）、保留单个 `workspace.md`（v0.3 内）。
- 先吸收 Task/Event/Time Block、VTODO、AI Command Layer；多文件/SQLite 索引进入 spike。
- 评估与决策：`docs/planning/CHRONOMD_PROPOSAL_REVIEW.md`、`docs/planning/reviews/decision-log.md`（D20–D26）。

## 📄 License

[Add your license here]

## 🤝 Contributing

Contributions welcome! See existing code style and structure.

## 📚 Documentation

**先看 [REF/README.md](REF/README.md)** —— 它标明了哪份文档可信、哪份是历史稿，
避免照着已废弃的架构开工。

- [REF/DATA_SOURCE.md](REF/DATA_SOURCE.md) — 统一数据源：格式、字段、清单/子任务、完整 API（**权威**）
- [REF/MD_ICS_BRIDGE.md](REF/MD_ICS_BRIDGE.md) — 唯一格式转换层 md ↔ ics（**权威**）
- [REF/ARCHITECTURE.md](REF/ARCHITECTURE.md) — 模块化框架 + 数据层 + 遗留文件清单
- [REF/DASHBOARD_DESIGN.md](REF/DASHBOARD_DESIGN.md) — 工作台设计稿（含实现状态对照）
- [docs/SYNC_MANAGEMENT.md](docs/SYNC_MANAGEMENT.md) — WebDAV / CalDAV 两条通道与当前真实行为
- [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) — 提醒字段、应用内提醒、六种手机推送渠道与调度语义
- [docs/TESTING.md](docs/TESTING.md) — 测试清单、实测通过数、环境坑
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 各平台构建与打包
- [docs/CHANGELOG.md](docs/CHANGELOG.md) / [docs/UPDATE_LOG.md](docs/UPDATE_LOG.md) — 版本与迭代记录
- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发约定（含「不要再引入第二个数据文件」等铁律）

## 🤖 AI-Assisted Development

This project was developed with the help of AI coding assistants, demonstrating how modern AI tools can accelerate software development while maintaining high code quality and best practices.

---

**Last Updated**: 2026-11-02

## 📢 Latest Updates

**November 2, 2026（提醒 + 推送 + Docker）**: 新增 `remind` 字段与全局提醒宿主（应用内卡片、
稍后 10 分钟）；服务端新增六种推送渠道（企业微信 / Server酱 / PushPlus / Bark / ntfy / Webhook）
与定时调度；新增 `Dockerfile` / `docker-compose.yml`，一个容器同时提供 API + 前端 + 推送，
数据挂载 `./data`；前端支持运行时配置「后端地址」，可做前端-only 部署。

**November 2, 2026（本地功能加固）**: 任务看板支持点击编辑 / 搜索 / 清单重命名 / 级联删除；
修掉「截止日当天被算逾期」「排期按钮保存失败」「编辑任务被改成事件」「重复事件编辑挪动系列锚点」
等本地 bug；冲突处理统一为三选一（本地 / 远端 / 合并），WebDAV 条目级合并与 CalDAV 字段级合并均已实现。
新增本地日期工具与 9 项回归测试。

**November 2, 2026（CalDAV 通道）**: 新增 `caldav-sync.ts` + `/api/caldav/*`，
日历页三个同步按钮从遗留 `events.md` 切到 `workspace.md`；条目新增 `uid` 字段
（拉取远端 UID 落盘，避免回推时重复建日程）；ETag 增量、字段指纹冲突检测、
自动同步定时器；`project` 改用 `X-WORKBENCH-PROJECT` 保存（不再混进 CATEGORIES 标签）；
新增 21 个 CalDAV 同步测试。

**November 2, 2026**: 清单分组（`list`）与子任务进度（`parent`）落地；ICS 导入导出接入统一数据源；
WebDAV 收拢为单文件同步（并修掉拉取后界面不刷新的判断 bug）；
**文档全量校正** —— `REF/MD_ICS_BRIDGE.md`、`docs/SYNC_MANAGEMENT.md`、`docs/TESTING.md` 重写，
新增 `REF/README.md` 文档索引，界面里所有残留的 `events.md` 文案改正。

**October 26, 2026**: 架构重构为统一数据源 `workspace.md`（单文件条目池），
废弃「双文件 + 双向绑定」；新增 RRULE、schema 校验、容错解析、写入前备份。

**August 19, 2026**: MD↔ICS 转换引擎完成（当时是 events.md 架构，后已被统一数据源取代）。

**June 30, 2026**: 删除流程与同步管理增强，文档合并去重。

**June 25, 2026**: 仓库清理，大体积构建产物移出 Git 历史。


## 🧩 扩展性与通用性

### 配置：界面可改，不必翻文件

所有配置都能在**设置界面**里改（设置 → 通用 / AI 解析 / 同步），保存到项目根目录的
`config.json`（已加入 `.gitignore`，含密钥不入库）。

配置来源优先级：

```
config.json（界面写入） > 环境变量 > 项目 .env > 代码默认值
```

**配置保存在项目根目录的 `config.json`**，重启后自动加载 —— 不用每次重配。
`config.json` 已加入 `.gitignore`（含密钥，不入库），可随时备份或用 git 管理。

敏感字段（API Key / 密码）读取时返回掩码（`sk-****abcd`），
界面原样回传掩码时视为「未修改」，**不会覆盖真实值**。

> 例外：**数据文件路径**（`WORKSPACE_FILE`）以**环境变量优先** ——
> 容器部署时通常用环境变量指定挂载位置。

### 多语言

内置 `zh-CN` / `en-US`，在设置里切换立即生效。
语言包 key 有一致性测试保证（`apps/renderer/src/__tests__/i18n.test.ts`），
少一个 key 就会测试失败 —— 避免界面静默串语言。

### 模块可插拔

新增模块**不需要改核心代码**：

1. 在 `apps/renderer/plugins/` 放 `<id>.json`（声明 id / name / routes / navItems）
2. （可选）放 `<id>.tsx` 组件（default export）
3. 重启应用，模块自动出现在侧边栏

示例见 `apps/renderer/plugins/example.json`。
插件 id 与内置模块冲突时会被跳过（不覆盖内置功能）；
组件文件缺失时退化为占位页面。

> 插件目录必须在 `apps/renderer/` 内 —— 插件是渲染进程的一部分，
> 需要和主应用共享 `node_modules`。
