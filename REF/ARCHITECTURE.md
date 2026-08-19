# 积木式模块化架构设计

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
- [x] 实现 AppRouter 路由系统
- [x] 实现 AppLayout 布局系统

### Phase 2: 模块化改造

- [ ] 重构 calendar 为独立模块
- [ ] 重构 sync 为独立模块
- [ ] 重构 settings 为独立模块
- [ ] 重构 roadmap 为独立模块

### Phase 3: 工作台页面 ✅

- [x] 创建 Dashboard 模块
- [x] 实现欢迎卡片
- [x] 实现今日日程概览
- [x] 实现快速操作区
- [x] 实现模块快速入口网格
- [x] 实现同步状态卡片

### Phase 4: 占位模块创建

- [ ] git-sync 占位模块（WebDAV + Git 双通道同步）
- [ ] ai-agent 占位模块（AI 驱动的笔记→日历工作流）
- [ ] notifications 占位模块（多渠道推送通知）

### Phase 5: 清理与优化

- [ ] 删除旧目录结构
- [ ] 更新导入路径
- [ ] 代码分割验证
- [ ] 性能测试
