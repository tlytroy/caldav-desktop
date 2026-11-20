/**
 * 服务端提醒检查（用于推送渠道）
 * ================================
 *
 * 与前端 ReminderHost 的分工：
 *  - 前端：应用打开时的**应用内**提醒（30 秒轮询，localStorage 去重）
 *  - 这里：后端定时检查并**推送到手机**（企业微信 / Server酱 / Bark…）
 *
 * Docker 部署时后端 7×24 运行，所以即使手机 / 电脑都没开也能收到推送。
 * 桌面版后端只在本机运行，推送就只在应用运行时发生。
 *
 * 去重状态存在 workspace.md 同目录的 `.reminder-state.json`：
 *  - sent：已成功推送的 key（条目 id + 提醒时间）
 *  - failed：推送失败的 key + 时间，5 分钟后重试
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "../config.js";
import {
  readWorkspace,
  workspaceFilePath,
  type WorkbenchItem,
} from "../workspace.js";
import { enabledChannelIds, sendPush, channelConfigured } from "./push.js";
import {
  beginSyncActivity,
  currentSyncEpoch,
  isSyncMaintenance,
} from "../sync-control.js";

/** 超过 24 小时才检查到的提醒不推送（避免一次涌入一堆过期提醒） */
export const REMINDER_GRACE_MS = 24 * 3_600_000;
/** 推送失败后的重试间隔 */
const RETRY_DELAY_MS = 5 * 60_000;
const TICK_MS = 30_000;
const STATE_TTL_MS = 30 * 24 * 3_600_000;

interface ReminderState {
  sent: Record<string, number>;
  failed: Record<string, number>;
}

/** 提醒状态文件路径（恢复流程会重写 sent） */
export function reminderStatePath(): string {
  return statePath();
}

function statePath(): string {
  if (process.env.REMINDER_STATE_FILE) return process.env.REMINDER_STATE_FILE;
  return path.join(path.dirname(workspaceFilePath()), ".reminder-state.json");
}

function prune(map: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (now - v <= STATE_TTL_MS) out[k] = v;
  }
  return out;
}

function readState(now = Date.now()): ReminderState {
  try {
    const p = statePath();
    if (!fs.existsSync(p)) return { sent: {}, failed: {} };
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      sent: prune(parsed?.sent || {}, now),
      failed: prune(parsed?.failed || {}, now),
    };
  } catch {
    return { sent: {}, failed: {} };
  }
}

function writeState(state: ReminderState): void {
  try {
    const p = statePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.warn("[提醒] 写入推送状态失败：", (e as Error).message);
  }
}

export interface DueReminder {
  key: string;
  item: WorkbenchItem;
  at: Date;
  lateMinutes: number;
}

export function reminderKey(item: WorkbenchItem): string | null {
  if (!item.remind) return null;
  return `${item.id}|${item.remind}`;
}

function parseLocal(s?: string): Date | null {
  if (!s) return null;
  // 带 T 的本地时间串按本地时区解释（与前端一致）
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 找出此刻应该推送的提醒（纯函数，便于测试） */
export function collectDueReminders(
  items: WorkbenchItem[],
  opts: {
    now?: number;
    sent?: Record<string, number>;
    failed?: Record<string, number>;
    graceMs?: number;
  } = {},
): DueReminder[] {
  const now = opts.now ?? Date.now();
  const sent = opts.sent ?? {};
  const failed = opts.failed ?? {};
  const grace = opts.graceMs ?? REMINDER_GRACE_MS;

  const out: DueReminder[] = [];
  for (const item of items) {
    if (!item.remind || item.done) continue;
    if (item.status === "cancelled") continue;

    const key = reminderKey(item);
    if (!key || sent[key]) continue;

    const lastFail = failed[key];
    if (lastFail && now - lastFail < RETRY_DELAY_MS) continue;

    const at = parseLocal(item.remind);
    if (!at) continue;
    const t = at.getTime();
    if (t > now) continue;
    if (now - t > grace) continue;

    out.push({
      key,
      item,
      at,
      lateMinutes: Math.floor((now - t) / 60_000),
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** 推送正文：时间 + 清单 / 项目 + 类型 */
export function reminderBody(item: WorkbenchItem): string {
  const parts: string[] = [];
  if (item.allDay) {
    const day = (item.start || item.due || "").slice(0, 10);
    if (day) parts.push(`${day} 全天`);
  } else if (item.start) {
    parts.push(item.start.replace("T", " ").slice(0, 16));
  } else if (item.due) {
    parts.push(`${item.due.slice(0, 10)} 截止`);
  }
  parts.push(item.kind === "task" ? "任务" : "日程");
  if (item.list) parts.push(`清单：${item.list}`);
  if (item.project) parts.push(`项目：${item.project}`);
  return parts.join(" · ");
}

export interface ReminderRunResult {
  /** 已启用的推送渠道数 */
  channels: number;
  /** 本次到点的提醒数 */
  due: number;
  /** 成功推送的条数 */
  sent: number;
  /** 推送失败的条数 */
  failed: number;
  errors: string[];
}

/**
 * 执行一次检查 + 推送。
 *
 * 只要**任一**渠道成功就记为已推送（避免某个渠道配错导致其他渠道重复收）；
 * 全部失败则记录 failed，5 分钟后重试。
 */
export async function runReminderCheck(opts: {
  now?: number;
  /** 忽略「已推送」标记，用于调试 */
  resetFailed?: boolean;
} = {}): Promise<ReminderRunResult> {
  const channels = enabledChannelIds();
  const result: ReminderRunResult = {
    channels: channels.length,
    due: 0,
    sent: 0,
    failed: 0,
    errors: [],
  };
  if (!channels.length) return result;

  const now = opts.now ?? Date.now();
  const epochAtStart = currentSyncEpoch();
  const state = readState(now);
  if (opts.resetFailed) state.failed = {};

  const items = readWorkspace().items.filter((i) => !i.errors);
  const due = collectDueReminders(items, {
    now,
    sent: state.sent,
    failed: state.failed,
  });
  result.due = due.length;

  const endActivity = beginSyncActivity("reminder");
  try {
  for (const hit of due) {
    const results = await sendPush({
      title: hit.item.title,
      body: reminderBody(hit.item),
      tags: [hit.item.kind === "task" ? "task" : "event"],
    });
    const ok = results.some((r) => r.ok);
    if (ok) {
      state.sent[hit.key] = now;
      delete state.failed[hit.key];
      result.sent++;
      console.log(`[提醒] 已推送：${hit.item.title}（${hit.key}）`);
    } else {
      state.failed[hit.key] = now;
      result.failed++;
      const errs = results
        .filter((r) => !r.ok)
        .map((r) => `${r.channel}: ${r.error}`);
      result.errors.push(...errs);
      console.warn(`[提醒] 推送失败：${hit.item.title} → ${errs.join("；")}`);
    }
  }
  } finally {
    endActivity();
  }

  if (epochAtStart !== currentSyncEpoch() || isSyncMaintenance()) {
    console.warn("[提醒] 同步纪元已变化，跳过写回已发送状态");
    return result;
  }

  writeState(state);
  return result;
}

// ===== 定时器 =====

let timer: NodeJS.Timeout | null = null;
let lastRunAt = 0;
let lastResult: ReminderRunResult | null = null;

let runningTick: Promise<void> | null = null;

async function tick(): Promise<void> {
  if (runningTick) return runningTick;
  runningTick = (async () => {
    try {
      const r = await runReminderCheck();
      lastResult = r;
      lastRunAt = Date.now();
    } catch (e) {
      console.warn("[提醒] 检查失败：", (e as Error).message);
    } finally {
      runningTick = null;
    }
  })();
  return runningTick;
}

/** 启动服务端提醒检查（幂等；没有启用任何推送渠道时不做任何事） */
export function startReminderScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref?.();
  void tick();

  const channels = enabledChannelIds();
  if (channels.length) {
    console.log(
      `[提醒] 服务端推送已启用：${channels.join(", ")}（每 ${TICK_MS / 1000} 秒检查一次）`,
    );
  }
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * 暂停：停掉定时器并等待当前这一轮结束。
 * 恢复流程必须先调用它，否则本轮可能在 sent 重置之后把旧状态写回去。
 */
export async function pauseReminderScheduler(): Promise<void> {
  stopReminderScheduler();
  if (runningTick) {
    try {
      await runningTick;
    } catch {
      /* tick 内部已 catch */
    }
  }
}

/** 恢复：幂等重启（没有启用任何推送渠道时 start 内部自行判断） */
export function resumeReminderScheduler(): void {
  startReminderScheduler();
}

/**
 * 恢复工作区后重写 sent/failed：只保留新工作区里仍存在的 `id|remind`。
 * 这样未变化的条目不会重复推送，已经改过提醒时间的条目会重新生效。
 */
export function pruneReminderSent(keep: Set<string>): void {
  const state = readState(Date.now());
  const sent: Record<string, number> = {};
  const failed: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.sent)) if (keep.has(k)) sent[k] = v;
  for (const [k, v] of Object.entries(state.failed)) if (keep.has(k)) failed[k] = v;
  writeState({ sent, failed });
}

/** 状态摘要（给界面用） */
export function getReminderStatus(): {
  pushEnabled: boolean;
  channels: string[];
  configuredChannels: string[];
  dueCount: number;
  lastSentAt: number | null;
  lastRunAt: number | null;
  lastResult: ReminderRunResult | null;
  stateFile: string;
  intervalSeconds: number;
} {
  const now = Date.now();
  const state = readState(now);
  let items: WorkbenchItem[] = [];
  try {
    items = readWorkspace().items.filter((i) => !i.errors);
  } catch (e) {
    console.warn("[提醒] 读取工作区失败：", (e as Error).message);
  }
  const due = collectDueReminders(items, {
    now,
    sent: state.sent,
    failed: state.failed,
  });
  const sentTimes = Object.values(state.sent);
  const lastSentAt = sentTimes.length ? Math.max(...sentTimes) : 0;

  const ids = ["wecom", "serverchan", "pushplus", "bark", "ntfy", "webhook"] as const;
  return {
    pushEnabled: getConfig().notifications.enabled,
    channels: enabledChannelIds(),
    configuredChannels: ids.filter((id) => channelConfigured(id)),
    dueCount: due.length,
    lastSentAt: lastSentAt || null,
    lastRunAt: lastRunAt || null,
    lastResult,
    stateFile: statePath(),
    intervalSeconds: TICK_MS / 1000,
  };
}
