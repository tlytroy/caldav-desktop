/**
 * API 地址解析（支持「前端-only 连接远端后端」）
 * ============================================
 *
 * 三种部署形态：
 *  1. 本地一体（Electron / 同一台机器跑前后端）：同源，baseURL 为空
 *  2. Docker / NAS：前端由后端静态托管，同源，baseURL 为空
 *  3. 仅前端（浏览器 / 另一台设备）：需要指向远端后端
 *
 * 优先级：
 *   window.__API_BASE_URL__（Electron preload / 宿主注入）
 *   > localStorage（设置界面填的「后端地址」）
 *   > VITE_API_URL（构建时注入）
 *   > 空（同源）
 *
 * 注意：值是模块加载时算的。在设置里改完会刷新页面，让所有 axios 实例重建。
 */

const STORAGE_KEY = "dsh-api-base";

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const injected = (window as any).__API_BASE_URL__;
    // 只要宿主注入了字符串就听它的——包括空字符串。
    // Electron 用随机端口，构建时的 VITE_API_URL 是过期值，不能回退到它。
    if (typeof injected === "string") {
      return normalize(injected);
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && saved.trim()) return normalize(saved);
    } catch {
      /* 隐私模式：忽略 */
    }
  }
  return normalize(import.meta.env.VITE_API_URL || "");
}

/** 保存前端-only 模式的后端地址；空字符串 = 恢复同源 */
export function setApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  try {
    const v = normalize(url);
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 当前生效的 API 根地址（模块加载时确定） */
export const API_BASE_URL = getApiBaseUrl();

/** 拼一个绝对 API 地址（导出下载链接等场景） */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${p}`;
}
