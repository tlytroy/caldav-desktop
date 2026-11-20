import { createApiClient } from "./client";

/**
 * 同步中心（只读概览）
 *
 * 后端 `/api/sync/overview` **不发任何网络请求** —— 它只读本地状态文件、
 * 配置和进程内的事件/冲突缓冲。所以这个接口在 NAS 挂掉时也能立刻返回。
 *
 * 注意：这里刻意不复用 `api/webdav.ts` 的 `fetchWebDAVStatus()`，
 * 那个会去 HEAD 远端文件，离线时会卡住 20 秒。
 */

const client = createApiClient(15000);

export interface SyncEventItem {
  ts: string;
  channel: "caldav" | "webdav" | "restore";
  kind: string;
  message: string;
}

export interface SyncConflictItem {
  ts: string;
  channel: "caldav" | "webdav" | "restore";
  localId?: string;
  remoteHref?: string;
  localHash?: string;
  remoteEtag?: string;
  summary: string;
}

export interface SyncOverviewCalDAV {
  configured: boolean;
  calendarUrl: string;
  autoSyncMinutes: number;
  lastSyncAt: string | null;
  pendingCount: number;
  localCount: number;
  syncedCount: number;
  lastError: string | null;
}

export interface SyncOverviewWebDAV {
  configured: boolean;
  remoteDir: string;
  lastSyncedAt: string | null;
  lastKnownEtag: string | null;
  lastError: string | null;
}

export interface SyncOverview {
  success: boolean;
  caldav: SyncOverviewCalDAV;
  webdav: SyncOverviewWebDAV;
  events: SyncEventItem[];
  conflicts: SyncConflictItem[];
  restorePending: boolean;
  autoSyncSuspended: boolean;
  maintenance: boolean;
  inFlight: { caldav: number; webdav: number; restore: number };
}

export async function fetchSyncOverview(): Promise<SyncOverview> {
  const res = await client.get<SyncOverview>("/api/sync/overview");
  return res.data;
}

/** 恢复后继续同步；action 与 P7 的 resume 接口一致 */
export async function resumeSync(
  action: "pull" | "push" | "bidirectional",
): Promise<{ success: boolean; autoSyncMinutes?: number }> {
  const res = await client.post("/api/sync/resume", { action });
  return res.data as { success: boolean; autoSyncMinutes?: number };
}
