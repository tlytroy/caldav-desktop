/**
 * 备份恢复状态机（v0.3 / P7）
 * =================================
 *
 * 恢复是唯一会**整份替换** workspace.md 的操作，必须做到：
 *  1. 先冻结写入（maintenance）与所有后台任务（CalDAV 自动同步 / 提醒推送）；
 *  2. 等在途同步结束，避免它们把旧数据写回来；
 *  3. 备份当前文件（pre-restore），再原子替换；
 *  4. 重置同步基线（etag / fingerprint）与提醒已发送状态；
 *  5. 暂停同步，等用户明确选择「拉取 / 推送 / 双向」后再恢复。
 *
 * 中途失败时保留 marker + maintenance：客户端会收到 503，界面显示“恢复未完成”，
 * 用户可以重试、或调用 abort 放弃（工作区保持现状）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { atomicWriteFile } from "./storage-check.js";
import {
  backupsDir,
  pinBackup,
  readBackupForExport,
} from "./backups.js";
import {
  backupWorkspaceFile,
  isParseableItem,
  parseWorkspace,
  workspaceFilePath,
} from "./workspace.js";
import { validateWorkspaceGraph } from "./workspace-store.js";
import { withWorkspaceLock } from "./workspace-lock.js";
import {
  currentSyncEpoch,
  invalidateSyncEpoch,
  isStorageReadOnly,
  isSyncMaintenance,
  setSyncMaintenance,
  waitForInFlightSync,
} from "./sync-control.js";
import {
  MaintenanceError,
  SyncEpochError,
  WorkspaceHttpError,
  WorkspaceReadOnlyError,
} from "./errors.js";
import {
  loadCalDAVSyncSettings,
  normalizeDirection,
  startCalDAVAutoSync,
  stopCalDAVAutoSync,
  syncStatePath,
  syncWorkspaceToCalDAV,
} from "./caldav-sync.js";
import {
  pauseReminderScheduler,
  pruneReminderSent,
  reminderKey,
  resumeReminderScheduler,
} from "./notifications/scheduler.js";

export type RestorePhase =
  | "prepared"
  | "drained"
  | "pre-restore"
  | "written"
  | "failed";

export interface RestoreMarker {
  phase: RestorePhase;
  file: string;
  sha256: string;
  startedAt: string;
  epoch: number;
  error?: string;
}

export interface SyncSuspension {
  since: string;
  reason: "restore";
  epoch: number;
}

const SHA256_RE = /^[0-9a-f]{64}$/;

/** 测试里可以缩短；生产固定 10 秒。 */
function drainTimeoutMs(): number {
  const n = Number(process.env.RESTORE_DRAIN_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

let restoring = false;

function dataDir(): string {
  return path.dirname(workspaceFilePath());
}

export function restoreMarkerPath(): string {
  return path.join(dataDir(), ".restore-state.json");
}

export function syncSuspendedPath(): string {
  return path.join(dataDir(), ".sync-suspended.json");
}

export function readRestoreMarker(): RestoreMarker | null {
  const p = restoreMarkerPath();
  try {
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as RestoreMarker;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMarker(marker: RestoreMarker): void {
  atomicWriteFile(restoreMarkerPath(), JSON.stringify(marker, null, 2));
}

export function clearRestoreMarker(): void {
  try {
    fs.rmSync(restoreMarkerPath(), { force: true });
  } catch (e) {
    console.warn("[恢复] 删除 marker 失败：", (e as Error).message);
  }
}

export function readSyncSuspension(): SyncSuspension | null {
  try {
    const p = syncSuspendedPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as SyncSuspension;
  } catch {
    return null;
  }
}

export function isSyncSuspended(): boolean {
  return readSyncSuspension() !== null;
}

function writeSyncSuspension(): void {
  atomicWriteFile(
    syncSuspendedPath(),
    JSON.stringify(
      { since: new Date().toISOString(), reason: "restore", epoch: currentSyncEpoch() },
      null,
      2,
    ),
  );
}

function clearSyncSuspension(): void {
  try {
    fs.rmSync(syncSuspendedPath(), { force: true });
  } catch (e) {
    console.warn("[恢复] 删除同步暂停标记失败：", (e as Error).message);
  }
}

export interface RestoreStatus {
  active: boolean;
  marker: RestoreMarker | null;
  suspended: SyncSuspension | null;
  maintenance: boolean;
}

export function getRestoreStatus(): RestoreStatus {
  return {
    active: restoring,
    marker: readRestoreMarker(),
    suspended: readSyncSuspension(),
    maintenance: isSyncMaintenance(),
  };
}

/** 启动时调用：有未完成 marker 就保持冻结；固定快照已失效则自动解除。 */
export function recoverRestoreOnStartup(): "none" | "resumed" | "cleared" {
  const marker = readRestoreMarker();
  if (!marker) return "none";

  // 固定快照可能已被 24h TTL 清掉；没有它就永远无法重试，自动放弃。
  let pinnedOk = false;
  try {
    const sha = String(marker.sha256 || "");
    if (SHA256_RE.test(sha)) {
      const dir = backupsDir();
      const fixed = path.join(dir, ".pinned", `${sha}.md`);
      pinnedOk = fs.existsSync(fixed);
    }
  } catch {
    pinnedOk = false;
  }

  if (!pinnedOk) {
    clearRestoreMarker();
    setSyncMaintenance(false);
    console.warn(
      "[恢复] 发现未完成的恢复，但固定快照已失效：已自动解除写入冻结；同步保持暂停，请重新选择恢复或继续同步。",
    );
    return "cleared";
  }

  setSyncMaintenance(true);
  console.warn(
    `[恢复] 检测到未完成的恢复（${marker.phase}，${marker.file}）：写入已暂停，可重试或取消恢复。`,
  );
  return "resumed";
}

function resetSyncStateFiles(): void {
  const targets = [
    syncStatePath(),
    path.join(dataDir(), ".webdav-state.json"),
  ];
  for (const p of targets) {
    try {
      fs.rmSync(p, { force: true });
    } catch (e) {
      console.warn(`[恢复] 重置同步基线失败（${path.basename(p)}）：`, (e as Error).message);
    }
  }
}

export interface RestoreInput {
  file?: unknown;
  sha256?: unknown;
  confirm?: unknown;
}

export interface RestoreResult {
  success: true;
  file: string;
  sha256: string;
  items: number;
  preRestoreBackup: string | null;
  suspended: true;
}

/**
 * 执行恢复。调用前路由层已完成鉴权；这里只做业务校验。
 */
export async function runRestore(input: RestoreInput): Promise<RestoreResult> {
  if (restoring) {
    throw new WorkspaceHttpError(409, "已有恢复任务正在进行", "RESTORE_IN_PROGRESS");
  }
  if (isStorageReadOnly()) {
    throw new WorkspaceReadOnlyError("存储为只读模式，无法恢复");
  }
  if (input.confirm !== true) {
    throw new WorkspaceHttpError(400, "恢复需要显式确认（confirm: true）", "RESTORE_CONFIRM_REQUIRED");
  }
  if (typeof input.file !== "string" || !input.file.trim()) {
    throw new WorkspaceHttpError(400, "缺少备份文件名", "BACKUP_FILE_REQUIRED");
  }
  if (typeof input.sha256 !== "string" || !SHA256_RE.test(input.sha256)) {
    throw new WorkspaceHttpError(400, "缺少或非法的 sha256", "RESTORE_SHA_REQUIRED");
  }

  const { file, content } = readBackupForExport(input.file);
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (sha256 !== input.sha256) {
    throw new WorkspaceHttpError(
      409,
      "备份文件在预览后已被修改，请重新预览",
      "RESTORE_SHA_MISMATCH",
    );
  }

  const text = content.toString("utf-8");
  const parsed = parseWorkspace(text);
  if (parsed.items.length > 0 && parsed.items.every((it) => !isParseableItem(it))) {
    throw new WorkspaceHttpError(
      400,
      "这份备份里没有可解析的条目，已拒绝恢复",
      "RESTORE_UNPARSEABLE",
    );
  }
  const issues = validateWorkspaceGraph(parsed.items, { includeHistorical: true });
  if (issues.length) {
    throw new WorkspaceHttpError(400, "备份数据校验失败，已拒绝恢复", "RESTORE_INVALID", {
      issues,
    });
  }

  restoring = true;
  const epoch = invalidateSyncEpoch();
  const marker: RestoreMarker = {
    phase: "prepared",
    file,
    sha256,
    startedAt: new Date().toISOString(),
    epoch,
  };

  try {
    writeMarker(marker);
    setSyncMaintenance(true);
    stopCalDAVAutoSync();
    await pauseReminderScheduler();

    const drained = await waitForInFlightSync(drainTimeoutMs());
    if (!drained) {
      marker.phase = "failed";
      marker.error = "等待在途同步超时";
      writeMarker(marker);
      throw new MaintenanceError(
        "同步任务未在 10 秒内结束，恢复已暂停；可稍后重试或取消恢复",
      );
    }
    marker.phase = "drained";
    writeMarker(marker);

    // 固定这份快照，防止 24h TTL / 轮转把它删掉，后续重试仍可用。
    const dir = backupsDir();
    pinBackup(dir, sha256, text);
    const fixed = path.join(dir, ".pinned", `${sha256}.md`);
    if (!fs.existsSync(fixed)) {
      throw new WorkspaceReadOnlyError("无法固定备份快照，恢复已中止");
    }

    const preRestore = backupWorkspaceFile(workspaceFilePath());
    marker.phase = "pre-restore";
    writeMarker(marker);

    const keepKeys = new Set<string>();
    for (const item of parsed.items) {
      const key = reminderKey(item);
      if (key) keepKeys.add(key);
    }

    await withWorkspaceLock(async () => {
      if (epoch !== currentSyncEpoch()) {
        throw new SyncEpochError("恢复期间同步纪元已变化，已中止写入");
      }
      atomicWriteFile(workspaceFilePath(), text, 0o644);
      resetSyncStateFiles();
      try {
        pruneReminderSent(keepKeys);
      } catch (e) {
        console.warn("[恢复] 重置提醒状态失败：", (e as Error).message);
      }
      writeSyncSuspension();
    }, 15_000);

    marker.phase = "written";
    writeMarker(marker);

    clearRestoreMarker();
    setSyncMaintenance(false);
    resumeReminderScheduler();

    console.log(
      `[恢复] 已从 ${file} 恢复 ${parsed.items.length} 条；同步已暂停，等待选择方向。`,
    );

    return {
      success: true,
      file,
      sha256,
      items: parsed.items.length,
      preRestoreBackup: preRestore,
      suspended: true,
    };
  } catch (e) {
    marker.phase = "failed";
    marker.error = (e as Error).message;
    try {
      writeMarker(marker);
    } catch {
      /* marker 写不进去也不能掩盖原始错误 */
    }
    throw e;
  } finally {
    restoring = false;
  }
}

export interface AbortResult {
  success: true;
  aborted: boolean;
  suspended: boolean;
}

/** 放弃未完成的恢复：解除冻结，工作区保持现状，同步仍暂停。 */
export function abortRestore(): AbortResult {
  if (restoring) {
    throw new WorkspaceHttpError(409, "恢复正在执行，无法中止", "RESTORE_IN_PROGRESS");
  }
  const marker = readRestoreMarker();
  if (!marker) {
    throw new WorkspaceHttpError(409, "没有未完成的恢复", "RESTORE_NOT_FOUND");
  }
  clearRestoreMarker();
  setSyncMaintenance(false);
  resumeReminderScheduler();
  console.warn("[恢复] 用户取消了未完成的恢复；工作区保持现状，同步仍暂停。");
  return { success: true, aborted: true, suspended: isSyncSuspended() };
}

export interface ResumeResult {
  success: true;
  action: "pull" | "push" | "bidirectional";
  sync: unknown;
  syncError: string | null;
}

/** 恢复之后由用户显式选择同步方向，才重新开始同步。 */
export async function resumeSync(actionRaw: unknown): Promise<ResumeResult> {
  if (restoring || isSyncMaintenance()) {
    throw new WorkspaceHttpError(409, "恢复尚未结束，无法恢复同步", "RESTORE_IN_PROGRESS");
  }
  const raw = typeof actionRaw === "string" ? actionRaw.trim() : "";
  if (!["pull", "push", "bidirectional"].includes(raw)) {
    throw new WorkspaceHttpError(
      400,
      "action 必须是 pull / push / bidirectional",
      "RESUME_ACTION_INVALID",
    );
  }
  if (!isSyncSuspended()) {
    throw new WorkspaceHttpError(409, "同步没有被暂停，无需恢复", "SYNC_NOT_SUSPENDED");
  }

  const action = normalizeDirection(raw) as "pull" | "push" | "bidirectional";
  clearSyncSuspension();
  invalidateSyncEpoch();

  const caldav = loadCalDAVSyncSettings();
  if (!caldav.rootUrl || !caldav.username) {
    startCalDAVAutoSync();
    return { success: true, action, sync: null, syncError: null };
  }

  let sync: unknown = null;
  let syncError: string | null = null;
  try {
    sync = await syncWorkspaceToCalDAV({ direction: action });
  } catch (e) {
    syncError = (e as Error).message;
    console.warn("[恢复] 恢复同步失败（本地数据未受影响）：", syncError);
  }
  startCalDAVAutoSync();
  return { success: true, action, sync, syncError };
}
