import React, { createContext, useContext, useCallback, useMemo } from "react";
import type { CalendarModule, RouteConfig, NavItem } from "./types";

interface ModuleRegistryContextType {
  modules: CalendarModule[];
  registerModule: (module: CalendarModule) => void;
  registerPlugin: (module: CalendarModule) => void;
  getModule: (id: string) => CalendarModule | undefined;
  getActiveModules: () => CalendarModule[];
  getPlaceholderModules: () => CalendarModule[];
  getRoutes: () => RouteConfig[];
  getNavItems: () => NavItem[];
}

const ModuleRegistryContext = createContext<ModuleRegistryContextType | null>(null);

export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const [modules, setModules] = React.useState<CalendarModule[]>([]);

  const registerModule = useCallback((module: CalendarModule) => {
    setModules((prev) => {
      const exists = prev.find((m) => m.id === module.id);
      if (exists) {
        return prev.map((m) => (m.id === module.id ? module : m));
      }
      return [...prev, module];
    });
  }, []);

  /**
   * 注册外部插件模块。
   * 与内置模块 id 冲突时**跳过**（不覆盖）——
   * 外部插件是可选增强，不能顶掉核心功能。
   */
  const registerPlugin = useCallback((module: CalendarModule) => {
    setModules((prev) => {
      if (prev.some((m) => m.id === module.id)) {
        console.warn(
          `[plugin] 模块 id "${module.id}" 与已有模块冲突，已跳过`,
        );
        return prev;
      }
      return [...prev, module];
    });
  }, []);

  const getModule = useCallback(
    (id: string) => modules.find((m) => m.id === id),
    [modules],
  );

  const getActiveModules = useCallback(
    () => modules.filter((m) => m.status === "active").sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [modules],
  );

  const getPlaceholderModules = useCallback(
    () => modules.filter((m) => m.status === "placeholder").sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [modules],
  );

  const getRoutes = useCallback(
    () => modules.flatMap((m) => m.routes),
    [modules],
  );

  const getNavItems = useCallback(
    () => modules.flatMap((m) => m.navItems),
    [modules],
  );

  const value = useMemo(
    () => ({
      modules,
      registerModule,
      registerPlugin,
      getModule,
      getActiveModules,
      getPlaceholderModules,
      getRoutes,
      getNavItems,
    }),
    [
      modules,
      registerModule,
      registerPlugin,
      getModule,
      getActiveModules,
      getPlaceholderModules,
      getRoutes,
      getNavItems,
    ],
  );

  return (
    <ModuleRegistryContext.Provider value={value}>
      {children}
    </ModuleRegistryContext.Provider>
  );
}

export function useModuleRegistry(): ModuleRegistryContextType {
  const context = useContext(ModuleRegistryContext);
  if (!context) {
    throw new Error("useModuleRegistry must be used within a ModuleProvider");
  }
  return context;
}