# CalDAV Desktop - Cross-Platform Calendar Application

A cross-platform desktop calendar application with full CalDAV support and modern UI design.

Built with the help of AI assistance, this project addresses the lack of standalone CalDAV calendar applications on Windows, providing a lightweight alternative to email clients that bundle calendar functionality.

![Version](https://img.shields.io/badge/version-0.1.0-blue) ![Status](https://img.shields.io/badge/status-production%20ready-green)

## ✨ Features

- **CalDAV Sync**: Full synchronization with Radicale servers (RFC 5545 compliant)
- **Smart Sync Management**:
  - Configurable sync intervals (5/10/30 minutes or manual)
  - Local caching for improved performance
  - Manual sync button for immediate updates
  - Sync status visualization in bottom status bar
  - Immediate frontend feedback with background synchronization
- **iCalendar 文件导入 / 导出**:
  - 导入任意 `.ics`（Google / Outlook / Apple 导出）到 events.md，支持先预览再确认
  - 按 uid 去重，重复导入不会产生重复事件
  - 可选择追加（append）或替换（replace）两种模式
  - 导出 events.md 为单个 `.ics` 文件，可按日期范围过滤
- **Event Management**: Create, edit, delete events with full CRUD operations
  - Enhanced delete functionality with robust error handling
  - Graceful handling of network issues and server errors
- **Advanced Features**:
  - Event categories for organization
  - Multi-tag support for flexible grouping
  - Recurring events (daily, weekly, monthly, yearly)
  - All-day events
- **Modern Design**:
  - 4 Morandi color schemes + custom colors
  - Unified rounded corner design system
  - Full dark mode support
  - Responsive layout
- **Cross-Platform**: Linux, Windows, macOS (packaged as Electron app), Android (Capacitor)
- **Workbench Integration (双向绑定)**: 任务看板与日历事件通过 `events.md` 单一事实源互链，可双向一键创建、级联删除、解绑保留；ICS 仅作非实时同步通道（延时自动 + 手动同步）

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

Create `.env` file in project root:

```
RADICALE_URL=https://your-radicale-server.com
RADICALE_USERNAME=your_username
RADICALE_PASSWORD=your_password

# MD↔ICS 桥接（events.md 单一事实源；设为 true 开启）
MD_ICS_ENABLED=true
MD_EVENTS_FILE=./events.md
MD_ICS_SYNC_DIRECTION=bidirectional   # push | pull | bidirectional
MD_ICS_AUTO_SYNC_MINUTES=0             # >0 启用延时自动同步（非实时）
KANBAN_FILE_PATH=./工作搭子看板.md      # 工作台任务看板文件路径
```

## 🔗 工作台集成（events.md 单一事实源）

工作台「任务看板」与日历共享同一个 `events.md` 作为唯一事实源（设计见 `REF/MD_ICS_BRIDGE.md`）：

- 在任务看板加任务时可勾选「同时加入日历」并填日期/时间；在日历加事件时可勾选「同时加入任务看板」。
- 两端通过 `日历:<uid>`（看板任务行）/ `kanbanTaskId`（events.md 事件）互链，删除时可级联或仅解绑。
- ICS 不是首屏数据源，只是同步通道：通过延时自动同步（`MD_ICS_AUTO_SYNC_MINUTES`）或 UI 的「推送/拉取/双向同步」按钮进行非实时同步；拉取时保留本地绑定，不会打掉双向关联。

## 📦 Builds

Pre-built packages available in `apps/desktop/dist-electron/`:

- Linux: `CalDAV-Desktop-0.1.0-linux.AppImage` (~100MB)
- Linux: `CalDAV-Desktop-0.1.0-linux.tar.gz` (~95MB)
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
cd apps/server && pnpm test
```

### Test Coverage

Current automated tests (`apps/server/src/__tests__/`):

| Test file | What it locks down |
| --------- | ------------------ |
| `ics-file.test.ts` | 多事件 `.ics` 解析、全天事件 DTEND 排他、本地日历日不跨时区、导出→导入往返一致、异常输入不崩 |
| `kanban-id.test.ts` | 任务 id 持久化、**新增任务不导致存量 id 行序漂移**、旧格式文件兼容、项目/速记往返 |

Tests that require a live CalDAV server (`caldav.test.ts`, `e2e-bridge.test.ts`, `e2e-full.test.ts`) need `CALDAV_URL` / `CALDAV_USER` / `CALDAV_PASS` configured in `.env`; they are not part of the offline suite.

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

### Current Architecture (v0.1.0)

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
│   │   └── src/
│   │       ├── framework/ # 框架核心 (ModuleRegistry, AppRouter, etc.)
│   │       ├── modules/   # 积木模块 (calendar, dashboard, sync, etc.)
│   │       └── shared/    # 共享层 (UI, API, Store, Utils)
│   └── server/           # Node.js backend
├── docs/                 # Documentation
├── REF/                  # 设计参考文档
│   ├── ARCHITECTURE.md   # 积木式模块化架构设计
│   ├── DASHBOARD_DESIGN.md # 工作台页面设计
│   ├── MD_ICS_BRIDGE.md  # MD↔ICS 中转方案设计
│   └── work-dazi-toolkit/ # 工作搭子工具箱参考实现
└── pnpm-workspace.yaml
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
- **Phase 3: MD 文件层**
  - [x] events.md 读写（YAML frontmatter）
  - [x] 工作搭子看板.md 读写（待办 / 项目 / 速记）
  - [x] iCalendar 文件导入（多事件、dryRun 预览、按 uid 去重）
  - [x] iCalendar 文件导出（单文件 VCALENDAR、可按日期范围过滤）
  - [ ] WebDAV 通道（`.env` 里已预留 `WEBDAV_*` 变量，**代码尚未实现**）
- **Phase 4: CalDAV 同步**
  - [x] MD → ICS 转换
  - [x] push / pull / 双向同步，pull 保留本地 `kanbanTaskId`
  - [x] 延时自动同步（`MD_ICS_AUTO_SYNC_MINUTES`）
  - [x] 同步方向枚举归一化（`md-to-caldav` / `push` 等表述统一）
  - [~] 增量同步：目前按全量 events 遍历，未做 `updated` 级增量
  - [~] 冲突检测：仅基于 `updated` 时间戳的基础版
- **Phase 5: 双向绑定**
  - [x] 任务 ↔ 事件互链（看板 `日历:<uid>` ↔ events.md `kanbanTaskId`）
  - [x] 级联删除 / 解绑保留
  - [x] `X-KANBAN-TASK-ID` 扩展属性保证同步往返不丢关联
- **Phase 6: 占位模块**
  - [ ] git-sync 占位模块（模块已注册，路由到通用占位页）
  - [ ] ai-agent 占位模块（`.env` 里 `AI_*` 全是死配置，无代码读取）
  - [ ] notifications 占位模块

### v0.3.0+ (规划中)

- 自然语言快速创建事件（类 Fantastical 交互）
- AI 从笔记提取事件
- 多 CalDAV 账号支持
- 离线模式增强
- Android 端适配（**架构前提**：md 读写与同步核心需下沉到渲染层或改用 Capacitor 插件，因为移动端没有 Node 后端）

## 📄 License

[Add your license here]

## 🤝 Contributing

Contributions welcome! See existing code style and structure.

## 📚 Documentation

- README.md - Project overview and quick start
- docs/TESTING.md - Comprehensive test plan and results
- docs/DEPLOYMENT.md - Build and packaging guide for all platforms
- docs/CHANGELOG.md - Version history and feature updates
- docs/UPDATE_LOG.md - Continuous update log with detailed changes
- docs/SYNC_MANAGEMENT.md - Sync management and caching guide

## 🤖 AI-Assisted Development

This project was developed with the help of AI coding assistants, demonstrating how modern AI tools can accelerate software development while maintaining high code quality and best practices.

---

**Last Updated**: 2026-08-19

## 📢 Latest Updates

**August 19, 2026**: MD↔ICS Bridge engine complete — 28/28 end-to-end tests passing. Fixed STATUS mapping (needs-action → NEEDS-ACTION), proxy layer removed in favor of direct HTTPS fetch, CALDAV_ROOT_URL env var for tsdav discovery. All sync operations (push/pull/delete/batch) verified against Radicale production server.

**August 18, 2026**: Architecture redesign with 积木式模块化架构. Created design documents for Dashboard, MD↔ICS Bridge, and introduced work-dazi-toolkit reference implementation. Updated development roadmap for v0.2.0.

**June 30, 2026**: Enhanced delete functionality and sync management with improved error handling and user feedback. Documentation consolidated and redundant files removed.

**June 25, 2026**: Repository cleaned and optimized - large build artifacts removed from Git history for better performance and reduced clone times. All documentation updated to reflect latest changes.
