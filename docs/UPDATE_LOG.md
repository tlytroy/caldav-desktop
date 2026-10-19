# 更新日志 (Update Log)

这个文件记录了项目的持续更新和改进。每次更新都应该在这个文件中添加相关信息，而不是创建新的更新日志文件。

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
