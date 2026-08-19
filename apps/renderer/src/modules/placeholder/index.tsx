import { Lock } from "lucide-react";
import { useModuleRegistry } from "../../framework";

/**
 * PlaceholderPage - 通用占位页面
 *
 * 当用户导航到尚未实现的模块时显示。
 * 从 ModuleRegistry 中获取对应模块信息。
 */
export default function PlaceholderPage() {
  const { modules } = useModuleRegistry();

  // 根据当前 hash 找到匹配的模块
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const currentModule = modules.find((m) => m.routes.some((r) => r.path === hash));

  const placeholder = currentModule?.placeholder;

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="flex flex-col items-center text-center p-8 bg-white dark:bg-neutral-900 rounded-2xl border border-gray-200 dark:border-gray-700">
        <div className="p-4 bg-gray-100 dark:bg-neutral-800 rounded-full mb-6">
          <Lock className="w-16 h-16 text-gray-300 dark:text-gray-500" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
          {placeholder?.title ?? "功能开发中"}
        </h1>

        <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md">
          {placeholder?.description ?? "该功能正在开发中，敬请期待后续版本。"}
        </p>

        <div className="flex flex-wrap gap-3 justify-center">
          {placeholder?.plannedVersion && (
            <span className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-medium">
              计划版本: {placeholder.plannedVersion}
            </span>
          )}
          {placeholder?.eta && placeholder.eta !== "TBD" && (
            <span className="px-3 py-1.5 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg text-sm font-medium">
              预计完成: {placeholder.eta}
            </span>
          )}
          {(!placeholder?.eta || placeholder.eta === "TBD") && (
            <span className="px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded-lg text-sm font-medium">
              时间待定
            </span>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700 w-full">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            模块化架构 · 持续进化 · {currentModule?.id ?? "unknown"}
          </p>
        </div>
      </div>
    </div>
  );
}