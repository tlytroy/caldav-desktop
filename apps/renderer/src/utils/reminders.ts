/**
 * 提醒（本地能力，不依赖服务器）
 * ==============================
 *
 * ## 为什么提醒时间存「绝对时刻」
 *
 * 全天条目、只有截止日的任务没有明确的开始时间。如果存「提前几分钟」，
 * 就得定义一堆隐藏规则（从 0 点算？从 9 点算？跨天怎么算？），
 * 用户看到的和实际触发的容易对不上。存绝对时间串，界面上一眼就能看懂。
 *
 * 界面上的「提前 30 分钟」只是**输入辅助**：选中后换算成绝对时间再保存。
 *
 * ## 触发规则
 *
 * - 只提醒 `remind <= now` 且 `now - remind <= 24h` 的（过期太久不轰炸用户）
 * - 已完成 / 已取消的条目不提醒
 * - 同一个「条目 id + 提醒时间」只提醒一次（fired 集合）
 * - 「稍后提醒」记录 snoozeUntil，到点后重新提醒
 */

import type { WorkbenchItem } from "../api/workspace";
import {
  localDate,
  parseLocalDateTime,
  timeOf,
  toLocalIso,
} from "./date";

/** 提醒输入辅助选项 */
export interface RemindPreset {
  value: string;
  label: string;
  /** 提前多少分钟；undefined = 不提醒 */
  minutes?: number;
}

export const REMIND_PRESETS: RemindPreset[] = [
  { value: "none", label: "不提醒" },
  { value: "0", label: "开始时", minutes: 0 },
  { value: "10", label: "提前 10 分钟", minutes: 10 },
  { value: "30", label: "提前 30 分钟", minutes: 30 },
  { value: "60", label: "提前 1 小时", minutes: 60 },
  { value: "1440", label: "提前 1 天", minutes: 1440 },
];

/** 提醒的「基准时刻」：定时条目用 start；全天 / 只有截止日 → 当天 09:00 */
export function reminderBase(item: {
  start?: string;
  due?: string;
  allDay?: boolean;
}): Date | null {
  const start = parseLocalDateTime(item.start);
  if (start) {
    if (item.allDay) start.setHours(9, 0, 0, 0);
    return start;
  }
  if (item.due) return parseLocalDateTime(`${item.due.slice(0, 10)}T09:00:00`);
  return null;
}

/** 基准时刻 - 提前分钟数 → 本地时间串 */
export function computeRemindAt(base: Date, minutes: number): string {
  return toLocalIso(new Date(base.getTime() - minutes * 60_000));
}

/** 现有 remind 对应的「提前分钟数」；不匹配任何预设返回 null */
export function presetMinutesOf(
  remind: string | undefined,
  base: Date | null,
): number | null {
  if (!remind || !base) return null;
  const r = parseLocalDateTime(remind);
  if (!r) return null;
  const diff = Math.round((base.getTime() - r.getTime()) / 60_000);
  return REMIND_PRESETS.some((p) => p.minutes === diff) ? diff : null;
}

/** 选择器当前值：none / 数字 / custom（自定义绝对时间） */
export function presetValueOf(
  remind: string | undefined,
  base: Date | null,
): string {
  if (!remind) return "none";
  const m = presetMinutesOf(remind, base);
  return m === null ? "custom" : String(m);
}

// ===== 到点提醒 =====

/** 只提醒 24 小时内到点的（应用关太久不轰炸） */
export const REMINDER_GRACE_MS = 24 * 3_600_000;
/** 默认「稍后提醒」间隔 */
export const SNOOZE_MS = 10 * 60_000;

export interface ReminderHit {
  key: string;
  item: WorkbenchItem;
  at: Date;
  /** 已经晚了多少分钟 */
  lateMinutes: number;
}

/** 去重键：条目 + 提醒时间（改提醒时间算一条新提醒） */
export function reminderKey(item: WorkbenchItem): string | null {
  if (!item.remind) return null;
  return `${item.id}|${item.remind}`;
}

/**
 * 找出此刻应该弹出的提醒。
 *
 * @param opts.fired   已提醒过的 key 集合（持久化在 localStorage）
 * @param opts.snoozed key → 稍后提醒到的毫秒时间戳
 */
export function collectDueReminders(
  items: WorkbenchItem[],
  opts: {
    now?: number;
    fired?: ReadonlySet<string>;
    snoozed?: Record<string, number>;
    graceMs?: number;
  } = {},
): ReminderHit[] {
  const now = opts.now ?? Date.now();
  const fired = opts.fired ?? new Set<string>();
  const snoozed = opts.snoozed ?? {};
  const grace = opts.graceMs ?? REMINDER_GRACE_MS;

  const hits: ReminderHit[] = [];
  for (const item of items) {
    if (!item.remind || item.done) continue;
    if (item.status === "cancelled") continue;

    const key = reminderKey(item);
    if (!key || fired.has(key)) continue;

    const snoozeUntil = snoozed[key];
    if (snoozeUntil && snoozeUntil > now) continue;

    const at = parseLocalDateTime(item.remind);
    if (!at) continue;
    const t = at.getTime();
    if (t > now) continue;
    if (now - t > grace) continue;

    hits.push({
      key,
      item,
      at,
      lateMinutes: Math.floor((now - t) / 60_000),
    });
  }

  return hits.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** 未来会提醒的条目（通知页展示用） */
export function upcomingReminders(
  items: WorkbenchItem[],
  now: number = Date.now(),
  limit = 20,
): ReminderHit[] {
  const out: ReminderHit[] = [];
  for (const item of items) {
    if (!item.remind || item.done) continue;
    if (item.status === "cancelled") continue;
    const at = parseLocalDateTime(item.remind);
    if (!at || at.getTime() < now) continue;
    out.push({
      key: reminderKey(item) || item.id,
      item,
      at,
      lateMinutes: 0,
    });
  }
  return out
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, limit);
}

/** 「11-02 09:30」这样的提醒时刻文案 */
export function describeRemind(remind?: string): string {
  const d = parseLocalDateTime(remind);
  if (!d || !remind) return "不提醒";
  return `${localDate(d)} ${timeOf(remind)}`;
}

/** 条目的时间文案（提醒卡片上用） */
export function describeItemTime(item: WorkbenchItem): string {
  if (item.allDay) {
    const day = (item.start || item.due || "").slice(0, 10);
    return day ? `${day} 全天` : "";
  }
  const start = parseLocalDateTime(item.start);
  if (start) return `${localDate(start)} ${timeOf(item.start)}`;
  if (item.due) return `${item.due.slice(0, 10)} 截止`;
  return "";
}
