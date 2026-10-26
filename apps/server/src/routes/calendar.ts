import express from "express";
import {
  davClient,
  ensureAuthenticated,
  getCurrentConfig,
  testConnection,
  setServerConfig,
  initializeClient,
  currentConfig,
} from "../caldav.js";
export const calendarRouter = express.Router();

/**
 * 判断错误是不是「CalDAV 服务器连不上」这类外部依赖问题。
 *
 * 这类错误不该让整个接口 500 —— 服务器暂时挂了，用户打开应用看到的应该是
 * 「同步暂不可用，本地数据照常可用」，而不是一坨报错。
 */
function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /principalUrl|cannot find|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|502|503|504|getaddrinfo/i.test(
    msg,
  );
}

/**
 * CalDAV 不可用时的统一响应。
 *
 * 返回 200 + 空数据 + 状态标记，让前端能正常渲染（显示"同步不可用"提示），
 * 而不是整个页面报错。本地 md 数据仍然完全可用 —— 这是本工具的设计前提。
 */
function degraded(res: express.Response, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  res.json({
    success: true,
    degraded: true,
    data: [],
    calendars: [],
    events: [],
    error: msg,
    message: "CalDAV 服务器当前不可用，本地数据不受影响。可在「设置 → 同步」中检查配置。",
  });
}

calendarRouter.get("/calendars", async (_, res) => {
  try {
    // Ensure we're authenticated before fetching calendars
    await ensureAuthenticated();
    const cals = await davClient.fetchCalendars();
    res.json(cals);
  } catch (error) {
    if (isConnectionError(error)) {
      // 服务器连不上 → 优雅降级，不要 500
      return degraded(res, error);
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

calendarRouter.get("/events", async (req, res) => {
  try {
    const { start, end, calendarUrl } = req.query;
    if (!start || !end) {
      return res
        .status(400)
        .json({ error: "start and end dates are required" });
    }

    // Ensure we're authenticated before fetching events
    await ensureAuthenticated();

    const cals = await davClient.fetchCalendars();
    let targetCal = cals[0];
    if (calendarUrl) {
      targetCal = cals.find((cal: any) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    // 解析日期过滤器
    const startFilter = new Date(start as string);
    const endFilter = new Date(end as string);

    // 构建 CalDAV REPORT 请求的 XML
    // 注意：toISOString() 返回 "2020-01-01T00:00:00.000Z"，需要去掉中间的符号和最后的 Z
    const formatCalDAVDate = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+/, "")
        .replace(/Z$/, "");

    const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${formatCalDAVDate(startFilter)}Z" end="${formatCalDAVDate(endFilter)}Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

    // 获取日历 URL
    const calUrl = (targetCal as any).url;
    const baseUrl = calUrl.endsWith("/") ? calUrl : calUrl + "/";

    // 直接发送 CalDAV REPORT 请求
    console.log(`[DEBUG] Sending REPORT to ${baseUrl}`);
    const response = await fetch(baseUrl, {
      method: "REPORT",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "1",
        Authorization:
          "Basic " +
          Buffer.from(
            `${currentConfig.username}:${currentConfig.password}`,
          ).toString("base64"),
      },
      body: reportBody,
    });

    console.log(
      `[DEBUG] REPORT response status: ${response.status} ${response.statusText}`,
    );
    const xmlText = await response.text();
    console.log(`[DEBUG] REPORT response body length: ${xmlText.length}`);

    // 解析 XML 响应，提取 calendar-data
    const icalModule = await import("ical.js");

    // 安全的日期转换函数（用于处理 ical.js 返回的复杂日期对象）
    const toDate = (val: unknown): Date => {
      if (val instanceof Date) return val;
      if (typeof val === "string") return new Date(val);
      if (val && typeof val === "object") {
        const obj = val as Record<string, unknown>;
        if (typeof obj.toJSDate === "function") {
          const d = obj.toJSDate();
          return d instanceof Date ? d : new Date(d as string);
        }
        if (typeof obj._time === "number") {
          return new Date(obj._time);
        }
        if (typeof obj.toString === "function") {
          const s = obj.toString();
          return s ? new Date(s) : new Date();
        }
      }
      return new Date();
    };

    // 提取所有 calendar-data 内容
    const dataRegex = /<C:calendar-data>([\s\S]*?)<\/C:calendar-data>/g;
    const events: Array<{
      uid: string;
      summary: string;
      start: { dateTime: string };
      end: { dateTime: string };
      category?: { id: string; name: string; color: string };
      tags?: Array<{ id: string; name: string; color: string }>;
      priority?: "high" | "medium" | "low";
      recurrence?: {
        frequency: string;
        interval: number;
        endDate?: string;
        count?: number;
      };
    }> = [];
    let match;

    while ((match = dataRegex.exec(xmlText)) !== null) {
      try {
        const icsData = match[1].trim();
        const jcal = icalModule.default.parse(icsData);
        const comp = new icalModule.default.Component(jcal);
        const vevent = comp.getFirstSubcomponent("vevent");

        if (vevent) {
          const startProp = vevent.getFirstProperty("dtstart");
          const endProp = vevent.getFirstProperty("dtend");
          const summaryProp = vevent.getFirstProperty("summary");
          const uidProp = vevent.getFirstProperty("uid");
          const categoriesProp = vevent.getFirstProperty("categories");
          const tagsProp = vevent.getFirstProperty("x-tags");
          const rruleProp = vevent.getFirstProperty("rrule");
          const descriptionProp = vevent.getFirstProperty("description");
          const priorityProp = vevent.getFirstProperty("priority");

          let startDate: Date, endDate: Date;

          try {
            const rawStart: unknown = startProp
              ? startProp.getFirstValue()
              : new Date();
            const rawEnd: unknown = endProp
              ? endProp.getFirstValue()
              : new Date(Date.now() + 3600000);

            startDate = toDate(rawStart);
            endDate = toDate(rawEnd);
          } catch (dateError) {
            console.warn("Failed to parse dates:", dateError);
            startDate = new Date();
            endDate = new Date(Date.now() + 3600000);
          }

          // 解析分类
          let category = undefined;
          if (categoriesProp) {
            const categoryName = categoriesProp.getFirstValue();
            if (categoryName) {
              category = {
                id: categoryName.toLowerCase(),
                name: categoryName,
                color: "blue",
              };
            }
          }

          // 解析标签
          let tags: Array<{ id: string; name: string; color: string }> = [];
          if (tagsProp) {
            const tagsString = tagsProp.getFirstValue();
            if (tagsString) {
              tags = tagsString.split(",").map((tagName: string) => ({
                id: tagName.toLowerCase(),
                name: tagName.trim(),
                color: "gray",
              }));
            }
          } else if (descriptionProp) {
            const descStr = descriptionProp
              ? descriptionProp.getFirstValue()
              : "";
            const tagsMatch = descStr.match(/Tags: ([^\n]+)/);
            if (tagsMatch) {
              const tagsString = tagsMatch[1];
              tags = tagsString.split(",").map((tagName: string) => ({
                id: tagName.toLowerCase().trim(),
                name: tagName.trim(),
                color: "gray",
              }));
            }
          }

          // 解析优先级
          let priority: "high" | "medium" | "low" | undefined;
          if (priorityProp) {
            const prioVal = parseInt(priorityProp.getFirstValue(), 10);
            if (prioVal === 1) priority = "high";
            else if (prioVal >= 5 && prioVal <= 6) priority = "medium";
            else if (prioVal >= 9) priority = "low";
            else priority = "medium";
          }

          // 解析重复规则
          let recurrence:
            | {
                frequency: string;
                interval: number;
                endDate?: string;
                count?: number;
              }
            | undefined = undefined;
          if (rruleProp) {
            const rrule = rruleProp.getFirstValue();
            if (rrule) {
              recurrence = {
                frequency: rrule.freq.toLowerCase(),
                interval: rrule.interval || 1,
              } as {
                frequency: string;
                interval: number;
                endDate?: string;
                count?: number;
              };

              if (rrule.until) {
                recurrence.endDate = rrule.until.toString();
              } else if (rrule.count) {
                recurrence.count = rrule.count;
              }
            }
          }

          events.push({
            uid: uidProp ? uidProp.getFirstValue() : "",
            summary: summaryProp ? summaryProp.getFirstValue() : "无标题事件",
            start: {
              dateTime: startDate.toISOString(),
            },
            end: {
              dateTime: endDate.toISOString(),
            },
            category,
            tags,
            priority,
            recurrence,
          });
        }
      } catch (e) {
        console.warn("Failed to parse event data:", e);
      }
    }

    // 如果没有匹配到 calendar-data，尝试从 href 逐个获取
    if (events.length === 0) {
      console.log("No events found via REPORT, trying PROPFIND...");

      // 使用 PROPFIND 列出所有 ICS 文件
      const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

      const propResp = await fetch(baseUrl, {
        method: "PROPFIND",
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          Depth: "1",
          Authorization:
            "Basic " +
            Buffer.from(
              `${currentConfig.username}:${currentConfig.password}`,
            ).toString("base64"),
        },
        body: propfindBody,
      });

      const propXmlText = await propResp.text();

      // 提取所有 .ics 文件的 href
      // 兼容多种 namespace 格式：<d:href>、<D:href>、<href>（Radicale 默认 namespace）
      const hrefRegex =
        /<(?:[a-zA-Z]*:)?href>([^<]+\.ics)<\/(?:[a-zA-Z]*:)?href>/g;
      let hrefMatch;

      while ((hrefMatch = hrefRegex.exec(propXmlText)) !== null) {
        const icsUrl = hrefMatch[1];
        const fullUrl = icsUrl.startsWith("http")
          ? icsUrl
          : new URL(icsUrl, baseUrl).href;

        try {
          // 获取每个 ICS 文件的内容
          const icsResp = await fetch(fullUrl, {
            method: "GET",
            headers: {
              Authorization:
                "Basic " +
                Buffer.from(
                  `${currentConfig.username}:${currentConfig.password}`,
                ).toString("base64"),
            },
          });

          const icsData = await icsResp.text();
          const jcal = icalModule.default.parse(icsData);
          const comp = new icalModule.default.Component(jcal);
          const vevent = comp.getFirstSubcomponent("vevent");

          if (vevent) {
            const startProp = vevent.getFirstProperty("dtstart");
            if (!startProp) continue;

            const startVal = startProp.getFirstValue();
            const eventStartDate = toDate(startVal);

            // 检查是否在日期范围内
            if (eventStartDate >= startFilter && eventStartDate <= endFilter) {
              const endProp = vevent.getFirstProperty("dtend");
              const summaryProp = vevent.getFirstProperty("summary");
              const uidProp = vevent.getFirstProperty("uid");
              const categoriesProp = vevent.getFirstProperty("categories");
              const descriptionProp = vevent.getFirstProperty("description");

              const endVal = endProp ? endProp.getFirstValue() : null;
              const eventEndDate = toDate(endVal);

              // 解析分类
              let category = undefined;
              if (categoriesProp) {
                const categoryName = categoriesProp.getFirstValue();
                if (categoryName) {
                  category = {
                    id: categoryName.toLowerCase(),
                    name: categoryName,
                    color: "blue",
                  };
                }
              }

              events.push({
                uid: uidProp ? uidProp.getFirstValue() : icsUrl,
                summary: summaryProp
                  ? summaryProp.getFirstValue()
                  : "无标题事件",
                start: {
                  dateTime: eventStartDate.toISOString(),
                },
                end: {
                  dateTime: eventEndDate.toISOString(),
                },
                category,
              });
            }
          }
        } catch (fetchErr) {
          console.warn(`Failed to fetch ${icsUrl}:`, fetchErr);
        }
      }
    }

    res.json(events);
  } catch (error) {
    if (isConnectionError(error)) {
      // 服务器连不上 → 返回空事件列表 + 提示，不让整个日历页崩掉
      return degraded(res, error);
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

// 创建事件端点
calendarRouter.post("/events", async (req, res) => {
  try {
    const {
      title,
      start,
      end,
      allDay,
      description,
      calendarUrl,
      category,
      tags,
      priority,
      recurrence,
    } = req.body;

    if (!title || !start || !end) {
      return res
        .status(400)
        .json({ error: "title, start, and end are required" });
    }

    // Ensure we're authenticated
    await ensureAuthenticated();

    // Get the target calendar
    const cals = await davClient.fetchCalendars();
    let targetCal = cals[0];
    if (calendarUrl) {
      targetCal = cals.find((cal: any) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    // Generate UID
    const uid = `radicale-desktop-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    // Build ICS content using shared function
    const icsContent = buildICSContent({
      uid,
      title,
      start,
      end,
      allDay,
      description,
      category,
      tags,
      priority,
      recurrence,
    });

    // Create the event in CalDAV
    const createdEvent = await davClient.createCalendarObject({
      calendar: targetCal,
      filename: `${uid}.ics`,
      iCalString: icsContent,
    });

    res.status(201).json({ success: true, uid: uid, event: createdEvent });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 更新事件端点
calendarRouter.put("/events/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const {
      title,
      start,
      end,
      allDay,
      description,
      calendarUrl,
      category,
      tags,
      priority,
      recurrence,
    } = req.body;

    if (!title || !start || !end) {
      return res
        .status(400)
        .json({ error: "title, start, and end are required" });
    }

    // Ensure we're authenticated
    await ensureAuthenticated();

    // Get the target calendar
    const cals = await davClient.fetchCalendars();
    let targetCal = cals[0];
    if (calendarUrl) {
      targetCal = cals.find((cal: any) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    // Find the existing event
    const events = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });
    const eventToUpdate = events.find((e: any) => e.url.includes(uid));

    if (!eventToUpdate) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Build ICS content using shared function
    const icsContent = buildICSContent({
      uid,
      title,
      start,
      end,
      allDay,
      description,
      category,
      tags,
      priority,
      recurrence,
    });

    // Delete the old event and create a new one (since updateCalendarObject doesn't accept iCalString)
    await davClient.deleteCalendarObject({
      calendarObject: eventToUpdate,
    });

    const updatedEvent = await davClient.createCalendarObject({
      calendar: targetCal,
      filename: `${uid}.ics`,
      iCalString: icsContent,
    });

    res.json({ success: true, event: updatedEvent });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 删除事件端点
calendarRouter.delete("/events/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const { calendarUrl } = req.query;

    console.log(`Attempting to delete event with uid: ${uid}`);

    // Ensure we're authenticated
    await ensureAuthenticated();

    // Get the target calendar
    const cals = await davClient.fetchCalendars();
    let targetCal = cals[0];
    if (calendarUrl && typeof calendarUrl === "string") {
      targetCal = cals.find((cal: any) => cal.url === calendarUrl) || cals[0];
    }

    console.log(`Target calendar: ${(targetCal as any)?.url}`);

    if (!targetCal) {
      console.warn(`Calendar not found for url: ${calendarUrl}`);
      return res.status(404).json({ error: "Calendar not found" });
    }

    // Find the event to delete
    console.log(`Fetching calendar objects from: ${(targetCal as any).url}`);
    const events = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });

    console.log(`Found ${events.length} events in calendar`);

    // 改进查找逻辑：支持多种匹配方式
    let eventToDelete = null;
    for (const event of events) {
      // 直接匹配UID（多种变体）
      if (
        (event as any).url.includes(uid) ||
        (event as any).url.includes(`${uid}.ics`) ||
        (event as any).url.endsWith(`/${uid}`) ||
        (event as any).url.endsWith(`/${uid}.ics`)
      ) {
        eventToDelete = event;
        console.log(`Found event by URL match: ${(event as any).url}`);
        break;
      }

      // 从URL中提取UID进行匹配
      const urlParts = (event as any).url.split("/");
      const urlUid = urlParts[urlParts.length - 1].replace(".ics", "");
      const normalizedUid = uid.replace(".ics", ""); // 移除可能的.ics后缀
      if (urlUid === normalizedUid || urlUid === uid) {
        eventToDelete = event;
        console.log(`Found event by extracted UID: ${urlUid}`);
        break;
      }

      // 尝试从事件数据中提取UID
      try {
        const icalModule = await import("ical.js");
        const jcal = icalModule.default.parse((event as any).data.toString());
        const comp = new icalModule.default.Component(jcal);
        const vevent = comp.getFirstSubcomponent("vevent");
        if (vevent) {
          const uidProp = vevent.getFirstProperty("uid");
          const eventUid = uidProp?.getFirstValue();
          if (uidProp && (eventUid === uid || eventUid === normalizedUid)) {
            eventToDelete = event;
            console.log(`Found event by parsed UID: ${eventUid}`);
            break;
          }

          // 特殊处理：如果事件UID包含完整的URL路径，尝试部分匹配
          if (eventUid && eventUid.includes(uid)) {
            eventToDelete = event;
            console.log(`Found event by partial UID match: ${eventUid}`);
            break;
          }
        }
      } catch (parseError: unknown) {
        // 解析失败则跳过
        const error = parseError as Error;
        console.warn(
          `Failed to parse event data for UID matching: ${error.message}`,
        );
      }
    }

    // 即使找不到事件，我们也返回成功，因为结果是一样的（事件不存在）
    if (!eventToDelete) {
      console.warn(
        `Event with uid ${uid} not found in calendar ${(targetCal as any).url}`,
      );
      // 返回更详细的响应，说明可能的原因
      return res.json({
        success: true,
        message: "Event not found, but considering deletion successful",
        details: `Could not find event with UID '${uid}' in calendar. It may have already been deleted or the UID format may differ.`,
      });
    }

    // Delete the event from CalDAV
    console.log(`Deleting event: ${(eventToDelete as any).url}`);
    await davClient.deleteCalendarObject({
      calendarObject: eventToDelete,
    });

    console.log(`Successfully deleted event with uid: ${uid}`);
    res.json({ success: true, message: "Event successfully deleted" });
  } catch (error) {
    console.error(`Error deleting event with uid ${req.params.uid}:`, error);
    // 对于某些特定错误，我们可以考虑返回成功
    if (
      error instanceof Error &&
      (error.message.includes("Not Found") || error.message.includes("404"))
    ) {
      console.warn(
        "Event not found during deletion, considering operation successful",
      );
      return res.json({
        success: true,
        message: "Event not found, but considering deletion successful",
        details: "The event appears to be already deleted or not found.",
      });
    }

    res.status(500).json({
      error: (error as Error).message,
      details:
        "An unexpected error occurred while deleting the event. Please try again.",
    });
  }
});

// ===== 共享工具函数 =====

// 构建ICS内容
export function buildICSContent(params: {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  category?: { name?: string };
  tags?: Array<{ name: string }>;
  priority?: "high" | "medium" | "low";
  recurrence?: {
    frequency: string;
    interval?: number;
    endDate?: string;
    count?: number;
  };
}): string {
  const {
    uid,
    title,
    start,
    end,
    allDay,
    description,
    category,
    tags,
    priority,
    recurrence,
  } = params;

  const dtstamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+/, "");

  const startDate = new Date(start);
  const endDate = new Date(end);

  let dtstart: string, dtend: string;
  if (allDay) {
    dtstart = startDate.toISOString().slice(0, 10).replace(/-/g, "");
    dtend = endDate.toISOString().slice(0, 10).replace(/-/g, "");
  } else {
    dtstart = startDate.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    dtend = endDate.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  }

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CalDAV Desktop//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART${allDay ? ";VALUE=DATE" : ""}:${dtstart}`,
    `DTEND${allDay ? ";VALUE=DATE" : ""}:${dtend}`,
    `SUMMARY:${title}`,
    ...(description ? [`DESCRIPTION:${description}`] : []),
  ];

  // 添加分类
  if (category?.name) {
    icsLines.push(`CATEGORIES:${category.name}`);
  }

  // 添加标签到描述中
  if (tags && Array.isArray(tags) && tags.length > 0) {
    const tagNames = tags.map((tag: { name: string }) => tag.name).join(", ");
    if (description) {
      icsLines.push(`DESCRIPTION:${description}\\n\\nTags: ${tagNames}`);
    } else {
      icsLines.push(`DESCRIPTION:Tags: ${tagNames}`);
    }
  }

  // 添加优先级 (iCalendar: 1=high, 5=medium, 9=low)
  if (priority) {
    const prioMap: Record<string, string> = {
      high: "1",
      medium: "5",
      low: "9",
    };
    icsLines.push(`PRIORITY:${prioMap[priority] || "5"}`);
  }

  // 添加重复规则
  if (recurrence) {
    let rrule = "RRULE:";
    switch (recurrence.frequency) {
      case "daily":
        rrule += "FREQ=DAILY";
        break;
      case "weekly":
        rrule += "FREQ=WEEKLY";
        break;
      case "monthly":
        rrule += "FREQ=MONTHLY";
        break;
      case "yearly":
        rrule += "FREQ=YEARLY";
        break;
    }

    if (recurrence.interval && recurrence.interval > 1) {
      rrule += `;INTERVAL=${recurrence.interval}`;
    }

    if (recurrence.endDate) {
      const endDate = new Date(recurrence.endDate);
      const formattedEndDate = endDate
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");
      rrule += `;UNTIL=${formattedEndDate}`;
    } else if (recurrence.count) {
      rrule += `;COUNT=${recurrence.count}`;
    }

    icsLines.push(rrule);
  }

  icsLines.push("END:VEVENT", "END:VCALENDAR");
  return icsLines.join("\r\n");
}

// Configuration management endpoints
calendarRouter.get("/config", async (_, res) => {
  try {
    const config = getCurrentConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

calendarRouter.post("/config/test", async (req, res) => {
  try {
    const { url, username, password } = req.body;

    if (!url || !username || !password) {
      return res
        .status(400)
        .json({ error: "url, username, and password are required" });
    }

    const result = await testConnection({ url, username, password });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

calendarRouter.post("/config", async (req, res) => {
  try {
    const { url, username, password } = req.body;

    if (!url || !username || !password) {
      return res
        .status(400)
        .json({ error: "url, username, and password are required" });
    }

    // First test the connection
    const testResult = await testConnection({ url, username, password });

    if (!testResult.success) {
      return res.status(400).json({ error: testResult.message });
    }

    // If test passes, apply the config
    setServerConfig({ url, username, password });

    // Reinitialize the client
    await initializeClient();

    res.json({
      success: true,
      message: "配置已更新并成功连接",
      config: getCurrentConfig(),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
