/**
 * WebDAV 同步 API 客户端
 *
 * WebDAV 通道与 CalDAV 通道的分工：
 *   - CalDAV：workspace.md → ICS → CalDAV 服务器（跨日历软件互通）
 *   - WebDAV：md 文件本身 ↔ WebDAV 服务器（**无需 ICS 转换**）
 *
 * 适用场景：用户没有 CalDAV 服务器，但有任意支持 WebDAV 的云盘
 * （Nextcloud / ownCloud / 坚果云 / Box）。md 仍是唯一事实源。
 */

import { createApiClient } from "./client";

const api = createApiClient(60000);

export interface WebDAVFileStatus {
  /** 统一数据源只有一个文件 */
  key: "workspace";
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

/** 合并报告（条目级） */
export interface WebDAVMergeReport {
  localOnly: number;
  remoteOnly: number;
  fromRemote: number;
  fromLocal: number;
  conflicts: Array<{ id: string; title: string }>;
  invalid: number;
  total: number;
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
  files?: "workspace"[];
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
  files?: "workspace"[];
  force?: boolean;
}): Promise<{ success: boolean; results: WebDAVSyncResult[] }> {
  const { data } = await api.post("/api/webdav/pull", {
    files: opts?.files,
    force: opts?.force,
  });
  return data;
}

/**
 * 合并本地与远端（冲突时的第三个选项）。
 *
 * 按条目 id 取并集：只有一边有的都保留；两边都有的用 `updatedAt` 较新的一版；
 * 时间相同但内容不同时保留本地并在 `conflicts` 里报告。
 * 合并结果会同时写回本地与远端，本地覆盖前备份为 `.bak`。
 */
export async function mergeWebDAV(): Promise<{
  success: boolean;
  filename: string;
  merged: WebDAVMergeReport;
  backupPath?: string;
}> {
  const { data } = await api.post("/api/webdav/merge");
  return data;
}
