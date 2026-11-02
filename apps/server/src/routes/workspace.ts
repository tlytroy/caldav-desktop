import express from "express";
import {
  readWorkspace,
  writeWorkspace,
  validateItem,
  buildValidationReport,
  filterItems,
  newItemId,
  workspaceFilePath,
  type WorkbenchItem,
  type ParsedItem,
  type ItemKind,
} from "../workspace.js";
import { expandEventInstances, describeRRule } from "../recurrence.js";
import { expandRecurrenceDates, parseRRule } from "../recurrence.js";
import {
  itemsToIcs,
  parseIcsEvents,
  icsEventToItem,
} from "../ics-convert.js";

export const workspaceRouter = express.Router();

/**
 * 统一数据源 API（workspace.md）
 * ============================
 *
 * ## 与旧 API 的关系
 *
 * 旧的 `/api/md-bridge/*` 与 `/api/kanban/*` 走的是**两个文件 + 双向绑定**。
 * 那套机制已经被本文件取代 —— 事件与任务现在是同一个条目池里的两类记录，
 * 没有绑定字段、没有级联删除、没有解绑。
 *
 * 旧路由暂时保留（兼容期），但内部实现已改为读写 workspace.md。
 */

/** 读取全部条目（含无效条目，供校验报告用） */
function loadAll(): ParsedItem[] {
  return readWorkspace().items;
}

/** 找出条目在数组中的下标 */
function findIndex(items: ParsedItem[], id: string): number {
  return items.findIndex((i) => i.id === id);
}

// ===== 列表 =====

/**
 * GET /api/workspace/items
 *
 * 查询参数：
 *  - scope: all | calendar | board —— 模块视角（默认 all）
 *  - kind: task | event
 *  - start / end: 日期范围过滤
 *  - includeDone: false 排除已完成
 *  - expand: true 时把重复事件展开成多个实例（给日历用）
 */
workspaceRouter.get("/items", async (req, res) => {
  try {
    const {
      scope = "all",
      kind,
      start,
      end,
      includeDone = "true",
      expand = "false",
    } = req.query as Record<string, string | undefined>;

    const ws = readWorkspace();
    let items = filterItems(ws.items, {
      scope: scope as any,
      kind: kind as any,
      start,
      end,
      includeDone: includeDone !== "false",
    });

    // ---- 重复事件展开 ----
    if (expand === "true") {
      const rangeStart = start || defaultRangeStart();
      const rangeEnd = end || defaultRangeEnd();
      const expanded: any[] = [];
      for (const it of items) {
        if (!it.recurrence || !it.start) {
          expanded.push({
            ...it,
            instanceId: it.id,
            instanceDate: it.start?.slice(0, 10),
          });
          continue;
        }
        const instances = expandEventInstances(
          it.start,
          it.end,
          it.recurrence,
          rangeStart,
          rangeEnd,
        );
        for (const inst of instances) {
          expanded.push({
            ...it,
            id: `${it.id}@${inst.instanceDate}`,
            instanceId: it.id,
            instanceDate: inst.instanceDate,
            start: inst.start,
            end: inst.end,
          });
        }
      }
      items = expanded as any;
    }

    res.json({
      success: true,
      items,
      count: items.length,
      filePath: ws.filePath,
      notes: ws.notes,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** 默认展开区间起点（今天往前 30 天） */
function defaultRangeStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return localDate(d);
}

/** 默认展开区间终点（今天往后 180 天） */
function defaultRangeEnd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 180);
  return localDate(d);
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// ===== 校验报告 =====

/**
 * GET /api/workspace/validation
 *
 * 返回整份文件的校验结果。这是"AI 改坏了"的探测口 ——
 * 界面可以显示"3 条记录有问题"，而不是静默丢数据。
 */
workspaceRouter.get("/validation", async (_req, res) => {
  try {
    const ws = readWorkspace();
    const report = buildValidationReport(ws);
    res.json({
      success: true,
      ...report,
      filePath: ws.filePath,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== 创建 =====

/**
 * POST /api/workspace/items
 *
 * 创建一条记录。**AI 也走这个接口** —— 服务端做 schema 校验，
 * 非法字段直接拒绝并说明原因，AI 无法写出格式错误的数据。
 */
workspaceRouter.post("/items", async (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date().toISOString();

    // ---- 未知字段拦截（AI 乱写防护）----
    // 必须在构造 item 之前检查，否则乱字段会被静默吞掉，
    // 变成「看起来保存成功了，其实 AI 的意图丢了」。
    const ALLOWED = new Set([
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
      "project",
      "tags",
      "description",
      "location",
      "status",
    ]);
    const unknown = Object.keys(body).filter((k) => !ALLOWED.has(k));
    if (unknown.length) {
      return res.status(400).json({
        error: `包含未知字段：${unknown.join(", ")}`,
        errors: unknown.map((k) => `未知字段：${k}`),
        allowedFields: [...ALLOWED],
        hint: "按 schema/item.schema.json 的字段定义修正后重试",
      });
    }

    // ---- kind 原样传递，非法值交给校验拦下 ----
    // 不能在这里做 `kind === "event" ? "event" : "task"` 的降级 ——
    // 那会让非法 kind 静默变成 task，校验形同虚设。
    // 缺失时补默认 task（合法默认值），但"存在且非法"要报错。
    const kind: ItemKind =
      body.kind === undefined
        ? "task"
        : body.kind === "event" || body.kind === "task"
          ? body.kind
          : (body.kind as ItemKind); // 非法值原样带下去，让 validateItem 报错

    const item: WorkbenchItem = {
      id: body.id || newItemId(),
      kind,
      title: typeof body.title === "string" ? body.title.trim() : "",
      start: body.start || undefined,
      end: body.end || undefined,
      due: body.due || undefined,
      allDay: body.allDay,
      done: body.done ?? false,
      priority: body.priority,
      recurrence: body.recurrence || undefined,
      project: body.project || undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      description: body.description || undefined,
      location: body.location || undefined,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };

    // ---- Schema 校验 ----
    const errors = validateItem(item);
    if (errors.length) {
      return res.status(400).json({
        error: "条目校验失败",
        errors,
        hint: "按 schema/item.schema.json 的字段定义修正后重试",
      });
    }

    const ws = readWorkspace();

    // id 冲突检查
    if (findIndex(ws.items, item.id) >= 0) {
      return res.status(409).json({
        error: `id 已存在：${item.id}`,
        hint: "换一个 id，或不传 id 让服务端生成",
      });
    }

    // 时间逻辑检查
    if (item.start && item.end) {
      if (new Date(item.end).getTime() <= new Date(item.start).getTime()) {
        return res.status(400).json({
          error: "end 必须晚于 start",
          errors: ["end 必须晚于 start"],
        });
      }
    }

    const items = [...ws.items, item];
    const file = writeWorkspace(items, ws.notes);

    res.status(201).json({
      success: true,
      item,
      count: items.length,
      filePath: file,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== 更新 =====

/**
 * PUT /api/workspace/items/:id
 *
 * 局部更新。**只接受白名单字段** —— AI 无法写入未知字段。
 * 传 null 表示清空该字段。
 */
workspaceRouter.put("/items/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};

    const ws = readWorkspace();
    const idx = findIndex(ws.items, id);
    if (idx < 0) {
      return res.status(404).json({ error: `找不到条目：${id}` });
    }

    const current = ws.items[idx];

    // ---- 字段白名单 ----
    const EDITABLE = new Set([
      "title",
      "kind",
      "start",
      "end",
      "due",
      "allDay",
      "done",
      "priority",
      "recurrence",
      "project",
      "tags",
      "description",
      "location",
      "status",
    ]);

    const next: WorkbenchItem = { ...current };
    const rejected: string[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (!EDITABLE.has(k)) {
        rejected.push(k);
        continue;
      }
      if (v === null) {
        delete (next as any)[k];
      } else {
        (next as any)[k] = v;
      }
    }

    if (rejected.length) {
      return res.status(400).json({
        error: `包含不可修改字段：${rejected.join(", ")}`,
        errors: rejected.map((k) => `字段 ${k} 不可修改`),
        editableFields: [...EDITABLE],
      });
    }

    const errors = validateItem(next);
    if (errors.length) {
      return res.status(400).json({
        error: "条目校验失败",
        errors,
        hint: "按 schema/item.schema.json 的字段定义修正后重试",
      });
    }

    if (next.start && next.end) {
      if (new Date(next.end).getTime() <= new Date(next.start).getTime()) {
        return res.status(400).json({
          error: "end 必须晚于 start",
          errors: ["end 必须晚于 start"],
        });
      }
    }

    next.updatedAt = new Date().toISOString();

    const items = [...ws.items];
    items[idx] = next;
    const file = writeWorkspace(items, ws.notes);

    res.json({
      success: true,
      item: next,
      filePath: file,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== 删除 =====

/**
 * DELETE /api/workspace/items/:id
 *
 * 删一条就是删一条。没有级联、没有解绑 —— 因为不存在绑定关系。
 */
workspaceRouter.delete("/items/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const ws = readWorkspace();
    const idx = findIndex(ws.items, id);
    if (idx < 0) {
      return res.status(404).json({ error: `找不到条目：${id}` });
    }

    const removed = ws.items[idx];
    const items = ws.items.filter((i) => i.id !== id);
    const file = writeWorkspace(items, ws.notes);

    res.json({
      success: true,
      removed,
      count: items.length,
      filePath: file,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== 重复规则预览 =====

/**
 * GET /api/workspace/recurrence/preview
 *
 * 预览某个 RRULE 在未来会展开成哪些日期。
 * 界面上选「每周一三五」时用它实时给用户看效果。
 *
 * 查询参数：
 *  - rule: RRULE 字符串
 *  - start: 首次发生时间（ISO 本地时间）
 *  - weeks: 往后看几周（默认 8）
 */
workspaceRouter.get("/recurrence/preview", async (req, res) => {
  try {
    const { rule, start, weeks = "8" } = req.query as Record<
      string,
      string | undefined
    >;
    if (!rule) {
      return res.status(400).json({ error: "rule 参数必需" });
    }
    if (!start) {
      return res.status(400).json({ error: "start 参数必需" });
    }

    const parsed = parseRRule(rule);
    if (!parsed) {
      return res.status(400).json({
        error: `RRULE 解析失败：${rule}`,
        hint: "支持 FREQ=DAILY|WEEKLY|MONTHLY|YEARLY，可带 BYDAY / BYMONTHDAY / INTERVAL / COUNT / UNTIL",
      });
    }

    const s = new Date(start);
    const n = Math.max(1, Math.min(52, parseInt(weeks, 10) || 8));
    const rangeStart = localDate(new Date(s.getFullYear(), s.getMonth(), s.getDate()));
    const rangeEnd = localDate(
      new Date(s.getFullYear(), s.getMonth(), s.getDate() + n * 7),
    );

    const dates = expandRecurrenceDates(start, parsed, rangeStart, rangeEnd);

    res.json({
      success: true,
      rule,
      label: describeRRule(rule),
      dates,
      count: dates.length,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== 重复规则选项（给界面用） =====

/**
 * GET /api/workspace/recurrence/options
 *
 * 返回可选的重复规则列表，供界面渲染下拉框。
 */
workspaceRouter.get("/recurrence/options", async (_req, res) => {
  res.json({
    success: true,
    options: [
      { value: "", label: "不重复" },
      { value: "FREQ=DAILY", label: "每天" },
      { value: "FREQ=WEEKLY", label: "每周" },
      { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "每周一至五" },
      { value: "FREQ=WEEKLY;BYDAY=MO,WE,FR", label: "每周一、三、五" },
      { value: "FREQ=WEEKLY;BYDAY=SA,SU", label: "每周末" },
      { value: "FREQ=MONTHLY", label: "每月" },
      { value: "FREQ=MONTHLY;BYMONTHDAY=1", label: "每月1号" },
      { value: "FREQ=MONTHLY;BYMONTHDAY=15", label: "每月15号" },
      { value: "FREQ=YEARLY", label: "每年" },
    ],
  });
});

// ===== 文件信息 =====

/**
 * GET /api/workspace/info
 *
 * 数据源文件的位置与统计。设置界面显示这个。
 */
workspaceRouter.get("/info", async (_req, res) => {
  try {
    const ws = readWorkspace();
    const report = buildValidationReport(ws);
    res.json({
      success: true,
      filePath: workspaceFilePath(),
      exists: ws.items.length > 0,
      total: report.total,
      valid: report.valid,
      invalid: report.invalid,
      tasks: ws.items.filter((i) => i.kind === "task").length,
      events: ws.items.filter((i) => i.kind === "event").length,
      scheduled: ws.items.filter((i) => !!i.start).length,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== ICS 导入 / 导出 =====
//
// 这是整个系统里**唯一**的格式转换边界。
// workspace.md 是我们自定义的格式，ICS 是 RFC 5545 标准（别的软件只认它），
// 所以只有这里需要转换，其余一切（日历视图、看板、AI 工具）都直接读写 md。

/**
 * POST /api/workspace/ics/import
 *
 * 把一份 .ics 导入到统一数据源。
 *
 * Body:
 *  - icsContent: string（必需）
 *  - mode: "append"（默认）| "replace"
 *  - kind: "event"（默认）| "task" —— 导入的条目算事件还是任务
 *  - dryRun: boolean —— 只解析不落盘
 *  - skipDuplicates: boolean（默认 true）—— 按 id 去重
 */
workspaceRouter.post("/ics/import", async (req, res) => {
  try {
    const {
      icsContent,
      mode = "append",
      kind = "event",
      dryRun = false,
      skipDuplicates = true,
    } = req.body || {};

    if (!icsContent || typeof icsContent !== "string") {
      return res.status(400).json({ error: "icsContent is required" });
    }

    const icsEvents = parseIcsEvents(icsContent);
    if (icsEvents.length === 0) {
      return res.status(400).json({
        error: "这份 .ics 里没有可解析的事件",
        hint: "确认文件包含 BEGIN:VEVENT 块，且每个事件有 SUMMARY 与 DTSTART",
      });
    }

    const ws = readWorkspace();
    const existingIds = new Set(ws.items.map((i) => i.id));

    // 转换 + 去重
    const incoming: WorkbenchItem[] = [];
    let skipped = 0;
    for (const ev of icsEvents) {
      const item = icsEventToItem(ev, {
        kind: kind === "task" ? "task" : "event",
      });
      if (skipDuplicates && existingIds.has(item.id)) {
        skipped++;
        continue;
      }
      incoming.push(item);
      existingIds.add(item.id);
    }

    // 预览模式：不落盘
    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        parsed: icsEvents.length,
        toImport: incoming.length,
        skipped,
        preview: incoming.slice(0, 20).map((i) => ({
          id: i.id,
          title: i.title,
          start: i.start,
          allDay: i.allDay,
          recurrence: i.recurrence,
        })),
      });
    }

    const base = mode === "replace" ? [] : ws.items;
    const items = [...base, ...incoming];
    const file = writeWorkspace(items, ws.notes);

    res.json({
      success: true,
      imported: incoming.length,
      skipped,
      total: items.length,
      filePath: file,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/workspace/ics/export
 *
 * 导出为 .ics 文件。
 *
 * 查询参数：
 *  - start / end: 日期范围（本地日历日）
 *  - scope: all | calendar | board
 *  - download: 1 时直接下载文件
 *  - expand: 1 时把重复事件展开成多个独立事件（默认不展开，
 *            因为 ICS 支持 RRULE，保持规则更省空间且可编辑）
 */
workspaceRouter.get("/ics/export", async (req, res) => {
  try {
    const {
      start,
      end,
      scope = "all",
      download = "0",
      expand = "0",
    } = req.query as Record<string, string | undefined>;

    const ws = readWorkspace();
    let items = filterItems(ws.items, {
      scope: scope as any,
      start,
      end,
      includeDone: true,
    });

    // 可选：展开重复事件成独立条目
    if (expand === "1") {
      const rangeStart = start || localDate(new Date());
      const rangeEnd =
        end ||
        (() => {
          const d = new Date();
          d.setDate(d.getDate() + 365);
          return localDate(d);
        })();
      const expanded: WorkbenchItem[] = [];
      for (const it of items) {
        if (!it.recurrence || !it.start) {
          expanded.push(it);
          continue;
        }
        for (const inst of expandEventInstances(
          it.start,
          it.end,
          it.recurrence,
          rangeStart,
          rangeEnd,
        )) {
          expanded.push({
            ...it,
            id: it.id,
            start: inst.start,
            end: inst.end,
            recurrence: undefined,
          });
        }
      }
      items = expanded;
    }

    if (items.length === 0) {
      return res.status(404).json({
        error: "没有可导出的条目",
        hint: "检查日期范围，或确认数据源里已有条目",
      });
    }

    const ics = itemsToIcs(items);

    if (download === "1") {
      const stamp = localDate(new Date());
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="workbench-${stamp}.ics"`,
      );
      return res.send(ics);
    }

    res.json({
      success: true,
      ics,
      count: items.length,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
