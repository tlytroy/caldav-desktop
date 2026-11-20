/**
 * 本地日期时间工具
 * =================
 *
 * 统一数据源里的时间是**不带时区的本地时间串**（`2026-11-02T09:00:00`）。
 *
 * ⚠️ 不要写 `new Date("2026-11-02")` —— 按 ECMAScript 规范，纯日期串会被当成
 * **UTC 午夜**。在东八区它等于本地 08:00，于是「今天到期」的任务从早上 8 点起
 * 就被判成逾期（这是一个真实踩过的 bug）。
 *
 * 这里的函数统一走 `new Date("YYYY-MM-DDT23:59:59.999")`（带时间 → 本地时区），
 * 或者手动拆日期再 `new Date(y, m-1, d)`。
 */

/** Date → 本地日期串 YYYY-MM-DD */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Date → 本地时间串 YYYY-MM-DDTHH:mm:ss（不带 Z） */
export function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 只取日期部分（兼容 "2026-11-02T09:00:00" 与 "2026-11-02"） */
export function dateOnly(value?: string | null): string | undefined {
  if (!value) return undefined;
  const s = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

/** 解析本地时间串；非法返回 null（不要回退成 UTC 解释） */
export function parseLocalDateTime(value?: string | null): Date | null {
  if (!value) return null;
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 本地日期串 → 当天最后一毫秒（用于「今天到期不算逾期」） */
export function endOfLocalDay(
  value?: string | null,
  base: Date = new Date(),
): Date {
  const day = dateOnly(value) ?? localDate(base);
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/**
 * 是否逾期。
 *
 * 规则：**截止日当天不算逾期**（和看板清单统计口径一致）。
 * 只传日期时按本地日历日解释；done 的条目不参与逾期。
 */
export function isOverdue(
  due: string | null | undefined,
  done?: boolean,
  now: number = Date.now(),
): boolean {
  if (done || !due) return false;
  const day = dateOnly(due);
  if (!day) return false;
  const end = endOfLocalDay(day).getTime();
  return end < now;
}

/** 加小时（返回新 Date，不修改入参） */
export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000);
}

/** 加天（按日历日推进，避免夏令时把 24h 变成 23/25h） */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds());
}

/** 时间串 → "HH:mm"（用于 <input type="time">） */
export function timeOf(value?: string | null): string {
  const d = parseLocalDateTime(value);
  if (!d) return "09:00";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
