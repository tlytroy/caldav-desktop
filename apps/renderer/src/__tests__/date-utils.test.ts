import { describe, it, expect } from "vitest";
import {
  addDays,
  addHours,
  dateOnly,
  endOfLocalDay,
  isOverdue,
  localDate,
  parseLocalDateTime,
  timeOf,
  toLocalIso,
} from "../utils/date";

describe("本地日期工具", () => {
  it("纯日期按本地日历日解释（不是 UTC 午夜）", () => {
    const d = parseLocalDateTime("2026-11-02")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(2);
    expect(d.getHours()).toBe(0);
  });

  it("截止日当天不算逾期（东八区早上 8 点曾误判）", () => {
    const due = "2026-11-02";
    const end = endOfLocalDay(due).getTime();
    // 当天 23:00 → 不逾期
    expect(isOverdue(due, false, end - 60 * 60 * 1000)).toBe(false);
    // 当天结束之后 1 秒 → 逾期
    expect(isOverdue(due, false, end + 1000)).toBe(true);
  });

  it("done 的条目不参与逾期", () => {
    expect(isOverdue("2020-01-01", true)).toBe(false);
    expect(isOverdue(undefined)).toBe(false);
    expect(isOverdue("not-a-date")).toBe(false);
  });

  it("toLocalIso 不带 Z，且补零", () => {
    expect(toLocalIso(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "2026-01-02T03:04:05",
    );
  });

  it("addDays 跨月且保留时分", () => {
    const d = addDays(new Date(2026, 0, 31, 10, 0, 0), 1);
    expect(localDate(d)).toBe("2026-02-01");
    expect(d.getHours()).toBe(10);
  });

  it("addHours 跨年", () => {
    const d = addHours(new Date(2026, 11, 31, 23, 30), 1);
    expect(localDate(d)).toBe("2027-01-01");
    expect(d.getHours()).toBe(0);
  });

  it("dateOnly / timeOf 容错", () => {
    expect(dateOnly("2026-11-02T09:30:00")).toBe("2026-11-02");
    expect(dateOnly("bad")).toBeUndefined();
    expect(timeOf("2026-11-02T09:05:00")).toBe("09:05");
    expect(timeOf(undefined)).toBe("09:00");
  });
});
