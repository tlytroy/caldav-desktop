import React from "react";
import { Calendar, Cloud, Bell, BrainCircuit, ListTodo } from "lucide-react";
import type { CalendarModule } from "../framework";

/**
 * ========================================
 * 模块注册表
 * ========================================
 *
 * 所有模块在此集中注册，通过 ModuleProvider 注入到应用中。
 *
 * 模块 status 字段:
 * - "active": 已实现，可交互
 * - "placeholder": 尚未实现，显示占位提示
 *
 * 开发新模块流程:
 * 1. 在 src/modules/<module-name>/ 下创建模块组件
 * 2. 在此文件中注册模块
 * 3. 设置 status: "placeholder" 可先占位
 * 4. 实现完成后改为 status: "active"
 */

// ---- Dashboard - 工作台首页（始终活跃） ----
const DashboardModule: CalendarModule = {
  id: "dashboard",
  name: "工作台",
  version: "1.0.0",
  description: "CalDAV Desktop 首页，展示所有模块状态概览",
  icon: React.createElement(Calendar, { className: "w-5 h-5" }),
  status: "active",
  order: 0,
  routes: [
    {
      path: "/dashboard",
      component: React.lazy(() => import("./dashboard")),
      title: "工作台",
      showInNav: true,
    },
  ],
  navItems: [
    {
      id: "nav-dashboard",
      label: "工作台",
      icon: React.createElement(Calendar, { className: "w-5 h-5" }),
      path: "/dashboard",
    },
  ],
};

// ---- Calendar - 日历模块（活跃） ----
const CalendarModule: CalendarModule = {
  id: "calendar",
  name: "日历",
  version: "1.0.0",
  description: "统一数据源的日历视图：多日历渲染、事件 CRUD、RRULE 展开",
  icon: React.createElement(Calendar, { className: "w-5 h-5" }),
  status: "active",
  order: 2,
  routes: [
    {
      path: "/calendar",
      component: React.lazy(() => import("./calendar")),
      title: "日历",
      showInNav: true,
    },
  ],
  navItems: [
    {
      id: "nav-calendar",
      label: "日历",
      icon: React.createElement(Calendar, { className: "w-5 h-5" }),
      path: "/calendar",
    },
  ],
};

// ---- Tasks - 任务看板模块（活跃） ----
const TasksModule: CalendarModule = {
  id: "tasks",
  name: "任务",
  version: "1.0.0",
  description: "统一数据源的看板视图：清单分组、子任务进度、勾选完成",
  icon: React.createElement(ListTodo, { className: "w-5 h-5" }),
  status: "active",
  order: 1,
  routes: [
    {
      path: "/tasks",
      component: React.lazy(() => import("./tasks")),
      title: "任务",
      showInNav: true,
    },
  ],
  navItems: [
    {
      id: "nav-tasks",
      label: "任务",
      icon: React.createElement(ListTodo, { className: "w-5 h-5" }),
      path: "/tasks",
    },
  ],
};

// ---- Sync - 同步中心（只读概览） ----
// 只读本地快照，不联网；未配置同步也能正常用。
const SyncModule: CalendarModule = {
  id: "sync",
  name: "同步中心",
  version: "0.1.0",
  description: "CalDAV / WebDAV 同步状态、最近事件与冲突（只读，不阻塞本地使用）",
  icon: React.createElement(Cloud, { className: "w-5 h-5" }),
  status: "active",
  order: 3,
  routes: [
    {
      path: "/sync",
      component: React.lazy(() => import("./sync")),
      title: "同步中心",
      showInNav: true,
    },
  ],
  navItems: [
    {
      id: "nav-sync",
      label: "同步中心",
      icon: React.createElement(Cloud, { className: "w-5 h-5" }),
      path: "/sync",
    },
  ],
};

// ---- AI Agent - AI 智能助手模块（占位） ----
const AIAgentModule: CalendarModule = {
  id: "ai-agent",
  name: "AI 助手",
  version: "0.0.0",
  description: "接入 AI API，自动从 Obsidian 笔记提取事件，生成日历任务",
  icon: React.createElement(BrainCircuit, { className: "w-5 h-5" }),
  status: "placeholder",
  order: 4,
  placeholder: {
    title: "AI 智能助手",
    description:
      "接入兼容 OpenAI 格式的 AI API（如 DeepSeek、通义千问等），自动监控 Obsidian 会议纪要文件夹，通过 AI 提取笔记中的日期/事件信息，生成 ICS 日历事件并推送到 CalDAV。支持自定义 Prompt 和监控目录。",
    plannedVersion: "2.1.0",
    eta: "TBD",
  },
  routes: [
    {
      path: "/ai-agent",
      component: React.lazy(() => import("./placeholder")),
      title: "AI 助手",
      showInNav: true,
    },
  ],
  navItems: [
    {
      id: "nav-ai-agent",
      label: "AI 助手",
      icon: React.createElement(BrainCircuit, { className: "w-5 h-5" }),
      path: "/ai-agent",
      status: "placeholder",
    },
  ],
};

// ---- Notifications - 本地提醒模块（活跃） ----
// 不依赖服务器：到点弹应用内卡片，可选桌面通知。
const NotificationsModule: CalendarModule = {
  id: "notifications",
  name: "通知推送",
  version: "0.1.0",
  description: "本地提醒：到点弹卡片、稍后 10 分钟、可选桌面通知",
  icon: React.createElement(Bell, { className: "w-5 h-5" }),
  status: "active",
  order: 5,
  routes: [
    {
      path: "/notifications",
      component: React.lazy(() => import("./notifications")),
      title: "通知推送",
      showInNav: true,
    },
  ],
  navItems: [
    {
      id: "nav-notifications",
      label: "通知推送",
      icon: React.createElement(Bell, { className: "w-5 h-5" }),
      path: "/notifications",
    },
  ],
};

// ---- 全部模块列表 ----
export const builtinModules: CalendarModule[] = [
  DashboardModule,
  TasksModule,
  CalendarModule,
  SyncModule,
  AIAgentModule,
  NotificationsModule,
];

/**
 * 加载外部插件模块。
 *
 * 插件来自项目根目录的 `plugins/` 目录（由后端 `GET /api/plugins` 扫描）。
 * 这样新增模块**不需要修改本文件**——放个 json + 可选 tsx 即可。
 *
 * @param componentLoader 组件加载器（通常用 import.meta.glob 传入）
 */
export async function loadPluginModules(
  componentLoader?: (
    name: string,
  ) => React.LazyExoticComponent<React.ComponentType<any>> | undefined,
): Promise<CalendarModule[]> {
  const { fetchPluginManifests, manifestToModule, validateManifest, createComponentLoader } =
    await import("../framework/plugins");

  const manifests = await fetchPluginManifests();
  const out: CalendarModule[] = [];

  // 组件加载器：优先用调用方传入的，否则用内置的 glob 扫描
  const loader = componentLoader || createComponentLoader;

  for (const m of manifests) {
    const err = validateManifest(m);
    if (err) {
      console.warn(`[plugin] 跳过插件 ${m?.id || "(未知)"}：${err}`);
      continue;
    }
    try {
      out.push(manifestToModule(m, loader));
    } catch (e) {
      console.warn(`[plugin] 插件 ${m.id} 加载失败：`, (e as Error).message);
    }
  }

  if (out.length) {
    console.log(`[plugin] 已加载 ${out.length} 个外部插件：`, out.map((m) => m.id).join(", "));
  }
  return out;
}
