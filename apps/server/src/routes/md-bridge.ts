/**
 * MD ↔ ICS Bridge API Routes
 *
 * 基于 events.md 单一文件缓存方案。
 * 所有事件存储在 events.md 的 YAML frontmatter 中。
 * 编辑操作直接修改该文件，同步时转换为 ICS 推送到 CalDAV。
 *
 * @see REF/MD_ICS_BRIDGE.md 完整设计文档
 */

import express from "express";
import { davClient, ensureAuthenticated } from "../caldav.js";
import {
  insertKanbanTaskLine,
  removeKanbanTaskLine,
} from "./kanban.js";
import {
  loadBridgeConfig,
  readEventsFile,
  writeEventsFile,
  ensureEventsFile,
  parseEventsFile,
  serializeEventsFile,
  eventToIcs,
  allEventsToIcs,
  icsToEvent,
  parseIcsFile,
  eventsFileToIcs,
  type BridgeEvent,
  type EventsFile,
  type BridgeConfig,
} from "../md-ics-bridge.js";

export const mdBridgeRouter = express.Router();

/**
 * 同步方向归一化：把配置层的表述统一到同步层认识的取值。
 *
 * 配置层（.env / BridgeConfig）：md-to-caldav | caldav-to-md | bidirectional
 * 同步层（performCaldavSync）  ：push | pull | bidirectional
 *
 * 两套命名此前并存，导致按文档填 `MD_ICS_SYNC_DIRECTION=md-to-caldav`
 * 时，自动同步既不 push 也不 pull，静默什么都不做。
 */
export function normalizeSyncDirection(
  raw: string | undefined,
): "push" | "pull" | "bidirectional" {
  const v = (raw || "").trim().toLowerCase();
  switch (v) {
    case "md-to-caldav":
    case "md2caldav":
    case "push":
      return "push";
    case "caldav-to-md":
    case "caldav2md":
    case "pull":
      return "pull";
    case "bidirectional":
    case "both":
      return "bidirectional";
    default:
      return "bidirectional";
  }
}

// ===== 与工作搭子看板的双向绑定 =====
//
// 历史问题：本文件早期内联了 readKanbanTodos / appendCalendarToTask /
// removeCalendarFromTask / deleteKanbanTaskLine / insertKanbanTaskLine 五个函数，
// 全部按「行序 t{seq}」定位任务行，而 kanban.ts 另有一套实现。两套逻辑不一致：
//  - 行序定位在新增任务 unshift 到队首后整体错位，删 A 会误删 B 的日历事件
//  - 内联版 insertKanbanTaskLine 算出的 newId 与实际写入行的 id 不一致
//  - appendCalendarToTask 存在重复拼接，且生成的整行是死代码
// 现在统一复用 kanban.ts 的实现（按稳定 id 定位），此处只保留删除与插入的转发。

// ===== Events File CRUD =====

/**
 * GET /api/md-bridge/events
 * 读取 events.md 返回所有事件
 *
 * Query params:
 *   - filePath?: string (自定义路径，默认使用配置中的路径)
 */
mdBridgeRouter.get("/events", async (req, res) => {
  try {
    const config = loadBridgeConfig();
    const filePath = (req.query.filePath as string) || config.eventsFilePath;
    const eventsFile = ensureEventsFile(filePath);

    res.json({
      success: true,
      events: eventsFile.events,
      body: eventsFile.body,
      filePath: eventsFile.filePath,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/md-bridge/events/:uid
 * 更新指定 uid 的事件字段。保留 kanbanTaskId 不被前端的 partial payload 覆盖。
 *
 * Body: Partial<BridgeEvent>
 */
mdBridgeRouter.put("/events/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const patch = req.body as Partial<BridgeEvent>;
    const config = loadBridgeConfig();
    const eventsFile = ensureEventsFile(config.eventsFilePath);
    const idx = eventsFile.events.findIndex((e) => e.uid === uid);
    if (idx < 0) return res.status(404).json({ error: `Event ${uid} not found` });
    const cur = eventsFile.events[idx];
    const next: BridgeEvent = {
      ...cur,
      ...patch,
      uid: cur.uid, // 不允许改 uid
      kanbanTaskId: cur.kanbanTaskId, // 保留关联
      updated: new Date().toISOString(),
    };
    eventsFile.events[idx] = next;
    writeEventsFile(eventsFile);
    res.json({ success: true, event: next });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/md-bridge/events
 * 写入完整 events.md（替换全部事件）
 *
 * Body:
 *   - events: BridgeEvent[]
 *   - body?: string（正文部分）
 *   - filePath?: string
 */
mdBridgeRouter.put("/events", async (req, res) => {
  try {
    const { events, body, filePath } = req.body;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: "events array is required" });
    }

    const config = loadBridgeConfig();
    const targetPath = filePath || config.eventsFilePath;

    const eventsFile: EventsFile = {
      events: events as BridgeEvent[],
      body: body || "",
      raw: "",
      filePath: targetPath,
    };

    writeEventsFile(eventsFile);

    res.json({
      success: true,
      count: events.length,
      filePath: targetPath,
      message: `Written ${events.length} events to ${targetPath}`,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/md-bridge/events/add
 * 向 events.md 追加一个新事件（不替换全部）
 *
 * Body:
 *   - event: BridgeEvent
 *   - filePath?: string
 */
mdBridgeRouter.post("/events/add", async (req, res) => {
  try {
    const { event, filePath, kanban } = req.body;
    if (!event || !event.title) {
      return res.status(400).json({ error: "event with title is required" });
    }

    const config = loadBridgeConfig();
    const targetPath = filePath || config.eventsFilePath;
    const eventsFile = ensureEventsFile(targetPath);

    // 预处理 category: 支持传对象 { name: "xxx" } 或字符串 "xxx"
    const rawCategory = event.category;
    const resolvedCategory =
      rawCategory && typeof rawCategory === "object"
        ? rawCategory.name || ""
        : rawCategory || undefined;

    // 预处理 tags: 支持传数组 [{ name: "xxx" }] 或 ["xxx"]
    const rawTags = event.tags;
    const resolvedTags = Array.isArray(rawTags)
      ? rawTags
          .map((t: any) => (typeof t === "object" ? t.name || "" : t))
          .filter(Boolean)
      : undefined;

    const uid =
      event.uid ||
      `md-event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 若要求同步创建工作搭子任务
    let kanbanTaskId: string | undefined;
    if (kanban && typeof kanban === "object") {
      const dateOnly = event.date?.slice(0, 10);
      try {
        kanbanTaskId = insertKanbanTaskLine({
          title: event.title,
          priority:
            event.priority === "high"
              ? "高"
              : event.priority === "low"
                ? "低"
                : "中",
          due: dateOnly,
          project: resolvedCategory,
          calendarEventUid: uid,
        });
      } catch (e) {
        console.warn("[md-bridge] 创建关联任务失败：", (e as Error).message);
      }
    }

    // 为事件添加时间戳
    const newEvent: BridgeEvent = {
      uid,
      title: event.title,
      date: event.date || event.start || new Date().toISOString(),
      end: event.end || undefined,
      allDay: event.allDay || false,
      status: event.status || "confirmed",
      category: resolvedCategory,
      tags: resolvedTags,
      priority: event.priority
        ? typeof event.priority === "number"
          ? event.priority <= 3
            ? "high"
            : event.priority <= 6
              ? "medium"
              : "low"
          : event.priority
        : undefined,
      recurrence: event.recurrence || undefined,
      description: event.description || undefined,
      updated: new Date().toISOString(),
      source: event.source || "md",
      kanbanTaskId,
    };

    eventsFile.events.push(newEvent);
    writeEventsFile(eventsFile);

    res.status(201).json({
      success: true,
      event: newEvent,
      totalCount: eventsFile.events.length,
      kanbanTaskId,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== iCalendar 文件导入 / 导出 =====

/**
 * POST /api/md-bridge/ics/import
 * 把一份 .ics 文件里的所有事件导入 events.md。
 *
 * Body:
 *   - icsContent: string（必需）整份 .ics 文本
 *   - filePath?: string（可选）自定义 events.md 路径
 *   - mode?: "append"（默认）| "replace"
 *     append 保留现有事件；replace 先清空再导入
 *   - dryRun?: boolean 只解析不落盘，用于前端预览"能导入几条"
 *
 * 注意：按 uid 去重。同一份 .ics 重复导入不会产生重复事件。
 */
mdBridgeRouter.post("/ics/import", async (req, res) => {
  try {
    const { icsContent, filePath, mode, dryRun } = req.body || {};
    if (!icsContent || typeof icsContent !== "string") {
      return res.status(400).json({ error: "icsContent is required" });
    }

    const parsed = parseIcsFile(icsContent);
    if (parsed.length === 0) {
      return res.status(400).json({
        error: "未能从该文件解析出任何事件。请确认是有效的 iCalendar (.ics) 文件。",
        imported: 0,
      });
    }

    const config = loadBridgeConfig();
    const targetPath = filePath || config.eventsFilePath;
    const eventsFile = ensureEventsFile(targetPath);

    // 按 uid 去重；缺失 uid 的补一个本地 id
    const existingUids = new Set(eventsFile.events.map((e) => e.uid));
    const toAdd: BridgeEvent[] = [];
    let skipped = 0;
    for (const ev of parsed) {
      const uid = ev.uid || `md-event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      if (existingUids.has(uid)) {
        skipped++;
        continue;
      }
      existingUids.add(uid);
      toAdd.push({
        ...ev,
        uid,
        updated: new Date().toISOString(),
        source: "caldav",
      });
    }

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        parsedCount: parsed.length,
        importedCount: toAdd.length,
        skippedCount: skipped,
        events: toAdd,
      });
    }

    if (mode === "replace") {
      eventsFile.events = toAdd;
    } else {
      eventsFile.events.push(...toAdd);
    }
    writeEventsFile(eventsFile);

    res.json({
      success: true,
      importedCount: toAdd.length,
      skippedCount: skipped,
      totalCount: eventsFile.events.length,
      filePath: eventsFile.filePath,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/md-bridge/ics/export
 * 把 events.md 导出为单个 .ics 文件（供其他日历软件导入）。
 *
 * Query:
 *   - start?: YYYY-MM-DD  仅导出该日期之后的事件
 *   - end?:   YYYY-MM-DD  仅导出该日期之前的事件
 *   - download?: "1"       带 Content-Disposition 头直接下载
 */
mdBridgeRouter.get("/ics/export", async (req, res) => {
  try {
    const config = loadBridgeConfig();
    const eventsFile = ensureEventsFile(config.eventsFilePath);

    const startFilter = req.query.start as string | undefined;
    const endFilter = req.query.end as string | undefined;

    /**
     * 日期过滤必须按**本地日**取边界。
     * `new Date("2026-10-02")` 会按 UTC 午夜解析，在东八区等于本地 10-02 08:00，
     * 于是当天的 09:00 前事件被误判为"早于 start"，导出结果为空。
     */
    const startOfLocalDay = (d: string) => new Date(`${d}T00:00:00`).getTime();
    const endOfLocalDay = (d: string) => new Date(`${d}T23:59:59.999`).getTime();

    let events = eventsFile.events;
    if (startFilter) {
      const t = startOfLocalDay(startFilter);
      events = events.filter((e) => new Date(e.date).getTime() >= t);
    }
    if (endFilter) {
      const t = endOfLocalDay(endFilter);
      events = events.filter((e) => new Date(e.date).getTime() <= t);
    }

    const ics = eventsFileToIcs({ ...eventsFile, events });

    if (req.query.download === "1") {
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="caldav-desktop-${stamp}.ics"`,
      );
      return res.send(ics);
    }

    res.json({ success: true, icsContent: ics, count: events.length });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * DELETE /api/md-bridge/events/:uid
 * 从 events.md 中删除指定事件；若事件绑定了 kanbanTaskId，连带删除看板任务
 */
mdBridgeRouter.delete("/events/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const config = loadBridgeConfig();
    const eventsFile = ensureEventsFile(config.eventsFilePath);

    // 先找一下，若有 kanbanTaskId，连带删除
    const target = eventsFile.events.find((e) => e.uid === uid);
    let unlinkedTaskId: string | undefined;
    if (target?.kanbanTaskId) {
      try {
        removeKanbanTaskLine(target.kanbanTaskId);
        unlinkedTaskId = target.kanbanTaskId;
      } catch (e) {
        console.warn("[md-bridge] 删除关联任务失败：", (e as Error).message);
      }
    }

    const initialCount = eventsFile.events.length;
    eventsFile.events = eventsFile.events.filter((e) => e.uid !== uid);

    if (eventsFile.events.length === initialCount) {
      return res
        .status(404)
        .json({ error: `Event with uid "${uid}" not found` });
    }

    writeEventsFile(eventsFile);

    res.json({
      success: true,
      removed: true,
      totalCount: eventsFile.events.length,
      unlinkedTaskId,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== Conversion Endpoints =====

/**
 * POST /api/md-bridge/event-to-ics
 * Body: { event: BridgeEvent }
 * Returns: { icsContent: string, uid: string }
 *
 * 将单个事件转换为 ICS（预览用，不写入磁盘）
 */
mdBridgeRouter.post("/event-to-ics", async (req, res) => {
  try {
    const { event } = req.body;
    if (!event || !event.title) {
      return res.status(400).json({ error: "event with title is required" });
    }

    const icsContent = eventToIcs(event as BridgeEvent);
    const uidMatch = icsContent.match(/^UID:(.+)$/m);
    const uid = uidMatch ? uidMatch[1].trim() : "unknown";

    res.json({ success: true, icsContent, uid });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/md-bridge/ics-to-event
 * Body: { icsContent: string }
 * Returns: { event: BridgeEvent }
 *
 * 将 ICS 字符串解析为 BridgeEvent（预览用）
 */
mdBridgeRouter.post("/ics-to-event", async (req, res) => {
  try {
    const { icsContent } = req.body;
    if (!icsContent) {
      return res.status(400).json({ error: "icsContent is required" });
    }

    const event = icsToEvent(icsContent);
    if (!event) {
      return res.status(400).json({ error: "Failed to parse ICS content" });
    }

    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== Sync to CalDAV =====

/**
 * POST /api/md-bridge/sync/caldav
 * 将 events.md 中所有事件同步到 CalDAV 服务器
 *
 * Body:
 *   - calendarUrl?: string
 *   - filePath?: string
 *   - direction?: "push" | "pull" | "bidirectional"
 */
mdBridgeRouter.post("/sync/caldav", async (req, res) => {
  try {
    const { calendarUrl, filePath, direction } = req.body;
    const out = await performCaldavSync({ calendarUrl, filePath, direction });
    if (!out.success) return res.status(500).json({ error: out.error });
    res.json({
      success: true,
      results: out.results,
      totalEvents: out.totalEvents,
      filePath: out.filePath,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== Configuration =====

/**
 * GET /api/md-bridge/config
 * 读取桥接配置
 */
mdBridgeRouter.get("/config", async (_, res) => {
  try {
    const config = loadBridgeConfig();
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/md-bridge/config
 * 更新桥接配置（仅运行时，不持久化）
 */
mdBridgeRouter.put("/config", async (req, res) => {
  try {
    const updates = req.body;
    // 运行时配置更新直接返回，不做持久化
    res.json({
      success: true,
      message: "Configuration updated (runtime only)",
      config: {
        ...loadBridgeConfig(),
        ...updates,
      },
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== 同步核心（手动 + 延时自动共用） =====

/**
 * 执行一次 CalDAV 同步（push / pull / bidirectional），返回结构化结果。
 * 同时供 HTTP 路由（手动同步）与进程内定时器（延时自动同步）复用，避免逻辑重复。
 */
async function performCaldavSync(opts: {
  calendarUrl?: string;
  filePath?: string;
  direction?: "push" | "pull" | "bidirectional";
}): Promise<{
  success: boolean;
  results: { pushed: string[]; pulled: string[]; errors: string[] };
  totalEvents: number;
  filePath: string;
  error?: string;
}> {
  const { calendarUrl, filePath, direction } = opts;
  const config = loadBridgeConfig();
  const targetPath = filePath || config.eventsFilePath;
  // 请求体显式传 direction 时优先用它（同样做归一化），否则用配置默认值
  const syncDir = normalizeSyncDirection(direction || config.syncDirection);
  const results: { pushed: string[]; pulled: string[]; errors: string[] } = {
    pushed: [],
    pulled: [],
    errors: [],
  };
  try {
    await ensureAuthenticated();
    const cals = await davClient.fetchCalendars();
    let targetCal = cals[0];
    if (calendarUrl) {
      targetCal = cals.find((cal) => cal.url === calendarUrl) || cals[0];
    }
    if (!targetCal) {
      return { success: false, results, totalEvents: 0, filePath: targetPath, error: "Calendar not found" };
    }
    const eventsFile = ensureEventsFile(targetPath);

    // === Push: events.md → CalDAV ===
    if (syncDir === "push" || syncDir === "bidirectional") {
      for (const event of eventsFile.events) {
        try {
          const icsContent = eventToIcs(event);
          const uid = event.uid || `md-event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          await davClient.createCalendarObject({
            calendar: targetCal,
            filename: `${uid}.ics`,
            iCalString: icsContent,
          });
          results.pushed.push(uid);
        } catch (err) {
          results.errors.push(`Failed to push ${event.title}: ${(err as Error).message}`);
        }
      }
    }

    // === Pull: CalDAV → events.md ===
    if (syncDir === "pull" || syncDir === "bidirectional") {
      try {
        const remoteEvents = await davClient.fetchCalendarObjects({ calendar: targetCal });
        for (const remoteEvent of remoteEvents) {
          try {
            const icsContent = remoteEvent.data.toString();
            const bridgeEvent = icsToEvent(icsContent);
            if (!bridgeEvent || !bridgeEvent.title) continue;
            const existingIndex = eventsFile.events.findIndex((e) => e.uid === bridgeEvent.uid);
            if (existingIndex >= 0) {
              // 保留本地关联：优先远程 X-KANBAN-TASK-ID，否则回退本地 kanbanTaskId
              const local = eventsFile.events[existingIndex];
              eventsFile.events[existingIndex] = {
                ...bridgeEvent,
                kanbanTaskId: bridgeEvent.kanbanTaskId || local.kanbanTaskId,
                source: "caldav",
              };
            } else {
              eventsFile.events.push({ ...bridgeEvent, source: "caldav" });
            }
            if (bridgeEvent.uid) results.pulled.push(bridgeEvent.uid);
          } catch (err) {
            results.errors.push(`Failed to parse remote event: ${(err as Error).message}`);
          }
        }
        writeEventsFile(eventsFile);
      } catch (err) {
        results.errors.push(`Failed to fetch remote events: ${(err as Error).message}`);
      }
    }

    return { success: true, results, totalEvents: eventsFile.events.length, filePath: targetPath };
  } catch (error) {
    return { success: false, results, totalEvents: 0, filePath: targetPath, error: (error as Error).message };
  }
}

// ===== 延时自动同步（非实时） =====
// 仅当 MD_ICS_ENABLED=true 且 MD_ICS_AUTO_SYNC_MINUTES>0 时，在进程内启动定时器，
// 按间隔触发双向同步（拉取时保留本地 kanbanTaskId）。
{
  const cfg = loadBridgeConfig();
  if (cfg.enabled && cfg.autoSyncMinutes > 0) {
    const intervalMs = cfg.autoSyncMinutes * 60 * 1000;
    // 配置用的是 md-to-caldav / caldav-to-md / bidirectional 三种表述，
    // 而 performCaldavSync 认的是 push / pull / bidirectional。
    // 历史 bug：直接把 config 值传过去，"md-to-caldav" 既不等于 push 也不等于
    // bidirectional，导致自动同步实际什么都不做（且类型不兼容）。
    const dir = normalizeSyncDirection(cfg.syncDirection);
    if (dir !== cfg.syncDirection) {
      console.warn(
        `[MD Bridge] MD_ICS_SYNC_DIRECTION="${cfg.syncDirection}" 已归一化为 "${dir}"`,
      );
    }
    setInterval(() => {
      performCaldavSync({ direction: dir })
        .then((r) => {
          if (r.success) {
            console.log(
              `[MD Bridge] 自动同步完成：pushed=${r.results.pushed.length}, pulled=${r.results.pulled.length}, errors=${r.results.errors.length}`,
            );
          } else {
            console.warn(`[MD Bridge] 自动同步失败：${r.error}`);
          }
        })
        .catch((e) => console.warn("[MD Bridge] 自动同步异常：", (e as Error).message));
    }, intervalMs);
    console.log(`[MD Bridge] 已启用延时自动同步，间隔 ${cfg.autoSyncMinutes} 分钟`);
  }
}
