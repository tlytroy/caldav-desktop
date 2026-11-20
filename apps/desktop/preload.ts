/**
 * 预加载脚本（sandbox + contextIsolation）
 *
 * 只暴露两个只读值：
 *  - `__DSH_ELECTRON__`：前端据此隐藏“输入令牌”页（token 由主进程注入）
 *  - `__API_BASE_URL__`：本机后端地址（同源，但显式给出，避免构建期 VITE_API_URL 干扰）
 *
 * token 绝不进渲染进程：`webRequest.onBeforeSendHeaders` 在主进程加头。
 */
import { contextBridge } from "electron";

function readApiBase(): string | undefined {
  try {
    const arg = process.argv.find((a) => a.startsWith("--dsh-api-base="));
    if (!arg) return undefined;
    const value = arg.slice("--dsh-api-base=".length);
    return value.startsWith("http://127.0.0.1:") ? value : undefined;
  } catch {
    return undefined;
  }
}

const apiBase = readApiBase();

try {
  contextBridge.exposeInMainWorld("__DSH_ELECTRON__", true);
  if (apiBase) {
    contextBridge.exposeInMainWorld("__API_BASE_URL__", apiBase);
  }
  contextBridge.exposeInMainWorld("electron", { isElectron: true });
} catch (err) {
  console.error("[preload]", err);
}
