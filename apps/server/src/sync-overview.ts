/**
 * 同步中心只读概览（v0.3 / P8）
 * =================================
 *
 * 给「同步中心」页面提供一份**不联网**的快照：
 *   - CalDAV / WebDAV 是否配置、上次同步时间、待推送条数、上次错误；
 *   - 最近的同步事件与冲突（进程内环形缓冲，重启清空）；
 *   - 恢复是否挂起、同步是否被暂停、当前在途同步数。
 *
 * 硬约束（SDS §5）：
 *   - 这里**绝不能**发任何网络请求 —— 后端可能正在离线/NAS 挂掉，
 *     打开同步中心不能因此卡住或报错。状态只从本地状态文件 +
 *     配置 + 进程内缓冲读取。
 *   - 未配置同步也必须有正常返回值（本工具离线可用，同步只是可选增强）。
 */

import {
  getCalDAVSyncStatus,
  loadCalDAVSyncSettings,
} from "./caldav-sync.js";
import {
  isWebDAVConfigured,
  loadWebDAVConfig,
  readSyncState,
} from "./webdav.js";
import { workspaceFilePath } from "./workspace.js";
import { getRestoreStatus, isSyncSuspended } from "./restore.js";
import {
  getSyncConflicts,
  getSyncEvents,
  inFlightCount,
  isSyncMaintenance,
  type SyncChannel,
  type SyncConflictRecord,
  type SyncEvent,
} from "./sync-control.js";

export interface SyncOverviewCalDAV {
  configured: boolean;
  calendarUrl: string;
  autoSyncMinutes: number;
  lastSyncAt: string | null;
  /** 本地改过、还没推上去的条数 */
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
  success: true;
  caldav: SyncOverviewCalDAV;
  webdav: SyncOverviewWebDAV;
  events: SyncEvent[];
  conflicts: SyncConflictRecord[];
  /** 有未完成的恢复（marker 存在） */
  restorePending: boolean;
  /** 恢复后同步被暂停，需要用户选择方向 */
  autoSyncSuspended: boolean;
  maintenance: boolean;
  inFlight: { caldav: number; webdav: number; restore: number };
}

/** 取某通道最近一条错误事件，作为「上次错误」展示 */
function lastErrorOf(channel: SyncChannel): string | null {
  const events = getSyncEvents();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].channel === channel && events[i].kind === "error") {
      return events[i].message;
    }
  }
  return null;
}

/**
 * 配置里的 remoteDir 形如 `CalDAV-Desktop/events.md`（历史形状），
 * 概览只展示目录部分。
 */
function webdavDirName(remoteDir: string): string {
  const cleaned = (remoteDir || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/\.md$/i.test(cleaned)) return cleaned;
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(0, idx) : "";
}

function readCalDAVOverview(): SyncOverviewCalDAV {
  try {
    const s = getCalDAVSyncStatus();
    return {
      configured: s.configured,
      calendarUrl: s.calendarUrl,
      autoSyncMinutes: s.autoSyncMinutes,
      lastSyncAt: s.lastSyncAt ?? null,
      pendingCount: s.pendingCount,
      localCount: s.localCount,
      syncedCount: s.syncedCount,
      lastError: lastErrorOf("caldav"),
    };
  } catch (e) {
    // workspace.md 暂时读不出来时，概览也不该整个失败
    const s = loadCalDAVSyncSettings();
    return {
      configured: !!(s.rootUrl || s.calendarUrl) && !!s.username,
      calendarUrl: s.calendarUrl,
      autoSyncMinutes: s.autoSyncMinutes,
      lastSyncAt: null,
      pendingCount: 0,
      localCount: 0,
      syncedCount: 0,
      lastError: lastErrorOf("caldav") ?? (e as Error).message,
    };
  }
}

function readWebDAVOverview(): SyncOverviewWebDAV {
  try {
    const cfg = loadWebDAVConfig();
    const configured = isWebDAVConfigured(cfg);
    let lastSyncedAt: string | null = null;
    let lastKnownEtag: string | null = null;
    if (configured) {
      // 只读本地状态文件，不发 HEAD/PROPFIND
      const state = readSyncState(workspaceFilePath());
      lastSyncedAt = state.syncedAt?.["workspace.md"] ?? null;
      lastKnownEtag = state.etags?.["workspace.md"] ?? null;
    }
    return {
      configured,
      remoteDir: webdavDirName(cfg.remoteDir),
      lastSyncedAt,
      lastKnownEtag,
      lastError: lastErrorOf("webdav"),
    };
  } catch (e) {
    return {
      configured: false,
      remoteDir: "",
      lastSyncedAt: null,
      lastKnownEtag: null,
      lastError: lastErrorOf("webdav") ?? (e as Error).message,
    };
  }
}

/** 只读快照；任何异常都降级为「未配置/无数据」，不抛错。 */
export function getSyncOverview(): SyncOverview {
  const caldav = readCalDAVOverview();
  const webdav = readWebDAVOverview();
  const restore = getRestoreStatus();

  let suspended = false;
  try {
    suspended = isSyncSuspended();
  } catch {
    suspended = false;
  }

  return {
    success: true,
    caldav,
    webdav,
    events: getSyncEvents(),
    conflicts: getSyncConflicts(),
    restorePending: restore.active || restore.marker !== null,
    autoSyncSuspended: suspended,
    maintenance: isSyncMaintenance(),
    inFlight: {
      caldav: inFlightCount("caldav"),
      webdav: inFlightCount("webdav"),
      restore: inFlightCount("restore"),
    },
  };
}
