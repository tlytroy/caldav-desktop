/**
 * WebDAV 客户端 —— md 文件同步通道
 *
 * 为什么需要这条通道（见 REF/MD_ICS_BRIDGE.md「方式二」）：
 *   events.md / 工作搭子看板.md 是唯一事实源，用户可能**没有 CalDAV 服务器**。
 *   WebDAV 直接同步 md 文件本身即可多设备互通，**不需要 ICS 转换**，
 *   任何支持 WebDAV 的云盘（Nextcloud / ownCloud / 坚果云 / Box）都能用。
 *
 * 实现要点：
 *  - 只用 Node 内置 fetch，不引第三方依赖（坚果云等对 WebDAV 库兼容性参差）
 *  - Basic 认证（WebDAV 事实标准；坚果云强制要求）
 *  - 用 ETag 判断远端是否变化，避免无脑覆盖用户的本地修改
 *  - 远端目录不存在时自动 MKCOL 创建
 *
 * @see REF/MD_ICS_BRIDGE.md 完整设计文档
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "./config.js";

export interface WebDAVConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  /** 远端目录，如 CalDAV-Desktop */
  remoteDir: string;
  /** 单次请求超时（毫秒） */
  timeoutMs: number;
}

/** 单个文件的远端状态 */
export interface RemoteFileInfo {
  exists: boolean;
  /** 强 ETag（带引号）；不可用时为 undefined */
  etag?: string;
  /** RFC1123 格式的最后修改时间 */
  lastModified?: string;
  size?: number;
}

/** 加载 WebDAV 配置。来源：config.json（界面写入）> 环境变量 / .env > 默认值 */
export function loadWebDAVConfig(): WebDAVConfig {
  const cfg = getConfig();
  return {
    enabled: cfg.webdav.enabled || !!cfg.webdav.url,
    url: (cfg.webdav.url || "").trim(),
    username: cfg.webdav.username || "",
    password: cfg.webdav.password || "",
    /**
     * 远端目录。
     *
     * ⚠️ 这里必须读配置层的值 —— 之前写死成常量，导致用户在界面改了目录
     *    完全不生效（实测发现）。配置层存的是**目录名**（如 MyCal），
     *    这里补上 .md 后缀只是为了与旧接口的形状保持一致；
     *    实际取目录部分时由 remoteDirOf() 处理。
     */
    remoteDir: cfg.webdav.remoteDir
      ? `${cfg.webdav.remoteDir.replace(/\/+$/, "")}/events.md`
      : "CalDAV-Desktop/events.md",
    timeoutMs: cfg.webdav.timeoutMs || 20000,
  };
}

/** 配置是否可用于实际请求 */
export function isWebDAVConfigured(cfg: WebDAVConfig): boolean {
  if (!cfg.url) return false;
  try {
    const u = new URL(cfg.url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function authHeader(cfg: WebDAVConfig): string {
  const raw = `${cfg.username}:${cfg.password}`;
  const b64 = typeof Buffer !== "undefined"
    ? Buffer.from(raw, "utf-8").toString("base64")
    : btoa(unescape(encodeURIComponent(raw)));
  return `Basic ${b64}`;
}

/** 拼接远端文件 URL，容忍 url 末尾有无斜杠 */
function remoteFileUrl(cfg: WebDAVConfig, filename: string): string {
  const base = cfg.url.endsWith("/") ? cfg.url : `${cfg.url}/`;
  const dir = cfg.remoteDir
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const name = filename.replace(/^\/+/, "");
  return `${base}${dir ? `${dir}/` : ""}${name}`;
}

function requestInit(cfg: WebDAVConfig, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      Authorization: authHeader(cfg),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(cfg.timeoutMs),
  };
}

/** 网络层错误 → 可读中文提示 */
function describeError(status: number, statusText: string): string {
  switch (status) {
    case 401:
    case 403:
      return `认证失败（${status}）：请检查 WEBDAV_USER / WEBDAV_PASS`;
    case 404:
      return "远端文件或目录不存在（404）";
    case 409:
      return "远端目录缺失（409）：WebDAV 根目录可能未启用";
    case 412:
      return "前置条件失败（412）：远端文件已被他人修改";
    case 415:
      return "服务器不支持该请求类型（415）";
    case 507:
      return "服务器存储空间不足（507）";
    default:
      return `WebDAV 请求失败：${status} ${statusText}`;
  }
}

/**
 * 确保远端目录存在（不存在则 MKCOL）。
 * WebDAV 目录是逐级创建的，递归建到目标目录。
 */
export async function ensureRemoteDir(cfg: WebDAVConfig): Promise<void> {
  const base = cfg.url.endsWith("/") ? cfg.url : `${cfg.url}/`;
  const segments = cfg.remoteDir
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);

  let current = base;
  for (const seg of segments) {
    current = `${current}${seg}/`;
    const res = await fetch(current, requestInit(cfg, { method: "PROPFIND" }));
    // 207 = 目录存在；其他都尝试创建
    if (res.status === 207) continue;
    if (res.status === 405 || res.status === 301) continue; // 已存在

    const mk = await fetch(current, requestInit(cfg, { method: "MKCOL" }));
    // 201 Created / 405 Method Not Allowed(已存在) / 301 都算成功
    if (![201, 405, 301].includes(mk.status)) {
      throw new Error(
        `创建远端目录失败：${current.replace(/https?:\/\/[^/]+/, "")} — ${describeError(mk.status, mk.statusText)}`,
      );
    }
  }
}

/**
 * 查询远端文件状态（是否存在 + ETag + 修改时间）。
 * 用 HEAD 而不是 PROPFIND：兼容性更好，且不需要读 body。
 * 部分服务端不支持 HEAD，此时降级用 GET 的 ETag 响应头。
 */
export async function statRemoteFile(
  cfg: WebDAVConfig,
  filename: string,
): Promise<RemoteFileInfo> {
  const url = remoteFileUrl(cfg, filename);

  const head = await fetch(url, requestInit(cfg, { method: "HEAD" }));
  if (head.status === 404) return { exists: false };
  if ([401, 403].includes(head.status)) {
    throw new Error(describeError(head.status, head.statusText));
  }
  if (head.ok) {
    return {
      exists: true,
      etag: normalizeEtag(head.headers.get("etag")),
      lastModified: head.headers.get("last-modified") || undefined,
      size: parseInt(head.headers.get("content-length") || "0", 10) || undefined,
    };
  }

  // 降级：HEAD 不支持（405/501）时用 GET 读 ETag
  if ([405, 501].includes(head.status)) {
    const get = await fetch(url, requestInit(cfg, { method: "GET" }));
    if (get.status === 404) return { exists: false };
    if (!get.ok) throw new Error(describeError(get.status, get.statusText));
    const text = await get.text();
    return {
      exists: true,
      etag: normalizeEtag(get.headers.get("etag")),
      lastModified: get.headers.get("last-modified") || undefined,
      size: text.length,
    };
  }

  throw new Error(describeError(head.status, head.statusText));
}

/** 去掉 ETag 的弱标记前缀与两端引号，便于比较 */
export function normalizeEtag(raw: string | null): string | undefined {
  if (!raw) return undefined;
  let e = raw.trim();
  if (e.startsWith("W/")) e = e.slice(2);
  e = e.replace(/^"|"$/g, "");
  return e || undefined;
}

/**
 * 上传本地文件到远端（覆盖）。
 *
 * @param expectedEtag 传远端当前 ETag 可实现乐观锁（`If-Match`）：
 *   远端已被他人改动时服务端返回 412，从而避免静默覆盖别人的修改。
 *   传 undefined 表示无条件覆盖。
 */
export async function putRemoteFile(
  cfg: WebDAVConfig,
  filename: string,
  content: string,
  expectedEtag?: string,
): Promise<{ etag?: string }> {
  await ensureRemoteDir(cfg);
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
  };
  if (expectedEtag) headers["If-Match"] = `"${expectedEtag}"`;

  const res = await fetch(
    remoteFileUrl(cfg, filename),
    requestInit(cfg, { method: "PUT", headers, body: content }),
  );

  if (!res.ok && res.status !== 204) {
    throw new Error(describeError(res.status, res.statusText));
  }
  return { etag: normalizeEtag(res.headers.get("etag")) };
}

/** 下载远端文件内容；不存在时返回 null */
export async function getRemoteFile(
  cfg: WebDAVConfig,
  filename: string,
): Promise<string | null> {
  const res = await fetch(
    remoteFileUrl(cfg, filename),
    requestInit(cfg, { method: "GET" }),
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(describeError(res.status, res.statusText));
  return res.text();
}

/** 本地文件是否存在的 ETag 记录（写入 .webdav-state.json，用于冲突检测） */
export interface SyncState {
  /** filename → 上次同步成功时远端的 ETag */
  etags: Record<string, string>;
  /** filename → 上次同步时间 */
  syncedAt?: Record<string, string>;
}

function statePathFor(localFile: string): string {
  const dir = path.dirname(localFile);
  return path.join(dir, ".webdav-state.json");
}

/** 读取同步状态 */
export function readSyncState(localFile: string): SyncState {
  try {
    const p = statePathFor(localFile);
    if (!fs.existsSync(p)) return { etags: {} };
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { etags: parsed.etags || {}, syncedAt: parsed.syncedAt || {} };
  } catch {
    return { etags: {} };
  }
}

/** 写入同步状态 */
export function writeSyncState(localFile: string, state: SyncState): void {
  try {
    fs.writeFileSync(
      statePathFor(localFile),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
  } catch (e) {
    console.warn("[WebDAV] 写入同步状态失败：", (e as Error).message);
  }
}
