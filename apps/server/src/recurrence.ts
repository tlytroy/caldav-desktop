/**
 * 重复规则（RRULE）
 * =================
 *
 * 采用 RFC 5545 的 RRULE 子集，因为它同时满足三个要求：
 *  1. 能表达「每周一三五」「每月1号」这类规则（简单枚举做不到）
 *  2. 导出 ICS 时可以直接映射到 RRULE 行，不丢信息
 *  3. 业界通用，换解析器不用重写数据
 *
 * ## 支持的规则
 *
 * | 界面选项           | RRULE                            |
 * | ------------------ | -------------------------------- |
 * | 不重复             | （无）                            |
 * | 每天               | FREQ=DAILY                       |
 * | 每周               | FREQ=WEEKLY                      |
 * | 每周一 / 每周一三五  | FREQ=WEEKLY;BYDAY=MO,WE,FR       |
 * | 每月               | FREQ=MONTHLY                     |
 * | 每月1号             | FREQ=MONTHLY;BYMONTHDAY=1        |
 * | 每年               | FREQ=YEARLY                      |
 *
 * 另外支持 UNTIL（结束日期）与 COUNT（次数），界面上先不暴露，
 * 但解析与展开都支持，这样外部导入的 ICS 规则不会丢。
 *
 * ## 展开算法
 *
 * v0.3 起不再自己写日期推进，改用 `rrule`（RFC 5545 的成熟实现）展开。
 * 自己算「每月31号遇到2月」「2月29日」「INTERVAL + BYDAY」这些边界太容易错，
 * 这类轮子没必要重复造。我们只做一层适配：把「本地日期时间」映射到 UTC
 * 伪时间轴交给 rrule，再把结果按 UTC 读回成本地日历日，避免夏令时/时区漂移。
 */

// `rrule@2` 是 CJS 包（webpack UMD 产物），ESM 的具名导入在 Node 里会报
// "does not provide an export named 'RRule'"（vitest 走转换不会暴露这个问题，
// 只有跑 dist/ 才会炸）。用默认导入再解构。
import rrulePkg from "rrule";
import type { Options } from "rrule";

const { RRule } = rrulePkg;

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** WEEKLY 时的星期（MO=1 … SU=7），与 JS getDay 对齐：0=周日 */
  byDay?: number[];
  /** MONTHLY 时的几号（1-31） */
  byMonthDay?: number[];
  /** 结束日期（含当天），YYYY-MM-DD */
  until?: string;
  /** 总次数 */
  count?: number;
  /** 相隔几周/几月（INTERVAL=2 表示每两周） */
  interval?: number;
}

/** RRULE → 中文界面标签 */
export const RECURRENCE_LABELS: Record<string, string> = {
  "": "不重复",
  "FREQ=DAILY": "每天",
  "FREQ=WEEKLY": "每周",
  "FREQ=MONTHLY": "每月",
  "FREQ=YEARLY": "每年",
};

/** 解析 RRULE 字符串；无效时返回 null */
export function parseRRule(raw: string | undefined | null): RecurrenceRule | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // 允许带 RRULE: 前缀
  const body = s.replace(/^RRULE:/i, "");
  const parts = body.split(";");
  const map: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx <= 0) continue;
    map[p.slice(0, idx).trim().toUpperCase()] = p.slice(idx + 1).trim();
  }

  const freq = map.FREQ?.toUpperCase();
  if (
    freq !== "DAILY" &&
    freq !== "WEEKLY" &&
    freq !== "MONTHLY" &&
    freq !== "YEARLY"
  ) {
    return null;
  }

  const rule: RecurrenceRule = {
    freq: freq as RecurrenceFreq,
    interval: map.INTERVAL ? Math.max(1, parseInt(map.INTERVAL, 10) || 1) : 1,
  };

  if (map.BYDAY) {
    rule.byDay = map.BYDAY.split(",")
      .map((d) => weekdayToIndex(d.trim()))
      .filter((n): n is number => n !== null);
    if (rule.byDay.length === 0) delete rule.byDay;
  }

  if (map.BYMONTHDAY) {
    rule.byMonthDay = map.BYMONTHDAY.split(",")
      .map((d) => parseInt(d.trim(), 10))
      .filter((n) => n >= 1 && n <= 31);
    if (rule.byMonthDay.length === 0) delete rule.byMonthDay;
  }

  if (map.UNTIL) {
    // UNTIL 可能是 20261101T000000Z 或 20261101
    const u = map.UNTIL.replace(/Z$/i, "");
    const m = u.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) rule.until = `${m[1]}-${m[2]}-${m[3]}`;
  }

  if (map.COUNT) {
    const c = parseInt(map.COUNT, 10);
    if (c > 0) rule.count = c;
  }

  return rule;
}

/** MO/MO..SU → 1..7（1=周一）；MO=1, TU=2, WE=3, TH=4, FR=5, SA=6, SU=7 */
function weekdayToIndex(d: string): number | null {
  const map: Record<string, number> = {
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
    SU: 7,
  };
  return map[d.toUpperCase()] ?? null;
}

/** 1..7（1=周一）→ MO..SU */
export function indexToWeekday(i: number): string {
  return ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][(i - 1) % 7] ?? "MO";
}

/** RRULE → 中文标签（带 BYDAY / BYMONTHDAY 的细分描述） */
export function describeRRule(raw: string | undefined | null): string {
  const rule = parseRRule(raw);
  if (!rule) return "不重复";

  if (rule.freq === "DAILY") return "每天";
  if (rule.freq === "YEARLY") return "每年";

  if (rule.freq === "WEEKLY") {
    if (rule.byDay && rule.byDay.length > 0) {
      const names = ["一", "二", "三", "四", "五", "六", "日"];
      return `每周${rule.byDay.map((i) => names[(i - 1) % 7]).join("、")}`;
    }
    return "每周";
  }

  if (rule.freq === "MONTHLY") {
    if (rule.byMonthDay && rule.byMonthDay.length > 0) {
      return `每月${rule.byMonthDay.join("、")}号`;
    }
    return "每月";
  }

  return RECURRENCE_LABELS[raw as string] ?? "不重复";
}

/**
 * 把 RRULE 序列化成规范字符串（字段顺序固定，便于 diff 与幂等比较）。
 */
export function formatRRule(rule: RecurrenceRule): string {
  const parts: string[] = [`FREQ=${rule.freq}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay && rule.byDay.length > 0) {
    parts.push(`BYDAY=${rule.byDay.map(indexToWeekday).join(",")}`);
  }
  if (rule.byMonthDay && rule.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  }
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, "")}T235959Z`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}

// ===== 日期工具（全部按本地日历日） =====

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * 展开重复规则为具体发生日期。
 *
 * 交给 rrule 计算，本函数只负责本地日期 ↔ UTC 伪日期轴的适配。
 *
 * @param startIso 首次发生的时间（ISO 本地时间串，如 "2026-10-28T09:00:00"）
 * @param rule RRULE 规则
 * @param rangeStart 展开区间起（本地日历日 YYYY-MM-DD），含
 * @param rangeEnd 展开区间止（本地日历日 YYYY-MM-DD），含
 * @param maxCount 硬上限，防止规则写错导致无限展开
 * @returns 发生日期数组（本地日历日 YYYY-MM-DD，按时间升序）
 */
export function expandRecurrenceDates(
  startIso: string,
  rule: RecurrenceRule,
  rangeStart: string,
  rangeEnd: string,
  maxCount = 400,
): string[] {
  const start = new Date(startIso);
  if (isNaN(start.getTime())) return [];

  const rs = new Date(`${rangeStart}T00:00:00`);
  const re = new Date(`${rangeEnd}T23:59:59`);
  if (isNaN(rs.getTime()) || isNaN(re.getTime())) {
    return [];
  }

  const options: Partial<Options> = {
    freq: FREQ_TO_RRULE[rule.freq],
    dtstart: toPseudoUtc(start),
    interval: Math.max(1, rule.interval ?? 1),
  };
  if (rule.byDay && rule.byDay.length > 0) {
    options.byweekday = rule.byDay.map((d) => RRULE_WEEKDAYS[d - 1]);
  }
  if (rule.byMonthDay && rule.byMonthDay.length > 0) {
    options.bymonthday = rule.byMonthDay;
  }
  if (rule.count) options.count = rule.count;
  if (rule.until) {
    const until = new Date(`${rule.until}T23:59:59`);
    if (!isNaN(until.getTime())) options.until = toPseudoUtc(until);
  }

  let dates: Date[];
  try {
    dates = new RRule(options as Options).between(
      toPseudoUtc(rs),
      toPseudoUtc(re),
      true,
    );
  } catch {
    // 规则本身非法（例如 BYMONTHDAY=0）：当作不展开，不要拖垮日历渲染
    return [];
  }

  return dates.slice(0, maxCount).map(pseudoUtcYmd);
}

/** 本地日期时间 → UTC 伪时间（只借用 UTC 的算术，不改变墙上时间） */
function toPseudoUtc(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
    ),
  );
}

/** UTC 伪时间 → 本地日历日 YYYY-MM-DD */
function pseudoUtcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const FREQ_TO_RRULE: Record<RecurrenceFreq, number> = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
};

/** 与 indexToWeekday 对齐：1=周一 … 7=周日 */
const RRULE_WEEKDAYS = [
  RRule.MO,
  RRule.TU,
  RRule.WE,
  RRule.TH,
  RRule.FR,
  RRule.SA,
  RRule.SU,
];

/**
 * 把带重复规则的事件展开成多个实例（用于日历渲染）。
 *
 * @param eventStart 首次发生的本地时间 ISO 串
 * @param eventEnd 首次结束的本地时间 ISO 串
 * @param rrule RRULE 字符串
 * @param rangeStart 区间起（本地日历日）
 * @param rangeEnd 区间止（本地日历日）
 */
export function expandEventInstances(
  eventStart: string,
  eventEnd: string | undefined,
  rrule: string | undefined,
  rangeStart: string,
  rangeEnd: string,
): Array<{ start: string; end?: string; instanceDate: string }> {
  const rule = parseRRule(rrule);
  if (!rule) return [{ start: eventStart, end: eventEnd, instanceDate: eventStart.slice(0, 10) }];

  const dates = expandRecurrenceDates(
    eventStart,
    rule,
    rangeStart,
    rangeEnd,
  );
  if (dates.length === 0) return [];

  // 事件时长（毫秒），用于保持各实例的相对时长
  const s0 = new Date(eventStart);
  const e0 = eventEnd ? new Date(eventEnd) : null;
  const duration = e0 && !isNaN(e0.getTime()) ? e0.getTime() - s0.getTime() : 0;

  return dates.map((d) => {
    const [y, m, dd] = d.split("-").map((n) => parseInt(n, 10));
    const base = new Date(
      y,
      m - 1,
      dd,
      s0.getHours(),
      s0.getMinutes(),
      s0.getSeconds(),
    );
    const startIso = localIso(base);
    const endIso =
      duration > 0
        ? localIso(new Date(base.getTime() + duration))
        : undefined;
    return { start: startIso, end: endIso, instanceDate: d };
  });
}

/** Date → "YYYY-MM-DDTHH:mm:ss"（本地时间，不带 Z） */
export function localIso(d: Date): string {
  return `${ymd(d)}T${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/**
 * 把旧的枚举式 recurrence（daily/weekly/monthly/yearly）迁移成 RRULE。
 * 早期 events.md 里就是这种写法，不能丢。
 */
export function migrateLegacyRecurrence(
  legacy: string | undefined | null,
): string | undefined {
  if (!legacy) return undefined;
  const v = legacy.trim().toLowerCase();
  switch (v) {
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return "FREQ=WEEKLY";
    case "monthly":
      return "FREQ=MONTHLY";
    case "yearly":
      return "FREQ=YEARLY";
    default:
      // 已经是 RRULE 形式
      if (legacy.includes("FREQ=")) return legacy;
      return undefined;
  }
}
