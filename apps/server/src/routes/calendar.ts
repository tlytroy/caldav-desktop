import express from "express";
import {
  davClient,
  ensureAuthenticated,
  getCurrentConfig,
  testConnection,
  setServerConfig,
  initializeClient,
} from "../caldav.js";

export const calendarRouter = express.Router();

calendarRouter.get("/calendars", async (_, res) => {
  try {
    // Ensure we're authenticated before fetching calendars
    await ensureAuthenticated();
    const cals = await davClient.fetchCalendars();
    res.json(cals);
  } catch (error) {
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
      targetCal = cals.find((cal) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    // 使用正确的tsdav API获取事件
    const events = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });

    // 解析ICS数据以提取事件信息
    const icalModule = await import("ical.js");
    const parsedEvents = events.map((event) => {
      try {
        // 解析ICS内容
        const jcal = icalModule.default.parse(event.data.toString());
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

          let startDate, endDate;

          try {
            startDate = startProp ? startProp.getFirstValue() : new Date();
            endDate = endProp
              ? endProp.getFirstValue()
              : new Date(Date.now() + 3600000);

            // 更安全的日期处理
            if (!(startDate instanceof Date)) {
              if (typeof startDate === "string") {
                startDate = new Date(startDate);
              } else if (startDate && typeof startDate === "object") {
                // 处理ical.js返回的日期对象
                if (
                  startDate.toJSDate &&
                  typeof startDate.toJSDate === "function"
                ) {
                  startDate = startDate.toJSDate();
                } else if (startDate._time) {
                  startDate = new Date(startDate._time);
                } else {
                  // 尝试获取日期字符串表示
                  const dateStr = startDate.toString
                    ? startDate.toString()
                    : null;
                  startDate = dateStr ? new Date(dateStr) : new Date();
                }
              } else {
                startDate = new Date();
              }
            }

            if (!(endDate instanceof Date)) {
              if (typeof endDate === "string") {
                endDate = new Date(endDate);
              } else if (endDate && typeof endDate === "object") {
                // 处理ical.js返回的日期对象
                if (
                  endDate.toJSDate &&
                  typeof endDate.toJSDate === "function"
                ) {
                  endDate = endDate.toJSDate();
                } else if (endDate._time) {
                  endDate = new Date(endDate._time);
                } else {
                  // 尝试获取日期字符串表示
                  const dateStr = endDate.toString ? endDate.toString() : null;
                  endDate = dateStr
                    ? new Date(dateStr)
                    : new Date(Date.now() + 3600000);
                }
              } else {
                endDate = new Date(Date.now() + 3600000);
              }
            }
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
                color: "blue", // 默认颜色，实际应用中可能需要根据分类名称设置不同颜色
              };
            }
          }

          // 解析标签（从X-TAGS属性或DESCRIPTION中提取）
          let tags: Array<{ id: string; name: string; color: string }> = [];
          if (tagsProp) {
            const tagsString = tagsProp.getFirstValue();
            if (tagsString) {
              tags = tagsString.split(",").map((tagName: string) => ({
                id: tagName.toLowerCase(),
                name: tagName.trim(),
                color: "gray", // 默认颜色，实际应用中可能需要根据标签名称设置不同颜色
              }));
            }
          } else if (descriptionProp) {
            // 尝试从描述中提取标签
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

          return {
            uid: uidProp ? uidProp.getFirstValue() : event.url,
            summary: summaryProp ? summaryProp.getFirstValue() : "无标题事件",
            start: {
              dateTime: startDate.toISOString(),
            },
            end: {
              dateTime: endDate.toISOString(),
            },
            category,
            tags,
            recurrence,
          };
        }
      } catch (e) {
        console.warn("Failed to parse event:", e);
      }

      // 默认返回值
      return {
        uid: event.url,
        summary: "无标题事件",
        start: { dateTime: new Date().toISOString() },
        end: { dateTime: new Date(Date.now() + 3600000).toISOString() },
      };
    });

    res.json(parsedEvents);
  } catch (error) {
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
      targetCal = cals.find((cal) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    // Generate UID and timestamps
    const uid = `radicale-desktop-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    const startDate = new Date(start);
    const endDate = new Date(end);
    const dtstamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+/, "");

    // Format dates according to RFC 5545
    let dtstart, dtend;
    if (allDay) {
      // For all-day events, use DATE format (YYYYMMDD)
      dtstart = startDate.toISOString().slice(0, 10).replace(/-/g, "");
      dtend = endDate.toISOString().slice(0, 10).replace(/-/g, "");
    } else {
      // For timed events, use DATE-TIME format (YYYYMMDDTHHMMSSZ)
      dtstart = startDate
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+/, "");
      dtend = endDate.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    }

    // Build ICS content manually without ical.js
    const icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Radicale Desktop//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART${allDay ? ";VALUE=DATE" : ""}:${dtstart}`,
      `DTEND${allDay ? ";VALUE=DATE" : ""}:${dtend}`,
      `SUMMARY:${title}`,
      ...(description ? [`DESCRIPTION:${description}`] : []),
    ];

    // 添加分类
    if (category && category.name) {
      icsLines.push(`CATEGORIES:${category.name}`);
    }

    // 添加标签到描述中（因为CATEGORIES只用于分类）
    if (tags && Array.isArray(tags) && tags.length > 0) {
      const tagNames = tags.map((tag) => tag.name).join(", ");
      // 如果已有描述，则追加标签信息
      if (description) {
        icsLines.push(`DESCRIPTION:${description}\\n\\nTags: ${tagNames}`);
      } else {
        icsLines.push(`DESCRIPTION:Tags: ${tagNames}`);
      }
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

    const icsContent = icsLines.join("\r\n");

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
      targetCal = cals.find((cal) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    // Find the existing event
    const events = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });
    const eventToUpdate = events.find((e) => e.url.includes(uid));

    if (!eventToUpdate) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Generate timestamps
    const dtstamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+/, "");

    // Format dates
    const startDate = new Date(start);
    const endDate = new Date(end);

    let dtstart, dtend;
    if (allDay) {
      // For all-day events, use DATE format (YYYYMMDD)
      dtstart = startDate.toISOString().slice(0, 10).replace(/-/g, "");
      dtend = endDate.toISOString().slice(0, 10).replace(/-/g, "");
    } else {
      // For timed events, use DATE-TIME format (YYYYMMDDTHHMMSSZ)
      dtstart = startDate
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+/, "");
      dtend = endDate.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    }

    // Build ICS content manually without ical.js
    const icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Radicale Desktop//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART${allDay ? ";VALUE=DATE" : ""}:${dtstart}`,
      `DTEND${allDay ? ";VALUE=DATE" : ""}:${dtend}`,
      `SUMMARY:${title}`,
      ...(description ? [`DESCRIPTION:${description}`] : []),
    ];

    // 添加分类
    if (category && category.name) {
      icsLines.push(`CATEGORIES:${category.name}`);
    }

    // 添加标签到描述中（因为CATEGORIES只用于分类）
    if (tags && Array.isArray(tags) && tags.length > 0) {
      const tagNames = tags.map((tag) => tag.name).join(", ");
      // 如果已有描述，则追加标签信息
      if (description) {
        icsLines.push(`DESCRIPTION:${description}\\n\\nTags: ${tagNames}`);
      } else {
        icsLines.push(`DESCRIPTION:Tags: ${tagNames}`);
      }
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

    const icsContent = icsLines.join("\r\n");

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

    // Ensure we're authenticated
    await ensureAuthenticated();

    // Get the target calendar
    const cals = await davClient.fetchCalendars();
    let targetCal = cals[0];
    if (calendarUrl) {
      targetCal = cals.find((cal) => cal.url === calendarUrl) || cals[0];
    }

    if (!targetCal) {
      return res.status(404).json({ error: "Calendar not found" });
    }

    // Find the event to delete
    const events = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });
    const eventToDelete = events.find((e) => e.url.includes(uid));

    if (!eventToDelete) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Delete the event from CalDAV
    await davClient.deleteCalendarObject({
      calendarObject: eventToDelete,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

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
