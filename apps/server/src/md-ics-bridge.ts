/**
 * MD ↔ ICS Bridge Service (events.md 方案)
 *
 * 核心思路：一个专门的 events.md 文件作为所有日历事件的本地缓存。
 * 编辑操作全在本地 MD 文件上进行，ICS 仅在同步时生成。
 *
 * 文件格式：
 *   ---
 *   events:
 *     - uid: "uuid-1"
 *       title: "项目评审会议"
 *       date: "2026-08-18T14:00:00"
 *       end: "2026-08-18T15:30:00"
 *       allDay: false
 *       status: confirmed
 *       category: "工作"
 *       tags: ["项目", "评审"]
 *       recurrence: "weekly"
 *       description: "项目进度评审会议"
 *       updated: "2026-08-18T10:00:00Z"
 *       source: "caldav"
 *     - ...
 *   ---
 *   # 正文部分：会议纪要、笔记等自由内容
 *
 * @see REF/MD_ICS_BRIDGE.md 完整设计文档
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ===== Types =====

/** 单个日历事件（events.md 中 events[] 数组的元素） */
export interface BridgeEvent {
  uid?: string;
  title: string;
  date: string; // ISO 8601
  end?: string; // ISO 8601
  allDay?: boolean;
  status?: "confirmed" | "tentative" | "cancelled" | "needs-action";
  category?: string;
  tags?: string[];
  priority?: "high" | "medium" | "low";
  recurrence?: "daily" | "weekly" | "monthly" | "yearly";
  description?: string;
  updated?: string; // ISO 8601
  source?: "caldav" | "md" | "ai";
  /** 关联的工作搭子任务 ID（双向绑定：任务看板那边的对应任务的 id） */
  kanbanTaskId?: string;
}

/** events.md 完整内容（frontmatter + body） */
export interface EventsFile {
  events: BridgeEvent[];
  body: string; // 正文部分（frontmatter 之外的内容）
  raw: string; // 完整原始内容
  filePath?: string;
}

/** 桥接配置 */
export interface BridgeConfig {
  enabled: boolean;
  eventsFilePath: string;
  syncDirection: "md-to-caldav" | "caldav-to-md" | "bidirectional";
  autoSyncMinutes: number;
  targetCalendarUrl?: string;
}

// ===== Configuration =====

export function loadBridgeConfig(): BridgeConfig {
  return {
    enabled: process.env.MD_ICS_ENABLED === "true",
    eventsFilePath: process.env.MD_EVENTS_FILE || "./events.md",
    syncDirection:
      (process.env.MD_ICS_SYNC_DIRECTION as BridgeConfig["syncDirection"]) ||
      "bidirectional",
    autoSyncMinutes: parseInt(process.env.MD_ICS_AUTO_SYNC_MINUTES || "0", 10),
    targetCalendarUrl: process.env.MD_ICS_TARGET_CALENDAR_URL || undefined,
  };
}

// ===== events.md 文件读写 =====

/**
 * 解析 events.md 文件内容
 *
 * 格式：
 *   ---
 *   events:
 *     - uid: "uuid-1"
 *       title: "事件标题"
 *       date: "2026-08-18T14:00:00"
 *       ...
 *   ---
 *   正文内容...
 */
export function parseEventsFile(mdContent: string): EventsFile {
  const result: EventsFile = {
    events: [],
    body: "",
    raw: mdContent,
  };

  // 提取 YAML frontmatter（--- 分隔）
  const fmMatch = mdContent.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) {
    // 没有 frontmatter，全部作为正文
    result.body = mdContent.trim();
    return result;
  }

  const yamlBlock = fmMatch[1];
  result.body = mdContent.slice(fmMatch[0].length).trim();

  // 解析 YAML 中的 events 数组
  // 采用逐行解析，因为 YAML 缩进结构固定
  const lines = yamlBlock.split("\n");
  let currentEvent: Partial<BridgeEvent> | null = null;
  let inEvents = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 events: 开头
    if (trimmed === "events:" || trimmed.startsWith("events:")) {
      inEvents = true;
      continue;
    }

    if (!inEvents) continue;

    // 检测新事件开始：- uid: 或 - title:
    const newEventMatch = trimmed.match(/^-\s+(\w+):\s*(.*)$/);
    if (newEventMatch) {
      // 如果已有 currentEvent，保存它
      if (currentEvent && currentEvent.title) {
        result.events.push(currentEvent as BridgeEvent);
      }
      currentEvent = {};
      const key = newEventMatch[1];
      const value = newEventMatch[2].replace(/^["']|["']$/g, "");
      setEventField(currentEvent, key, value);
      continue;
    }

    // 检测事件字段续行（缩进的行）
    if (currentEvent && trimmed.startsWith("- ")) {
      // 这是数组元素（tags）
      const tagValue = trimmed.replace(/^- /, "").replace(/^["']|["']$/g, "");
      if (!currentEvent.tags) currentEvent.tags = [];
      currentEvent.tags.push(tagValue);
      continue;
    }

    // 检测 key: value（事件字段的续行）
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch && currentEvent) {
      const key = kvMatch[1];
      const value = kvMatch[2].replace(/^["']|["']$/g, "");
      setEventField(currentEvent, key, value);
    }
  }

  // 保存最后一个事件
  if (currentEvent && currentEvent.title) {
    result.events.push(currentEvent as BridgeEvent);
  }

  return result;
}

/** 辅助：设置事件字段 */
function setEventField(
  event: Partial<BridgeEvent>,
  key: string,
  value: string,
): void {
  switch (key) {
    case "uid":
      event.uid = value;
      break;
    case "title":
      event.title = value;
      break;
    case "date":
      event.date = value;
      break;
    case "end":
      event.end = value || undefined;
      break;
    case "allDay":
      event.allDay = value === "true";
      break;
    case "status":
      event.status = value as BridgeEvent["status"];
      break;
    case "category":
      event.category = value || undefined;
      break;
    case "recurrence":
      event.recurrence = value as BridgeEvent["recurrence"];
      break;
    case "description":
      event.description = value || undefined;
      break;
    case "updated":
      event.updated = value;
      break;
    case "priority":
      event.priority = value as BridgeEvent["priority"];
      break;
    case "source":
      event.source = value as BridgeEvent["source"];
      break;
    case "kanbanTaskId":
    case "kanban":
      event.kanbanTaskId = value || undefined;
      break;
  }
}

/**
 * 将 EventsFile 序列化为 events.md 格式
 */
export function serializeEventsFile(eventsFile: EventsFile): string {
  const yamlLines: string[] = ["---", "events:"];

  for (const event of eventsFile.events) {
    yamlLines.push(`  - uid: "${event.uid || generateUid()}"`);
    yamlLines.push(`    title: "${escapeYaml(event.title)}"`);
    yamlLines.push(`    date: "${event.date}"`);
    if (event.end) yamlLines.push(`    end: "${event.end}"`);
    if (event.allDay) yamlLines.push(`    allDay: true`);
    if (event.status) {
      yamlLines.push(`    status: "${event.status}"`);
    }
    if (event.category) {
      yamlLines.push(`    category: "${escapeYaml(event.category)}"`);
    }
    if (event.tags && event.tags.length > 0) {
      yamlLines.push(`    tags:`);
      for (const tag of event.tags) {
        yamlLines.push(`      - "${escapeYaml(tag)}"`);
      }
    }
    if (event.recurrence) {
      yamlLines.push(`    recurrence: "${event.recurrence}"`);
    }
    if (event.description) {
      yamlLines.push(`    description: "${escapeYaml(event.description)}"`);
    }
    yamlLines.push(
      `    updated: "${event.updated || new Date().toISOString()}"`,
    );
    if (event.priority) {
      yamlLines.push(`    priority: "${event.priority}"`);
    }
    if (event.source) {
      yamlLines.push(`    source: "${event.source}"`);
    }
    if (event.kanbanTaskId) {
      yamlLines.push(`    kanbanTaskId: "${event.kanbanTaskId}"`);
    }
  }

  yamlLines.push("---");

  // 如果有正文，追加
  if (eventsFile.body) {
    yamlLines.push("", eventsFile.body);
  }

  return yamlLines.join("\n");
}

/** 转义 YAML 字符串值 */
function escapeYaml(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 生成唯一 ID */
function generateUid(): string {
  return `md-event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ===== 文件操作 =====

/**
 * 从磁盘读取 events.md
 */
export function readEventsFile(filePath: string): EventsFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseEventsFile(content);
    parsed.filePath = filePath;
    return parsed;
  } catch (err) {
    console.error(`[MD Bridge] Failed to read events file: ${filePath}`, err);
    return null;
  }
}

/**
 * 写入 events.md 到磁盘
 */
export function writeEventsFile(eventsFile: EventsFile): string {
  const filePath = eventsFile.filePath || "./events.md";
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = serializeEventsFile(eventsFile);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`[MD Bridge] Written events file: ${filePath}`);
  return filePath;
}

/**
 * 初始化空的 events.md（如果不存在）
 */
export function ensureEventsFile(filePath: string): EventsFile {
  const existing = readEventsFile(filePath);
  if (existing) return existing;

  const empty: EventsFile = {
    events: [],
    body: "# 日历事件缓存\n\n此文件由 CalDAV Desktop 自动管理。\n所有日历事件存储在 YAML frontmatter 的 events[] 数组中。\n",
    raw: "",
    filePath,
  };
  empty.raw = serializeEventsFile(empty);
  writeEventsFile(empty);
  return empty;
}

// ===== MD → ICS 转换（同步时使用） =====

/**
 * 将单个 BridgeEvent 转换为 ICS 字符串
 */
export function eventToIcs(event: BridgeEvent): string {
  const uid = event.uid || generateUid();
  const dtstamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+/, "");

  const startDate = new Date(event.date);
  let endDate: Date;
  if (event.allDay) {
    // 全天事件：ICS 的 DTEND 是排他边界，必须 ≥ 次日 00:00。
    // 历史数据里存在 end == start 的全天事件，直接导出会得到零长度事件、
    // 客户端可能完全不显示，这里统一兜底为次日。
    const base = event.end ? new Date(event.end) : new Date(startDate);
    endDate = base.getTime() > startDate.getTime() ? base : new Date(startDate.getTime() + 86400000);
  } else if (event.end) {
    endDate = new Date(event.end);
    // 结束时间不晚于开始 → 兜底 +1 小时
    if (endDate.getTime() <= startDate.getTime()) {
      endDate = new Date(startDate.getTime() + 3600000);
    }
  } else {
    endDate = new Date(startDate.getTime() + 3600000);
  }

  const formatDate = (d: Date, allDay?: boolean): string => {
    if (allDay) {
      // 全天事件的 VALUE=DATE 就是"日历上的那一天"，不含时区。
      // 不能用 toISOString()（会按 UTC 换算，东八区凌晨的事件会落到前一天），
      // 也不应直接用本地值 —— 因为 startDate 可能本身就是从 UTC 串解析来的。
      // 这里统一按本地日历日取年月日。
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}${m}${day}`;
    }
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  };

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CalDAV Desktop MD Bridge//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART${event.allDay ? ";VALUE=DATE" : ""}:${formatDate(startDate, event.allDay)}`,
    `DTEND${event.allDay ? ";VALUE=DATE" : ""}:${formatDate(endDate, event.allDay)}`,
    `SUMMARY:${event.title}`,
  ];

  // STATUS
  if (event.status) {
    const statusMap: Record<string, string> = {
      confirmed: "CONFIRMED",
      tentative: "TENTATIVE",
      cancelled: "CANCELLED",
      "needs-action": "NEEDS-ACTION",
    };
    lines.push(`STATUS:${statusMap[event.status] || "CONFIRMED"}`);
  }

  // CATEGORIES
  if (event.category) {
    lines.push(`CATEGORIES:${event.category}`);
  }

  // DESCRIPTION: tags + description
  const descParts: string[] = [];
  if (event.tags && event.tags.length > 0) {
    descParts.push(`Tags: ${event.tags.join(", ")}`);
  }
  if (event.description) {
    descParts.push(event.description);
  }
  if (descParts.length > 0) {
    lines.push(`DESCRIPTION:${descParts.join("\\n\\n")}`);
  }

  // PRIORITY (iCalendar: 1=high, 5=medium, 9=low)
  if (event.priority) {
    const prioMap: Record<string, string> = {
      high: "1",
      medium: "5",
      low: "9",
    };
    lines.push(`PRIORITY:${prioMap[event.priority] || "5"}`);
  }

  // RRULE
  if (event.recurrence) {
    const freqMap: Record<string, string> = {
      daily: "DAILY",
      weekly: "WEEKLY",
      monthly: "MONTHLY",
      yearly: "YEARLY",
    };
    lines.push(
      `RRULE:FREQ=${freqMap[event.recurrence] || event.recurrence.toUpperCase()}`,
    );
  }

  // 关联工作搭子任务（非 ICS 标准字段，用 X- 扩展属性保留双向绑定，确保 push→CalDAV→pull 往返不丢）
  if (event.kanbanTaskId) {
    lines.push(`X-KANBAN-TASK-ID:${event.kanbanTaskId}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * 将 events.md 中所有事件批量转换为 ICS 字符串数组
 * 返回 Map<uid, icsContent>
 */
export function allEventsToIcs(eventsFile: EventsFile): Map<string, string> {
  const result = new Map<string, string>();
  for (const event of eventsFile.events) {
    const ics = eventToIcs(event);
    const uid = event.uid || generateUid();
    result.set(uid, ics);
  }
  return result;
}

// ===== ICS → BridgeEvent 转换（从 CalDAV 拉取时使用） =====

/**
 * 将 ICS 字符串解析为 BridgeEvent
 */
export function icsToEvent(icsContent: string): BridgeEvent | null {
  // Normalize line endings to \n
  icsContent = icsContent.replace(/\r\n/g, "\n");
  const veventMatch = icsContent.match(/BEGIN:VEVENT\n([\s\S]*?)END:VEVENT/);
  if (!veventMatch) return null;

  const block = veventMatch[1];
  const event: Partial<BridgeEvent> = {
    source: "caldav",
    updated: new Date().toISOString(),
  };

  // UID
  const uidMatch = block.match(/^UID:(.+)$/m);
  if (uidMatch) event.uid = uidMatch[1].trim();

  // SUMMARY → title
  const summaryMatch = block.match(/^SUMMARY:(.+)$/m);
  if (summaryMatch) event.title = summaryMatch[1].trim();

  // DTSTART
  const dtstartMatch = block.match(/^DTSTART(?:;VALUE=DATE)?:(.+)$/m);
  if (dtstartMatch) {
    const val = dtstartMatch[1].trim();
    if (/^\d{8}$/.test(val)) {
      // VALUE=DATE 不含时区，按本地零点解析，保留"日历上的那一天"
      event.date = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T00:00:00`;
      event.allDay = true;
    } else {
      event.date = val
        .replace(
          /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
          "$1-$2-$3T$4:$5:$6",
        )
        .replace(/Z$/, "");
    }
  }

  // DTSTART with VALUE=DATE
  if (block.match(/^DTSTART;VALUE=DATE:/m)) {
    event.allDay = true;
  }

  // DTEND
  const dtendMatch = block.match(/^DTEND(?:;VALUE=DATE)?:(.+)$/m);
  if (dtendMatch) {
    const val = dtendMatch[1].trim();
    if (/^\d{8}$/.test(val)) {
      event.end = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T00:00:00`;
    } else {
      event.end = val
        .replace(
          /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
          "$1-$2-$3T$4:$5:$6",
        )
        .replace(/Z$/, "");
    }
  }

  // CATEGORIES → category
  const catMatch = block.match(/^CATEGORIES:(.+)$/m);
  if (catMatch) event.category = catMatch[1].trim();

  // STATUS
  const statusMatch = block.match(/^STATUS:(.+)$/m);
  if (statusMatch) {
    const statusMap: Record<string, BridgeEvent["status"]> = {
      CONFIRMED: "confirmed",
      TENTATIVE: "tentative",
      CANCELLED: "cancelled",
      "NEEDS-ACTION": "needs-action",
    };
    event.status = statusMap[statusMatch[1].trim()] || "confirmed";
  }

  // PRIORITY
  const prioMatch = block.match(/^PRIORITY:(\d+)/m);
  if (prioMatch) {
    const prioMap: Record<string, BridgeEvent["priority"]> = {
      "1": "high",
      "5": "medium",
      "9": "low",
    };
    event.priority = prioMap[prioMatch[1]] || "medium";
  }

  // RRULE → recurrence
  const rruleMatch = block.match(/^RRULE:FREQ=(\w+)/m);
  if (rruleMatch) {
    event.recurrence = rruleMatch[1].toLowerCase() as BridgeEvent["recurrence"];
  }

  // DESCRIPTION → description + tags
  const descMatch = block.match(/^DESCRIPTION:(.+)$/m);
  if (descMatch) {
    const rawDesc = descMatch[1].trim();
    const tagsPrefixMatch = rawDesc.match(/^Tags:\s*(.+?)(?:\\n\\n|$)/);
    if (tagsPrefixMatch) {
      event.tags = tagsPrefixMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      event.description =
        rawDesc
          .slice(tagsPrefixMatch[0].length)
          .replace(/\\n\\n?/g, "\n")
          .trim() || undefined;
    } else {
      event.description = rawDesc.replace(/\\n\\n?/g, "\n").trim() || undefined;
    }
  }

  // X-KANBAN-TASK-ID → 关联的工作搭子任务 ID（自定义扩展属性）
  const kanbanMatch = block.match(/^X-KANBAN-TASK-ID:(.+)$/m);
  if (kanbanMatch) {
    event.kanbanTaskId = kanbanMatch[1].trim() || undefined;
  }

  if (!event.title) return null;
  return event as BridgeEvent;
}

/**
 * 解析包含多个 VEVENT 的完整 .ics 文件。
 *
 * 现状：`icsToEvent` 只取第一个 VEVENT（正则不带 g 标志），所以导入一份
 * 从 Google/Outlook/Apple 导出的日历文件时，只会得到一条事件。
 * 导入功能必须基于这个函数。
 *
 * @returns 解析出的事件列表；无法识别的条目跳过
 */
export function parseIcsFile(icsContent: string): BridgeEvent[] {
  const normalized = icsContent.replace(/\r\n/g, "\n");
  const results: BridgeEvent[] = [];
  const re = /BEGIN:VEVENT\n([\s\S]*?)END:VEVENT/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const block = m[1];
    // 复用单事件解析逻辑，保证导入与 CalDAV 拉取行为一致
    const evt = icsToEvent(`BEGIN:VEVENT\n${block}END:VEVENT`);
    if (evt && evt.title) results.push(evt);
  }
  return results;
}

/**
 * 把多个事件导出为单个 .ics 文件（VCALENDAR 包裹）。
 *
 * 现状：events.md 里已有 `allEventsToIcs` 返回 Map<uid, ics>，
 * 但那是给"每个事件存一个 .ics 文件"的 CalDAV 用法，
 * 与"导出成一个文件给别的日历软件导入"是两回事。
 *
 * @returns 完整的 VCALENDAR 文本
 */
export function eventsFileToIcs(eventsFile: EventsFile): string {
  const parts: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CalDAV Desktop//MD Bridge Export//ZH",
    "CALSCALE:GREGORIAN",
  ];
  for (const event of eventsFile.events) {
    // eventToIcs 自带 VCALENDAR 包裹，这里剥掉外层，只留 VEVENT
    const single = eventToIcs(event);
    const vevent = single
      .replace(/^BEGIN:VCALENDAR\r?\n?/, "")
      .replace(/VERSION:2\.0\r?\n?/, "")
      .replace(/PRODID:[^\r\n]*\r?\n?/, "")
      .replace(/END:VCALENDAR\s*$/, "")
      .trim();
    if (vevent) parts.push(vevent);
  }
  parts.push("END:VCALENDAR");
  return parts.join("\r\n") + "\r\n";
}
