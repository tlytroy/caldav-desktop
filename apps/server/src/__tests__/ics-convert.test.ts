import { describe, it, expect } from "vitest";
import {
  itemsToIcs,
  parseIcsEvents,
  itemToIcsEvent,
  icsEventToItem,
  itemsToIcsMap,
} from "../ics-convert.js";
import type { WorkbenchItem } from "../workspace.js";

const baseItem: WorkbenchItem = {
  id: "a1b2c3d4",
  kind: "event",
  title: "项目周会",
  start: "2026-10-26T10:00:00",
  end: "2026-10-26T11:00:00",
};

describe("条目 → ICS", () => {
  it("生成合法的 VCALENDAR", () => {
    const ics = itemsToIcs([baseItem]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("UID:a1b2c3d4");
    expect(ics).toContain("SUMMARY:项目周会");
  });

  it("时间用本地时间，不带 Z", () => {
    const ics = itemsToIcs([baseItem]);
    expect(ics).toContain("DTSTART:20261026T100000");
    expect(ics).toContain("DTEND:20261026T110000");
    // 不能出现 Z（那是 UTC，会偏 8 小时）
    expect(ics).not.toMatch(/DTSTART:[^:]*Z$/m);
  });

  it("全天事件用 VALUE=DATE，且 DTEND 是次日（排他边界）", () => {
    const ics = itemsToIcs([
      {
        ...baseItem,
        title: "体检",
        start: "2026-10-28T00:00:00",
        end: "2026-10-29T00:00:00",
        allDay: true,
      },
    ]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261028");
    expect(ics).toContain("DTEND;VALUE=DATE:20261029");
  });

  it("全天事件缺 end 时自动补次日（不能同日，否则零长度）", () => {
    const ics = itemsToIcs([
      {
        ...baseItem,
        start: "2026-10-28T00:00:00",
        end: undefined,
        allDay: true,
      },
    ]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261028");
    expect(ics).toContain("DTEND;VALUE=DATE:20261029");
  });

  it("★ RRULE 完整透传：每周一三五不丢 BYDAY", () => {
    const ics = itemsToIcs([
      { ...baseItem, recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
    ]);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("★ RRULE 完整透传：每月1号不丢 BYMONTHDAY", () => {
    const ics = itemsToIcs([
      { ...baseItem, recurrence: "FREQ=MONTHLY;BYMONTHDAY=1" },
    ]);
    expect(ics).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=1");
  });

  it("RRULE 支持 INTERVAL / COUNT / UNTIL", () => {
    const ics = itemsToIcs([
      {
        ...baseItem,
        recurrence: "FREQ=WEEKLY;INTERVAL=2;COUNT=10;UNTIL=20261231",
      },
    ]);
    expect(ics).toContain("INTERVAL=2");
    expect(ics).toContain("COUNT=10");
    expect(ics).toContain("UNTIL=20261231");
  });

  it("文本转义：逗号分号换行", () => {
    const ics = itemsToIcs([
      { ...baseItem, title: "开会, 讨论; 方案", description: "第一行\n第二行" },
    ]);
    expect(ics).toContain("SUMMARY:开会\\, 讨论\\; 方案");
    expect(ics).toContain("DESCRIPTION:第一行\\n第二行");
  });

  it("超长行折行（RFC 要求 ≤75 字节）", () => {
    const ics = itemsToIcs([
      { ...baseItem, description: "x".repeat(300) },
    ]);
    const descLine = ics
      .split("\r\n")
      .find((l) => l.startsWith("DESCRIPTION:") || l.startsWith(" "));
    expect(descLine).toBeTruthy();
    expect(descLine!.length).toBeLessThanOrEqual(75);
  });

  it("优先级映射为 ICS 数字", () => {
    const ics = itemsToIcs([
      { ...baseItem, priority: "high" },
      { ...baseItem, id: "bbbb2222", priority: "low" },
    ]);
    expect(ics).toContain("PRIORITY:1");
    expect(ics).toContain("PRIORITY:9");
  });

  it("拆分为多个文件（CalDAV 同步用）", () => {
    const map = itemsToIcsMap([baseItem]);
    expect(map.size).toBe(1);
    expect(map.get("a1b2c3d4.ics")).toContain("BEGIN:VCALENDAR");
  });
});

describe("ICS → 条目", () => {
  it("解析单个事件", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test1234
DTSTAMP:20261026T020000Z
DTSTART:20261026T100000
DTEND:20261026T110000
SUMMARY:测试事件
END:VEVENT
END:VCALENDAR`;
    const evs = parseIcsEvents(ics);
    expect(evs).toHaveLength(1);
    expect(evs[0].title).toBe("测试事件");
    expect(evs[0].start).toBe("2026-10-26T10:00:00");
    expect(evs[0].end).toBe("2026-10-26T11:00:00");
  });

  it("解析多个事件", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART:20261026T100000
SUMMARY:甲
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART:20261027T100000
SUMMARY:乙
END:VEVENT
END:VCALENDAR`;
    expect(parseIcsEvents(ics)).toHaveLength(2);
  });

  it("★ 往返后 RRULE 不丢参数（这是旧实现最大的问题）", () => {
    const original = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
    const ics = itemsToIcs([{ ...baseItem, recurrence: original }]);
    const evs = parseIcsEvents(ics);
    expect(evs[0].recurrence).toBe(original);
  });

  it("★ 每月1号往返后不丢 BYMONTHDAY", () => {
    const original = "FREQ=MONTHLY;BYMONTHDAY=1";
    const ics = itemsToIcs([{ ...baseItem, recurrence: original }]);
    const evs = parseIcsEvents(ics);
    expect(evs[0].recurrence).toBe(original);
  });

  it("带 Z 的 UTC 时间转成本地表示", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART:20261026T020000Z
SUMMARY:UTC时间
END:VEVENT
END:VCALENDAR`;
    const evs = parseIcsEvents(ics);
    // 02:00Z 在东八区是 10:00
    expect(evs[0].start).toBe("2026-10-26T10:00:00");
  });

  it("全天事件解析出 allDay 标记", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART;VALUE=DATE:20261028
DTEND;VALUE=DATE:20261029
SUMMARY:体检
END:VEVENT
END:VCALENDAR`;
    const evs = parseIcsEvents(ics);
    expect(evs[0].allDay).toBe(true);
    expect(evs[0].start).toBe("2026-10-28T00:00:00");
  });

  it("容错：一个坏事件不影响其它", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
SUMMARY:好的
DTSTART:20261026T100000
END:VEVENT
BEGIN:VEVENT
UID:b
END:VEVENT
BEGIN:VEVENT
UID:c
SUMMARY:也好
DTSTART:20261027T100000
END:VEVENT
END:VCALENDAR`;
    const evs = parseIcsEvents(ics);
    // 缺 DTSTART 的那个被跳过
    expect(evs).toHaveLength(2);
    expect(evs.map((e) => e.title)).toEqual(["好的", "也好"]);
  });

  it("反转义文本", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART:20261026T100000
SUMMARY:开会\\, 讨论\\; 方案
DESCRIPTION:第一行\\n第二行
END:VEVENT
END:VCALENDAR`;
    const evs = parseIcsEvents(ics);
    expect(evs[0].title).toBe("开会, 讨论; 方案");
    expect(evs[0].description).toBe("第一行\n第二行");
  });

  it("展开折行后再解析", () => {
    const longDesc = "x".repeat(200);
    const ics = itemsToIcs([{ ...baseItem, description: longDesc }]);
    const evs = parseIcsEvents(ics);
    expect(evs[0].description).toBe(longDesc);
  });

  it("转换后的条目 id 是合法 8 位十六进制", () => {
    const evs = parseIcsEvents(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:some-weird-uid-123
DTSTART:20261026T100000
SUMMARY:x
END:VEVENT
END:VCALENDAR`);
    const item = icsEventToItem(evs[0]);
    expect(item.id).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("完整往返", () => {
  it("条目 → ICS → 条目，字段保持一致", () => {
    const original: WorkbenchItem = {
      id: "abc12345",
      kind: "event",
      title: "竞聘答辩",
      start: "2026-11-05T14:00:00",
      end: "2026-11-05T15:30:00",
      allDay: false,
      description: "准备材料",
      location: "张江",
      tags: ["重要", "对外"],
      priority: "high",
      recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    };
    const ics = itemsToIcs([original]);
    const evs = parseIcsEvents(ics);
    const back = icsEventToItem(evs[0]);

    expect(back.title).toBe(original.title);
    expect(back.start).toBe(original.start);
    expect(back.end).toBe(original.end);
    expect(back.description).toBe(original.description);
    expect(back.location).toBe(original.location);
    expect(back.tags).toEqual(original.tags);
    expect(back.priority).toBe(original.priority);
    expect(back.recurrence).toBe(original.recurrence);
  });

  it("全天事件往返后仍然是全天且 end 正确", () => {
    const original: WorkbenchItem = {
      id: "aaa11111",
      kind: "task",
      title: "体检",
      start: "2026-10-28T00:00:00",
      end: "2026-10-29T00:00:00",
      allDay: true,
    };
    const ics = itemsToIcs([original]);
    const evs = parseIcsEvents(ics);
    const back = icsEventToItem(evs[0]);
    expect(back.allDay).toBe(true);
    expect(back.start).toBe("2026-10-28T00:00:00");
    expect(back.end).toBe("2026-10-29T00:00:00");
  });
});
