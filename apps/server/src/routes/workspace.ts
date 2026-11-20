import express from "express";
import {
  readWorkspace,
  validateItem,
  buildValidationReport,
  filterItems,
  newItemId,
  workspaceFilePath,
  collectLists,
  attachSubtaskProgress,
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
import { asyncHandler } from "../http.js";
import { isStorageReadOnly } from "../sync-control.js";
import { mutateWorkspace } from "../workspace-store.js";
import { WorkspaceHttpError } from "../errors.js";

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
workspaceRouter.get("/items", asyncHandler(async (req, res) => {
  try {
    const {
      scope = "all",
      kind,
      start,
      end,
      includeDone = "true",
      expand = "false",
      list,
      topLevel = "false",
    } = req.query as Record<string, string | undefined>;

    const ws = readWorkspace();
    let items = filterItems(ws.items, {
      scope: scope as any,
      kind: kind as any,
      start,
      end,
      includeDone: includeDone !== "false",
      // list 未传 = 不筛选；传空串 = 只看收件箱
      list: list !== undefined ? list : undefined,
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
            // 系列原始起点/终点：编辑某一次实例时，必须拿它当锚点，
            // 否则保存会把整个系列的起点挪到「被点的那一天」。
            seriesStart: it.start,
            seriesEnd: it.end,
          });
        }
      }
      items = expanded as any;
    }

    // 挂上子任务进度（父任务显示 2/5、进度条等）
    let out: any[] = attachSubtaskProgress(items as any);
    // topLevel=true 时只返回顶层条目（子任务由前端单独取）
    if (topLevel === "true") {
      out = out.filter((i) => !i.parent);
    }

    res.json({
      success: true,
      items: out,
      count: out.length,
      filePath: ws.filePath,
      notes: ws.notes,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}));

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
workspaceRouter.post("/items", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();

  // ---- 未知字段拦截（AI 乱写防护）----
  // 必须在构造 item 之前检查，否则乱字段会被静默吞掉，
  // 变成「看起来保存成功了，其实 AI 的意图丢了」。
  const ALLOWED = new Set([
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
    "project",
    "tags",
    "description",
    "location",
    "status",
    "list",
    "parent",
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
    uid: body.uid || undefined,
    kind,
    title: typeof body.title === "string" ? body.title.trim() : "",
    start: body.start || undefined,
    end: body.end || undefined,
    due: body.due || undefined,
    remind: body.remind || undefined,
    allDay: body.allDay,
    done: body.done ?? false,
    priority: body.priority,
    recurrence: body.recurrence || undefined,
    list: body.list || undefined,
    parent: body.parent || undefined,
    project: body.project || undefined,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    description: body.description || undefined,
    location: body.location || undefined,
    status: body.status,
    createdAt: now,
    updatedAt: now,
  };

  // ---- Schema 校验（写文件之前，纯内存判断）----
  const errors = validateItem(item);
  if (errors.length) {
    return res.status(400).json({
      error: "条目校验失败",
      errors,
      hint: "按 schema/item.schema.json 的字段定义修正后重试",
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

  // id 冲突检查必须在锁内 —— 两个并发创建同一个 id 时，锁外读到的都是「不存在」
  const { result, filePath } = await mutateWorkspace((ws) => {
    if (findIndex(ws.items, item.id) >= 0) {
      throw new WorkspaceHttpError(409, `id 已存在：${item.id}`, "DUPLICATE_ID");
    }
    ws.items.push(item);
    return { count: ws.items.length };
  });

  res.status(201).json({
    success: true,
    item,
    count: result.count,
    filePath,
  });
}));

// ===== 更新 =====
// ===== 更新 =====

/**
 * PUT /api/workspace/items/:id
 *
 * 局部更新。**只接受白名单字段** —— AI 无法写入未知字段。
 * 传 null 表示清空该字段。
 */
workspaceRouter.put("/items/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};

  // ---- 字段白名单 ----
  const EDITABLE = new Set([
    "title",
    "uid",
    "kind",
    "start",
    "end",
    "due",
    "remind",
    "allDay",
    "done",
    "priority",
    "recurrence",
    "project",
    "tags",
    "description",
    "location",
    "status",
    "list",
    "parent",
  ]);

  const rejected: string[] = [];
  for (const k of Object.keys(body)) {
    if (!EDITABLE.has(k)) rejected.push(k);
  }
  if (rejected.length) {
    return res.status(400).json({
      error: `包含不可修改字段：${rejected.join(", ")}`,
      errors: rejected.map((k) => `字段 ${k} 不可修改`),
      editableFields: [...EDITABLE],
    });
  }

  const { result, filePath } = await mutateWorkspace((ws) => {
    const idx = findIndex(ws.items, id);
    if (idx < 0) {
      throw new WorkspaceHttpError(404, `找不到条目：${id}`, "ITEM_NOT_FOUND");
    }

    const current = ws.items[idx];
    const next: WorkbenchItem = { ...current };
    for (const [k, v] of Object.entries(body)) {
      if (v === null) {
        delete (next as any)[k];
      } else {
        (next as any)[k] = v;
      }
    }

    const errors = validateItem(next);
    if (errors.length) {
      throw new WorkspaceHttpError(400, "条目校验失败", "ITEM_INVALID", {
        errors,
        hint: "按 schema/item.schema.json 的字段定义修正后重试",
      });
    }

    if (next.start && next.end) {
      if (new Date(next.end).getTime() <= new Date(next.start).getTime()) {
        throw new WorkspaceHttpError(400, "end 必须晚于 start", "INVALID_RANGE");
      }
    }

    next.updatedAt = new Date().toISOString();
    ws.items[idx] = next;
    return next;
  });

  res.json({
    success: true,
    item: result,
    filePath,
  });
}));

// ===== 删除 =====
// ===== 删除 =====

/**
 * DELETE /api/workspace/items/:id
 *
 * 删一条就是删一条。没有级联、没有解绑 —— 因为不存在绑定关系。
 */
workspaceRouter.delete("/items/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;

  const { result, filePath } = await mutateWorkspace((ws) => {
    const idx = findIndex(ws.items, id);
    if (idx < 0) {
      throw new WorkspaceHttpError(404, `找不到条目：${id}`, "ITEM_NOT_FOUND");
    }
    const removed = ws.items[idx];

    // 子任务是普通条目，只靠 `parent` 指向父级。删父任务时若不处理子任务，
    // 会留下「有 parent、但父级不存在」的孤儿：看板按顶层过滤不渲染它，
    // 清单统计也不算它 —— 数据还在文件里，但用户永远看不到。
    // 所以这里默认级联删除整棵子树（子任务属于父任务，不是独立数据）。
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const it of ws.items) {
        if (it.parent && doomed.has(it.parent) && !doomed.has(it.id)) {
          doomed.add(it.id);
          grew = true;
        }
      }
    }

    ws.items = ws.items.filter((i) => !doomed.has(i.id));
    return {
      removed,
      removedChildren: doomed.size - 1,
      count: ws.items.length,
    };
  });

  res.json({
    success: true,
    removed: result.removed,
    removedChildren: result.removedChildren,
    count: result.count,
    filePath,
  });
}));

// ===== 重复规则预览 =====
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
workspaceRouter.get("/recurrence/preview", asyncHandler(async (req, res) => {
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
}));

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
      storageSafe: !isStorageReadOnly(),
      readOnly: isStorageReadOnly(),
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
workspaceRouter.post("/ics/import", asyncHandler(async (req, res) => {
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

  /** 把 ICS 事件转成本地条目：跳过例外实例、可选去重 */
  const convert = (existingIds: Set<string>) => {
    const incoming: WorkbenchItem[] = [];
    let skipped = 0;
    for (const ev of icsEvents) {
      // 重复事件的例外实例（RECURRENCE-ID）不单独导入：
      // 它和主事件共用 UID，硬导会覆盖主事件或产生重复条目。
      if (ev.recurrenceId) {
        skipped++;
        continue;
      }
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
    return { incoming, skipped };
  };

  // 预览模式：只读，不落盘
  if (dryRun) {
    const ws = readWorkspace();
    const { incoming, skipped } = convert(new Set(ws.items.map((i) => i.id)));
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

  const { result, filePath } = await mutateWorkspace((ws) => {
    const { incoming, skipped } = convert(new Set(ws.items.map((i) => i.id)));
    const base = mode === "replace" ? [] : ws.items;
    ws.items = [...base, ...incoming];
    return {
      imported: incoming.length,
      skipped,
      total: ws.items.length,
    };
  });

  res.json({
    success: true,
    imported: result.imported,
    skipped: result.skipped,
    total: result.total,
    filePath,
  });
}));

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
workspaceRouter.get("/ics/export", asyncHandler(async (req, res) => {
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
}));

// ===== 清单 =====

/**
 * GET /api/workspace/lists
 *
 * 返回所有清单及其统计。清单不需要预先创建 —— 它是条目上的一个字段值，
 * 由条目聚合而来。空清单没有意义，所以不单独持久化。
 *
 * 「收件箱」= list 为空的条目（快速捕获、还没归类的东西），永远排第一。
 */
workspaceRouter.get("/lists", async (_req, res) => {
  try {
    const ws = readWorkspace();
    const lists = collectLists(ws.items);
    res.json({
      success: true,
      lists,
      totalLists: lists.length,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/workspace/lists/rename
 *
 * 重命名清单（把所有 list=from 的条目改成 list=to）。
 * 传 to: "" 表示并回收件箱。
 */
workspaceRouter.post("/lists/rename", asyncHandler(async (req, res) => {
  const { from, to } = req.body || {};
  if (typeof from !== "string" || typeof to !== "string") {
    return res.status(400).json({ error: "from 与 to 都必须是字符串" });
  }
  if (from === to) {
    return res.status(400).json({ error: "from 与 to 相同，无需重命名" });
  }

  const { result, filePath } = await mutateWorkspace((ws) => {
    let changed = 0;
    ws.items = ws.items.map((it) => {
      if ((it.list || "") === from) {
        changed++;
        return { ...it, list: to || undefined };
      }
      return it;
    });
    if (changed === 0) {
      throw new WorkspaceHttpError(
        404,
        `找不到清单：${from || "收件箱"}`,
        "LIST_NOT_FOUND",
      );
    }
    return { changed };
  });

  res.json({ success: true, changed: result.changed, filePath });
}));
