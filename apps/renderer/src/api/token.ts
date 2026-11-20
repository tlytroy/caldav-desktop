/**
 * 访问令牌的本地存取（浏览器 / PWA / Docker 直连）
 * ================================================
 *
 * Electron 不走这里：主进程用 webRequest 注入 Authorization，渲染层
 * 根本不需要知道 token（见 apps/desktop/main.ts）。
 *
 * 只放 localStorage，不放 URL、不放 cookie —— token 进 URL 会留在
 * 浏览器历史、代理日志和 Referer 里。
 */

const TOKEN_KEY = "dsh-api-token";

export function getApiToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setApiToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    /* 隐私模式：本次会话内仍然可以用内存值 */
  }
}

export function clearApiToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Electron 由主进程注入 token，渲染层不显示输入页 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && (window as any).__DSH_ELECTRON__ === true;
}

export const AUTH_REQUIRED_EVENT = "dsh:auth-required";
