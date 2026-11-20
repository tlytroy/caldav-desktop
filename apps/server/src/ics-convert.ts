/**
 * ICS 转换（唯一真正需要格式转换的地方）
 * ==========================================
 *
 * ## 为什么单独一个模块
 *
 * 统一数据源（workspace.md）是**我们自己定义的格式**，可以随意演进。
 * 而 ICS 是 **RFC 5545 标准**，Google / Outlook / Apple / 滴答清单 都认它，
 * 不能自定义。所以「md ↔ ics」是整个系统里**唯一**需要格式转换的边界。
 *
 * 其余一切（日历视图、看板视图、快速创建、AI 工具）都直接读写 workspace.md，
 * 不做任何转换。
 *
 * ## 与旧实现的差异
 *
 * 旧实现（md-ics-bridge.ts）的 RRULE 处理只取 `FREQ=xxx`，
 * **BYDAY / BYMONTHDAY / INTERVAL / COUNT / UNTIL 全部丢失** ——
 * 所以「每周一三五」导出到别的日历会退化成「每周」。
 *
 * 现在直接透传完整 RRULE 字符串，导出无损。
 */

import {
  parseRRule,
  formatRRule,
  type RecurrenceRule,
} from "./recurrence.js";
import type { WorkbenchItem } from "./workspace.js";

/** 单个 VEVENT */
export interface IcsEvent {
  uid: string;
  title: string;
  /** 本地时间 "YYYY-MM-DDTHH:mm:ss" */
  start: string;
  end?: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  project?: string;
  tags?: string[];
  priority?: "high" | "mid" | "low";
  /** 完整 RRULE 字符串 */
  recurrence?: string;
  status?: string;
  /** 远端最后修改时间（ISO，UTC）；来自 LAST-MODIFIED 或 DTSTAMP */
  lastModified?: string;
  /** 重复事件的例外实例（RECURRENCE-ID），同步时应跳过 */
  recurrenceId?: string;
  /** 原始 VEVENT 块（导入时保留未知字段） */
  rawBlock?: string;
}

// ===== 日期格式化 =====

/** 本地日期 → "YYYYMMDD" */
function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 本地日期时间 → "YYYYMMDDTHHMMSS" */
function fmtDateTime(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s.replace(/[-:]/g, "");
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] || "00"}`;
}

/**
 * ISO 时间 → UTC 的 "YYYYMMDDTHHMMSSZ"。
 *
 * DTSTAMP / CREATED / LAST-MODIFIED 按 RFC 5545 必须是 UTC（带 Z）。
 * 以前这里输出的是**本地时间不带 Z** —— 别的客户端会把它当浮动时间，
 * 跨时区时「最后修改时间」会偏好几个小时，冲突判定跟着错。
 */
function fmtUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `${fmtDateTime(iso)}Z`;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** ICS 的 UTC 时间（20261026T020000Z）→ ISO 字符串 */
export function parseIcsUtcToIso(s: string): string | undefined {
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
}

/** 解析 "YYYYMMDD" 或 "YYYYMMDDTHHMMSS" → 本地时间串 */
function parseIcsDate(v: string): { local: string; allDay: boolean } {
  const s = v.trim();
  const dm = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dm) {
    return { local: `${dm[1]}-${dm[2]}-${dm[3]}T00:00:00`, allDay: true };
  }
  const dtm = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (dtm) {
    // 带 Z 的按 UTC 存，会造成偏移 —— 转成本地时间表示
    const utc = Date.UTC(
      Number(dtm[1]),
      Number(dtm[2]) - 1,
      Number(dtm[3]),
      Number(dtm[4]),
      Number(dtm[5]),
      Number(dtm[6]),
    );
    if (dtm[7]) {
      const d = new Date(utc);
      const p = (n: number) => String(n).padStart(2, "0");
      return {
        local: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
          d.getHours(),
        )}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
        allDay: false,
      };
    }
    return {
      local: `${dtm[1]}-${dtm[2]}-${dtm[3]}T${dtm[4]}:${dtm[5]}:${dtm[6]}`,
      allDay: false,
    };
  }
  return { local: s, allDay: false };
}

/** 全天事件的 DTEND 是**排他的** —— 必须是次日 00:00 */
function nextDay(localStart: string): string {
  const d = new Date(localStart);
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T00:00:00`;
}

/** ICS 文本转义 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** ICS 文本反转义 */
function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * 按分隔符切分，但**跳过被转义的分隔符**。
 *
 * 用于标签列表：`重要\,对外; 紧急` 应切成两个标签
 * 「重要,对外; 紧急」和「紧急」，而不是三个。
 */
function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      // 转义字符：原样保留到下一轮统一反转义
      cur += ch + s[i + 1];
      i++;
      continue;
    }
    if (ch === sep) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((t) => unescapeText(t.trim())).filter(Boolean);
}

/** 折行（RFC 5545 要求每行不超过 75 字节） */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) chunks.push(" " + rest);
  return chunks.join("\r\n");
}

// ===== 条目 → ICS =====

/**
 * 单个条目 → VEVENT 文本（不含 BEGIN/END 包装）
 */
export function itemToIcsBlock(item: WorkbenchItem): string {
  const lines: string[] = [];
  // UID 优先用外部日历给的（拉取时已落盘保存），否则用本地 id。
  // 用错 UID 服务器会当成另一个事件 —— 手机上就会看到重复日程。
  const uid = item.uid || item.id;

  lines.push(`UID:${uid}`);
  lines.push(
    `DTSTAMP:${fmtUtc(
      item.updatedAt || item.createdAt || new Date().toISOString(),
    )}`,
  );

  const allDay = !!item.allDay;
  if (allDay) {
    const startDate = item.start
      ? fmtDate(new Date(item.start))
      : fmtDate(new Date());
    // 全天事件 DTEND 排他 → 次日
    let endDate = startDate;
    if (item.end) {
      const e = new Date(item.end);
      endDate = fmtDate(new Date(e.getFullYear(), e.getMonth(), e.getDate()));
    } else {
      const s = item.start ? new Date(item.start) : new Date();
      endDate = fmtDate(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1));
    }
    lines.push(`DTSTART;VALUE=DATE:${startDate}`);
    lines.push(`DTEND;VALUE=DATE:${endDate}`);
  } else {
    const start = item.start || `${new Date().toISOString().slice(0, 10)}T00:00:00`;
    const end =
      item.end ||
      (() => {
        const s = new Date(start);
        return `${start.slice(0, 10)}T${String(s.getHours()).padStart(2, "0")}:${String(
          s.getMinutes(),
        ).padStart(2, "0")}:00`;
      })();
    lines.push(`DTSTART:${fmtDateTime(start)}`);
    lines.push(`DTEND:${fmtDateTime(end)}`);
  }

  lines.push(`SUMMARY:${escapeText(item.title)}`);

  if (item.description) {
    lines.push(`DESCRIPTION:${escapeText(item.description)}`);
  }
  if (item.location) {
    lines.push(`LOCATION:${escapeText(item.location)}`);
  }
  // 项目是**本工具的字段**，不是 RFC 5545 的 CATEGORIES 语义。
  // 若写成 CATEGORIES，拉取时会被当成标签，和真正的 tags 混在一起
  // （项目 → 标签 → 字段指纹变化 → 每次同步都多一次无意义的往返）。
  // 用 X- 私有属性保存：别的日历会忽略，我们自己能无损读回。
  if (item.project) {
    lines.push(`X-WORKBENCH-PROJECT:${escapeText(item.project)}`);
  }
  // 标签：**每个标签一行 CATEGORIES**（RFC 5545 允许属性重复出现）。
  //
  // ⚠️ 不能用 `tags.join(",")` —— 那样两个标签会变成一个，
  // 解析时无法还原（`重要,对外` 会被当成单个标签）。
  if (item.tags && item.tags.length) {
    for (const tag of item.tags) {
      lines.push(`CATEGORIES:${escapeText(tag)}`);
    }
  }
  if (item.priority) {
    const map = { high: 1, mid: 5, low: 9 };
    lines.push(`PRIORITY:${map[item.priority] ?? 5}`);
  }
  if (item.status) {
    lines.push(`STATUS:${item.status.toUpperCase()}`);
  }

  // ---- RRULE：完整透传，不丢 BYDAY 等参数 ----
  if (item.recurrence) {
    const rule = parseRRule(item.recurrence);
    if (rule) {
      // formatRRule 会补 UNTIL 的时分秒，ICS 里 UNTIL 要用 UTC 格式
      const parts = [`FREQ=${rule.freq}`];
      if (rule.interval && rule.interval > 1) {
        parts.push(`INTERVAL=${rule.interval}`);
      }
      if (rule.byDay && rule.byDay.length) {
        parts.push(
          `BYDAY=${rule.byDay
            .map((i) => ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][(i - 1) % 7])
            .join(",")}`,
        );
      }
      if (rule.byMonthDay && rule.byMonthDay.length) {
        parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
      }
      if (rule.count) parts.push(`COUNT=${rule.count}`);
      if (rule.until) {
        parts.push(`UNTIL=${rule.until.replace(/-/g, "")}T235959Z`);
      }
      lines.push(`RRULE:${parts.join(";")}`);
    }
  }

  if (item.createdAt) {
    lines.push(`CREATED:${fmtUtc(item.createdAt)}`);
  }
  if (item.updatedAt) {
    lines.push(`LAST-MODIFIED:${fmtUtc(item.updatedAt)}`);
  }

  return lines.map(foldLine).join("\r\n");
}

/**
 * 多个条目 → 完整 VCALENDAR 文本
 */
export function itemsToIcs(items: WorkbenchItem[]): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//CalDAV Desktop Workbench//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("X-WR-CALNAME:Workbench");

  for (const item of items) {
    lines.push("BEGIN:VEVENT");
    lines.push(itemToIcsBlock(item));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * 多个条目 → 按 uid 拆分的 .ics 文件内容（用于 CalDAV 同步）
 */
export function itemsToIcsMap(items: WorkbenchItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CalDAV Desktop Workbench//EN",
      "BEGIN:VEVENT",
      itemToIcsBlock(item),
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    map.set(`${item.uid || item.id}.ics`, body);
  }
  return map;
}

// ===== ICS → 条目 =====

/**
 * 解析一份 .ics 文本里的所有 VEVENT。
 *
 * 容错：单个 VEVENT 解析失败不影响其它（与 workspace 的容错策略一致）。
 */
export function parseIcsEvents(icsContent: string): IcsEvent[] {
  // 展开折行
  const unfolded = icsContent.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const events: IcsEvent[] = [];
  let inEvent = false;
  let block: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      block = [];
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      const ev = parseVeventBlock(block.join("\n"));
      if (ev) events.push(ev);
      block = [];
      continue;
    }
    if (inEvent) block.push(line);
  }

  return events;
}

/** 解析单个 VEVENT 块 */
function parseVeventBlock(block: string): IcsEvent | null {
  const get = (name: string): string | undefined => {
    const m = block.match(new RegExp(`^${name}[^:]*:(.*)$`, "m"));
    return m ? m[1].trim() : undefined;
  };

  const summary = get("SUMMARY");
  if (!summary) return null;

  const dtstartRaw = get("DTSTART");
  if (!dtstartRaw) return null;
  const start = parseIcsDate(dtstartRaw);
  const isAllDay =
    /^DTSTART[^:]*VALUE=DATE/m.test(block) || start.allDay;

  let end: string | undefined;
  const dtendRaw = get("DTEND");
  if (dtendRaw) {
    end = parseIcsDate(dtendRaw).local;
  } else if (isAllDay) {
    end = nextDay(start.local);
  }

  // ---- RRULE：完整保留 ----
  let recurrence: string | undefined;
  const rruleMatch = block.match(/^RRULE:(.+)$/m);
  if (rruleMatch) {
    const parsed = parseRRule(rruleMatch[1].trim());
    if (parsed) {
      // 归一化成规范形式（字段顺序固定）
      recurrence = normalizeRRuleForStorage(parsed);
    }
  }

  const priorityRaw = get("PRIORITY");
  let priority: "high" | "mid" | "low" | undefined;
  if (priorityRaw) {
    const p = parseInt(priorityRaw, 10);
    if (p <= 3) priority = "high";
    else if (p <= 6) priority = "mid";
    else priority = "low";
  }

  // CATEGORIES 可能出现**多次**（每个标签一行，RFC 5545 允许属性重复）。
  // 所以不能用 get("CATEGORIES") —— 那只取第一行。
  const categoriesAll = [...block.matchAll(/^CATEGORIES[^:]*:(.*)$/gm)].map(
    (m) => m[1].trim(),
  );
  const tags = categoriesAll.length
    ? categoriesAll.flatMap((c) => splitEscaped(c, ","))
    : undefined;

  // 远端修改时间：LAST-MODIFIED 优先，退回 DTSTAMP。
  // 冲突判定会用到它（与本地字段指纹配合，判断「两边都改过」）。
  const lastModified =
    parseIcsUtcToIso(get("LAST-MODIFIED") || "") ||
    parseIcsUtcToIso(get("DTSTAMP") || "");
  // 重复事件的例外实例（RECURRENCE-ID）不是独立事件。
  // 当成新事件会把同 UID 的主事件覆盖掉（只剩那一天），同步时必须跳过。
  const recurrenceId = get("RECURRENCE-ID");

  return {
    uid: get("UID") || `ics-${Math.random().toString(16).slice(2, 10)}`,
    title: unescapeText(summary),
    start: start.local,
    end,
    allDay: isAllDay,
    description: get("DESCRIPTION") ? unescapeText(get("DESCRIPTION")!) : undefined,
    location: get("LOCATION") ? unescapeText(get("LOCATION")!) : undefined,
    project: get("X-WORKBENCH-PROJECT")
      ? unescapeText(get("X-WORKBENCH-PROJECT")!)
      : undefined,
    tags,
    priority,
    recurrence,
    status: get("STATUS")?.toLowerCase(),
    lastModified,
    recurrenceId,
    rawBlock: block,
  };
}

/** 归一化 RRULE 为存储形式（去掉 UNTIL 的时分秒尾巴） */
function normalizeRRuleForStorage(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay && rule.byDay.length) {
    parts.push(
      `BYDAY=${rule.byDay
        .map((i) => ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][(i - 1) % 7])
        .join(",")}`,
    );
  }
  if (rule.byMonthDay && rule.byMonthDay.length) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  }
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, "")}T235959Z`);
  return parts.join(";");
}

/**
 * UID → 本地 id（8 位小写十六进制）。
 *
 * - `abc12345` 这种本来就是 8 位 hex 的（本项目自己导出的）直接复用，
 *   保证「导出 → 再导入」不产生新 id。
 * - 其它 UID（Radicale 的 UUID、Outlook 的长 UID）用 FNV-1a 哈希成 8 位。
 *   必须**确定性**：同一份远端数据每次拉取都得到同一个 id，
 *   否则每同步一次就会多出一条重复。
 */
export function idFromUid(uid: string): string {
  const trimmed = (uid || "").trim();
  if (/^[0-9a-f]{8}$/.test(trimmed)) return trimmed;
  let h = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 旧版 id 推导规则（去掉非十六进制字符、截 8 位、不足补 0）。
 *
 * **只用于迁移**：升级前从 ICS 导入的条目没有 `uid`，id 是用这条规则算的。
 * CalDAV 拉取时用它把老条目认领到远端 UID 上，避免第一次同步产生重复；
 * 新代码不要再用它生成 id。
 */
export function legacyIdFromUid(uid: string): string {
  return (uid || "")
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 8)
    .padEnd(8, "0");
}

/**
 * ICS 事件 → 工作台条目（用于导入）
 */
export function icsEventToItem(
  ev: IcsEvent,
  opts: { kind?: "task" | "event" } = {},
): WorkbenchItem {
  return {
    id: idFromUid(ev.uid),
    uid: ev.uid || undefined,
    kind: opts.kind ?? "event",
    title: ev.title,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    description: ev.description,
    location: ev.location,
    project: ev.project,
    tags: ev.tags,
    priority: ev.priority,
    recurrence: ev.recurrence,
    status: (ev.status as WorkbenchItem["status"]) ?? "confirmed",
    updatedAt: ev.lastModified,
  };
}

/**
 * 工作台条目 → ICS 事件（用于导出前的预览）
 */
export function itemToIcsEvent(item: WorkbenchItem): IcsEvent {
  return {
    uid: item.uid || item.id,
    title: item.title,
    start: item.start || "",
    end: item.end,
    allDay: item.allDay,
    description: item.description,
    location: item.location,
    project: item.project,
    tags: item.tags,
    priority: item.priority,
    recurrence: item.recurrence,
    status: item.status,
  };
}

/** 重新导出 RRULE（供 formatRRule 的完整能力复用） */
export { formatRRule };
