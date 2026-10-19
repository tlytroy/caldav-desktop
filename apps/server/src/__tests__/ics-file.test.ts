/**
 * iCalendar 导入 / 导出 单元测试
 *
 * 覆盖 md-ics-bridge 中 parseIcsFile / eventsFileToIcs / eventToIcs 的关键行为，
 * 尤其是此前实现缺失或错误的部分：
 *  - icsToEvent 只取第一个 VEVENT（正则缺 g 标志），导入多事件日历会丢数据
 *  - 全天事件 DTEND 与 DTSTART 同日 → 零长度事件，客户端可能不显示
 *  - 全天事件用 toISOString() 取日期 → 东八区会落到前一天
 */

import { describe, it, expect } from "vitest";
import {
  parseIcsFile,
  eventsFileToIcs,
  icsToEvent,
  eventToIcs,
  type EventsFile,
} from "../md-ics-bridge.js";

const MULTI_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VEVENT",
  "UID:evt-1@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260901T090000Z",
  "DTEND:20260901T100000Z",
  "SUMMARY:晨会",
  "DESCRIPTION:每天同步进度",
  "CATEGORIES:工作",
  "PRIORITY:1",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-2@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;VALUE=DATE:20260902",
  "DTEND;VALUE=DATE:20260903",
  "SUMMARY:全天出差",
  "STATUS:TENTATIVE",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-3@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260903T140000Z",
  "DTEND:20260903T150000Z",
  "SUMMARY:客户会议",
  "RRULE:FREQ=WEEKLY",
  "X-KANBAN-TASK-ID:k-abc123",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\n");

describe("parseIcsFile — 多事件解析", () => {
  it("解析出全部 3 条事件（旧实现只能拿到第 1 条）", () => {
    const parsed = parseIcsFile(MULTI_ICS);
    expect(parsed).toHaveLength(3);
  });

  it("解析常规事件字段", () => {
    const [first] = parseIcsFile(MULTI_ICS);
    expect(first.title).toBe("晨会");
    expect(first.uid).toBe("evt-1@test");
    expect(first.category).toBe("工作");
    expect(first.priority).toBe("high");
  });

  it("识别全天事件（VALUE=DATE）", () => {
    const allDay = parseIcsFile(MULTI_ICS)[1];
    expect(allDay.allDay).toBe(true);
    expect(allDay.title).toBe("全天出差");
    expect(allDay.status).toBe("tentative");
  });

  it("保留 RRULE 与看板关联", () => {
    const third = parseIcsFile(MULTI_ICS)[2];
    expect(third.recurrence).toBe("weekly");
    expect(third.kanbanTaskId).toBe("k-abc123");
  });

  it("兼容 CRLF 行尾", () => {
    expect(parseIcsFile(MULTI_ICS.replace(/\n/g, "\r\n"))).toHaveLength(3);
  });

  it("异常输入不崩溃", () => {
    expect(parseIcsFile("")).toHaveLength(0);
    expect(parseIcsFile("hello world")).toHaveLength(0);
    expect(parseIcsFile("BEGIN:VEVENT\nSUMMARY:残缺")).toHaveLength(0);
  });

  it("跳过没有 SUMMARY 的事件", () => {
    expect(icsToEvent("BEGIN:VEVENT\nUID:x\nEND:VEVENT")).toBeNull();
  });
});

describe("eventToIcs — 全天事件边界", () => {
  it("DTEND 与 DTSTART 同日时修正为次日（ICS 要求排他）", () => {
    const ics = eventToIcs({
      uid: "ad-1",
      title: "全天任务",
      date: "2026-09-10T00:00:00.000Z",
      end: "2026-09-10T00:00:00.000Z",
      allDay: true,
    });
    const start = ics.match(/DTSTART;VALUE=DATE:(\d{8})/)?.[1];
    const end = ics.match(/DTEND;VALUE=DATE:(\d{8})/)?.[1];
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect(Number(end)).toBeGreaterThan(Number(start));
  });

  it("全天事件日期按本地日历日，不做 UTC 换算", () => {
    // 东八区凌晨的事件若走 toISOString 会退到前一天
    const ics = eventToIcs({
      uid: "ad-2",
      title: "凌晨事件",
      date: new Date(2026, 8, 10, 0, 30, 0).toISOString(),
      allDay: true,
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260910");
  });

  it("非全天事件结束不晚于开始时兜底 +1 小时", () => {
    const ics = eventToIcs({
      uid: "e-1",
      title: "异常区间",
      date: "2026-09-10T10:00:00.000Z",
      end: "2026-09-10T09:00:00.000Z",
    });
    const start = Date.parse("2026-09-10T10:00:00Z");
    const endMatch = ics.match(/DTEND:(\d{8}T\d{6})/)?.[1];
    expect(endMatch).toBeDefined();
    const end = Date.parse(
      `${endMatch!.slice(0, 4)}-${endMatch!.slice(4, 6)}-${endMatch!.slice(6, 8)}T${endMatch!.slice(9, 11)}:${endMatch!.slice(11, 13)}:${endMatch!.slice(13, 15)}Z`,
    );
    expect(end).toBeGreaterThan(start);
  });
});

describe("eventsFileToIcs — 导出为单个 VCALENDAR", () => {
  const file: EventsFile = {
    events: [
      { uid: "e1", title: "A", date: "2026-09-01T09:00:00Z" },
      { uid: "e2", title: "B", date: "2026-09-02T09:00:00Z" },
    ],
    body: "",
    raw: "",
  };

  it("包含全部 VEVENT", () => {
    const ics = eventsFileToIcs(file);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/^UID:/gm)).toHaveLength(2);
  });

  it("外层只有一层 VCALENDAR，无嵌套 VERSION", () => {
    const ics = eventsFileToIcs(file);
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/VERSION:/g)).toHaveLength(1);
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("导出→导入往返保持事件数与标题", () => {
    const roundTrip = parseIcsFile(eventsFileToIcs(file));
    expect(roundTrip).toHaveLength(2);
    expect(roundTrip[0].title).toBe("A");
    expect(roundTrip[1].title).toBe("B");
  });

  it("空事件列表也能产出合法 VCALENDAR", () => {
    const ics = eventsFileToIcs({ events: [], body: "", raw: "" });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
  });
});
