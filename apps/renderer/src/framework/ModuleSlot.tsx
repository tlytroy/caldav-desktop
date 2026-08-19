import React from "react";
import { Lock } from "lucide-react";
import type { CalendarModule } from "./types";

interface ModuleSlotProps {
  module: CalendarModule;
  fallback?: React.ReactNode;
}

/**
 * ModuleSlot - 模块插槽组件
 *
 * 根据模块状态渲染：
 * - active: 渲染模块的 component
 * - placeholder: 渲染占位提示
 */
export function ModuleSlot({ module, fallback }: ModuleSlotProps) {
  if (module.status === "active" && module.component) {
    const Component = module.component;
    return (
      <React.Suspense fallback={fallback ?? <div className="p-4 text-center text-gray-400">加载中...</div>}>
        <Component />
      </React.Suspense>
    );
  }

  if (module.status === "placeholder" && module.placeholder) {
    const { title, description, plannedVersion, eta } = module.placeholder;
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-neutral-700/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-600 text-center">
        <Lock className="w-12 h-12 text-gray-300 dark:text-gray-500 mb-3" />
        <h3 className="text-lg font-semibold text-gray-400 dark:text-gray-400 mb-2">
          {title}
        </h3>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-3 max-w-md">
          {description}
        </p>
        <div className="flex gap-2 text-xs text-gray-400 dark:text-gray-500">
          {plannedVersion && (
            <span className="px-2 py-1 bg-gray-100 dark:bg-neutral-600 rounded">
              计划版本: {plannedVersion}
            </span>
          )}
          {eta && eta !== "TBD" && (
            <span className="px-2 py-1 bg-gray-100 dark:bg-neutral-600 rounded">
              预计完成: {eta}
            </span>
          )}
        </div>
      </div>
    );
  }

  return null;
}

/**
 * PlaceholderModuleCard - 占位模块卡片（用于 Dashboard 网格展示）
 */
export function PlaceholderModuleCard({ module }: { module: CalendarModule }) {
  return (
    <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-neutral-700/50 rounded-xl border border-gray-200 dark:border-gray-600 opacity-60 cursor-not-allowed">
      <div className="p-2 bg-gray-200 dark:bg-neutral-600 rounded-lg">
        <Lock className="w-5 h-5 text-gray-400" />
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-medium text-gray-400 dark:text-gray-400">
          {module.name}
        </h4>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {module.placeholder?.plannedVersion
            ? `计划: ${module.placeholder.plannedVersion}`
            : "即将到来"}
        </p>
      </div>
    </div>
  );
}