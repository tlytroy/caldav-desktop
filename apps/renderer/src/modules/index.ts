import React from "react";
import { Calendar, GitBranch, Bell, BrainCircuit, ListTodo } from "lucide-react";
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
  description: "CalDAV 日历事件管理，支持多日历、事件 CRUD、同步",
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

// ---- Tasks - 任务看板模块（活跃，工作搭子集成） ----
const TasksModule: CalendarModule = {
  id: "tasks",
  name: "任务",
  version: "1.0.0",
  description: "工作搭子任务看板：添加/勾选任务，并与日历双向集成",
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

// ---- GitSync - 多通道同步模块（占位） ----
const GitSyncModule: CalendarModule = {
  id: "git-sync",
  name: "多通道同步",
  version: "0.0.0",
  description: "WebDAV + Git 双通道同步日历数据，支持自建服务器与 GitHub",
  icon: React.createElement(GitBranch, { className: "w-5 h-5" }),
  status: "placeholder",
  order: 3,
  placeholder: {
    title: "多通道同步",
    description:
      "WebDAV 同步主通道 + Git 仓库备份/同步副通道。Git 通道可白嫖 GitHub 私有仓库作为备份，实现跨设备配置同步。",
    plannedVersion: "2.0.0",
    eta: "TBD",
  },
  routes: [
    {
      path: "/git-sync",
      component: React.lazy(() => import("./placeholder")),
      title: "多通道同步",
      showInNav: true,
    },
  ],
  navItems: [
    {
      id: "nav-git-sync",
      label: "多通道同步",
      icon: React.createElement(GitBranch, { className: "w-5 h-5" }),
      path: "/git-sync",
      status: "placeholder",
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

// ---- Notifications - 多渠道通知模块（占位） ----
const NotificationsModule: CalendarModule = {
  id: "notifications",
  name: "通知推送",
  version: "0.0.0",
  description: "日历事件提醒，支持企业微信、邮箱、Server酱等多渠道推送",
  icon: React.createElement(Bell, { className: "w-5 h-5" }),
  status: "placeholder",
  order: 5,
  placeholder: {
    title: "通知推送",
    description:
      "事件提醒与推送通知。支持企业微信机器人、邮箱、Server酱、PushPlus、Bark 等常用推送渠道。可自定义提醒规则。",
    plannedVersion: "2.2.0",
    eta: "TBD",
  },
  routes: [
    {
      path: "/notifications",
      component: React.lazy(() => import("./placeholder")),
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
      status: "placeholder",
    },
  ],
};

// ---- 全部模块列表 ----
export const builtinModules: CalendarModule[] = [
  DashboardModule,
  TasksModule,
  CalendarModule,
  GitSyncModule,
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
