# Changelog

All notable changes to CalDAV Desktop are documented here.

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