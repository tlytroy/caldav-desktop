import axios, { AxiosInstance, AxiosError } from "axios";
import { API_BASE_URL } from "./base";
import { AUTH_REQUIRED_EVENT, getApiToken, isElectron } from "./token";

/**
 * 统一的 axios 实例工厂（P5）
 * ==========================
 *
 * 所有 API 客户端都必须从这里建，不要再各自 `axios.create`：
 *  - 自动带 Authorization（浏览器 / PWA；Electron 由主进程注入）
 *  - 401 统一广播 `dsh:auth-required`，由 AuthGate 接管
 *
 * 不做自动重试 / 自动跳转：401 时静默重试只会放大错误。
 */

export function createApiClient(timeout = 30000): AxiosInstance {
  const api = axios.create({ baseURL: API_BASE_URL, timeout });

  api.interceptors.request.use((config) => {
    // Electron 下主进程会注入（且 token 不落到渲染层）；这里避免重复头
    if (!isElectron()) {
      const token = getApiToken();
      if (token) {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
      }
    }
    return config;
  });

  api.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      if (err.response?.status === 401) {
        window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
      }
      return Promise.reject(err);
    },
  );

  return api;
}

/** 给 fetch / 下载这类非 axios 场景用 */
export function authHeaders(): Record<string, string> {
  if (isElectron()) return {};
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
