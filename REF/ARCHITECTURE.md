# 积木式模块化架构设计

> ⚠️ **文档与代码的差异说明（2026-11-02 校正）**
>
> 下文「目录结构设计」是原始设计稿，与实际代码有出入。实际情况：
>
> | 设计稿 | 实际 |
> | ------ | ---- |
> | `modules/dashboard/{DashboardModule.tsx, pages/, components/, hooks/}` | 单文件 `modules/dashboard/index.tsx` |
> | `modules/calendar/pages/CalendarPage.tsx` 等分层 | 单文件 `modules/calendar/index.tsx` |
> | `framework/ModuleProvider.tsx` | 并入 `framework/ModuleRegistry.tsx` |
> | `framework/ErrorBoundary.tsx` | 位于 `components/ui/ErrorBoundary.tsx` |
> | `shared/{ui,api,store,hooks,utils,types}` | 平铺为 `api/`、`store/`、`hooks/`、`components/`、`types/` |
> | `modules/{git-sync,ai-agent,notifications}/index.ts` | 三者共用 `modules/placeholder/index.tsx` |
> | `settings` / `roadmap` 独立模块 | 未注册，仍是 `components/settings/SettingsModal.tsx` 与 `features/roadmap/` |
> | 模块各自持有数据（各模块 store 各存一份） | **全部模块读同一个 `workspace.md`**，没有模块级数据副本 |
>
> 框架核心（ModuleRegistry / AppRouter / AppLayout / ModuleSlot）与
> 「active / placeholder」状态机制是**真实可用**的，上表的差异属于组织形式层面，
> 不影响模块注册与路由的工作方式。

## 当前活跃模块（`apps/renderer/src/modules/index.ts`）

| id | 名称 | 状态 | 说明 |
| -- | ---- | ---- | ---- |
| `dashboard` | 工作台 | active | 一次 `fetchItems()` 分拣：有 `start` → 今日日程；`kind=task` → 打勾列表 |
| `tasks` | 任务 | active | 清单切换、子任务进度、加任务、勾选完成 |
| `calendar` | 日历 | active | 只读统一数据源，RRULE 展开渲染 |
| `git-sync` | 多通道同步 | placeholder | WebDAV 通道实际能力在日历页工具栏里 |
| `ai-agent` | AI 助手 | placeholder | 自然语言创建已实现，但入口在日历页顶部 |
| `notifications` | 通知推送 | placeholder | 提醒通知**尚未实现** |

外部插件：`apps/renderer/plugins/<id>.json` + 可选 `<id>.tsx`，
由后端 `GET /api/plugins` 扫描、前端 `loadPluginModules()` 注册。
**目录必须在 `apps/renderer/` 内** —— 插件是渲染进程的一部分，要和主应用共享
`node_modules`（放仓库根目录会 import 不到依赖）。

## 数据层：唯一事实源

模块化解决的是「界面怎么组织」，不解决「数据在哪儿」。
数据层的铁律是 **一个文件**：

```
apps/server/src/
├── workspace.ts      # 唯一数据层：解析 / 序列化 / 校验 / 筛选 / 清单聚合 / 子任务进度
├── recurrence.ts     # RRULE 解析与展开（视图与 ICS 共用）
├── ics-convert.ts    # 唯一的格式转换点（md ↔ ics）
├── config.ts         # 配置优先级：config.json > env > .env > 默认（路径例外，env 优先）
├── caldav-sync.ts    # CalDAV 同步引擎：workspace ↔ ICS ↔ CalDAV（uid / ETag / 冲突 / 自动同步）
├── caldav.ts         # CalDAV 探测与日历列表（tsdav；同步已不再走它）
├── webdav.ts         # WebDAV 通道（直接同步 workspace.md，不做转换）
└── routes/
    ├── workspace.ts  # /api/workspace/*（标准 CRUD + 清单 + ICS 导入导出）
    ├── caldav-sync.ts # /api/caldav/*（status / calendars / sync / test）
    ├── calendar.ts   # /api/calendar/*（CalDAV 探测，遗留）
    ├── webdav.ts / nlp.ts / config.ts / plugins.ts
    └── agenda.ts     # 聚合视图（已废弃，保留未挂载）
```

模块只是这个文件的不同筛选条件：

| 模块 | 请求 |
| ---- | ---- |
| 日历 | `GET /api/workspace/items?scope=calendar&expand=true&start=…&end=…` |
| 任务 | `GET /api/workspace/items?scope=board&topLevel=true&list=…` |
| 工作台 | `GET /api/workspace/items` 一次拿全，前端分拣 |

**不要**在模块里再建一份数据副本、再做一次同步 —— 那是旧架构（双文件 +
双向绑定）的老路，已经拆掉。详见 [DATA_SOURCE.md](DATA_SOURCE.md)。

外部日历（CalDAV）也只是一个**通道**：`caldav-sync.ts` 把条目转成 ICS 推上去，
拉取时按 `uid` 合并回同一条目。它不改变数据归属，也不产生第二份数据。

## 核心理念


本架构采用 **"积木式"微模块架构**，所有功能模块独立开发、独立注册、独立部署（代码分割），通过统一的 Module Registry 进行组装。未开发的模块使用占位组件，不阻塞主框架。

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
│  ┌──────────┐ ┌────────────────┐ ┌─────────────────┐    │
│  │ [GitSync]│ │  [AI Agent]   │ │ [Notifications]  │    │
│  │ (占位)    │ │  (占位)        │ │ (占位)           │    │
│  └──────────┘ └────────────────┘ └─────────────────┘    │
├──────────────────────────────────────────────────────────┤
│                   共享基础设施层                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐│
│  │ UI组件库  │ │ API层     │ │ Store层   │ │  工具库       ││
│  │ (shared) │ │ (api)    │ │ (store)  │ │  (utils)     ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘│
└──────────────────────────────────────────────────────────┘
```

## 目录结构设计

```
apps/renderer/src/
├── framework/                    # 框架核心层
│   ├── ModuleRegistry.tsx        # 模块注册中心
│   ├── ModuleProvider.tsx        # 模块上下文提供者
│   ├── ModuleSlot.tsx            # 模块插槽（占位组件）
│   ├── AppRouter.tsx             # 路由系统
│   ├── AppLayout.tsx             # 布局系统
│   ├── ErrorBoundary.tsx         # 全局错误边界
│   └── types.ts                  # 模块接口定义
├── modules/                      # 积木模块目录
│   ├── dashboard/                # 工作台模块（主入口）
│   │   ├── index.ts              # 模块注册信息
│   │   ├── DashboardModule.tsx   # 模块根组件
│   │   ├── pages/
│   │   │   └── DashboardPage.tsx # 工作台页面
│   │   ├── components/
│   │   │   ├── WelcomeCard.tsx
│   │   │   ├── QuickActions.tsx
│   │   │   ├── ModuleGrid.tsx
│   │   │   └── SyncStatusCard.tsx
│   │   └── hooks/
│   │       └── useDashboard.ts
│   ├── calendar/                 # 日历模块
│   │   ├── index.ts
│   │   ├── CalendarModule.tsx
│   │   ├── pages/
│   │   │   └── CalendarPage.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── store/
│   ├── git-sync/                 # [占位] 多通道同步模块
│   │   └── index.ts
│   ├── ai-agent/                 # [占位] AI 智能助手模块
│   │   └── index.ts
│   ├── notifications/            # [占位] 通知推送模块
│   │   └── index.ts
│   ├── settings/                 # 设置模块
│   │   └── ...
│   └── roadmap/                  # 路线图模块
│       └── ...
├── shared/                       # 共享层
│   ├── ui/                       # 通用 UI 组件
│   ├── api/                      # API 层
│   ├── store/                    # 全局 Store
│   ├── hooks/                    # 通用 Hooks
│   ├── utils/                    # 工具函数
│   └── types/                    # 通用类型
├── App.tsx
└── main.tsx
```

## 模块接口定义

```typescript
// framework/types.ts

export type ModuleStatus = "active" | "placeholder";

export interface RouteConfig {
  path: string;
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  title?: string;
  icon?: React.ReactNode;
  showInNav?: boolean;
}

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  status?: ModuleStatus;
}

export interface CalendarModule {
  id: string; // 唯一标识，如 'dashboard', 'calendar'
  name: string; // 显示名称
  version: string; // 版本号
  description: string; // 模块描述
  icon: React.ReactNode; // 图标
  status: ModuleStatus; // 开发状态
  order?: number; // 排序权重

  // active 状态时使用
  component?: React.LazyExoticComponent<React.ComponentType<any>>;

  // placeholder 状态时使用
  placeholder?: {
    title: string;
    description: string;
    plannedVersion: string; // 计划版本
    eta?: string; // 预计完成时间
  };

  // 路由配置
  routes: RouteConfig[];

  // 导航配置
  navItems: NavItem[];

  // 初始化函数（可选）
  onInit?: () => void | Promise<void>;
}
```

## 模块注册机制

每个模块通过 `index.ts` 导出注册信息：

```typescript
// modules/calendar/index.ts
import { Calendar, LayoutGrid, type LucideIcon } from "lucide-react";
import type { CalendarModule } from "../../framework/types";

const calendarModule: CalendarModule = {
  id: "calendar",
  name: "日历",
  version: "0.1.0",
  description: "CalDAV 日历视图与事件管理",
  icon: Calendar,
  status: "active",
  order: 1,
  component: React.lazy(() => import("./CalendarModule")),
  routes: [
    {
      path: "/calendar",
      component: React.lazy(() => import("./pages/CalendarPage")),
      title: "日历",
      icon: Calendar,
      showInNav: true,
    },
  ],
  navItems: [
    { id: "calendar", label: "日历", icon: Calendar, path: "/calendar" },
  ],
};

export default calendarModule;
```

占位模块示例：

```typescript
// modules/git-sync/index.ts
import { GitBranch } from "lucide-react";
import type { CalendarModule } from "../../framework/types";

const gitSyncModule: CalendarModule = {
  id: "git-sync",
  name: "多通道同步",
  version: "0.0.0",
  description: "WebDAV + Git 双通道同步日历数据，支持自建服务器与 GitHub",
  icon: GitBranch,
  status: "placeholder",
  order: 2,
  placeholder: {
    title: "多通道同步",
    description:
      "WebDAV 同步主通道 + Git 仓库备份/同步副通道。Git 通道可白嫖 GitHub 私有仓库作为备份，实现跨设备配置同步。",
    plannedVersion: "2.0.0",
    eta: "TBD",
  },
  routes: [],
  navItems: [
    {
      id: "git-sync",
      label: "多通道同步",
      icon: GitBranch,
      path: "/git-sync",
      status: "placeholder",
    },
  ],
};

export default gitSyncModule;
```

## 工作台页面设计 (Dashboard)

工作台是用户登录后的首页，整合各模块的概览信息：

```
┌──────────────────────────────────────────────────────┐
│  🔍 [搜索框]                              [用户头像]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─── 欢迎回来 ──────────────────────────────────┐   │
│  │  今天有 5 个事件  |  上次同步: 2分钟前         │   │
│  │  [查看日历]  [手动同步]  [添加事件]             │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌─── 今日日程 ────────────┐ ┌─── 快速操作 ───────┐  │
│  │ 09:00 团队站会          │ │ [📅 新建事件]       │  │
│  │ 10:30 客户会议          │ │ [⚙️ 设置]          │  │
│  │ 14:00 项目评审          │ │                      │  │
│  │                        │ │                      │  │
│  └────────────────────────┘ └────────────────────┘  │
│                                                      │
│  ┌─── 模块快速入口 ───────────────────────────────┐  │
│  │ [📅 日历] [🔄 多通道同步(占位)] [🔔 通知(占位)] │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌─── 同步状态 ──────────────────────────────────┐   │
│  │ 状态: ✅ 已同步  |  上次同步: 2分钟前          │   │
│  │ [⚡ 立即同步]  [⏰ 每5分钟]                    │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## 开发阶段规划

### Phase 1: 框架搭建 ✅

- [x] 创建 framework/ 核心框架
- [x] 实现 ModuleRegistry
- [x] 实现 ModuleSlot 占位系统
- [x] 实现 AppRouter 路由系统（hash 路由，无 react-router 依赖）
- [x] 实现 AppLayout 布局系统

### Phase 2: 模块化改造

- [x] calendar 模块（`modules/calendar`，active）
- [x] tasks 任务看板模块（`modules/tasks`，active）
- [x] dashboard 工作台模块（`modules/dashboard`，active）
- [ ] sync 模块（当前同步能力在日历模块工具栏内，未独立成模块）
- [ ] settings 模块（仍是 `components/settings/SettingsModal.tsx`）
- [ ] roadmap 模块（`features/roadmap/FeatureRoadmap.tsx` 未注册到 registry）

### Phase 3: 工作台页面 ✅

- [x] 创建 Dashboard 模块
- [x] 实现欢迎卡片
- [x] 实现今日事件概览（2026-10-26 起改为读统一数据源 `workspace.md`）
- [x] 实现今日待办概览
- [x] 实现系统状态卡片
- [x] 实现同步状态详情

### Phase 4: 占位模块

- [x] git-sync / ai-agent / notifications 三个模块已注册（status=placeholder，共用通用占位页）
- [ ] 各模块的实际功能

### Phase 5: 清理与优化

- [x] 旧 `AppShell` 保留为回退路径（`App.tsx` 的 `useModularUI` 开关，当前为 `true`）
- [x] 主题系统回写修复（`theme/ThemeApplier.tsx` + `index.css` 的 `@theme inline`）
- [x] 缺失的 `styles/touch-optimized.css` / `styles/responsive.css` 补齐
- [x] ~~数据层统一到 workspace.md~~（2026-10-26 完成，见 DATA_SOURCE.md）
- [x] 遗留路由与前端 `api/md-bridge.ts`、`api/kanban.ts` 下线（v0.3 P3 完成）
- [ ] `AppShell`（老 `AppShell`）与相关 props 清理（模块化 UI 已默认启用，旧分支为死代码）
- [ ] `routes/agenda.ts` 聚合视图已废弃，未挂载，可直接删除
- [ ] 代码分割粒度优化（主 chunk 541KB，可进一步拆分）

---

**Last Updated**: 2026-11-03（P3：删除 md-bridge/kanban 路由与前端 api 模块，数据层只留 workspace.md）
**Related**: [DATA_SOURCE.md](DATA_SOURCE.md)、[MD_ICS_BRIDGE.md](MD_ICS_BRIDGE.md)、[README.md](README.md)
