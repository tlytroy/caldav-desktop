/**
 * 完整端到端测试套件
 *
 * 覆盖范围：
 * 1. 事件 CRUD（增删改查）在本地 MD 文件上的操作
 * 2. 事件 CRUD 通过 CalDAV API 的操作
 * 3. MD ↔ CalDAV 双向同步（push / pull / delete sync）
 * 4. 工作台功能：加任务、优先级、标记完成/取消
 * 5. 缓存完整性：操作后即时可用，无需等待同步
 * 6. All-day 事件处理
 * 7. 标签、分类、重复事件
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  ensureEventsFile,
  writeEventsFile,
  readEventsFile,
  parseEventsFile,
  serializeEventsFile,
  eventToIcs,
  icsToEvent,
  type BridgeEvent,
  type EventsFile,
} from "../md-ics-bridge.js";
import {
  davClient,
  ensureAuthenticated,
  fetchCalendarObjectsDirect,
} from "../caldav.js";
import type { DAVCalendar } from "tsdav";

// ===== Helpers =====

/** 生成一个测试用 UID */
function makeUid(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/** 创建一个简单的事件对象 */
function makeEvent(overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  const now = new Date();
  const start = new Date(now.getTime() + 86400000); // 明天
  const end = new Date(start.getTime() + 3600000); // 1小时后
  return {
    uid: makeUid(),
    title: "Test Event - " + overrides.title || "default",
    date: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    status: "confirmed",
    category: "test",
    tags: ["e2e"],
    priority: "medium",
    description: "Created by e2e test",
    updated: new Date().toISOString(),
    source: "md",
    ...overrides,
  };
}

/** 创建一个任务（不带 end 即视为任务/待办） */
function makeTask(overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  const now = new Date();
  const start = new Date(now.getTime() + 86400000);
  return {
    uid: makeUid("task"),
    title: "Task - " + (overrides.title || "default"),
    date: start.toISOString(),
    end: undefined, // 任务没有结束时间
    allDay: false,
    status: "needs-action", // 任务初始状态
    category: "task",
    tags: ["task", "e2e"],
    priority: "medium",
    description: "Task created by e2e test",
    updated: new Date().toISOString(),
    source: "md",
    ...overrides,
  };
}

// ===== Test Suite =====

describe("E2E: MD Bridge Full Suite", () => {
  const mdEventsPath = path.resolve(__dirname, "../../../events.fulltest.md");
  let targetCal: DAVCalendar;

  beforeAll(async () => {
    // 清理旧测试文件
    try {
      if (fs.existsSync(mdEventsPath)) fs.unlinkSync(mdEventsPath);
    } catch {
      // ignore
    }

    // 连接 CalDAV
    await ensureAuthenticated();
    const cals = await davClient.fetchCalendars();
    expect(cals.length).toBeGreaterThan(0);
    targetCal = cals[0];

    console.log(`[Test] Target calendar: ${(targetCal as any).url}`);
    console.log(`[Test] Events file: ${mdEventsPath}`);
  }, 60000);

  afterAll(() => {
    // 清理测试文件
    try {
      if (fs.existsSync(mdEventsPath)) fs.unlinkSync(mdEventsPath);
    } catch {
      // ignore
    }
  });

  // 每个测试前清理 MD 文件
  beforeEach(() => {
    try {
      if (fs.existsSync(mdEventsPath)) fs.unlinkSync(mdEventsPath);
    } catch {
      // ignore
    }
  });

  // ================================================================
  // 第1部分：本地 MD 文件操作（工作台基础）
  // ================================================================

  describe("Part 1: Local MD file operations (Workspace basics)", () => {
    it("1.1 初始化空的 events.md 缓存文件", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      expect(fs.existsSync(mdEventsPath)).toBe(true);
      expect(eventsFile.events).toEqual([]);
      expect(eventsFile.body).toBeTruthy();
      expect(eventsFile.filePath).toBe(mdEventsPath);

      // 验证文件内容格式正确
      const raw = fs.readFileSync(mdEventsPath, "utf-8");
      expect(raw).toContain("---");
      expect(raw).toContain("events:");
    });

    it("1.2 添加事件到本地 MD 文件（工作台：加事件）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({ title: "Team Standup", priority: "high" });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // 即时验证：重新读取 MD 文件，无需同步
      const reread = ensureEventsFile(mdEventsPath);
      expect(reread.events.length).toBe(1);
      const found = reread.events[0];
      expect(found.title).toBe("Team Standup");
      expect(found.priority).toBe("high");
      expect(found.uid).toBe(event.uid);
    });

    it("1.3 添加多个事件（工作台：批量加事件）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const events = [
        makeEvent({ title: "Meeting A", priority: "high" }),
        makeEvent({ title: "Meeting B", priority: "medium" }),
        makeEvent({ title: "Meeting C", priority: "low" }),
      ];
      events.forEach((e) => eventsFile.events.push(e));
      writeEventsFile(eventsFile);

      const reread = ensureEventsFile(mdEventsPath);
      expect(reread.events.length).toBe(3);
      expect(reread.events.map((e) => e.title).sort()).toEqual([
        "Meeting A",
        "Meeting B",
        "Meeting C",
      ]);
    });

    it("1.4 添加任务（工作台：加任务，无 end 时间）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const task = makeTask({
        title: "Buy groceries",
        priority: "high",
        status: "needs-action",
      });
      eventsFile.events.push(task);
      writeEventsFile(eventsFile);

      const reread = ensureEventsFile(mdEventsPath);
      const found = reread.events.find((e) => e.uid === task.uid);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Buy groceries");
      expect(found!.priority).toBe("high");
      expect(found!.status).toBe("needs-action");
      expect(found!.end).toBeUndefined(); // 任务无结束时间
    });

    it("1.5 标记任务完成（工作台：任务完成 → status 改为 confirmed）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const task = makeTask({
        title: "Complete report",
        status: "needs-action",
      });
      eventsFile.events.push(task);
      writeEventsFile(eventsFile);

      // 模拟"完成任务"操作：修改 status 为 confirmed
      const reread = ensureEventsFile(mdEventsPath);
      const found = reread.events.find((e) => e.uid === task.uid)!;
      found.status = "confirmed";
      found.updated = new Date().toISOString();
      writeEventsFile(reread);

      // 验证
      const afterComplete = ensureEventsFile(mdEventsPath);
      const completed = afterComplete.events.find((e) => e.uid === task.uid);
      expect(completed).toBeDefined();
      expect(completed!.status).toBe("confirmed");
    });

    it("1.6 修改事件优先级（工作台：改优先级）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({
        title: "Important Meeting",
        priority: "medium",
      });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // 修改优先级：medium → high
      const reread = ensureEventsFile(mdEventsPath);
      const found = reread.events.find((e) => e.uid === event.uid)!;
      found.priority = "high";
      writeEventsFile(reread);

      const afterChange = ensureEventsFile(mdEventsPath);
      const changed = afterChange.events.find((e) => e.uid === event.uid);
      expect(changed!.priority).toBe("high");
    });

    it("1.7 从本地 MD 删除事件（工作台：删除事件）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const eventA = makeEvent({ title: "Keep me" });
      const eventB = makeEvent({ title: "Delete me" });
      eventsFile.events.push(eventA, eventB);
      writeEventsFile(eventsFile);

      // 删除 eventB
      const reread = ensureEventsFile(mdEventsPath);
      reread.events = reread.events.filter((e) => e.uid !== eventB.uid);
      writeEventsFile(reread);

      const afterDelete = ensureEventsFile(mdEventsPath);
      expect(afterDelete.events.length).toBe(1);
      expect(afterDelete.events[0].uid).toBe(eventA.uid);
      expect(
        afterDelete.events.find((e) => e.uid === eventB.uid),
      ).toBeUndefined();
    });

    it("1.8 编辑事件信息（工作台：修改标题/时间/描述）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({
        title: "Original Title",
        description: "Original description",
      });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // 修改标题和描述
      const reread = ensureEventsFile(mdEventsPath);
      const found = reread.events.find((e) => e.uid === event.uid)!;
      found.title = "Updated Title";
      found.description = "Updated description";
      found.priority = "high";
      writeEventsFile(reread);

      const afterEdit = ensureEventsFile(mdEventsPath);
      const edited = afterEdit.events.find((e) => e.uid === event.uid);
      expect(edited!.title).toBe("Updated Title");
      expect(edited!.description).toBe("Updated description");
      expect(edited!.priority).toBe("high");
    });
  });

  // ================================================================
  // 第2部分：ICS 转换测试
  // ================================================================

  describe("Part 2: ICS conversion (MD ↔ ICS)", () => {
    it("2.1 事件 → ICS 转换保留所有字段", () => {
      const event = makeEvent({
        title: "Full Fields Event",
        priority: "high",
        category: "work",
        tags: ["tag1", "tag2"],
        description: "A full featured event",
        recurrence: "weekly",
      });

      const ics = eventToIcs(event);
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain(`SUMMARY:${event.title}`);
      expect(ics).toContain("PRIORITY:1"); // high → 1
      expect(ics).toContain("CATEGORIES:work");
      expect(ics).toContain("RRULE:FREQ=WEEKLY");
      expect(ics).toContain(`UID:${event.uid}`);

      // ICS → Event 回读
      const parsed = icsToEvent(ics);
      expect(parsed).not.toBeNull();
      expect(parsed!.title).toBe(event.title);
      expect(parsed!.priority).toBe("high");
      expect(parsed!.category).toBe("work");
      expect(parsed!.recurrence).toBe("weekly");
      expect(parsed!.tags).toEqual(["tag1", "tag2"]);
    });

    it("2.2 任务（无 end）→ ICS 转换", () => {
      const task = makeTask({
        title: "Task without end",
        priority: "high",
      });

      const ics = eventToIcs(task);
      expect(ics).toContain(`SUMMARY:${task.title}`);
      expect(ics).toContain("PRIORITY:1");

      // 回读
      const parsed = icsToEvent(ics);
      expect(parsed).not.toBeNull();
      expect(parsed!.title).toBe(task.title);
      expect(parsed!.priority).toBe("high");
    });

    it("2.3 All-day 事件转换", () => {
      const allDay = makeEvent({
        title: "All Day Conference",
        allDay: true,
        date: "2026-10-01T00:00:00.000Z",
        end: "2026-10-02T00:00:00.000Z",
      });

      const ics = eventToIcs(allDay);
      expect(ics).toContain("DTSTART;VALUE=DATE:20261001");
      expect(ics).toContain("DTEND;VALUE=DATE:20261002");

      const parsed = icsToEvent(ics);
      expect(parsed).not.toBeNull();
      expect(parsed!.allDay).toBe(true);
    });

    it("2.4 不同优先级映射正确", () => {
      const high = makeEvent({ title: "High Prio", priority: "high" });
      const med = makeEvent({ title: "Med Prio", priority: "medium" });
      const low = makeEvent({ title: "Low Prio", priority: "low" });

      expect(eventToIcs(high)).toContain("PRIORITY:1");
      expect(eventToIcs(med)).toContain("PRIORITY:5");
      expect(eventToIcs(low)).toContain("PRIORITY:9");

      // 回读验证
      expect(icsToEvent(eventToIcs(high))!.priority).toBe("high");
      expect(icsToEvent(eventToIcs(med))!.priority).toBe("medium");
      expect(icsToEvent(eventToIcs(low))!.priority).toBe("low");
    });
  });

  // ================================================================
  // 第3部分：CalDAV 同步（Push / Pull / Delete）
  // ================================================================

  /** 获取目标日历 URL */
  function getCalUrl(): string {
    return (targetCal as any).url;
  }

  describe("Part 3: CalDAV sync operations", () => {
    const remoteUidsToCleanup: string[] = [];

    afterEach(async () => {
      // 清理远程事件
      for (const uid of remoteUidsToCleanup) {
        try {
          const events = await fetchCalendarObjectsDirect(getCalUrl());
          const found = events.find((e) => e.data?.toString().includes(uid));
          if (found) {
            await davClient.deleteCalendarObject({
              calendarObject: found,
            });
          }
        } catch {
          // ignore
        }
      }
      remoteUidsToCleanup.length = 0;
    }, 15000);

    it("3.1 Push: MD 事件 → CalDAV（新建事件同步到服务器）", async () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({ title: "Push Test Event" });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // Push 到 CalDAV
      const icsContent = eventToIcs(event);
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${event.uid}.ics`,
        iCalString: icsContent,
      });
      remoteUidsToCleanup.push(event.uid!);

      // 验证远程存在
      const remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      console.log(`[DEBUG] 3.1 remoteEvents count: ${remoteEvents.length}`);
      remoteEvents.forEach((re, i) => {
        console.log(
          `[DEBUG] 3.1 event[${i}]: url=${re.url}, data snippet=${re.data.substring(0, 100)}`,
        );
      });
      const found = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      expect(found).toBeDefined();
      const data = (found as any).data!.toString();
      expect(data).toContain(`SUMMARY:${event.title}`);
      expect(data).toContain(`UID:${event.uid}`);
    }, 30000);

    it("3.2 Push: 更新事件后重新 Push（修改 → 同步到服务器）", async () => {
      // 先创建
      const event = makeEvent({ title: "Update Original", priority: "medium" });
      const icsContent = eventToIcs(event);
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${event.uid}.ics`,
        iCalString: icsContent,
      });
      remoteUidsToCleanup.push(event.uid!);

      // 修改事件：标题和优先级
      event.title = "Update Changed";
      event.priority = "high";
      const updatedIcs = eventToIcs(event);

      // 删除旧版本，创建新版本（tsdav 的 update 需要先删后建）
      const remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      const oldObj = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      if (oldObj) {
        await davClient.deleteCalendarObject({ calendarObject: oldObj });
      }
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${event.uid}.ics`,
        iCalString: updatedIcs,
      });

      // 验证更新
      const afterUpdate = await fetchCalendarObjectsDirect(getCalUrl());
      const updated = afterUpdate.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      expect(updated).toBeDefined();
      const updatedData = (updated as any).data!.toString();
      expect(updatedData).toContain("SUMMARY:Update Changed");
      expect(updatedData).toContain("PRIORITY:1"); // high
      expect(updatedData).not.toContain("PRIORITY:5"); // 不再是 medium
    }, 30000);

    it("3.3 Pull: CalDAV → MD（从服务器拉取事件到本地缓存）", async () => {
      // 先在 CalDAV 上创建事件
      const event = makeEvent({ title: "Pull Test Event" });
      const icsContent = eventToIcs(event);
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${event.uid}.ics`,
        iCalString: icsContent,
      });
      remoteUidsToCleanup.push(event.uid!);

      // 从 CalDAV 拉取
      const remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());

      const eventsFile = ensureEventsFile(mdEventsPath);
      let pulledCount = 0;

      for (const remoteEvent of remoteEvents) {
        const rawData = (remoteEvent as any).data?.toString();
        if (!rawData) continue;
        const bridgeEvent = icsToEvent(rawData);
        if (!bridgeEvent || !bridgeEvent.title) continue;

        const existingIndex = eventsFile.events.findIndex(
          (e) => e.uid === bridgeEvent.uid,
        );
        if (existingIndex >= 0) {
          eventsFile.events[existingIndex] = {
            ...bridgeEvent,
            source: "caldav",
          };
        } else {
          eventsFile.events.push({ ...bridgeEvent, source: "caldav" });
        }
        pulledCount++;
      }
      writeEventsFile(eventsFile);

      expect(pulledCount).toBeGreaterThan(0);

      // 验证已拉取到 MD
      const afterPull = ensureEventsFile(mdEventsPath);
      const found = afterPull.events.find((e) => e.uid === event.uid);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Pull Test Event");
      expect(found!.source).toBe("caldav");
    }, 30000);

    it("3.4 Delete sync: MD 删除事件 → CalDAV 也删除", async () => {
      // 先在 MD 和 CalDAV 都创建事件
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({ title: "Delete Sync Event" });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // Push 到 CalDAV
      const icsContent = eventToIcs(event);
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${event.uid}.ics`,
        iCalString: icsContent,
      });

      // 验证远程存在
      let remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      let found = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      expect(found).toBeDefined();

      // 从 MD 删除事件
      const reread = ensureEventsFile(mdEventsPath);
      reread.events = reread.events.filter((e) => e.uid !== event.uid);
      writeEventsFile(reread);

      // 验证 MD 已删除
      const afterDelete = ensureEventsFile(mdEventsPath);
      expect(
        afterDelete.events.find((e) => e.uid === event.uid),
      ).toBeUndefined();

      // 同步删除到 CalDAV：从远程删除
      remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      found = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      if (found) {
        await davClient.deleteCalendarObject({ calendarObject: found });
      }

      // 验证远程已删除
      const afterRemoteDelete = await fetchCalendarObjectsDirect(getCalUrl());
      const stillExists = afterRemoteDelete.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      expect(stillExists).toBeUndefined();
    }, 30000);

    it("3.5 完整同步循环：MD 添加 → Push → Pull → 验证一致性", async () => {
      // Step 1: MD 添加事件
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({
        title: "Full Cycle Event",
        priority: "high",
        category: "sync-test",
        tags: ["cycle", "e2e"],
      });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // Step 2: Push 到 CalDAV
      const icsContent = eventToIcs(event);
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${event.uid}.ics`,
        iCalString: icsContent,
      });
      remoteUidsToCleanup.push(event.uid!);

      // Step 3: Pull 回来，验证一致性
      const remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      const remoteEvent = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      expect(remoteEvent).toBeDefined();

      const remoteParsed = icsToEvent((remoteEvent as any).data!.toString());
      expect(remoteParsed).not.toBeNull();
      expect(remoteParsed!.title).toBe(event.title);
      expect(remoteParsed!.priority).toBe(event.priority);
      expect(remoteParsed!.category).toBe(event.category);

      // Step 4: 验证 MD 文件仍然可用（缓存完整性）
      const localCheck = ensureEventsFile(mdEventsPath);
      const localEvent = localCheck.events.find((e) => e.uid === event.uid);
      expect(localEvent).toBeDefined();
      expect(localEvent!.title).toBe(event.title);
    }, 30000);

    it("3.6 批量同步：多个事件同时 Push", async () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const events = [
        makeEvent({ title: "Batch Event 1", priority: "high" }),
        makeEvent({ title: "Batch Event 2", priority: "medium" }),
        makeEvent({ title: "Batch Event 3", priority: "low" }),
      ];
      events.forEach((e) => eventsFile.events.push(e));
      writeEventsFile(eventsFile);

      // 批量 Push
      for (const event of events) {
        const ics = eventToIcs(event);
        await davClient.createCalendarObject({
          calendar: targetCal,
          filename: `${event.uid}.ics`,
          iCalString: ics,
        });
        remoteUidsToCleanup.push(event.uid!);
      }

      // 验证所有事件都在远程
      const remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());

      for (const event of events) {
        const found = remoteEvents.find((obj: any) =>
          (obj as any).data?.toString().includes(event.uid!),
        );
        expect(found).toBeDefined();
        const parsed = icsToEvent((found as any).data!.toString());
        expect(parsed!.title).toBe(event.title);
        expect(parsed!.priority).toBe(event.priority);
      }
    }, 30000);
  });

  // ================================================================
  // 第4部分：缓存完整性测试
  // ================================================================

  describe("Part 4: Cache integrity (no sync wait)", () => {
    it("4.1 写入后立即读取，无需等待", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({ title: "Instant Read Test" });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // 立即读取（无 await，无同步）
      const immediate = readEventsFile(mdEventsPath);
      expect(immediate).not.toBeNull();
      expect(immediate!.events.length).toBe(1);
      expect(immediate!.events[0].title).toBe("Instant Read Test");
    });

    it("4.2 多次写入后数据不丢失", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);

      // 第一次写入
      eventsFile.events.push(makeEvent({ title: "Event 1" }));
      writeEventsFile(eventsFile);

      // 第二次写入（追加）
      const second = ensureEventsFile(mdEventsPath);
      second.events.push(makeEvent({ title: "Event 2" }));
      writeEventsFile(second);

      // 第三次写入
      const third = ensureEventsFile(mdEventsPath);
      third.events.push(makeEvent({ title: "Event 3" }));
      writeEventsFile(third);

      // 验证全部存在
      const final = ensureEventsFile(mdEventsPath);
      expect(final.events.length).toBe(3);
      const titles = final.events.map((e) => e.title).sort();
      expect(titles).toEqual(["Event 1", "Event 2", "Event 3"]);
    });

    it("4.3 删除后缓存即时反映", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const eventA = makeEvent({ title: "Keep" });
      const eventB = makeEvent({ title: "Remove" });
      eventsFile.events.push(eventA, eventB);
      writeEventsFile(eventsFile);

      // 删除 eventB
      eventsFile.events = eventsFile.events.filter((e) => e.uid !== eventB.uid);
      writeEventsFile(eventsFile);

      // 即时验证
      const immediate = readEventsFile(mdEventsPath);
      expect(immediate!.events.length).toBe(1);
      expect(immediate!.events[0].uid).toBe(eventA.uid);
    });

    it("4.4 文件格式在多次写入后保持有效", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);

      for (let i = 0; i < 5; i++) {
        eventsFile.events.push(
          makeEvent({
            title: `Format Test ${i}`,
            priority: i === 0 ? "high" : "medium",
          }),
        );
      }
      writeEventsFile(eventsFile);

      // 验证 raw 内容格式
      const raw = fs.readFileSync(mdEventsPath, "utf-8");
      expect(raw).toContain("---");
      expect(raw).toContain("events:");

      // 验证可以正确解析
      const parsed = parseEventsFile(raw);
      expect(parsed.events.length).toBe(5);

      // 验证序列化再解析也正确
      const reserialized = serializeEventsFile(parsed);
      const reparsed = parseEventsFile(reserialized);
      expect(reparsed.events.length).toBe(5);
    });
  });

  // ================================================================
  // 第5部分：边缘情况
  // ================================================================

  describe("Part 5: Edge cases", () => {
    it("5.1 空 MD 文件处理", () => {
      const emptyFile = ensureEventsFile(mdEventsPath);
      expect(emptyFile.events).toEqual([]);

      // 空文件序列化再解析
      const raw = serializeEventsFile(emptyFile);
      const parsed = parseEventsFile(raw);
      expect(parsed.events).toEqual([]);
    });

    it("5.2 特殊字符在标题/描述中", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({
        title: 'Event with "quotes" and \\backslash and :colon',
        description: 'Description with "quotes" and special chars: @#$%',
      });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // 读取验证
      const reread = ensureEventsFile(mdEventsPath);
      const found = reread.events.find((e) => e.uid === event.uid);
      expect(found).toBeDefined();
      expect(found!.title).toContain("quotes");
      expect(found!.description).toContain("@#$%");

      // ICS 转换再回读
      const ics = eventToIcs(found!);
      const parsed = icsToEvent(ics);
      expect(parsed).not.toBeNull();
      expect(parsed!.title).toBe(found!.title);
    });

    it("5.3 大量事件处理（压力测试）", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const count = 50;
      for (let i = 0; i < count; i++) {
        eventsFile.events.push(makeEvent({ title: `Stress Test ${i}` }));
      }
      writeEventsFile(eventsFile);

      const reread = ensureEventsFile(mdEventsPath);
      expect(reread.events.length).toBe(count);

      // 验证所有事件都可读
      for (let i = 0; i < count; i++) {
        const found = reread.events.find((e) => e.title === `Stress Test ${i}`);
        expect(found).toBeDefined();
      }
    });

    it("5.4 无 UID 事件自动生成 UID", () => {
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({ uid: undefined });
      delete event.uid;
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      const reread = ensureEventsFile(mdEventsPath);
      expect(reread.events[0].uid).toBeDefined();
      expect(reread.events[0].uid).not.toBe("");
    });
  });

  // ================================================================
  // 第6部分：工作台完整工作流模拟
  // ================================================================

  describe("Part 6: Full workspace workflow simulation", () => {
    it("6.1 完整工作流：创建任务 → 设定优先级 → 标记完成 → 同步", async () => {
      // === 场景：用户在"工作台"页面的操作 ===

      // 1. 用户创建任务
      const eventsFile = ensureEventsFile(mdEventsPath);
      const task = makeTask({
        title: "Submit quarterly report",
        status: "needs-action",
        priority: "high",
        category: "work",
        tags: ["report", "quarterly", "urgent"],
      });
      eventsFile.events.push(task);
      writeEventsFile(eventsFile);

      // 2. 用户修改优先级（high → medium）
      const step2 = ensureEventsFile(mdEventsPath);
      const t2 = step2.events.find((e) => e.uid === task.uid)!;
      t2.priority = "medium";
      writeEventsFile(step2);

      // 3. 用户完成任务
      const step3 = ensureEventsFile(mdEventsPath);
      const t3 = step3.events.find((e) => e.uid === task.uid)!;
      t3.status = "confirmed";
      t3.updated = new Date().toISOString();
      writeEventsFile(step3);

      // 4. 用户取消任务（又改回未完成）
      const step4 = ensureEventsFile(mdEventsPath);
      const t4 = step4.events.find((e) => e.uid === task.uid)!;
      t4.status = "needs-action";
      t4.priority = "high";
      writeEventsFile(step4);

      // 5. 验证最终状态
      const final = ensureEventsFile(mdEventsPath);
      const finalTask = final.events.find((e) => e.uid === task.uid)!;
      expect(finalTask.title).toBe("Submit quarterly report");
      expect(finalTask.status).toBe("needs-action");
      expect(finalTask.priority).toBe("high");
      expect(finalTask.category).toBe("work");
      expect(finalTask.tags).toEqual(["report", "quarterly", "urgent"]);

      // 6. 同步到 CalDAV
      const icsContent = eventToIcs(finalTask);
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${finalTask.uid}.ics`,
        iCalString: icsContent,
      });

      // 7. 从 CalDAV 拉回验证
      const remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      const remote = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(finalTask.uid!),
      );
      expect(remote).toBeDefined();
      const remoteParsed = icsToEvent((remote as any).data!.toString());
      expect(remoteParsed!.title).toBe("Submit quarterly report");
      expect(remoteParsed!.status).toBe("needs-action");
      expect(remoteParsed!.priority).toBe("high");
      expect(remoteParsed!.category).toBe("work");

      // 清理
      if (remote) {
        await davClient.deleteCalendarObject({ calendarObject: remote });
      }
    }, 30000);

    it("6.2 完整工作流：创建事件 → 修改时间 → 删除 → 同步删除", async () => {
      // 1. 用户创建事件
      const eventsFile = ensureEventsFile(mdEventsPath);
      const event = makeEvent({
        title: "Client meeting",
        date: "2026-11-01T10:00:00.000Z",
        end: "2026-11-01T11:00:00.000Z",
        priority: "high",
        category: "meeting",
      });
      eventsFile.events.push(event);
      writeEventsFile(eventsFile);

      // 2. 同步到 CalDAV
      const icsContent = eventToIcs(event);
      await davClient.createCalendarObject({
        calendar: targetCal,
        filename: `${event.uid}.ics`,
        iCalString: icsContent,
      });

      // 3. 验证远程存在
      let remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      let found = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      expect(found).toBeDefined();

      // 4. 从 MD 删除事件
      const step4 = ensureEventsFile(mdEventsPath);
      step4.events = step4.events.filter((e) => e.uid !== event.uid);
      writeEventsFile(step4);

      // 5. 验证 MD 已删除（缓存即时更新）
      const step5 = ensureEventsFile(mdEventsPath);
      expect(step5.events.find((e) => e.uid === event.uid)).toBeUndefined();

      // 6. 同步删除到 CalDAV
      remoteEvents = await fetchCalendarObjectsDirect(getCalUrl());
      found = remoteEvents.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      if (found) {
        await davClient.deleteCalendarObject({ calendarObject: found });
      }

      // 7. 验证远程已删除
      const afterDelete = await fetchCalendarObjectsDirect(getCalUrl());
      const stillExists = afterDelete.find((obj: any) =>
        (obj as any).data?.toString().includes(event.uid!),
      );
      expect(stillExists).toBeUndefined();
    }, 30000);
  });
});
