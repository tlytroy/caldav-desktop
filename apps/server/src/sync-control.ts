/**
 * 同步控制：epoch / maintenance / in-flight 登记 + 同步事件环形缓冲（SDS §2.7 / §5）
 *
 * 解决的问题：恢复（restore）会在同步流程「下载完成、还没写盘」的窗口里发生。
 * 如果只在恢复时清定时器，正在飞行的 pull 仍会把旧数据写回事实源。
 *
 * 机制：
 *  - 每个同步开始时记下 epoch；提交前比对，不一致就抛 SyncEpochError，不写盘；
 *  - restore 开始时 epoch++ 并进入 maintenance，所有写路径再检查一次；
 *  - 飞行中的同步通过 beginSyncActivity 登记，restore 用 waitForInFlightSync 等待收敛。
 *
 * 另外维护两份**进程内**环形缓冲（各 20 条），给「同步中心」展示最近事件与冲突：
 * 不写历史文件（D13/D18），重启即清空。
 *
 * 进程内状态，不持久化；重启后由 marker 文件恢复（P7）。
 */

import {
  WorkspaceReadOnlyError,
  SyncEpochError,
  MaintenanceError,
} from "./errors.js";

let epoch = 1;
let maintenance = false;
let readOnly = false;
const activities = new Map<string, number>();
let nextActivityId = 1;

/** 当前 epoch（恢复后自增，旧任务据此作废） */
export function currentSyncEpoch(): number {
  return epoch;
}

/** epoch++，返回新值；用于恢复开始/结束时作废旧任务 */
export function invalidateSyncEpoch(): number {
  epoch += 1;
  return epoch;
}

/** 进入/退出维护态（恢复期间所有写入返回 503） */
export function setSyncMaintenance(on: boolean): void {
  maintenance = on;
}

export function isSyncMaintenance(): boolean {
  return maintenance;
}

/**
 * 只读模式（存储自检失败）：所有写路径拒绝。
 * 读接口不受影响 —— 本地优先，宁可只读也不锁死用户。
 */
export function setStorageReadOnly(on: boolean): void {
  readOnly = on;
}

export function isStorageReadOnly(): boolean {
  return readOnly;
}

/** 写路径统一入口检查：只读 → 503；维护态 → 503；epoch 变了 → 503 */
export function assertWritable(
  epochAtStart?: number,
  what = "写入",
): void {
  if (readOnly) {
    throw new WorkspaceReadOnlyError(`存储只读，${what}已拒绝`);
  }
  if (maintenance) {
    throw new MaintenanceError(`正在恢复数据，${what}已暂停`);
  }
  if (epochAtStart !== undefined && epochAtStart !== epoch) {
    throw new SyncEpochError();
  }
}

/** 登记一次飞行中的同步；返回的 end() 必须放在 finally 里调用 */
export type SyncActivityKind = "caldav" | "webdav" | "restore" | "reminder";

export function beginSyncActivity(kind: SyncActivityKind): () => void {
  const id = nextActivityId++;
  activities.set(`${kind}#${id}`, Date.now());
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activities.delete(`${kind}#${id}`);
  };
}

/** 当前飞行中的同步数量（按类型） */
export function inFlightCount(kind?: "caldav" | "webdav" | "restore"): number {
  if (!kind) return activities.size;
  let n = 0;
  for (const key of activities.keys()) {
    if (key.startsWith(`${kind}#`)) n += 1;
  }
  return n;
}

/**
 * 等待所有飞行中的同步结束。
 * 返回 true = 已排空；false = 超时（restore 必须保留 marker 并返回 503）。
 */
export async function waitForInFlightSync(
  timeoutMs: number,
  pollMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (activities.size > 0) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
}

// ===== 同步事件 / 冲突（环形缓冲，各 20 条） =====

export type SyncChannel = "caldav" | "webdav" | "restore";

/** 一条同步事件（推送/拉取/合并/失败/epoch 作废） */
export interface SyncEvent {
  ts: string;
  channel: SyncChannel;
  /** sync | push | pull | merge | error | aborted | restore */
  kind: string;
  message: string;
}

/** 一条冲突记录；`summary` 给用户看，其余用于排查 */
export interface SyncConflictRecord {
  ts: string;
  channel: SyncChannel;
  localId?: string;
  remoteHref?: string;
  localHash?: string;
  remoteEtag?: string;
  summary: string;
}

const RING_MAX = 20;
const events: SyncEvent[] = [];
const conflicts: SyncConflictRecord[] = [];

function trimRing<T>(arr: T[], max = RING_MAX): void {
  while (arr.length > max) arr.shift();
}

/** 记录一条同步事件（同步成功后调用；失败也记，kind="error"） */
export function recordSyncEvent(
  channel: SyncChannel,
  kind: string,
  message: string,
): void {
  events.push({
    ts: new Date().toISOString(),
    channel,
    kind,
    message: message.length > 500 ? `${message.slice(0, 500)}…` : message,
  });
  trimRing(events);
}

/** 记录一条冲突（不静默吞掉；界面只提供「重新合并」） */
export function recordSyncConflict(
  entry: Omit<SyncConflictRecord, "ts">,
): void {
  conflicts.push({ ts: new Date().toISOString(), ...entry });
  trimRing(conflicts);
}

/** 最近的同步事件（旧 → 新） */
export function getSyncEvents(): SyncEvent[] {
  return events.map((e) => ({ ...e }));
}

/** 最近的冲突（旧 → 新） */
export function getSyncConflicts(): SyncConflictRecord[] {
  return conflicts.map((c) => ({ ...c }));
}

/** 仅供测试：重置进程内状态 */
export function __resetSyncControlForTests(): void {
  epoch = 1;
  maintenance = false;
  readOnly = false;
  activities.clear();
  nextActivityId = 1;
  events.length = 0;
  conflicts.length = 0;
}
