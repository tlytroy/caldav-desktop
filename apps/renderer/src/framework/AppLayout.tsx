import React from "react";
import { useModuleRegistry } from "./ModuleRegistry";
import type { NavItem } from "./types";

interface AppLayoutProps {
  sidebar?: React.ReactNode;
  header?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * AppLayout - 应用主布局
 *
 * 包含侧边栏导航 + 主内容区。
 * 侧边栏从 ModuleRegistry 中获取所有模块的导航项。
 */
export function AppLayout({ sidebar, header, children }: AppLayoutProps) {
  const { getNavItems, getActiveModules, getPlaceholderModules } = useModuleRegistry();
  const navItems = getNavItems();
  const activeModules = getActiveModules();
  const placeholderCount = getPlaceholderModules().length;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-neutral-800">
      {/* 侧边栏 */}
      {sidebar ?? (
        <nav className="w-16 lg:w-56 bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white hidden lg:block">
              CalDAV
            </h1>
            <h1 className="text-lg font-bold text-brand lg:hidden">C</h1>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {navItems.map((item: NavItem) => (
              <NavItemButton key={item.id} item={item} />
            ))}
          </div>

          <div className="p-3 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-400 dark:text-gray-500 hidden lg:block">
              {activeModules.length} 个活跃模块
              {placeholderCount > 0 && ` · ${placeholderCount} 个占位`}
            </div>
          </div>
        </nav>
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {header && (
          <header className="bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            {header}
          </header>
        )}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItemButton({ item }: { item: NavItem }) {
  // 使用原生导航，后续可替换为 react-router Link
  const handleClick = () => {
    if (item.status === "placeholder") {
      // 占位模块不导航
      return;
    }
    window.location.hash = `#${item.path}`;
  };

  const isPlaceholder = item.status === "placeholder";
  const isActive = typeof window !== "undefined" && window.location.hash === `#${item.path}`;

  return (
    <button
      onClick={handleClick}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
        ${isPlaceholder
          ? "text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-50"
          : isActive
            ? "bg-brand/10 dark:bg-brand/20 text-brand"
            : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700"
        }
      `}
      title={item.label}
    >
      <span className="w-5 h-5 shrink-0">{item.icon}</span>
      <span className="hidden lg:block truncate">{item.label}</span>
      {isPlaceholder && (
        <span className="hidden lg:block ml-auto text-xs text-gray-400">即将</span>
      )}
    </button>
  );
}