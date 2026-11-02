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
import * as path from "node:path";
import { resolveDataPath } from "./config.js";

export type ItemKind = "task" | "event";
export type ItemPriority = "high" | "mid" | "low";

export interface WorkbenchItem {
  id: string;
  kind: ItemKind;
  title: string;
  /** 本地时间，不带时区后缀 */
  start?: string;
  end?: string;
  due?: string;
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

/** 解析结果里的条目：可能带校验错误 */
export interface ParsedItem extends WorkbenchItem {
  /** 校验错误列表；非空表示这条有问题，但其它条目不受影响 */
  errors?: string[];
}

export interface WorkspaceFile {
  items: ParsedItem[];
  /** 文件头之后的自由文本（AI 可以写备注） */
  notes: string;
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
const MAX_BACKUPS = 10;

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
export function parseWorkspace(content: string): WorkspaceFile {
  const result: WorkspaceFile = { items: [], notes: "" };
  const lines = content.split(/\r?\n/);

  let i = 0;

  // ---- 跳过 frontmatter ----
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++; // 跳过结束的 ---
  }

  // 收集非条目内容
  const noteLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // ---- 自由笔记区标记：其后全部是笔记 ----
    if (/^<!--\s*notes\s*-->/i.test(line.trim())) {
      i++;
      while (i < lines.length) {
        noteLines.push(lines[i]);
        i++;
      }
      break;
    }

    // ---- 条目起始 ----
    if (/^##\s+/.test(line)) {
      const heading = line.replace(/^##\s+/, "").trim();
      const raw: Record<string, string> = {};
      i++;

      // 收集该条目的字段行，直到遇到下一个 ## 或空行后的非字段内容
      while (i < lines.length && !/^##\s+/.test(lines[i])) {
        const l = lines[i];
        const m = l.match(/^\s*[-*]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
        if (m) {
          raw[m[1]] = m[2].trim();
          i++;
        } else if (l.trim() === "") {
          // 空行：可能是条目结束，也可能是字段块中的分隔
          // 向前看：下一行若仍是字段则继续，否则结束
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === "") j++;
          const nextIsField =
            j < lines.length &&
            /^\s*[-*]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/.test(lines[j]);
          if (!nextIsField) {
            i = j;
            break;
          }
          i = j;
        } else {
          // 缩进的续行（描述字段的多行内容）→ 追加到上一个字段
          const lastKey = Object.keys(raw).pop();
          if (lastKey && /^\s{2,}/.test(l)) {
            raw[lastKey] = (raw[lastKey] + " " + l.trim()).trim();
            i++;
          } else {
            // 无法识别 → 跳到下一个 ## 或字段
            noteLines.push(l);
            i++;
          }
        }
      }

      const item = buildItem(raw, heading);
      result.items.push(item);
      continue;
    }

    noteLines.push(line);
    i++;
  }

  result.notes = noteLines.join("\n").trim();
  return result;
}

/** 由原始字段构造条目，并做类型转换 */
function buildItem(
  raw: Record<string, string>,
  heading: string,
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
    kind,
    title,
    start,
    end,
    due,
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
export function serializeWorkspace(items: WorkbenchItem[], notes?: string): string {
  const out: string[] = [];
  out.push("---");
  out.push(`schema: ${SCHEMA_VERSION}`);
  out.push("---");
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
    out.push(`## ${item.title}`);
    out.push(`- id: ${item.id}`);
    out.push(`- kind: ${item.kind}`);
    if (item.start) out.push(`- start: ${item.start}`);
    if (item.end) out.push(`- end: ${item.end}`);
    if (item.due) out.push(`- due: ${item.due}`);
    if (item.allDay !== undefined) out.push(`- allDay: ${item.allDay}`);
    if (item.done !== undefined) out.push(`- done: ${item.done}`);
    if (item.priority) out.push(`- priority: ${item.priority}`);
    if (item.recurrence) out.push(`- recurrence: ${item.recurrence}`);
    if (item.list) out.push(`- list: ${item.list}`);
    if (item.parent) out.push(`- parent: ${item.parent}`);
    if (item.project) out.push(`- project: ${item.project}`);
    if (item.tags && item.tags.length) {
      out.push(`- tags: ${item.tags.join(", ")}`);
    }
    if (item.location) out.push(`- location: ${item.location}`);
    if (item.status) out.push(`- status: ${item.status}`);
    if (item.description) {
      out.push(`- description: ${item.description}`);
    }
    if (item.createdAt) out.push(`- createdAt: ${item.createdAt}`);
    if (item.updatedAt) out.push(`- updatedAt: ${item.updatedAt}`);
    out.push("");
  }

  if (notes && notes.trim()) {
    out.push("<!-- notes -->");
    out.push("");
    out.push(notes.trim());
    out.push("");
  }

  return out.join("\n");
}

// ===== 读 / 写 =====

/** 读取并解析 workspace.md（文件不存在时返回空集合） */
export function readWorkspace(filePath?: string): WorkspaceFile {
  const p = filePath ?? workspaceFilePath();
  try {
    if (!fs.existsSync(p)) {
      return { items: [], notes: "", filePath: p, raw: "" };
    }
    const content = fs.readFileSync(p, "utf-8");
    const parsed = parseWorkspace(content);
    parsed.filePath = p;
    parsed.raw = content;
    return parsed;
  } catch (err) {
    console.error("[workspace] 读取失败：", (err as Error).message);
    return { items: [], notes: "", filePath: p, raw: "" };
  }
}

/** 写入前先备份当前文件 */
function backupCurrent(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const dir = backupDir(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.basename(filePath).replace(/\.md$/, "");
    const target = path.join(dir, `${base}-${stamp}.md`);
    fs.copyFileSync(filePath, target);

    // 轮转：只保留最近 MAX_BACKUPS 份
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}-`) && f.endsWith(".md"))
      .sort()
      .reverse();
    for (const old of files.slice(MAX_BACKUPS)) {
      try {
        fs.unlinkSync(path.join(dir, old));
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn("[workspace] 备份失败（继续写入）：", (err as Error).message);
  }
}

/** 写入 workspace.md（自动备份） */
export function writeWorkspace(
  items: WorkbenchItem[],
  notes?: string,
  filePath?: string,
): string {
  const p = filePath ?? workspaceFilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  backupCurrent(p);
  fs.writeFileSync(p, serializeWorkspace(items, notes), "utf-8");
  return p;
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
  if (item.recurrence && !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;.*)?$/.test(item.recurrence)) {
    errors.push("recurrence 必须是合法的 RRULE");
  }

  const allowed = new Set([
    "id",
    "kind",
    "title",
    "start",
    "end",
    "due",
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
