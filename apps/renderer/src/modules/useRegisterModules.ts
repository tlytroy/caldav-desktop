import { useEffect } from "react";
import { useModuleRegistry } from "../framework";
import type { CalendarModule } from "../framework";

// 导入所有模块定义
import { allModules } from "./index";

/**
 * useRegisterModules - 注册所有模块到 ModuleRegistry
 *
 * 在应用启动时调用一次，将 allModules 中定义的所有模块注册到 registry。
 */
export function useRegisterModules() {
  const { registerModule } = useModuleRegistry();

  useEffect(() => {
    allModules.forEach((module: CalendarModule) => {
      registerModule(module);
    });
  }, [registerModule]);
}
