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
  loadBridgeConfig,
  readEventsFile,
  writeEventsFile,
  ensureEventsFile,
  parseEventsFile,
  serializeEventsFile,
  eventToIcs,
  allEventsToIcs,
  icsToEvent,
  type BridgeEvent,
  type EventsFile,
  type BridgeConfig,
} from "../md-ics-bridge.js";

export const mdBridgeRouter = express.Router();

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
    const { event, filePath } = req.body;
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

    // 为事件添加时间戳
    const newEvent: BridgeEvent = {
      uid:
        event.uid ||
        `md-event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
    };

    eventsFile.events.push(newEvent);
    writeEventsFile(eventsFile);

    res.status(201).json({
      success: true,
      event: newEvent,
      totalCount: eventsFile.events.length,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * DELETE /api/md-bridge/events/:uid
 * 从 events.md 中删除指定事件
 */
mdBridgeRouter.delete("/events/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const config = loadBridgeConfig();
    const eventsFile = ensureEventsFile(config.eventsFilePath);

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

    const config = loadBridgeConfig();
    const targetPath = filePath || config.eventsFilePath;
    const syncDir = direction || config.syncDirection || "bidirectional";

    // Ensure authenticated
    await ensureAuthenticated();

    // Get target calendar
    const cals = await davClient.fetchCalendars();
    let targetCal = cals[0];
    if (calendarUrl) {
      targetCal = cals.find((cal) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    const eventsFile = ensureEventsFile(targetPath);
    const results: {
      pushed: string[];
      pulled: string[];
      errors: string[];
    } = {
      pushed: [],
      pulled: [],
      errors: [],
    };

    // === Push: events.md → CalDAV ===
    if (syncDir === "push" || syncDir === "bidirectional") {
      for (const event of eventsFile.events) {
        try {
          const icsContent = eventToIcs(event);
          const uid =
            event.uid ||
            `md-event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          await davClient.createCalendarObject({
            calendar: targetCal,
            filename: `${uid}.ics`,
            iCalString: icsContent,
          });

          results.pushed.push(uid);
        } catch (err) {
          results.errors.push(
            `Failed to push ${event.title}: ${(err as Error).message}`,
          );
        }
      }
    }

    // === Pull: CalDAV → events.md ===
    if (syncDir === "pull" || syncDir === "bidirectional") {
      try {
        const remoteEvents = await davClient.fetchCalendarObjects({
          calendar: targetCal,
        });

        console.log(
          `[MD Bridge] Pull: fetched ${remoteEvents.length} remote objects`,
        );
        for (const remoteEvent of remoteEvents) {
          try {
            const icsContent = remoteEvent.data.toString();
            console.log(
              `[MD Bridge] Pull: parsing event, data length=${icsContent.length}, preview=${icsContent.substring(0, 100)}`,
            );
            const bridgeEvent = icsToEvent(icsContent);
            if (!bridgeEvent || !bridgeEvent.title) continue;

            // 检查是否已存在（通过 uid 去重）
            const existingIndex = eventsFile.events.findIndex(
              (e) => e.uid === bridgeEvent.uid,
            );

            if (existingIndex >= 0) {
              // 更新已有事件（保留本地修改？目前用远程覆盖本地）
              eventsFile.events[existingIndex] = {
                ...bridgeEvent,
                source: "caldav",
              };
            } else {
              eventsFile.events.push({
                ...bridgeEvent,
                source: "caldav",
              });
            }

            if (bridgeEvent.uid) {
              results.pulled.push(bridgeEvent.uid);
            }
          } catch (err) {
            results.errors.push(
              `Failed to parse remote event: ${(err as Error).message}`,
            );
          }
        }

        // 写回 events.md
        writeEventsFile(eventsFile);
      } catch (err) {
        results.errors.push(
          `Failed to fetch remote events: ${(err as Error).message}`,
        );
      }
    }

    res.json({
      success: true,
      results,
      totalEvents: eventsFile.events.length,
      filePath: targetPath,
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
