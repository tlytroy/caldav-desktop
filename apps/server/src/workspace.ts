/**
 * 统一数据层（workspace.md）
 * =========================
 *
 * ## 设计原则
 *
 * **唯一事实源 = 一个文件。** 日历、看板、快速创建都只是这个文件的视图。
 * 没有 events.md 与 工作搭子看板.md 的双向绑定，没有级联删除，没有解绑。
 * 一条记录就是一个东西，删掉就是删掉。
 *
 * ## 为什么不用 YAML 库解析
 *
 * YAML 库遇到畸形输入会整体抛错 —— 一条 AI 写坏的记录会让 500 条数据全部
 * 读不出来。这正是最不能接受的失败模式。
 *
 * 所以这里**逐条自解析**：每个条目是独立的 Markdown 块，解析一条只影响一条。
 * 坏条目被标记为 invalid 并跳过，其余照常工作。
 *
 * ## 文件格式
 *
 * ```markdown
 * ---
 * schema: workbench/v1
 * ---
 *
 * ## 2026-10-28 体检
 * - id: a1b2c3d4
 * - kind: task
 * - start: 2026-10-28T09:00:00
 * - end: 2026-10-28T10:00:00
 * - priority: mid
 * - done: false
 *
 * ## 每周一三五 晨会
 * - id: b2c3d4e5
 * - kind: event
 * - start: 2026-10-05T09:00:00
 * - recurrence: FREQ=WEEKLY;BYDAY=MO,WE,FR
 * ```
 *
 * ## 三层防护
 *
 * 1. **Schema 校验**（schema/item.schema.json）：字段类型/枚举/格式
 * 2. **容错解析**：单条坏 → 标记 invalid，其余照常
 * 3. **写入前备份**：.bak 轮转保留最近 N 版
 */

import * as fs from "node:fs";
import crypto from "node:crypto";
import * as path from "node:path";
import { resolveDataPath } from "./config.js";
import { WorkspaceReadError } from "./errors.js";

export type ItemKind = "task" | "event";
export type ItemPriority = "high" | "mid" | "low";

export interface WorkbenchItem {
  id: string;
  /**
   * 外部日历（CalDAV / ICS）里的稳定 UID。
   *
   * 为什么需要它：走 CalDAV 同步时，远端对象是用 UID 认的，不是用本地 id。
   * 如果拉取时丢掉 UID，本地改完再推回去就会**在服务器上新建一份** ——
   * 手机日历里会看到两个一模一样的日程。所以 UID 必须落盘保存。
   *
   * 为空时（纯本地创建的条目）用 id 充当 UID。
   */
  uid?: string;
  kind: ItemKind;
  title: string;
  /** 本地时间，不带时区后缀 */
  start?: string;
  end?: string;
  due?: string;
  /**
   * 提醒时间（本地时间串，绝对时刻）。空 = 不提醒。
   *
   * 存绝对时间而不是「提前几分钟」，是因为全天条目 / 只有截止日的任务
   * 没有明确的开始时刻 —— 存偏移量会需要一堆隐藏规则（从 0 点算？从 9 点算？），
   * 存绝对时刻界面上一眼就能看懂。
   */
  remind?: string;
  allDay?: boolean;
  done?: boolean;
  priority?: ItemPriority;
  /** RFC 5545 RRULE 子集 */
  recurrence?: string;
  /**
   * 所属清单（类似滴答清单的「列表」）。
   *
   * 空值 = 收件箱（Inbox）—— 快速捕获、还没归类的东西。
   * 清单不需要预先定义，直接按条目上的值聚合即可
   * （空清单没有意义，也不需要持久化）。
   */
  list?: string;
  /**
   * 父条目 id —— 用于子任务。
   *
   * 子任务本身也是普通条目，只是多指了一个父级。
   * 这样不需要嵌套数据结构，md 里所有条目依然是平铺的独立块，
   * 单条改动不会牵连整棵树（对 AI 编辑友好）。
   *
   * 加这个字段时**不引入递归深度限制以外的任何约束**：
   * 父子关系是自由图，服务端只负责展示时组装。
   */
  parent?: string;
  project?: string;
  tags?: string[];
  description?: string;
  location?: string;
  status?: "confirmed" | "tentative" | "cancelled" | "needs-action";
  createdAt?: string;
  updatedAt?: string;
}

/** 未知字段（v0.3 round-trip）：原样保留，避免丢掉用户/AI 手写的新字段 */
export interface ExtraField {
  key: string;
  value: string;
  /** 在条目块内的行号（0 起），序列化时按此顺序写回 */
  line: number;
}

/** 解析结果里的条目：可能带校验错误 */
export interface ParsedItem extends WorkbenchItem {
  /** 校验错误列表；非空表示这条有问题，但其它条目不受影响 */
  errors?: string[];
  /** 未知 `- key: value` 字段 */
  extra?: ExtraField[];
  /** 有问题的条目原始块（含标题行），未修改时写回原样，不静默丢字段 */
  rawBlock?: string;
}

export interface WorkspaceFile {
  items: ParsedItem[];
  /** 文件头之后的自由文本（AI 可以写备注） */
  notes: string;
  /** 原始 frontmatter 文本（含 --- 行）；保留 schema/注释/列表，不降级 */
  frontmatterRaw?: string;
  /** 未知块（notes 之后，原文保留） */
  unknownBlocks?: string[];
  filePath?: string;
  raw?: string;
}

/** 校验与解析的整体报告 */
export interface ValidationReport {
  total: number;
  valid: number;
  invalid: number;
  issues: Array<{ id?: string; title?: string; errors: string[] }>;
}

const SCHEMA_VERSION = "workbench/v1";

/** 新文件默认 frontmatter；已有文件保留原文（可能是 workbench/v2） */
function defaultFrontmatter(): string {
  return `---\nschema: ${SCHEMA_VERSION}\n---\n`;
}

const UNKNOWN_START = "<!-- workbench:unknown:start -->";
const UNKNOWN_END = "<!-- workbench:unknown:end -->";

/** 已知字段集合：解析时用于区分「未知字段」与「这条根本不是条目」 */
const KNOWN_FIELDS = new Set([
  "id",
  "uid",
  "kind",
  "title",
  "start",
  "end",
  "due",
  "remind",
  "allDay",
  "done",
  "priority",
  "recurrence",
  "list",
  "parent",
  "project",
  "tags",
  "description",
  "location",
  "status",
  "createdAt",
  "updatedAt",
]);

/**
 * 标量转义：先处理反斜杠，再处理换行。
 *
 * 这样 `description` 里的真实换行不会破坏「一行一个字段」的格式，
 * 字面量 `\\n` 与转义换行也能区分（反斜杠先被加倍）。
 */
export function escapeScalar(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/** escapeScalar 的逆操作 */
export function unescapeScalar(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[i + 1];
    if (next === "\\") {
      out += "\\";
      i++;
    } else if (next === "n") {
      out += "\n";
      i++;
    } else if (next === "r") {
      out += "\r";
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 解析期元数据：原文里出现过已知字段的条目。
 *
 * 用 WeakSet 而不是条目字段，避免它被 `{ ...item }` 带到 API 输出/validateItem
 * 里变成「未知字段」误报。
 */
const RECOGNIZED_ITEMS = new WeakSet<object>();

/** 一条解析结果是否「可识别」：有 id，或原文里出现过已知字段 */
export function isParseableItem(item: ParsedItem): boolean {
  if (item.id) return true;
  return RECOGNIZED_ITEMS.has(item);
}

/** 条目是否完全有效（无解析错误、不是保留的坏块） */
export function isValidItem(item: ParsedItem): boolean {
  return !item.rawBlock && (!item.errors || item.errors.length === 0);
}

// ===== 路径 =====

/** workspace.md 完整路径 */
export function workspaceFilePath(): string {
  const envVal = process.env.WORKSPACE_FILE;
  if (envVal && envVal.trim()) {
    const p = envVal.trim();
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  }
  const cfg = resolveDataPath("workspace");
  return cfg;
}

/** 备份目录（跟随实际文件路径，而不是全局配置） */
function backupDir(filePath: string): string {
  return path.join(path.dirname(filePath), ".workspace-backups");
}

/** 保留的备份份数 */
const MAX_BACKUPS = 20;

/** 备份目录总量上限（字节）；超出按最旧优先删除 */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

// ===== 解析 =====

/**
 * 逐条解析 workspace.md。
 *
 * 格式约定：
 *  - 以 `## ` 开头的行是条目分隔符，其后是标题
 *  - 标题之后的 `- key: value` 行是字段
 *  - `<!-- notes -->` 标记之后是自由笔记区（不再解析为条目）
 *  - `---` frontmatter 之后的非条目内容归入 notes
 */
/**
 * 逐条解析 workspace.md。
 *
 * 格式约定：
 *  - 以 `## ` 开头的行是条目分隔符，其后是标题
 *  - 标题之后的 `- key: value` 行是字段；未知 key 收进 `extra` 原样保留
 *  - `<!-- notes -->` 标记之后是自由笔记区（不再解析为条目）
 *  - `<!-- workbench:unknown:start/end -->` 之间是保留块（不吞进 notes）
 *  - `---` frontmatter 保留原文，不解析、不降级 schema
 */
export function parseWorkspace(content: string): WorkspaceFile {
  const result: WorkspaceFile = { items: [], notes: "" };
  const lines = content.split(/\r?\n/);

  let i = 0;

  // ---- frontmatter：保留原文 ----
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    if (i < lines.length) {
      result.frontmatterRaw = lines.slice(0, i + 1).join("\n") + "\n";
      i++;
    } else {
      // 没有闭合 --- ：整份文件当 frontmatter 保留，不猜
      result.frontmatterRaw = lines.join("\n");
      i = lines.length;
    }
  }

  // 收集非条目内容
  const noteLines: string[] = [];
  const unknownBlocks: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // ---- 自由笔记区标记：其后全部是笔记 ----
    if (/^<!--\s*notes\s*-->/i.test(trimmed)) {
      i++;
      while (i < lines.length) {
        // 未知块可能写在 notes 之后：停在这里交给主循环，不要吞进 notes
        if (/^<!--\s*workbench:unknown:start\s*-->$/i.test(lines[i].trim())) break;
        noteLines.push(lines[i]);
        i++;
      }
      continue;
    }

    // ---- 未知块：原文保留，不吞进 notes ----
    if (/^<!--\s*workbench:unknown:start\s*-->$/i.test(trimmed)) {
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !/^<!--\s*workbench:unknown:end\s*-->$/i.test(lines[i].trim())
      ) {
        body.push(lines[i]);
        i++;
      }
      // 第一次闭合即结束；缺少闭合则吃到文件末（并保持可写回）
      if (i < lines.length) i++;
      unknownBlocks.push(body.join("\n"));
      continue;
    }

    // ---- 条目起始 ----
    if (/^##\s+/.test(line)) {
      const blockStart = i;
      const heading = unescapeScalar(line.replace(/^##\s+/, "").trim());
      const raw: Record<string, string> = {};
      const extra: ExtraField[] = [];
      const strayLines: string[] = [];
      i++;

      // 收集该条目的字段行，直到遇到下一个 ## 或空行后的非字段内容
      while (i < lines.length && !/^##\s+/.test(lines[i])) {
        const l = lines[i];
        const m = l.match(/^\s*[-*]\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*:\s*(.*)$/u);
        if (m) {
          const key = m[1];
          const value = unescapeScalar(m[2].trim());
          if (KNOWN_FIELDS.has(key)) {
            raw[key] = value;
          } else {
            extra.push({ key, value, line: i - blockStart });
          }
          i++;
        } else if (l.trim() === "") {
          // 空行：向前看，下一行仍是字段则继续，否则结束本条
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === "") j++;
          const nextIsField =
            j < lines.length &&
            /^\s*[-*]\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*:\s*/u.test(lines[j]);
          if (!nextIsField) {
            i = j;
            break;
          }
          i = j;
        } else {
          // 缩进续行（描述字段的多行内容）→ 追加到上一个字段
          const lastKey = Object.keys(raw).pop();
          if (lastKey && /^\s{2,}/.test(l)) {
            raw[lastKey] = (raw[lastKey] + " " + l.trim()).trim();
            i++;
          } else {
            // 无法识别 → 先缓存；条目没错误时归入 notes，有错误时随 rawBlock 原样保留
            strayLines.push(l);
            i++;
          }
        }
      }

      const blockLines = lines.slice(blockStart, i);
      // 去掉块尾部空行，避免写回时不断累积空行
      while (blockLines.length && blockLines[blockLines.length - 1].trim() === "") {
        blockLines.pop();
      }

      const item = buildItem(raw, heading, extra);
      if (Object.keys(raw).length > 0) RECOGNIZED_ITEMS.add(item);
      // 一条「只有标题、没有任何已知字段」的块：不是条目，可能只是笔记
      if (!isParseableItem(item)) {
        item.errors = [...(item.errors ?? []), "条目缺少可识别字段（无 id 或已知字段）"];
      }
      if (item.errors?.length) {
        item.rawBlock = blockLines.join("\n");
      } else if (strayLines.length) {
        noteLines.push(...strayLines);
      }
      result.items.push(item);
      continue;
    }

    noteLines.push(line);
    i++;
  }

  result.notes = noteLines.join("\n").trim();
  if (unknownBlocks.length) result.unknownBlocks = unknownBlocks;
  return result;
}

/** 由原始字段构造条目，并做类型转换 */
function buildItem(
  raw: Record<string, string>,
  heading: string,
  extra: ExtraField[] = [],
): ParsedItem {
  const errors: string[] = [];

  const title = raw.title ?? heading;
  if (!raw.title && heading) {
    // 标题取自 H2 —— 这是设计意图（人写起来更自然）
  }

  const id = raw.id ?? "";
  if (!id) errors.push("缺少 id");

  let kind: ItemKind = "task";
  if (raw.kind) {
    if (raw.kind === "task" || raw.kind === "event") {
      kind = raw.kind;
    } else {
      errors.push(`kind 非法：${raw.kind}（应为 task 或 event）`);
    }
  }

  let priority: ItemPriority | undefined;
  if (raw.priority) {
    // 兼容中文优先级（早期数据）
    const map: Record<string, ItemPriority> = {
      高: "high",
      中: "mid",
      低: "low",
      high: "high",
      mid: "mid",
      medium: "mid",
      low: "low",
    };
    const p = map[raw.priority];
    if (p) priority = p;
    else errors.push(`priority 非法：${raw.priority}`);
  }

  const start = normDateTime(raw.start);
  if (raw.start && !start) errors.push(`start 格式非法：${raw.start}`);

  const end = normDateTime(raw.end);
  if (raw.end && !end) errors.push(`end 格式非法：${raw.end}`);

  if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
    errors.push("end 必须晚于 start");
  }

  const due = normDate(raw.due);
  if (raw.due && !due) errors.push(`due 格式非法：${raw.due}`);

  const remind = normDateTime(raw.remind);
  if (raw.remind && !remind) errors.push(`remind 格式非法：${raw.remind}`);

  let done: boolean | undefined;
  if (raw.done !== undefined && raw.done !== "") {
    const v = raw.done.toLowerCase();
    if (v === "true" || v === "yes" || v === "1") done = true;
    else if (v === "false" || v === "no" || v === "0") done = false;
    else errors.push(`done 非法：${raw.done}`);
  }

  let allDay: boolean | undefined;
  if (raw.allDay !== undefined && raw.allDay !== "") {
    const v = raw.allDay.toLowerCase();
    if (v === "true" || v === "yes" || v === "1") allDay = true;
    else if (v === "false" || v === "no" || v === "0") allDay = false;
    else errors.push(`allDay 非法：${raw.allDay}`);
  }

  const item: ParsedItem = {
    id,
    uid: raw.uid || undefined,
    kind,
    title,
    start,
    end,
    due,
    remind,
    allDay,
    done,
    priority,
    recurrence: raw.recurrence || undefined,
    list: raw.list || undefined,
    parent: raw.parent || undefined,
    project: raw.project || undefined,
    tags: raw.tags
      ? raw.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined,
    description: raw.description || undefined,
    location: raw.location || undefined,
    status:
      raw.status &&
      ["confirmed", "tentative", "cancelled", "needs-action"].includes(
        raw.status,
      )
        ? (raw.status as WorkbenchItem["status"])
        : undefined,
    createdAt: raw.createdAt || undefined,
    updatedAt: raw.updatedAt || undefined,
  };

  if (!title) errors.push("缺少 title");
  if (raw.recurrence && !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;.*)?$/.test(raw.recurrence)) {
    errors.push(`recurrence 非法：${raw.recurrence}`);
  }

  if (extra.length) item.extra = extra;
  if (errors.length) item.errors = errors;
  return item;
}

/** 归一化日期时间：接受 YYYY-MM-DDTHH:mm 与带秒的形式 */
function normDateTime(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().replace(/^["']|["']$/g, "");
  if (!s) return undefined;
  // 补秒
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return undefined;
  const [, d, hh, mm, ss] = m;
  return `${d}T${hh}:${mm}:${ss ?? "00"}`;
}

/** 归一化日期 */
function normDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().replace(/^["']|["']$/g, "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

// ===== 序列化 =====

/**
 * 把条目数组序列化成 workspace.md 文本。
 *
 * 输出顺序：未完成在前、已完成在后，各按开始时间排序。
 * 这样人打开文件直接看到"还欠着什么"。
 */
export interface SerializeOptions {
  /** 原始 frontmatter（含 --- 行）；缺省写默认 v1 */
  frontmatterRaw?: string;
  /** 未知块原文（重新包上标记） */
  unknownBlocks?: string[];
}

/**
 * 把条目数组序列化成 workspace.md 文本。
 *
 * 输出顺序：未完成在前、已完成在后，各按开始时间排序。
 * 这样人打开文件直接看到"还欠着什么"。
 */
export function serializeWorkspace(
  items: WorkbenchItem[],
  notes?: string,
  opts: SerializeOptions = {},
): string {
  const out: string[] = [];
  const fm = (opts.frontmatterRaw ?? defaultFrontmatter()).replace(/\s+$/, "");
  out.push(fm);
  out.push("");

  const sorted = [...items].sort((a, b) => {
    const ad = a.done ? 1 : 0;
    const bd = b.done ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const at = a.start ?? a.due ?? "9999";
    const bt = b.start ?? b.due ?? "9999";
    return at.localeCompare(bt);
  });

  for (const item of sorted) {
    const parsed = item as ParsedItem;

    // 有校验错误且未被修复的条目：原样写回，绝不静默丢字段
    if (parsed.rawBlock && parsed.errors?.length) {
      out.push(parsed.rawBlock.replace(/\s+$/, ""));
      out.push("");
      continue;
    }

    out.push(`## ${escapeScalar(item.title)}`);
    out.push(`- id: ${item.id}`);
    if (item.uid && item.uid !== item.id) out.push(`- uid: ${escapeScalar(item.uid)}`);
    out.push(`- kind: ${item.kind}`);
    if (item.start) out.push(`- start: ${item.start}`);
    if (item.end) out.push(`- end: ${item.end}`);
    if (item.due) out.push(`- due: ${item.due}`);
    if (item.remind) out.push(`- remind: ${item.remind}`);
    if (item.allDay !== undefined) out.push(`- allDay: ${item.allDay}`);
    if (item.done !== undefined) out.push(`- done: ${item.done}`);
    if (item.priority) out.push(`- priority: ${item.priority}`);
    if (item.recurrence) out.push(`- recurrence: ${escapeScalar(item.recurrence)}`);
    if (item.list) out.push(`- list: ${escapeScalar(item.list)}`);
    if (item.parent) out.push(`- parent: ${escapeScalar(item.parent)}`);
    if (item.project) out.push(`- project: ${escapeScalar(item.project)}`);
    if (item.tags && item.tags.length) {
      out.push(`- tags: ${item.tags.map((t) => escapeScalar(t)).join(", ")}`);
    }
    if (item.location) out.push(`- location: ${escapeScalar(item.location)}`);
    if (item.status) out.push(`- status: ${item.status}`);
    if (item.description) {
      out.push(`- description: ${escapeScalar(item.description)}`);
    }
    if (item.createdAt) out.push(`- createdAt: ${item.createdAt}`);
    if (item.updatedAt) out.push(`- updatedAt: ${item.updatedAt}`);
    if (parsed.extra?.length) {
      for (const field of [...parsed.extra].sort((a, b) => a.line - b.line)) {
        out.push(`- ${field.key}: ${escapeScalar(field.value)}`);
      }
    }
    out.push("");
  }

  if (notes && notes.trim()) {
    out.push("<!-- notes -->");
    out.push("");
    out.push(notes.trim());
    out.push("");
  }

  for (const block of opts.unknownBlocks ?? []) {
    out.push(UNKNOWN_START);
    if (block.length) out.push(block);
    out.push(UNKNOWN_END);
    out.push("");
  }

  return out.join("\n");
}

// ===== 读 / 写 =====

/**
 * 读取并解析 workspace.md。
 *
 * 只有 ENOENT 才当「空文件」；EACCES/EISDIR 必须抛错，
 * 否则一次权限问题就会让后面的一次写入清空事实源（SDS §2.1）。
 */
export function readWorkspace(filePath?: string): WorkspaceFile {
  const p = filePath ?? workspaceFilePath();
  let content: string;
  try {
    content = fs.readFileSync(p, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        items: [],
        notes: "",
        frontmatterRaw: defaultFrontmatter(),
        unknownBlocks: [],
        filePath: p,
        raw: "",
      };
    }
    throw new WorkspaceReadError(
      `数据文件读取失败（${code ?? "UNKNOWN"}）：${path.basename(p)}`,
    );
  }

  const parsed = parseWorkspace(content);
  parsed.filePath = p;
  parsed.raw = content;

  // 有 ## 块却一条都认不出来 → 数据文件损坏，绝不当空文件继续写
  // 注意：只是字段写错（例如 end <= start）但能认出来的条目不算坏，仍要能读出来
  if (parsed.items.length > 0 && parsed.items.every((it) => !isParseableItem(it))) {
    throw new WorkspaceReadError(
      "数据文件中所有条目都无法解析，请先手工修复或从 .workspace-backups 恢复",
    );
  }

  return parsed;
}

/** 固定快照的有效期（与 backups.ts 的 24h 保持一致） */
const PINNED_TTL_MS = 24 * 60 * 60 * 1000;

/** 备份目录里已固定的 sha256 集合（文件名即 sha） */
function pinnedShaSet(dir: string): Set<string> {
  try {
    return new Set(
      fs
        .readdirSync(path.join(dir, ".pinned"))
        .filter((f) => /^[0-9a-f]{64}\.md$/.test(f))
        .map((f) => f.replace(/\.md$/, "")),
    );
  } catch {
    return new Set();
  }
}

/** 清理超过 24h 的固定快照；失败不影响写入 */
function cleanupPinnedSnapshots(dir: string): void {
  const pd = path.join(dir, ".pinned");
  let names: string[];
  try {
    names = fs.readdirSync(pd);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.md$/.test(name)) continue;
    try {
      const abs = path.join(pd, name);
      if (now - fs.statSync(abs).mtimeMs > PINNED_TTL_MS) fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
}

/** 该备份文件的内容是否已被固定（固定期间不许轮转删掉） */
function backupIsPinned(dir: string, name: string, pinned: Set<string>): boolean {
  if (pinned.size === 0) return false;
  try {
    const content = fs.readFileSync(path.join(dir, name), "utf-8");
    const sha = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    return pinned.has(sha);
  } catch {
    return false;
  }
}

/**
 * 写入前先备份当前文件。
 *
 * 返回备份路径；文件不存在或备份失败（非 restore 场景）返回 null。
 */
export function backupWorkspaceFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const dir = backupDir(filePath);
    fs.mkdirSync(dir, { recursive: true });
    cleanupPinnedSnapshots(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.basename(filePath).replace(/\.md$/, "");
    const rand = crypto.randomBytes(3).toString("hex");
    const target = path.join(dir, `${base}-${stamp}-${rand}.md`);
    fs.copyFileSync(filePath, target);

    // 轮转：份数与总量双上限，按文件名（时间戳）从新到旧
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}-`) && f.endsWith(".md"))
      .sort()
      .reverse();

    const pinned = pinnedShaSet(dir);
    for (const old of files.slice(MAX_BACKUPS)) {
      if (backupIsPinned(dir, old, pinned)) continue;
      try {
        fs.unlinkSync(path.join(dir, old));
      } catch {
        /* ignore */
      }
    }

    let total = 0;
    for (const name of files.slice(0, MAX_BACKUPS)) {
      try {
        total += fs.statSync(path.join(dir, name)).size;
      } catch {
        /* ignore */
      }
    }
    for (const old of files.slice(0, MAX_BACKUPS).reverse()) {
      if (total <= MAX_BACKUP_BYTES) break;
      if (backupIsPinned(dir, old, pinned)) continue;
      try {
        total -= fs.statSync(path.join(dir, old)).size;
        fs.unlinkSync(path.join(dir, old));
      } catch {
        /* ignore */
      }
    }
    return target;
  } catch (err) {
    console.warn("[workspace] 备份失败（继续写入）：", (err as Error).message);
    return null;
  }
}

/** 生成新条目 id（8 位十六进制） */
export function newItemId(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
}

// ===== 校验 =====

/** 校验单条记录，返回错误列表（空数组 = 通过） */
export function validateItem(item: Partial<WorkbenchItem>): string[] {
  const errors: string[] = [];

  if (!item.id || !/^[0-9a-f]{8}$/.test(item.id)) {
    errors.push("id 必须是 8 位小写十六进制");
  }
  if (!item.title || !item.title.trim()) {
    errors.push("title 不能为空");
  } else if (item.title.length > 200) {
    errors.push("title 超过 200 字符");
  }
  if (item.uid !== undefined) {
    if (typeof item.uid !== "string" || !item.uid.trim()) {
      errors.push("uid 不能为空字符串");
    } else if (item.uid.length > 255 || /[\r\n]/.test(item.uid)) {
      errors.push("uid 不能超过 255 字符或包含换行");
    }
  }
  if (item.kind && !["task", "event"].includes(item.kind)) {
    errors.push("kind 必须是 task 或 event");
  }
  if (item.priority && !["high", "mid", "low"].includes(item.priority)) {
    errors.push("priority 必须是 high / mid / low");
  }
  if (item.start && !normDateTime(item.start)) {
    errors.push("start 必须是 YYYY-MM-DDTHH:mm:ss（本地时间）");
  }
  if (item.end && !normDateTime(item.end)) {
    errors.push("end 必须是 YYYY-MM-DDTHH:mm:ss（本地时间）");
  }
  if (item.due && !normDate(item.due)) {
    errors.push("due 必须是 YYYY-MM-DD");
  }
  if (item.remind && !normDateTime(item.remind)) {
    errors.push("remind 必须是 YYYY-MM-DDTHH:mm:ss（本地时间）");
  }
  if (item.recurrence && !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;.*)?$/.test(item.recurrence)) {
    errors.push("recurrence 必须是合法的 RRULE");
  }

  const allowed = new Set([
    "id",
    "uid",
    "kind",
    "title",
    "start",
    "end",
    "due",
    "remind",
    "allDay",
    "done",
    "priority",
    "recurrence",
    "list",
    "parent",
    "project",
    "tags",
    "description",
    "location",
    "status",
    "createdAt",
    "updatedAt",
  ]);
  for (const k of Object.keys(item)) {
    if (!allowed.has(k)) errors.push(`未知字段：${k}`);
  }

  return errors;
}

/** 生成整份文件的校验报告 */
export function buildValidationReport(ws: WorkspaceFile): ValidationReport {
  const issues: ValidationReport["issues"] = [];
  let valid = 0;
  let invalid = 0;

  // id 重复检查
  const idCount = new Map<string, number>();
  for (const it of ws.items) {
    if (it.id) idCount.set(it.id, (idCount.get(it.id) ?? 0) + 1);
  }

  for (const it of ws.items) {
    const errors = [...(it.errors ?? [])];
    if (it.id && (idCount.get(it.id) ?? 0) > 1) {
      errors.push(`id 重复：${it.id}`);
    }
    if (errors.length) {
      invalid++;
      issues.push({ id: it.id, title: it.title, errors });
    } else {
      valid++;
    }
  }

  return { total: ws.items.length, valid, invalid, issues };
}

// ===== 视图辅助 =====

/**
 * 按模块视角筛选条目。
 *
 * 这是"模块 = 视图"的核心：
 *  - calendar：有 start 的条目（按 start 排）
 *  - board：kind=task（按 done 分组）
 *  - all：全部
 */
export function filterItems(
  items: ParsedItem[],
  opts: {
    kind?: "task" | "event";
    scope?: "all" | "calendar" | "board";
    start?: string;
    end?: string;
    includeDone?: boolean;
    /** 只看某个清单；空字符串表示「收件箱」（list 为空的条目） */
    list?: string;
  } = {},
): ParsedItem[] {
  let out = items.filter((i) => !i.errors);

  if (opts.kind) out = out.filter((i) => i.kind === opts.kind);

  if (opts.scope === "calendar") {
    out = out.filter((i) => !!i.start);
  } else if (opts.scope === "board") {
    out = out.filter((i) => i.kind === "task");
  }

  if (opts.start) {
    const s = new Date(`${opts.start}T00:00:00`).getTime();
    out = out.filter((i) => !i.start || new Date(i.start).getTime() >= s);
  }
  if (opts.end) {
    const e = new Date(`${opts.end}T23:59:59`).getTime();
    out = out.filter((i) => !i.start || new Date(i.start).getTime() <= e);
  }

  if (opts.list !== undefined) {
    // 空字符串 = 收件箱（还没归类的）
    out = out.filter((i) => (i.list || "") === opts.list);
  }

  if (opts.includeDone === false) {
    out = out.filter((i) => !i.done);
  }

  return out.sort((a, b) => {
    const ad = a.done ? 1 : 0;
    const bd = b.done ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const at = a.start ?? a.due ?? "9999";
    const bt = b.start ?? b.due ?? "9999";
    return at.localeCompare(bt);
  });
}

// ===== 清单（List）=====

/** 清单摘要 */
export interface ListSummary {
  /** 清单名；空字符串表示收件箱 */
  name: string;
  /** 展示名（收件箱有专属名字） */
  label: string;
  /** 该清单下条目总数 */
  total: number;
  /** 未完成数 */
  open: number;
  /** 逾期数 */
  overdue: number;
}

/** 收件箱的展示名 */
export const INBOX_LABEL = "收件箱";

/**
 * 从条目聚合出清单列表。
 *
 * 清单**不需要预先定义** —— 它只是条目上的一个字段值。
 * 空清单没有意义，所以不单独持久化，每次由条目算出来。
 *
 * 返回值：收件箱永远排第一（它是默认捕获入口），其余按名称排序。
 */
export function collectLists(items: ParsedItem[]): ListSummary[] {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const todayEnd = today.getTime();

  const map = new Map<string, { total: number; open: number; overdue: number }>();

  for (const it of items) {
    if (it.errors) continue;
    // 清单只装**任务** —— 事件属于日历，不参与清单统计。
    // （否则「收件箱」会把纯事件也算进去，与看板视图看到的数量对不上）
    if (it.kind !== "task") continue;
    // 子任务不单独计入清单统计 —— 否则「父任务 + 3 个子任务」会让
    // 清单显示 4 条，而看板上只看到 1 个父任务，数量对不上。
    if (it.parent) continue;
    const key = it.list || "";
    const cur = map.get(key) ?? { total: 0, open: 0, overdue: 0 };
    cur.total++;
    if (!it.done) {
      cur.open++;
      // 逾期：有截止日且已过今天
      if (it.due && new Date(`${it.due}T00:00:00`).getTime() < todayEnd) {
        // 只算「已经过了截止日当天」的
        const dueEnd = new Date(`${it.due}T23:59:59`).getTime();
        if (dueEnd < todayEnd) cur.overdue++;
      }
    }
    map.set(key, cur);
  }

  const out: ListSummary[] = [];
  for (const [name, stat] of map) {
    out.push({
      name,
      label: name || INBOX_LABEL,
      ...stat,
    });
  }

  // 收件箱排第一，其余按名称
  return out.sort((a, b) => {
    if (a.name === "" && b.name !== "") return -1;
    if (b.name === "" && a.name !== "") return 1;
    return a.label.localeCompare(b.label, "zh-CN");
  });
}

// ===== 子任务 =====

/** 带子任务统计的条目（用于看板渲染） */
export interface ItemWithProgress extends ParsedItem {
  /** 直接子任务总数 */
  subtaskTotal?: number;
  /** 已完成的子任务数 */
  subtaskDone?: number;
  /** 进度百分比 0-100；无子任务时缺省 */
  progress?: number;
}

/**
 * 给条目附加子任务进度。
 *
 * 只统计**直接子任务**（一级），不做递归 —— 递归进度容易让用户困惑
 * （「我明明勾完了 3 个，为什么父任务还是 40%？」）。
 *
 * 子任务的完成状态不会自动回写父任务的 done —— 那是用户的判断。
 * 这里只提供数据，UI 决定怎么展示。
 */
export function attachSubtaskProgress(
  items: ParsedItem[],
): ItemWithProgress[] {
  // 先按 parent 分组
  const kidsByParent = new Map<string, ParsedItem[]>();
  for (const it of items) {
    if (!it.parent || it.errors) continue;
    const arr = kidsByParent.get(it.parent) ?? [];
    arr.push(it);
    kidsByParent.set(it.parent, arr);
  }

  return items.map((it) => {
    const kids = kidsByParent.get(it.id);
    if (!kids || kids.length === 0) return { ...it };
    const done = kids.filter((k) => k.done).length;
    return {
      ...it,
      subtaskTotal: kids.length,
      subtaskDone: done,
      progress: Math.round((done / kids.length) * 100),
    };
  });
}

/**
 * 取出顶层条目（没有 parent 的），并挂上子任务进度。
 *
 * 用于看板主列表 —— 子任务不单独占一行，而是显示在父任务下面。
 */
export function topLevelWithProgress(items: ParsedItem[]): ItemWithProgress[] {
  const withProgress = attachSubtaskProgress(items);
  return withProgress.filter((it) => !it.parent);
}

/** 取某个父任务的所有子任务 */
export function childrenOf(items: ParsedItem[], parentId: string): ParsedItem[] {
  return items.filter((it) => it.parent === parentId && !it.errors);
}
