import React, { useState, useEffect } from "react";
import { useModuleRegistry } from "./ModuleRegistry";

/**
 * AppRouter - 模块化路由系统（基于 hash）
 *
 * 从 ModuleRegistry 中收集所有模块的路由配置，
 * 通过监听 window.location.hash 实现客户端路由。
 *
 * 无需 react-router-dom 依赖，保持轻量。
 */
export function AppRouter() {
  const { getRoutes } = useModuleRegistry();
  const routes = getRoutes();

  const [currentHash, setCurrentHash] = useState(
    () => (typeof window !== "undefined" ? window.location.hash.replace("#", "") : "/dashboard"),
  );

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash.replace("#", ""));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // 默认路由
  const defaultPath = "/dashboard";

  // 找到匹配的路由
  const matchedRoute = routes.find((r) => r.path === currentHash) || routes.find((r) => r.path === defaultPath);

  if (!matchedRoute) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p>页面未找到</p>
        <a href="#/dashboard" className="text-indigo-500 hover:underline mt-2 inline-block">
          返回工作台
        </a>
      </div>
    );
  }

  const Component = matchedRoute.component;
  return (
    <React.Suspense fallback={<div className="p-4 text-center text-gray-400">加载中...</div>}>
      <Component />
    </React.Suspense>
  );
}