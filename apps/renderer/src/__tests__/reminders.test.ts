import { describe, it, expect } from "vitest";
import type { WorkbenchItem } from "../api/workspace";
import {
  collectDueReminders,
  computeRemindAt,
  describeRemind,
  presetMinutesOf,
  presetValueOf,
  reminderBase,
  reminderKey,
  upcomingReminders,
} from "../utils/reminders";

function item(overrides: Partial<WorkbenchItem> = {}): WorkbenchItem {
  return {
    id: "aaaa1111",
    kind: "task",
    title: "提醒我",
    start: "2026-11-02T10:00:00",
    remind: "2026-11-02T09:30:00",
    done: false,
    ...overrides,
  };
}

/** 本地时间 → 时间戳 */
function ts(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return new Date(y, mo - 1, d, h, mi, 0).getTime();
}

describe("提醒时间换算", () => {
  it("定时条目以 start 为基准；全天 / 只有截止日按当天 09:00", () => {
    expect(reminderBase({ start: "2026-11-02T10:00:00" })!.getHours()).toBe(10);
    expect(
      reminderBase({ start: "2026-11-02T00:00:00", allDay: true })!.getHours(),
    ).toBe(9);
    expect(reminderBase({ due: "2026-11-02" })!.getHours()).toBe(9);
    expect(reminderBase({})).toBeNull();
  });

  it("提前 30 分钟 = 基准 - 30 分钟", () => {
    const base = new Date(2026, 10, 2, 10, 0, 0);
    expect(computeRemindAt(base, 30)).toBe("2026-11-02T09:30:00");
    expect(computeRemindAt(base, 0)).toBe("2026-11-02T10:00:00");
    expect(computeRemindAt(base, 1440)).toBe("2026-11-01T10:00:00");
  });

  it("已有 remind 能映射回预设；不匹配则 custom", () => {
    const base = new Date(2026, 10, 2, 10, 0, 0);
    expect(presetMinutesOf("2026-11-02T09:30:00", base)).toBe(30);
    expect(presetValueOf("2026-11-02T09:30:00", base)).toBe("30");
    expect(presetValueOf("2026-11-02T09:37:00", base)).toBe("custom");
    expect(presetValueOf(undefined, base)).toBe("none");
  });

  it("提醒时刻文案", () => {
    expect(describeRemind("2026-11-02T09:30:00")).toBe("2026-11-02 09:30");
    expect(describeRemind(undefined)).toBe("不提醒");
  });
});

describe("到点提醒筛选", () => {
  const now = ts(2026, 11, 2, 9, 31);

  it("已到点且在 24 小时内 → 弹出，并算出迟到分钟", () => {
    const hits = collectDueReminders([item()], { now });
    expect(hits).toHaveLength(1);
    expect(hits[0].lateMinutes).toBe(1);
    expect(hits[0].key).toBe(reminderKey(item())!);
  });

  it("还没到点 → 不弹", () => {
    expect(
      collectDueReminders([item({ remind: "2026-11-02T09:45:00" })], { now }),
    ).toHaveLength(0);
  });

  it("过期超过 24 小时 → 不弹（应用关太久不轰炸）", () => {
    const hits = collectDueReminders(
      [item({ remind: "2026-10-31T09:00:00" })],
      { now },
    );
    expect(hits).toHaveLength(0);
  });

  it("已完成 / 已取消 → 不弹", () => {
    expect(
      collectDueReminders([item({ done: true })], { now }),
    ).toHaveLength(0);
    expect(
      collectDueReminders([item({ status: "cancelled" })], { now }),
    ).toHaveLength(0);
  });

  it("已提醒过（fired）→ 不重复弹", () => {
    const key = reminderKey(item())!;
    expect(
      collectDueReminders([item()], { now, fired: new Set([key]) }),
    ).toHaveLength(0);
  });

  it("稍后提醒未到期 → 不弹；到期后 → 再弹", () => {
    const key = reminderKey(item())!;
    expect(
      collectDueReminders([item()], {
        now,
        snoozed: { [key]: now + 60_000 },
      }),
    ).toHaveLength(0);
    expect(
      collectDueReminders([item()], {
        now,
        snoozed: { [key]: now - 1000 },
      }),
    ).toHaveLength(1);
  });

  it("多条按提醒时间升序", () => {
    const a = item({ id: "aaa11111", remind: "2026-11-02T09:20:00" });
    const b = item({ id: "bbb22222", remind: "2026-11-02T09:30:00" });
    const hits = collectDueReminders([b, a], { now });
    expect(hits.map((h) => h.item.id)).toEqual(["aaa11111", "bbb22222"]);
  });
});

describe("即将到来的提醒", () => {
  const now = ts(2026, 11, 2, 9, 0);

  it("只列未来、未完成、未取消的，按时间排序", () => {
    const list = upcomingReminders(
      [
        item({ id: "aaa11111", remind: "2026-11-02T09:30:00" }),
        item({ id: "bbb22222", remind: "2026-11-02T10:30:00" }),
        item({ id: "ccc33333", remind: "2026-11-02T08:00:00" }), // 过去
        item({ id: "ddd44444", remind: "2026-11-02T11:00:00", done: true }),
      ],
      now,
    );
    expect(list.map((x) => x.item.id)).toEqual(["aaa11111", "bbb22222"]);
  });
});
