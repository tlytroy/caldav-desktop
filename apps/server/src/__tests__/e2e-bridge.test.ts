/**
 * ⚠️ 这两个 e2e 测试需要**真实运行的 CalDAV 服务器**。
 *
 * 默认跳过 —— 因为「本地优先」是本工具的设计前提：
 * 没有服务器时也应该能完整使用本地功能，测试套件更不该因此变红。
 *
 * 要跑这些测试：
 *   RUN_E2E=1 pnpm vitest run src/__tests__/e2e-full.test.ts
 * 且 .env 里的 CALDAV_URL / CALDAV_USER / CALDAV_PASS 指向可用服务器。
 */
const RUN_E2E = process.env.RUN_E2E === "1";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  ensureEventsFile,
  writeEventsFile,
  eventToIcs,
  icsToEvent,
  type BridgeEvent,
} from "../md-ics-bridge.js";
import { davClient, ensureAuthenticated } from "../caldav.js";
import type { DAVCalendar } from "tsdav";

describe.skipIf(!RUN_E2E)("E2E: MD Bridge -> CalDAV sync", () => {
  const mdEventsPath = path.resolve(__dirname, "../../../events.test.md");
  const testEvent: BridgeEvent = {
    uid: "e2e-test-push-001",
    title: "E2E Test Event - Push",
    date: "2026-09-01T09:00:00.000Z",
    end: "2026-09-01T10:00:00.000Z",
    allDay: false,
    status: "confirmed",
    category: "test",
    tags: ["e2e", "automated"],
    priority: "high",
    recurrence: undefined,
    description: "Created by E2E test for push verification",
    updated: new Date().toISOString(),
    source: "md",
  };

  let targetCal: DAVCalendar;

  beforeAll(async () => {
    await ensureAuthenticated();
    const cals = await davClient.fetchCalendars();
    expect(cals.length).toBeGreaterThan(0);
    targetCal = cals[0];
    console.log("[DEBUG] targetCal.url:", targetCal.url);
    console.log("[DEBUG] targetCal keys:", Object.keys(targetCal));
  }, 30000);

  // Cleanup: delete test file after tests
  afterAll(() => {
    try {
      if (fs.existsSync(mdEventsPath)) fs.unlinkSync(mdEventsPath);
    } catch {
      // ignore
    }
  });

  it("1. should write event to events.test.md", () => {
    const eventsFile = ensureEventsFile(mdEventsPath);
    eventsFile.events.push(testEvent);
    writeEventsFile(eventsFile);

    // Verify the file exists and contains the event
    expect(fs.existsSync(mdEventsPath)).toBe(true);

    // Re-read and verify
    const reread = ensureEventsFile(mdEventsPath);
    expect(reread.events.length).toBeGreaterThanOrEqual(1);
    const found = reread.events.find((e) => e.uid === testEvent.uid);
    expect(found).toBeDefined();
    expect(found!.title).toBe(testEvent.title);
    expect(found!.priority).toBe("high");
  });

  it("2. should convert event to ICS and back without data loss", () => {
    const icsContent = eventToIcs(testEvent);
    expect(icsContent).toContain("BEGIN:VCALENDAR");
    expect(icsContent).toContain("SUMMARY:E2E Test Event - Push");
    expect(icsContent).toContain("PRIORITY:1");
    expect(icsContent).toContain("CATEGORIES:test");

    // Parse back
    const parsed = icsToEvent(icsContent);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe(testEvent.title);
    expect(parsed!.priority).toBe("high");
    expect(parsed!.category).toBe("test");
  });

  it("3. should push event to CalDAV server and verify via calendar API", async () => {
    // Push via davClient
    const icsContent = eventToIcs(testEvent);

    await davClient.createCalendarObject({
      calendar: targetCal,
      filename: `${testEvent.uid}.ics`,
      iCalString: icsContent,
    });

    // Verify by fetching back from server
    const remoteEvents = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });

    console.log("[DEBUG] remoteEvents count:", remoteEvents.length);
    remoteEvents.forEach((obj: any, i: number) => {
      console.log(`[DEBUG] remoteEvents[${i}] keys:`, Object.keys(obj));
      console.log(`[DEBUG] remoteEvents[${i}] url:`, obj.url);
    });

    console.log("[DEBUG] Searching for uid:", testEvent.uid);
    const found = remoteEvents.find((obj: any) => {
      const data = obj.data?.toString() || "";
      const has = data.includes(testEvent.uid!);
      if (has) console.log("[DEBUG] Found in remoteEvents url:", obj.url);
      return has;
    });

    expect(found).toBeDefined();
    const data = found!.data!.toString();
    expect(data).toContain("SUMMARY:E2E Test Event - Push");
    expect(data).toContain("PRIORITY:1");

    // Parse the remote ICS back to BridgeEvent
    const parsed = icsToEvent(data);
    console.log("[DEBUG] parsed result:", parsed ? parsed.title : null);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe(testEvent.title);
    expect(parsed!.priority).toBe("high");
    expect(parsed!.category).toBe("test");

    // Cleanup: delete the remote event
    await davClient.deleteCalendarObject({
      calendarObject: found!,
    });
  });

  it("4. should sync pull from CalDAV back to events.md", async () => {
    // First push an event directly to CalDAV
    const icsContent = eventToIcs(testEvent);

    await davClient.createCalendarObject({
      calendar: targetCal,
      filename: `${testEvent.uid}.ics`,
      iCalString: icsContent,
    });

    // Now simulate pull: fetch remote and merge into events.md
    const remoteEvents = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });

    const eventsFile = ensureEventsFile(mdEventsPath);
    let pulledCount = 0;

    let remoteObjToDelete: any = null;

    for (const remoteEvent of remoteEvents) {
      const rawData = remoteEvent.data?.toString();
      if (!rawData) {
        console.log("[DEBUG] remoteEvent has no data, url:", remoteEvent.url);
        continue;
      }
      const bridgeEvent = icsToEvent(rawData);
      if (!bridgeEvent || !bridgeEvent.title) {
        console.log("[DEBUG] icsToEvent failed for:", remoteEvent.url);
        console.log("[DEBUG] rawData preview:", rawData.substring(0, 200));
        continue;
      }

      if (bridgeEvent.uid === testEvent.uid) {
        remoteObjToDelete = remoteEvent;
      }

      const existingIndex = eventsFile.events.findIndex(
        (e) => e.uid === bridgeEvent.uid,
      );

      if (existingIndex >= 0) {
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
      pulledCount++;
    }

    writeEventsFile(eventsFile);
    expect(pulledCount).toBeGreaterThan(0);

    // Verify the pulled event is in events.md
    const afterPull = ensureEventsFile(mdEventsPath);
    const pulledEvent = afterPull.events.find((e) => e.uid === testEvent.uid);
    expect(pulledEvent).toBeDefined();
    expect(pulledEvent!.source).toBe("caldav");

    // Cleanup remote
    if (remoteObjToDelete) {
      await davClient.deleteCalendarObject({
        calendarObject: remoteObjToDelete,
      });
    }
  });

  it("5. should handle all-day event push/pull correctly", async () => {
    const allDayEvent: BridgeEvent = {
      uid: "e2e-test-allday-001",
      title: "E2E All-Day Test",
      date: "2026-09-15T00:00:00.000Z",
      end: "2026-09-16T00:00:00.000Z", // DTEND should be next day for all-day
      allDay: true,
      status: "confirmed",
      category: "test",
      description: "All-day event E2E test",
      updated: new Date().toISOString(),
      source: "md",
    };

    // Convert to ICS
    const icsContent = eventToIcs(allDayEvent);
    expect(icsContent).toContain("DTSTART;VALUE=DATE:20260915");
    // DTEND should be the next day (20260916) for all-day events
    expect(icsContent).toContain("DTEND;VALUE=DATE:20260916");

    // Parse back
    const parsed = icsToEvent(icsContent);
    expect(parsed).not.toBeNull();
    expect(parsed!.allDay).toBe(true);
    expect(parsed!.title).toBe(allDayEvent.title);

    // Push to CalDAV
    await davClient.createCalendarObject({
      calendar: targetCal,
      filename: `${allDayEvent.uid}.ics`,
      iCalString: icsContent,
    });

    // Fetch back and verify
    const remoteEvents = await davClient.fetchCalendarObjects({
      calendar: targetCal,
    });
    const found = remoteEvents.find((obj: any) =>
      obj.data?.toString().includes(allDayEvent.uid!),
    );
    expect(found).toBeDefined();

    const remoteParsed = icsToEvent(found!.data!.toString());
    expect(remoteParsed).not.toBeNull();
    expect(remoteParsed!.allDay).toBe(true);
    expect(remoteParsed!.title).toBe(allDayEvent.title);

    // Cleanup
    await davClient.deleteCalendarObject({
      calendarObject: found!,
    });
  });
});
