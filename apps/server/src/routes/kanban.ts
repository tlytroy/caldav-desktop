/**
 * 工作搭子看板 (Kanban) API Routes
 *
 * 解析 / 写回 `工作搭子看板.md` —— 工作搭子的唯一事实源（看板格式）。
 *
 * 双向绑定支持：
 *   - 任务 ↔ 日历事件通过 `日历:<uid>`（看板上）↔ `kanbanTaskId`（events.md）互链
 *   - POST /task 接受 `calendar: { date, allDay, endDate?, endTime?, time? }`
 *     → 同时创建 events.md 事件并互填链接字段
 *   - PATCH /task/:id 同上，可选 clearCalendar:true 解除并删除事件
 *   - DELETE /task/:id 自动连带删除日历事件
 *
 * 格式规范见 REF/work-dazi-toolkit/开发指南.md
 *   ## 待办  -> - [ ] [高] 任务 | 截止:2026-08-18 | 预估:3 | 项目:职称评审 | 日历:md-event-xxx
 *   ## 项目  -> ### 项目名 / 当前： / 下一步： / 卡点： / 关联：
 *   ## 速记  -> - #标签 内容
 */

import express from "express";
import fs from "fs";
import path from "path";
import { ensureEventsFile, writeEventsFile } from "../md-ics-bridge.js";
import { resolveDataPath } from "../config.js";

export const kanbanRouter = express.Router();

/**
 * 看板文件路径。
 * 来源优先级：环境变量 > config.json（界面可改）> 默认值。
 * 见 config.ts 的 resolveDataPath()。
 *
 * ⚠️ 这里在模块加载时求值一次。若用户在界面改了路径，需要重启服务
 *    （文件路径变更涉及已打开的文件句柄，冷启动更安全）。
 */
const KANBAN_FILE = resolveDataPath("kanban");

// ===== 类型 =====
export interface KanbanTodo {
  /** 稳定 ID，写入 md 的 `| id:` 字段。不可用行序代替 —— 行序会随增删漂移 */
  id: string;
  done: boolean;
  priority: "高" | "中" | "低";
  title: string;
  due?: string; // YYYY-MM-DD
  estimate?: number; // 预估工时
  project?: string;
  deferred?: number;
  doneDate?: string;
  /** 关联的日历事件 uid（双向绑定）。events.md 里反向记录 kanbanTaskId */
  calendarEventUid?: string;
}

export interface KanbanProject {
  name: string;
  current?: string;
  next?: string;
  blocker?: string;
  related: string[];
}

export interface KanbanNote {
  tags: string[];
  text: string;
}

export interface KanbanData {
  updated?: string;
  todos: KanbanTodo[];
  projects: KanbanProject[];
  notes: KanbanNote[];
}

const SAMPLE = `# 工作搭子看板
> 最后更新：__NOW__

## 待办
- [ ] [高] 示例任务：把这篇改成你的真实计划 | id:__ID__ | 截止:__DUE__ | 预估:2 | 项目:示例

## 项目
### 示例
当前：刚初始化看板
下一步：添加你的第一个任务
卡点：无
关联：示例任务：把这篇改成你的真实计划

## 速记
<!-- 灵感速记（#标签 内容） -->
`;

/** 生成稳定任务 ID：时间戳 + 随机后缀，跨重启不冲突 */
export function generateTaskId(): string {
  return `k-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function seedFile(): void {
  if (fs.existsSync(KANBAN_FILE)) return;
  const now = new Date().toISOString();
  const due = new Date(Date.now() + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  fs.writeFileSync(
    KANBAN_FILE,
    SAMPLE.replace("__NOW__", now)
      .replace("__DUE__", due)
      .replace("__ID__", generateTaskId()),
    "utf-8",
  );
}

function ensureFile(): string {
  seedFile();
  return KANBAN_FILE;
}

// ===== 解析 =====
const TODO_RE = /^-\s*\[([ xX])\]\s*\[([高低中])\]\s*(.+)$/;

function parseFields(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = rest.split("|").map((s) => s.trim());
  for (let i = 1; i < parts.length; i++) {
    const idx = parts[i].indexOf(":");
    if (idx > 0) {
      const k = parts[i].slice(0, idx).trim();
      const v = parts[i].slice(idx + 1).trim();
      if (k) out[k] = v;
    }
  }
  return out;
}

export function parseKanban(content: string): KanbanData {
  const lines = content.split(/\r?\n/);
  const data: KanbanData = { todos: [], projects: [], notes: [] };

  let section: "none" | "todo" | "project" | "note" = "none";
  let curProject: KanbanProject | null = null;
  let todoSeq = 0;

  for (const raw of lines) {
    const line = raw.trim();

    const upd = line.match(/^>\s*最后更新[:：]\s*(.+)$/);
    if (upd) {
      data.updated = upd[1].trim();
      continue;
    }

    if (line.startsWith("## ")) {
      const name = line.slice(3).trim();
      if (name === "待办") section = "todo";
      else if (name === "项目") section = "project";
      else if (name === "速记") section = "note";
      else section = "none";
      curProject = null;
      continue;
    }

    if (section === "todo") {
      const m = line.match(TODO_RE);
      if (m) {
        const titleAndRest = m[3];
        const barIdx = titleAndRest.indexOf("|");
        const title =
          barIdx >= 0
            ? titleAndRest.slice(0, barIdx).trim()
            : titleAndRest.trim();
        const fields = parseFields(titleAndRest);
        const todo: KanbanTodo = {
          // 优先用 md 里持久化的稳定 id；老文件没有 id 字段时回退到行序（仅兼容用，
          // 一旦被 PUT/POST 写回就会补上稳定 id）
          id: fields["id"] || `t${todoSeq}`,
          done: m[1].toLowerCase() === "x",
          priority: (m[2] as KanbanTodo["priority"]) || "中",
          title,
          due: fields["截止"] || undefined,
          estimate: fields["预估"] ? Number(fields["预估"]) : undefined,
          project: fields["项目"] || undefined,
          deferred: fields["顺延"] ? Number(fields["顺延"]) : undefined,
          doneDate: fields["完成"] || undefined,
          calendarEventUid: fields["日历"] || undefined,
        };
        todoSeq++;
        data.todos.push(todo);
      }
      continue;
    }

    if (section === "project") {
      if (line.startsWith("### ")) {
        curProject = { name: line.slice(4).trim(), related: [] };
        data.projects.push(curProject);
        continue;
      }
      if (curProject) {
        if (line.startsWith("当前：")) curProject.current = line.slice(3).trim();
        else if (line.startsWith("下一步：")) curProject.next = line.slice(4).trim();
        else if (line.startsWith("卡点：")) curProject.blocker = line.slice(3).trim();
        else if (line.startsWith("关联：")) {
          curProject.related = line
            .slice(3)
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
      continue;
    }

    if (section === "note") {
      if (line.startsWith("-") && line.length > 1) {
        const body = line.slice(1).trim();
        if (!body || body.startsWith("<!--")) continue;
        const tags: string[] = [];
        const text = body.replace(/#([^\s#]+)/g, (_m, t) => {
          tags.push(t);
          return "";
        }).trim();
        data.notes.push({ tags, text });
      }
      continue;
    }
  }

  return data;
}

// ===== 序列化 =====
function fieldStr(t: KanbanTodo): string {
  const f: string[] = [];
  // id 必须落盘：它是 events.md 里 kanbanTaskId 的关联键，
  // 也决定后续 PATCH/DELETE 能不能命中正确的行
  f.push(`id:${t.id}`);
  if (t.due) f.push(`截止:${t.due}`);
  if (t.estimate != null) f.push(`预估:${t.estimate}`);
  if (t.project) f.push(`项目:${t.project}`);
  if (t.deferred != null) f.push(`顺延:${t.deferred}`);
  if (t.done && t.doneDate) f.push(`完成:${t.doneDate}`);
  if (t.calendarEventUid) f.push(`日历:${t.calendarEventUid}`);
  return ` | ${f.join(" | ")}`;
}

export function serializeKanban(data: KanbanData): string {
  const out: string[] = [];
  out.push("# 工作搭子看板");
  out.push(`> 最后更新：${new Date().toISOString()}`);
  out.push("");
  out.push("## 待办");
  for (const t of data.todos) {
    const mark = t.done ? "x" : " ";
    out.push(`- [${mark}] [${t.priority}] ${t.title}${fieldStr(t)}`);
  }
  if (data.todos.length === 0) out.push("");
  out.push("");
  out.push("## 项目");
  for (const p of data.projects) {
    out.push(`### ${p.name}`);
    out.push(`当前：${p.current || "无"}`);
    out.push(`下一步：${p.next || "无"}`);
    out.push(`卡点：${p.blocker || "无"}`);
    out.push(`关联：${p.related.join("，")}`);
    out.push("");
  }
  if (data.projects.length === 0) out.push("");
  out.push("## 速记");
  out.push("<!-- 灵感速记（#标签 内容） -->");
  for (const n of data.notes) {
    const tagStr = n.tags.map((t) => `#${t}`).join(" ");
    out.push(`- ${tagStr} ${n.text}`.trim());
  }
  out.push("");
  return out.join("\n");
}

function readData(): KanbanData {
  const file = ensureFile();
  return parseKanban(fs.readFileSync(file, "utf-8"));
}

function writeData(data: KanbanData): void {
  const file = ensureFile();
  fs.writeFileSync(file, serializeKanban(data), "utf-8");
}

// ===== 供 md-bridge.ts 复用的行级操作（统一走稳定 id，禁止行序定位） =====

/**
 * 在看板「待办」段内按稳定 id 定位行号。
 *
 * 历史 bug：早期实现用行序 `t{seq}` 定位，而新增任务会 unshift 到队首，
 * 导致所有存量任务的 id 整体错位 —— 删 A 连带删掉 B 的日历事件。
 * 现在 id 落盘在 `| id:` 字段，行序只作为旧文件（无 id）的兼容回退。
 *
 * @returns 行号；找不到返回 -1
 */
export function findTodoLineIndex(content: string, taskId: string): number {
  const lines = content.split(/\r?\n/);
  let inTodo = false;
  let seq = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("## ")) {
      inTodo = l.slice(3).trim() === "待办";
      continue;
    }
    if (!inTodo) continue;
    const m = l.match(TODO_RE);
    if (!m) continue;
    const fields = parseFields(m[3]);
    const id = fields["id"] || `t${seq}`;
    seq++;
    if (id === taskId) return i;
  }
  return -1;
}

/** 按稳定 id 删除一条任务行；返回是否真的删掉了。 */
export function removeKanbanTaskLine(taskId: string): boolean {
  const file = ensureFile();
  const content = fs.readFileSync(file, "utf-8");
  const idx = findTodoLineIndex(content, taskId);
  if (idx < 0) return false;
  const lines = content.split(/\r?\n/);
  lines.splice(idx, 1);
  fs.writeFileSync(file, touchUpdated(lines), "utf-8");
  return true;
}

/**
 * 按稳定 id 在看板插入一条任务，返回新任务 id。
 * 与 POST /task 的实现保持一致（含 id 落盘），避免两处生成的 id 规则不同。
 */
export function insertKanbanTaskLine(t: {
  title: string;
  priority: "高" | "中" | "低";
  due?: string;
  project?: string;
  calendarEventUid?: string;
}): string {
  const file = ensureFile();
  const data = parseKanban(fs.readFileSync(file, "utf-8"));
  const id = generateTaskId();
  const todo: KanbanTodo = {
    id,
    done: false,
    priority: t.priority,
    title: t.title,
    due: t.due,
    project: t.project,
    calendarEventUid: t.calendarEventUid,
  };
  data.todos.unshift(todo);
  fs.writeFileSync(file, serializeKanban(data), "utf-8");
  return id;
}

/** 把内容里的「最后更新」时间戳刷新为当前时间 */
function touchUpdated(lines: string[]): string {
  return lines
    .map((l) =>
      l.startsWith("> 最后更新：") ? `> 最后更新：${new Date().toISOString()}` : l,
    )
    .join("\n");
}

// ===== events.md 双向绑定 helper =====

/**
 * 在 events.md 中删除指定 uid 的事件（如果存在）。
 * 找不到不视为错误。
 */
function removeLinkedEvent(uid: string): void {
  try {
    const eventsFile = ensureEventsFile(
      resolveDataPath("events"),
    );
    const before = eventsFile.events.length;
    eventsFile.events = eventsFile.events.filter((e) => e.uid !== uid);
    if (eventsFile.events.length !== before) {
      writeEventsFile(eventsFile);
    }
  } catch (e) {
    console.warn(`[kanban] 删除关联事件 ${uid} 失败：`, (e as Error).message);
  }
}

/**
 * 在 events.md 中创建一个事件，并反填 kanbanTaskId。
 * 返回生成的 uid。
 */
function createLinkedEvent(
  task: KanbanTodo,
  cal: { date: string; allDay?: boolean; end?: string },
): string {
  const eventsFile = ensureEventsFile(
    resolveDataPath("events"),
  );
  const uid = `md-event-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;
  eventsFile.events.push({
    uid,
    title: task.title,
    date: cal.date,
    end: cal.end,
    allDay: cal.allDay,
    status: "confirmed",
    category: task.project || "任务",
    tags: task.priority === "高" ? ["高优", "任务"] : ["任务"],
    priority:
      task.priority === "高" ? "high" : task.priority === "中" ? "medium" : "low",
    description: `来自工作搭子看板（${task.priority}优先级）`,
    updated: new Date().toISOString(),
    source: "md",
    kanbanTaskId: task.id,
  });
  writeEventsFile(eventsFile);
  return uid;
}

/**
 * 在 events.md 中更新已有事件的日期/时间，并保证 kanbanTaskId 仍对应本任务。
 */
function updateLinkedEvent(
  uid: string,
  taskId: string,
  cal: { date: string; allDay?: boolean; end?: string },
): void {
  try {
    const eventsFile = ensureEventsFile(
      resolveDataPath("events"),
    );
    const ev = eventsFile.events.find((e) => e.uid === uid);
    if (ev) {
      ev.date = cal.date;
      ev.end = cal.end;
      ev.allDay = cal.allDay;
      ev.kanbanTaskId = taskId;
      ev.updated = new Date().toISOString();
      writeEventsFile(eventsFile);
    }
  } catch (e) {
    console.warn(`[kanban] 更新关联事件 ${uid} 失败：`, (e as Error).message);
  }
}

// ===== 路由 =====

kanbanRouter.get("/", (_req, res) => {
  try {
    const data = readData();
    res.json({ success: true, ...data, filePath: KANBAN_FILE });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

kanbanRouter.get("/raw", (_req, res) => {
  try {
    const file = ensureFile();
    res.json({ success: true, content: fs.readFileSync(file, "utf-8"), filePath: KANBAN_FILE });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

kanbanRouter.put("/", (req, res) => {
  try {
    const { todos, projects, notes } = req.body;
    if (!Array.isArray(todos)) {
      return res.status(400).json({ error: "todos array is required" });
    }
    // 全量覆盖：补齐缺失的 id，避免写出 `| id:` 为空的行导致后续操作失联
    const normalized = (todos as KanbanTodo[]).map((t, i) => ({
      ...t,
      id: t.id?.trim() || `t${i}`,
      title: t.title || "(未命名任务)",
    }));
    writeData({
      todos: normalized,
      projects: Array.isArray(projects) ? (projects as KanbanProject[]) : [],
      notes: Array.isArray(notes) ? (notes as KanbanNote[]) : [],
    });
    res.json({ success: true, count: normalized.length });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * POST /api/kanban/task
 * Body: Partial<KanbanTodo> & {
 *   calendar?: { date: string; endDate?: string; time?: string; endTime?: string; allDay?: boolean }
 * }
 *
 * 若提供 calendar 字段，会在 events.md 创建事件并互填链接字段。
 */
kanbanRouter.post("/task", (req, res) => {
  try {
    const t = req.body as Partial<KanbanTodo> & {
      calendar?: {
        date: string;
        endDate?: string;
        time?: string;
        endTime?: string;
        allDay?: boolean;
      };
    };
    if (!t.title) return res.status(400).json({ error: "title is required" });
    const data = readData();
    const todo: KanbanTodo = {
      id: generateTaskId(),
      done: false,
      priority: (t.priority as KanbanTodo["priority"]) || "中",
      title: t.title,
      due: t.due,
      estimate: t.estimate,
      project: t.project,
      deferred: t.deferred,
    };

    // 若要求同时加入日历
    if (t.calendar?.date) {
      const cal = composeCalendarDate(t.calendar);
      const uid = createLinkedEvent(todo, cal);
      todo.calendarEventUid = uid;
    }

    data.todos.unshift(todo);
    writeData(data);
    res.status(201).json({ success: true, todo });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * PATCH /api/kanban/task/:id
 * Body: Partial<KanbanTodo> & {
 *   calendar?: { date: string; endDate?: string; time?: string; endTime?: string; allDay?: boolean },
 *   clearCalendar?: boolean
 * }
 */
kanbanRouter.patch("/task/:id", (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body as Partial<KanbanTodo> & {
      calendar?: {
        date: string;
        endDate?: string;
        time?: string;
        endTime?: string;
        allDay?: boolean;
      };
      clearCalendar?: boolean;
    };
    const data = readData();
    const idx = data.todos.findIndex((t) => t.id === id);
    if (idx < 0) return res.status(404).json({ error: "task not found" });
    const cur = data.todos[idx];
    // id 是主键，不接受被 patch 覆盖；
    // calendar / clearCalendar 是控制指令，不能混进任务字段被写进 md
    const {
      id: _ignoredId,
      calendar: _cal,
      clearCalendar: _clear,
      ...fieldPatch
    } = patch;
    void _ignoredId;
    void _cal;
    void _clear;
    const next: KanbanTodo = { ...cur, ...fieldPatch, id: cur.id };

    // 自动记录完成日期
    if (patch.done === true && !cur.done)
      next.doneDate = new Date().toISOString().slice(0, 10);
    if (patch.done === false) next.doneDate = undefined;

    // === 双绑联动 ===
    // 1) 解除日历绑定 → 删除 events.md 中的事件
    if (patch.clearCalendar) {
      if (next.calendarEventUid) removeLinkedEvent(next.calendarEventUid);
      next.calendarEventUid = undefined;
    }
    // 2) 新增/更新日历绑定
    else if (patch.calendar?.date) {
      const cal = composeCalendarDate(patch.calendar);
      if (next.calendarEventUid) {
        // 已绑定 → 更新现有事件
        updateLinkedEvent(next.calendarEventUid, next.id, cal);
      } else {
        // 未绑定 → 新建事件
        const uid = createLinkedEvent(next, cal);
        next.calendarEventUid = uid;
      }
      // 同步 due 字段（从 calendar.date 取日期部分）
      if (cal.date && !patch.due) {
        const dateOnly = cal.date.slice(0, 10);
        if (dateOnly.match(/^\d{4}-\d{2}-\d{2}$/)) next.due = dateOnly;
      }
    }

    data.todos[idx] = next;
    writeData(data);
    res.json({ success: true, todo: next });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

kanbanRouter.delete("/task/:id", (req, res) => {
  try {
    const { id } = req.params;
    const data = readData();
    const target = data.todos.find((t) => t.id === id);
    // 若任务有绑定日历事件，连带删除
    if (target?.calendarEventUid) {
      removeLinkedEvent(target.calendarEventUid);
    }
    const before = data.todos.length;
    data.todos = data.todos.filter((t) => t.id !== id);
    if (data.todos.length === before)
      return res.status(404).json({ error: "task not found" });
    writeData(data);
    res.json({ success: true, removed: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * POST /api/kanban/task/:id/unlink-calendar
 * 解除与日历事件的绑定，但不删除事件本身（保留在日历里独立显示）。
 */
kanbanRouter.post("/task/:id/unlink-calendar", (req, res) => {
  try {
    const { id } = req.params;
    const data = readData();
    const idx = data.todos.findIndex((t) => t.id === id);
    if (idx < 0) return res.status(404).json({ error: "task not found" });
    const cur = data.todos[idx];
    const next: KanbanTodo = { ...cur, calendarEventUid: undefined };
    data.todos[idx] = next;
    writeData(data);
    res.json({ success: true, todo: next });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ===== helper =====

/**
 * 把 { date, time, endDate, endTime, allDay } 拼成 { date: ISO, end?: ISO, allDay }。
 * date 与 endDate 必须是 YYYY-MM-DD，time / endTime 为 HH:mm，均按**本地时间**理解。
 *
 * 两个必须注意的点（历史 bug）：
 *  1. 不能用 `${date}T09:00:00.000Z` 拼 ISO —— 那等于把"东八区 9 点"当成"UTC 9 点"
 *     存进文件，日历上会整体偏 8 小时。必须构造成本地时间再 toISOString()。
 *  2. 全天事件的 ICS DTEND 是**排他**的，必须是次日 00:00。若与 start 同日，
 *     导出的 .ics 是零长度事件，部分客户端会直接不显示。
 */
function composeCalendarDate(c: {
  date: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  allDay?: boolean;
}): { date: string; allDay?: boolean; end?: string } {
  if (!c.date) return { date: new Date().toISOString() };

  // 未显式指定时间即视为全天
  const allDay = c.allDay === true || (!c.time && !c.endTime);

  let startLocal: Date;
  let endLocal: Date;

  if (allDay) {
    startLocal = new Date(`${c.date}T00:00:00`);
    // 结束日缺省为开始日；ICS 要求 DTEND 为排他边界，故取次日
    const endDay = c.endDate && c.endDate > c.date ? c.endDate : c.date;
    endLocal = new Date(`${endDay}T00:00:00`);
    endLocal.setDate(endLocal.getDate() + 1);
  } else {
    startLocal = new Date(`${c.date}T${(c.time || "09:00").padEnd(5, ":00")}:00`);
    const endDay = c.endDate && c.endDate > c.date ? c.endDate : c.date;
    endLocal = new Date(`${endDay}T${(c.endTime || "10:00").padEnd(5, ":00")}:00`);
    // 结束不晚于开始（如跨天误填）→ 兜底 +1 小时
    if (endLocal.getTime() <= startLocal.getTime()) {
      endLocal = new Date(startLocal.getTime() + 3600000);
    }
  }

  return {
    date: startLocal.toISOString(),
    end: endLocal.toISOString(),
    allDay,
  };
}
