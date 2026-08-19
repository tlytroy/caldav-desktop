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
- **Cross-Platform**: Linux, Windows, macOS (packaged as Electron app)

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
```

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

### Automated API Tests

```bash
./run-tests.sh
```

This script runs 9 comprehensive tests covering all backend functionality.

**Test Results: 9/9 PASSING (100%)**

### Manual Frontend Tests

Start the dev servers first:

```bash
cd apps/server && pnpm dev      # Terminal 1
cd apps/renderer && pnpm dev    # Terminal 2
```

Then visit http://localhost:5173/ in your browser.

## Test Coverage

### Backend API Tests (9/9 Passing)

1. List calendars from Radicale server
2. Fetch events from calendar
3. Create new event
4. Update existing event
5. Delete event
6. Handle event categories
7. Process event tags
8. Manage recurring events
9. Support all-day events

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

### v0.2.0 — 积木式模块化重构

- [ ] **Phase 1: 框架搭建**
  - [ ] 创建 framework/ 核心框架 (ModuleRegistry, ModuleSlot, AppRouter)
  - [ ] 实现占位模块系统
  - [ ] 实现工作台 Dashboard 页面
- [ ] **Phase 2: 模块化改造**
  - [ ] 重构 calendar 为独立模块
  - [ ] 重构 sync 为独立模块 (双通道: CalDAV + WebDAV)
  - [ ] 重构 settings 为独立模块
  - [ ] 重构 roadmap 为独立模块
- [ ] **Phase 3: WebDAV 同步 + MD 文件管理**
  - [ ] 实现 WebDAV 客户端 (MD 文件层同步)
  - [ ] 实现本地 MD 文件存储/读取服务
  - [ ] 实现同步控制器 (SyncController: 自动/手动/变化监听)
  - [ ] 实现一键同步按钮 (转换 + 双通道推送)
  - [ ] 实现可配置同步间隔 (5/10/30分钟/手动)
- [ ] **Phase 4: MD ↔ ICS 中转系统**
  - [ ] 实现 Markdown 解析器 (frontmatter + 内容)
  - [ ] 实现 MD → ICS 转换器
  - [ ] 实现 ICS → MD 反向转换器
  - [ ] 实现 CalDAV 同步桥接 (通道 A)
- [ ] **Phase 5: 占位模块**
  - [ ] todos 占位模块
  - [ ] contacts 占位模块
  - [ ] notes 占位模块
  - [ ] analytics 占位模块
- [ ] **Phase 6: work-dazi 桥接**
  - [ ] 看板 ↔ 日程双向同步
  - [ ] AI Agent 写入能力集成

### v0.3.0+ (规划中)

- Windows/macOS packaging improvements
- Advanced filtering & event search
- Offline mode enhancements
- Multiple CalDAV account support
- Meeting invitations
- Complex timezone handling

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
