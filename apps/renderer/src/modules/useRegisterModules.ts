import { useEffect } from "react";
import { useModuleRegistry } from "../framework";
import type { CalendarModule } from "../framework";

// 导入所有内置模块定义
import { builtinModules, loadPluginModules } from "./index";

/**
 * useRegisterModules - 注册所有模块到 ModuleRegistry
 *
 * 两阶段：
 *   1. 同步注册内置模块（立即可用，不等网络）
 *   2. 异步加载外部插件（plugins/ 目录），加载完再注册
 *
 * 插件加载失败不影响内置模块 —— 插件是可选增强。
 */
export function useRegisterModules() {
  const { registerModule, registerPlugin } = useModuleRegistry();

  // 阶段 1：内置模块
  useEffect(() => {
    builtinModules.forEach((module: CalendarModule) => {
      registerModule(module);
    });
  }, [registerModule]);

  // 阶段 2：外部插件
  useEffect(() => {
    let cancelled = false;

    loadPluginModules()
      .then((plugins) => {
        if (cancelled) return;
        plugins.forEach((module: CalendarModule) => {
          // 用 registerPlugin：id 冲突时跳过，不覆盖内置模块
          registerPlugin(module);
        });
      })
      .catch((e) => {
        console.warn("[plugin] 加载外部插件失败（不影响内置模块）：", e);
      });

    return () => {
      cancelled = true;
    };
  }, [registerPlugin]);
}
