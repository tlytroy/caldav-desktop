/**
 * WebDAV 同步 API 客户端
 *
 * WebDAV 通道与 CalDAV 通道的分工：
 *   - CalDAV：events.md → ICS → CalDAV 服务器（跨日历软件互通）
 *   - WebDAV：md 文件本身 ↔ WebDAV 服务器（**无需 ICS 转换**）
 *
 * 适用场景：用户没有 CalDAV 服务器，但有任意支持 WebDAV 的云盘
 * （Nextcloud / ownCloud / 坚果云 / Box）。md 仍是唯一事实源。
 */

import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 60000, // WebDAV 同步可能较慢，比普通 API 长
});

export interface WebDAVFileStatus {
  key: "events" | "kanban";
  filename: string;
  local: { path: string; exists: boolean; size: number; mtime?: number };
  remote: {
    exists: boolean;
    etag?: string;
    lastModified?: string;
    size?: number;
    error?: string;
  };
  lastSyncedEtag?: string;
  lastSyncedAt?: string;
  remoteChangedSinceLastSync: boolean;
}

export interface WebDAVStatus {
  success: true;
  configured: boolean;
  url?: string;
  remoteDir?: string;
  hasCredentials?: boolean;
  files: WebDAVFileStatus[];
  message?: string;
}

export interface WebDAVSyncResult {
  key: string;
  filename: string;
  ok: boolean;
  skipped?: boolean;
  forced?: boolean;
  conflict?: boolean;
  overwritten?: boolean;
  backupPath?: string;
  error?: string;
  localEtag?: string;
  remoteEtag?: string;
  bytes?: number;
}

/** 查询 WebDAV 配置与远端状态 */
export async function fetchWebDAVStatus(): Promise<WebDAVStatus> {
  const { data } = await api.get("/api/webdav/status");
  return data;
}

/** 连通性测试 */
export async function testWebDAVConnection(): Promise<{
  success: boolean;
  message: string;
  remoteDir?: string;
}> {
  const { data } = await api.post("/api/webdav/test");
  return data;
}

/**
 * 把本地 md 推送到远端。
 * @param opts.files 只推指定文件；缺省全部
 * @param opts.force 忽略 ETag 检查强制覆盖（远端被他人改动时）
 */
export async function pushToWebDAV(opts?: {
  files?: ("events" | "kanban")[];
  force?: boolean;
}): Promise<{ success: boolean; results: WebDAVSyncResult[] }> {
  const { data } = await api.post("/api/webdav/push", {
    files: opts?.files,
    force: opts?.force,
  });
  return data;
}

/**
 * 从远端拉取覆盖本地。
 * 远端无变化时默认跳过；覆盖前会自动备份为 .bak。
 */
export async function pullFromWebDAV(opts?: {
  files?: ("events" | "kanban")[];
  force?: boolean;
}): Promise<{ success: boolean; results: WebDAVSyncResult[] }> {
  const { data } = await api.post("/api/webdav/pull", {
    files: opts?.files,
    force: opts?.force,
  });
  return data;
}
