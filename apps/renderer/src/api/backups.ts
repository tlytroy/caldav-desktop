import { createApiClient } from "./client";

const api = createApiClient(30000);

/**
 * 备份只读客户端（v0.2.5 / P4）
 * ============================
 *
 * P4：列出备份、预览差异、下载原始文件（只读）。
 * P7：恢复（写回）、恢复状态、取消恢复、恢复后选择同步方向。
 * 写接口全部在服务端维护闸门 + 鉴权之后，客户端只负责带 sha 调用。
 */

export interface BackupEntry {
  file: string;
  createdAt: string;
  size: number;
  /** null = 备份内容无法解析（不是 0 条） */
  itemCount: number | null;
  pinned: boolean;
  pinnedSha256: string | null;
}

export interface BackupDiffItem {
  id: string;
  title: string;
  change: "added" | "removed" | "changed";
  fields?: string[];
}

export interface BackupDiff {
  added: number;
  removed: number;
  changed: number;
  items: BackupDiffItem[];
}

export interface BackupPreview {
  file: string;
  sha256: string;
  pinned: boolean;
  diff: BackupDiff;
}

export async function listBackups(): Promise<{
  filePath: string;
  backups: BackupEntry[];
}> {
  const res = await api.get("/api/workspace/backups");
  return { filePath: res.data.filePath, backups: res.data.backups ?? [] };
}

export async function previewBackup(file: string): Promise<BackupPreview> {
  const res = await api.post("/api/workspace/backups/preview", { file });
  const { file: f, sha256, pinned, diff } = res.data;
  return { file: f, sha256, pinned, diff };
}

/** 下载备份原文：必须走带 Authorization 的 fetch/axios，不能 window.open */
export async function downloadBackup(file: string): Promise<void> {
  const res = await api.get("/api/workspace/backups/export", {
    params: { file },
    responseType: "blob",
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { api as backupsApi };

export interface RestoreStatus {
  active: boolean;
  marker: { phase?: string; file?: string; error?: string } | null;
  suspended: { since?: string; reason?: string } | null;
  maintenance: boolean;
}

export interface RestoreResult {
  success: true;
  file: string;
  sha256: string;
  items: number;
  preRestoreBackup: string | null;
}

export async function getRestoreStatus(): Promise<RestoreStatus> {
  const res = await api.get("/api/workspace/backups/restore/status");
  return {
    active: Boolean(res.data.active),
    marker: res.data.marker ?? null,
    suspended: res.data.suspended ?? null,
    maintenance: Boolean(res.data.maintenance),
  };
}

/** 恢复：必须带上预览时拿到的 sha256，避免预览与写入之间文件被换掉 */
export async function restoreBackup(file: string, sha256: string): Promise<RestoreResult> {
  const res = await api.post("/api/workspace/backups/restore", {
    file,
    sha256,
    confirm: true,
  });
  return res.data;
}

export async function abortRestore(): Promise<void> {
  await api.post("/api/workspace/backups/restore/abort", {});
}

/** 恢复之后显式选择同步方向，才会重新开始同步 */
export async function resumeSync(
  action: "pull" | "push" | "bidirectional",
): Promise<{ syncError: string | null }> {
  const res = await api.post("/api/sync/resume", { action });
  return { syncError: res.data.syncError ?? null };
}
