/**
 * 模块插件机制
 *
 * 目标：**新增模块不需要修改核心代码**。
 *
 * 工作方式：
 *   1. 在 `plugins/` 目录下放一个 `<id>.json` 描述文件
 *   2. （可选）在 `plugins/<id>.tsx` 放同名的 React 组件
 *   3. 启动时扫描 plugins/，自动注册到 ModuleRegistry
 *
 * 描述文件示例（plugins/notes.json）：
 * ```json
 * {
 *   "id": "notes",
 *   "name": "速记",
 *   "version": "1.0.0",
 *   "description": "随手记",
 *   "icon": "file-text",
 *   "status": "active",
 *   "order": 50,
 *   "component": "notes",
 *   "routes": [{ "path": "/notes", "title": "速记", "showInNav": true }],
 *   "navItems": [{ "id": "notes", "label": "速记", "icon": "file-text", "path": "/notes" }]
 * }
 * ```
 *
 * 为什么用 JSON + 同名 tsx 而不是纯 JSON：
 *   纯 JSON 无法表达 React 组件；用「同名约定」让描述与实现分离，
 *   同时避免引入动态 require（Vite 下不可靠）。
 *
 * @see REF/PLUGIN_SYSTEM.md
 */

import React from "react";
import type { CalendarModule, RouteConfig, NavItem } from "./types";

/** 插件描述文件（对应 JSON） */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** 图标名（lucide-react 的 kebab-case 名，或自定义 SVG path） */
  icon?: string;
  status: "active" | "placeholder";
  order?: number;
  /** 组件文件名（相对 plugins/ 目录，不含扩展名）；缺省则用占位组件 */
  component?: string;
  routes?: Array<{
    path: string;
    title?: string;
    icon?: string;
    showInNav?: boolean;
  }>;
  navItems?: Array<{
    id: string;
    label: string;
    icon?: string;
    path: string;
    status?: "active" | "placeholder";
  }>;
  placeholder?: {
    title?: string;
    description?: string;
    plannedVersion?: string;
    eta?: string;
  };
}

/** 已知图标名 → lucide-react 组件 */
const ICON_MAP: Record<string, React.ComponentType<any>> = {};
/** 已加载的插件组件： filename → 组件 */
const pluginComponents = new Map<string, React.LazyExoticComponent<React.ComponentType<any>>>();

/**
 * 注册图标。
 * 由 main.tsx 在启动时把 lucide 图标批量塞进来（避免运行时动态 import）。
 */
export function registerIcons(icons: Record<string, React.ComponentType<any>>) {
  Object.assign(ICON_MAP, icons);
}

/** 解析图标：找不到时返回一个通用占位图标 */
export function resolveIcon(name?: string): React.ReactNode {
  if (!name) return null;
  const Cmp = ICON_MAP[name] || ICON_MAP[name.toLowerCase()];
  if (!Cmp) {
    // 找不到就返回一个简单的圆点，不至于渲染空白
    return React.createElement("span", {
      className: "inline-block w-4 h-4 rounded bg-current opacity-40",
    });
  }
  return React.createElement(Cmp, { className: "w-4 h-4" });
}

/** 注册插件组件（由 main.tsx 的 import.meta.glob 批量导入后调用） */
export function registerPluginComponent(
  filename: string,
  component: React.LazyExoticComponent<React.ComponentType<any>>,
) {
  pluginComponents.set(filename, component);
}

/**
 * 校验 manifest，返回错误信息或 null。
 * 插件是外部文件，字段可能写错 —— 要给出可读的错误而不是崩溃。
 */
export function validateManifest(m: unknown): string | null {
  if (!m || typeof m !== "object") return "不是对象";
  const obj = m as any;
  if (!obj.id || typeof obj.id !== "string") return "缺少 id";
  if (!/^[a-z][a-z0-9-]*$/.test(obj.id)) {
    return "id 只能包含小写字母、数字和连字符，且以字母开头";
  }
  if (!obj.name || typeof obj.name !== "string") return "缺少 name";
  if (obj.status !== "active" && obj.status !== "placeholder") {
    return "status 必须是 active 或 placeholder";
  }
  if (obj.routes && !Array.isArray(obj.routes)) return "routes 必须是数组";
  if (obj.navItems && !Array.isArray(obj.navItems)) return "navItems 必须是数组";
  for (const r of obj.routes || []) {
    if (!r.path || typeof r.path !== "string") return "route 缺少 path";
    if (!r.path.startsWith("/")) return `route path 必须以 / 开头：${r.path}`;
  }
  return null;
}

/**
 * 组件加载器：用 Vite 的 import.meta.glob 扫描 plugins/ 目录。
 *
 * ⚠️ 路径：src/framework/ → src/ → renderer/plugins/
 *    即 `../../plugins/*`（上溯 2 级到 renderer，再进 plugins）。
 *
 *    为什么插件目录必须在 apps/renderer 内：插件是渲染进程的一部分，
 *    需要和主应用共享 node_modules（axios、react 等依赖）。
 *    放在项目根会导致 "Rollup failed to resolve import 'axios'"。
 *
 *    写错路径时 glob 匹配不到，构建**仍然成功**（很容易漏掉），
 *    所以下面有 pluginGlobMatchCount() 供启动时诊断。
 */
const pluginModules = import.meta.glob("../../plugins/*.{tsx,jsx}", {
  eager: false,
}) as Record<string, () => Promise<any>>;

/** 供诊断用：启动时打印实际匹配到的插件组件数量 */
export function pluginGlobMatchCount(): number {
  return Object.keys(pluginModules).length;
}

/**
 * 创建组件加载器。
 * @param name manifest 的 component 字段（文件名，不含扩展名）
 */
export function createComponentLoader(
  name: string,
): React.LazyExoticComponent<React.ComponentType<any>> | undefined {
  const target = `../../plugins/${name}.tsx`;
  const loader =
    pluginModules[target] || pluginModules[`../../plugins/${name}.jsx`];
  if (!loader) return undefined;
  return React.lazy(() =>
    loader().then((m) => ({ default: m.default as React.ComponentType<any> })),
  );
}

/**
 * 组件加载器：把 manifest 的 component 字段解析成 React 组件。
 * 返回 undefined 表示组件文件不存在 —— 此时该模块退化为占位页面。
 */
export type PluginComponentLoader = (
  name: string,
) => React.LazyExoticComponent<React.ComponentType<any>> | undefined;

/**
 * 把 manifest 转换成 CalendarModule。
 * @param manifest 插件描述
 * @param componentLoader 组件加载器（由调用方提供，通常用 import.meta.glob）
 */
export function manifestToModule(
  manifest: PluginManifest,
  componentLoader?: PluginComponentLoader,
): CalendarModule {
  const routes: RouteConfig[] = (manifest.routes || []).map((r) => {
    const Comp =
      (componentLoader && manifest.component && componentLoader(manifest.component)) ||
      (manifest.component ? pluginComponents.get(manifest.component) : undefined) ||
      React.lazy(() =>
        import("../modules/placeholder/index").then((m) => ({
          default: m.default as React.ComponentType<any>,
        })),
      );
    return {
      path: r.path,
      component: Comp,
      title: r.title,
      icon: resolveIcon(r.icon),
      showInNav: r.showInNav ?? true,
    };
  });

  const navItems: NavItem[] = (manifest.navItems || []).map((n) => ({
    id: n.id || manifest.id,
    label: n.label || manifest.name,
    icon: resolveIcon(n.icon || manifest.icon),
    path: n.path,
    status: n.status,
  }));

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version || "0.0.0",
    description: manifest.description || "",
    icon: resolveIcon(manifest.icon),
    status: manifest.status,
    order: manifest.order ?? 99,
    component: routes[0]?.component,
    placeholder: manifest.placeholder
      ? {
          title: manifest.placeholder.title || manifest.name,
          description: manifest.placeholder.description || "",
          plannedVersion: manifest.placeholder.plannedVersion || "TBD",
          eta: manifest.placeholder.eta,
        }
      : undefined,
    routes,
    navItems,
  };
}

/**
 * 解析插件清单。
 * 清单由后端提供（`GET /api/plugins`），这样插件可以放在项目目录外。
 */
export async function fetchPluginManifests(
  baseUrl?: string,
): Promise<PluginManifest[]> {
  const base = baseUrl ?? import.meta.env.VITE_API_URL ?? "";
  const matched = pluginGlobMatchCount();
  if (matched === 0) {
    console.warn(
      "[plugin] 未匹配到任何插件组件 —— 检查 import.meta.glob 的路径是否正确" +
        "（应为 ../../../../plugins/*.{tsx,jsx}）",
    );
  }
  try {
    const res = await fetch(`${base}/api/plugins`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.plugins) ? data.plugins : [];
  } catch {
    return [];
  }
}
