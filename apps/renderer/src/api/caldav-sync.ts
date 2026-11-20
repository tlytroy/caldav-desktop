/**
 * CalDAV 同步客户端（workspace.md ↔ CalDAV）
 *
 * 这里走的是
 * `/api/caldav/*` —— 同步的才是用户正在看的统一数据源。
 */


import { createApiClient } from "./client";

const api = createApiClient(120000);

export type SyncDirection = "push" | "pull" | "bidirectional";

export interface SyncAction {
  uid: string;
  id: string;
  title: string;
  action: "created" | "updated" | "merged";
  /** 合并时两边都改过、最终保留本地的字段 */
  conflictFields?: string[];
}

export interface SyncConflict {
  uid: string;
  id: string;
  title: string;
  /** 冲突原因（给用户看的文案） */
  reason: string;
}

export interface CalDAVSyncResult {
  success: boolean;
  /** true = 有冲突或部分对象失败（HTTP 207） */
  partial?: boolean;
  direction: SyncDirection;
  calendarUrl: string;
  pushed: SyncAction[];
  pulled: SyncAction[];
  merged: SyncAction[];
  skipped: number;
  conflicts: SyncConflict[];
  errors: string[];
  localTotal: number;
  remoteTotal: number;
  syncedAt: string;
}

export interface CalDAVSyncStatus {
  configured: boolean;
  calendarUrl: string;
  direction: SyncDirection;
  autoSyncMinutes: number;
  lastSyncAt?: string;
  /** 上次同步记录的对象数 */
  syncedCount: number;
  /** 本地会参与同步的条目数（有 start 的） */
  localCount: number;
  /** 本地改过、还没推上去的条数 */
  pendingCount: number;
  stateFilePath: string;
  rootUrl?: string;
  hasCredentials?: boolean;
}

export interface CalDAVCalendarOption {
  url: string;
  displayName: string;
  components?: string[];
}

/** 从 axios 错误里取出服务端给的**可读**文案 */
export function caldavErrorMessage(e: unknown): string {
  const err = e as any;
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    (e as Error)?.message ||
    String(e)
  );
}

/** 同步状态（不发网络请求，秒回） */
export async function fetchCalDAVSyncStatus(): Promise<CalDAVSyncStatus> {
  const { data } = await api.get("/api/caldav/status");
  return data;
}

/**
 * 执行一次同步。
 *
 * 冲突不会被静默吞掉：结果里的 `conflicts` 会列出条目与原因，
 * 由界面展示给用户决定「强制推」还是「先拉」。
 */
export async function runCalDAVSync(
  opts: {
    direction?: SyncDirection;
    calendarUrl?: string;
    force?: boolean;
    /** 冲突时做字段级合并（本地改的保留，远端改的采纳） */
    merge?: boolean;
    /** 只同步这些 UID（逐条解决冲突时用） */
    uids?: string[];
  } = {},
): Promise<CalDAVSyncResult> {
  const { data } = await api.post("/api/caldav/sync", {
    direction: opts.direction,
    calendarUrl: opts.calendarUrl,
    force: opts.force === true,
    merge: opts.merge === true,
    uids: opts.uids,
  });
  return data;
}

/** 列出服务器上的日历（设置界面选择同步目标） */
export async function fetchCalDAVCalendars(): Promise<{
  calendars: CalDAVCalendarOption[];
  degraded?: boolean;
  message?: string;
  defaultCalendarUrl?: string;
}> {
  const { data } = await api.get("/api/caldav/calendars");
  return data;
}

/** 测试连接（只发 PROPFIND，不写数据） */
export async function testCalDAVConnection(calendarUrl?: string): Promise<{
  success: boolean;
  message: string;
}> {
  const { data } = await api.post("/api/caldav/test", { calendarUrl });
  return data;
}
