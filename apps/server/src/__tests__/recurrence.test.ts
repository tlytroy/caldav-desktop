import { describe, it, expect } from "vitest";
import {
  parseRRule,
  formatRRule,
  describeRRule,
  expandRecurrenceDates,
  expandEventInstances,
  migrateLegacyRecurrence,
  indexToWeekday,
} from "../recurrence.js";

describe("RRULE 解析", () => {
  it("解析基本频率", () => {
    expect(parseRRule("FREQ=DAILY")?.freq).toBe("DAILY");
    expect(parseRRule("FREQ=WEEKLY")?.freq).toBe("WEEKLY");
    expect(parseRRule("FREQ=MONTHLY")?.freq).toBe("MONTHLY");
    expect(parseRRule("FREQ=YEARLY")?.freq).toBe("YEARLY");
  });

  it("带 RRULE: 前缀也能解析", () => {
    expect(parseRRule("RRULE:FREQ=DAILY")?.freq).toBe("DAILY");
  });

  it("解析 BYDAY（每周一三五）", () => {
    const r = parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(r?.freq).toBe("WEEKLY");
    expect(r?.byDay).toEqual([1, 3, 5]);
  });

  it("解析 BYMONTHDAY（每月1号）", () => {
    const r = parseRRule("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(r?.byMonthDay).toEqual([1]);
  });

  it("解析 INTERVAL / COUNT / UNTIL", () => {
    const r = parseRRule("FREQ=WEEKLY;INTERVAL=2;COUNT=10;UNTIL=20261231");
    expect(r?.interval).toBe(2);
    expect(r?.count).toBe(10);
    expect(r?.until).toBe("2026-12-31");
  });

  it("UNTIL 支持完整时间戳形式", () => {
    const r = parseRRule("FREQ=DAILY;UNTIL=20261101T000000Z");
    expect(r?.until).toBe("2026-11-01");
  });

  it("无效规则返回 null", () => {
    expect(parseRRule("")).toBeNull();
    expect(parseRRule("FREQ=HOURLY")).toBeNull();
    expect(parseRRule("随便写的")).toBeNull();
    expect(parseRRule(undefined)).toBeNull();
  });

  it("weekday 索引双向对应", () => {
    expect(indexToWeekday(1)).toBe("MO");
    expect(indexToWeekday(7)).toBe("SU");
  });
});

describe("RRULE 格式化与描述", () => {
  it("格式化字段顺序固定", () => {
    const s = formatRRule({
      freq: "WEEKLY",
      byDay: [1, 3, 5],
    });
    expect(s).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("描述出中文标签", () => {
    expect(describeRRule("FREQ=DAILY")).toBe("每天");
    expect(describeRRule("FREQ=WEEKLY")).toBe("每周");
    expect(describeRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("每周一、三、五");
    expect(describeRRule("FREQ=MONTHLY;BYMONTHDAY=1")).toBe("每月1号");
    expect(describeRRule("FREQ=MONTHLY")).toBe("每月");
    expect(describeRRule("")).toBe("不重复");
  });

  it("解析→格式化→解析 幂等", () => {
    const a = "FREQ=WEEKLY;BYDAY=TU,TH";
    const b = formatRRule(parseRRule(a)!);
    expect(b).toBe(a);
  });

  it("迁移旧的枚举式 recurrence", () => {
    expect(migrateLegacyRecurrence("daily")).toBe("FREQ=DAILY");
    expect(migrateLegacyRecurrence("weekly")).toBe("FREQ=WEEKLY");
    expect(migrateLegacyRecurrence("monthly")).toBe("FREQ=MONTHLY");
    expect(migrateLegacyRecurrence("yearly")).toBe("FREQ=YEARLY");
    expect(migrateLegacyRecurrence(undefined)).toBeUndefined();
    // 已是 RRULE 的原样返回
    expect(migrateLegacyRecurrence("FREQ=DAILY")).toBe("FREQ=DAILY");
  });
});

describe("重复日期展开", () => {
  it("每天：区间内连续", () => {
    const dates = expandRecurrenceDates(
      "2026-10-01T09:00:00",
      { freq: "DAILY" },
      "2026-10-01",
      "2026-10-05",
    );
    expect(dates).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
  });

  it("每天：跳过区间之前的日期", () => {
    const dates = expandRecurrenceDates(
      "2026-10-01T09:00:00",
      { freq: "DAILY" },
      "2026-10-03",
      "2026-10-04",
    );
    expect(dates).toEqual(["2026-10-03", "2026-10-04"]);
  });

  it("每周：与首次同星期几", () => {
    // 2026-10-01 是周四
    const dates = expandRecurrenceDates(
      "2026-10-01T09:00:00",
      { freq: "WEEKLY" },
      "2026-10-01",
      "2026-10-29",
    );
    expect(dates).toEqual([
      "2026-10-01",
      "2026-10-08",
      "2026-10-15",
      "2026-10-22",
      "2026-10-29",
    ]);
  });

  it("每周一三五：按 BYDAY 展开", () => {
    const dates = expandRecurrenceDates(
      "2026-10-05T09:00:00", // 周一
      { freq: "WEEKLY", byDay: [1, 3, 5] },
      "2026-10-05",
      "2026-10-11",
    );
    expect(dates).toEqual([
      "2026-10-05", // 一
      "2026-10-07", // 三
      "2026-10-09", // 五
    ]);
  });

  it("每两周：INTERVAL=2", () => {
    const dates = expandRecurrenceDates(
      "2026-10-01T09:00:00",
      { freq: "WEEKLY", interval: 2 },
      "2026-10-01",
      "2026-10-29",
    );
    expect(dates).toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
  });

  it("每月：同几号", () => {
    const dates = expandRecurrenceDates(
      "2026-10-15T09:00:00",
      { freq: "MONTHLY" },
      "2026-10-01",
      "2027-01-31",
    );
    expect(dates).toEqual([
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
    ]);
  });

  it("每月1号：跨年正确", () => {
    const dates = expandRecurrenceDates(
      "2026-10-01T09:00:00",
      { freq: "MONTHLY", byMonthDay: [1] },
      "2026-10-01",
      "2027-01-31",
    );
    expect(dates).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  it("每月31号：短月跳过而不是溢出或钳位（RFC 5545 语义）", () => {
    const dates = expandRecurrenceDates(
      "2026-01-31T09:00:00",
      { freq: "MONTHLY" },
      "2026-01-01",
      "2026-06-30",
    );
    // 2 月（28天）、4 月（30天）、6 月（30天）都没有 31 号 → 跳过
    expect(dates).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("每月30号：4月与6月有30号，会正常出现", () => {
    const dates = expandRecurrenceDates(
      "2026-04-30T09:00:00",
      { freq: "MONTHLY" },
      "2026-04-01",
      "2026-07-31",
    );
    expect(dates).toEqual([
      "2026-04-30",
      "2026-05-30",
      "2026-06-30",
      "2026-07-30",
    ]);
  });

  it("COUNT 限制次数", () => {
    const dates = expandRecurrenceDates(
      "2026-10-01T09:00:00",
      { freq: "DAILY", count: 3 },
      "2026-10-01",
      "2026-10-31",
    );
    expect(dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("UNTIL 截断（含当天）", () => {
    const dates = expandRecurrenceDates(
      "2026-10-01T09:00:00",
      { freq: "DAILY", until: "2026-10-03" },
      "2026-10-01",
      "2026-10-31",
    );
    expect(dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("每年：同一日期", () => {
    const dates = expandRecurrenceDates(
      "2026-03-15T09:00:00",
      { freq: "YEARLY" },
      "2026-01-01",
      "2029-01-01",
    );
    expect(dates).toEqual([
      "2026-03-15",
      "2027-03-15",
      "2028-03-15",
    ]);
  });

  it("跨闰年：2月29日只在闰年出现", () => {
    const dates = expandRecurrenceDates(
      "2028-02-29T09:00:00",
      { freq: "YEARLY" },
      "2028-01-01",
      "2031-01-01",
    );
    expect(dates).toEqual(["2028-02-29"]);
  });

  it("非法起始时间返回空", () => {
    const dates = expandRecurrenceDates(
      "不是时间",
      { freq: "DAILY" },
      "2026-10-01",
      "2026-10-05",
    );
    expect(dates).toEqual([]);
  });
});

describe("事件实例展开", () => {
  it("无重复规则时返回单个实例", () => {
    const r = expandEventInstances(
      "2026-10-20T14:00:00",
      "2026-10-20T15:30:00",
      undefined,
      "2026-10-01",
      "2026-10-31",
    );
    expect(r).toHaveLength(1);
    expect(r[0].start).toBe("2026-10-20T14:00:00");
    expect(r[0].end).toBe("2026-10-20T15:30:00");
  });

  it("有重复规则时按时长保持各实例", () => {
    const r = expandEventInstances(
      "2026-10-05T09:30:00",
      "2026-10-05T10:30:00",
      "FREQ=WEEKLY",
      "2026-10-01",
      "2026-10-31",
    );
    expect(r.length).toBeGreaterThanOrEqual(4);
    expect(r[0].start).toBe("2026-10-05T09:30:00");
    expect(r[0].end).toBe("2026-10-05T10:30:00");
    // 每个实例都保持 1 小时时长
    for (const inst of r) {
      const s = new Date(inst.start).getTime();
      const e = new Date(inst.end!).getTime();
      expect(e - s).toBe(3600000);
    }
  });

  it("每日重复展开到正确日期", () => {
    const r = expandEventInstances(
      "2026-10-01T09:00:00",
      undefined,
      "FREQ=DAILY",
      "2026-10-01",
      "2026-10-03",
    );
    expect(r.map((x) => x.instanceDate)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("展开结果不含时区偏移（保持本地时间）", () => {
    const r = expandEventInstances(
      "2026-10-01T09:00:00",
      undefined,
      "FREQ=DAILY",
      "2026-10-01",
      "2026-10-01",
    );
    expect(r[0].start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(r[0].start).not.toContain("Z");
  });
});
