/**
 * 示例插件组件
 *
 * 演示：外部模块如何作为一个普通 React 组件工作。
 * 它可以调用后端 API、读写 events.md —— 与内置模块没有任何区别。
 *
 * 约定：
 *   - 文件名与 manifest 的 `component` 字段一致
 *   - 必须 default export
 *   - 放在项目根目录的 plugins/ 下
 */

import { useState, useEffect } from "react";
import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

export default function ExamplePlugin() {
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/api/md-bridge/events")
      .then((r) => setEventCount(r.data?.events?.length ?? 0))
      .catch((e) => setError(e?.response?.data?.error || e?.message));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          示例插件
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          这个模块来自 <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800">plugins/example.json</code>
          ，放在项目根目录的 plugins/ 下，没有改动任何核心代码。
        </p>
      </div>

      <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-600 dark:text-gray-400">当前事件数</div>
        <div className="text-3xl font-semibold text-gray-900 dark:text-white mt-1">
          {error ? "—" : (eventCount ?? "…")}
        </div>
        {error && (
          <div className="text-xs text-red-500 mt-2">读取失败：{error}</div>
        )}
      </div>

      <div className="p-4 rounded-xl bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        <p className="font-medium text-gray-900 dark:text-white mb-2">
          如何新增一个模块
        </p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            在 <code>plugins/</code> 目录下建{" "}
            <code>&lt;id&gt;.json</code>，声明 id / name / routes / navItems
          </li>
          <li>
            （可选）建 <code>&lt;id&gt;.tsx</code> 组件，default export
          </li>
          <li>重启应用，模块自动出现在侧边栏</li>
        </ol>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          插件 id 与内置模块冲突时会被跳过（不会覆盖内置功能）。
          组件文件缺失时会退化为占位页面。
        </p>
      </div>
    </div>
  );
}
