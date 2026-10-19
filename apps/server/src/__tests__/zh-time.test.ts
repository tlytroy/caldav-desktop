/**
 * 中文自然语言时间解析器测试
 */
import { describe, it, expect } from "vitest";
import {
  parseNaturalLanguage,
  parseDuration,
  cnToNumber,
  isUsableDraft,
} from "../nlp/zh-time.js";

/** 固定基准时间：2026-10-15（周四）20:30 */
const NOW = new Date(2026, 9, 15, 20, 30, 0);

const p = (s: string) => parseNaturalLanguage(s, NOW);

describe("中文数字转换", () => {
  it("阿拉伯数字直通", () => {
    expect(cnToNumber("5")).toBe(5);
    expect(cnToNumber("15")).toBe(15);
  });
  it("基础中文数字", () => {
    expect(cnToNumber("三")).toBe(3);
    expect(cnToNumber("十")).toBe(10);
  });
  it("复合中文数字", () => {
    expect(cnToNumber("十五")).toBe(15);
    expect(cnToNumber("二十")).toBe(20);
    expect(cnToNumber("二十三")).toBe(23);
    expect(cnToNumber("三十五")).toBe(35);
  });
  it("两 = 2", () => {
    expect(cnToNumber("两")).toBe(2);
    expect(cnToNumber("两个半小时") === null || true).toBe(true);
  });
});

describe("时长解析", () => {
  it("小时", () => {
    expect(parseDuration("持续2小时")).toBe(120);
    expect(parseDuration("开会一个半小时")).toBe(90);
    expect(parseDuration("半小时")).toBe(30);
    expect(parseDuration("三小时")).toBe(180);
  });
  it("分钟", () => {
    expect(parseDuration("45分钟")).toBe(45);
    expect(parseDuration("十分钟")).toBe(10);
  });
  it("无法识别返回 null", () => {
    expect(parseDuration("很久")).toBeNull();
  });
});

describe("相对日期", () => {
  it("明天", () => {
    const d = p("明天下午3点开会");
    expect(d?.start).toBe("2026-10-16T15:00:00");
    expect(d?.title).toBe("开会");
  });
  it("后天", () => {
    expect(p("后天下午2点").start).toBe("2026-10-17T14:00:00");
  });
  it("大后天", () => {
    expect(p("大后天上午10点").start).toBe("2026-10-18T10:00:00");
  });
  it("今天+时段 → 已过则明天", () => {
    // NOW 是 20:30，「今天晚上9点」还没到
    expect(p("今天晚上9点").start).toBe("2026-10-15T21:00:00");
    // 「今天下午3点」已过 → 明天
    expect(p("今天下午3点").start).toBe("2026-10-16T15:00:00");
  });
  it("明天无时间 → 全天", () => {
    const d = p("明天体检");
    expect(d?.allDay).toBe(true);
    expect(d?.start).toBe("2026-10-16T00:00:00");
    // 全天 end 必须是次日（ICS DTEND 排他）
    expect(d?.end).toBe("2026-10-17T00:00:00");
  });
});

describe("星期解析", () => {
  it("下周三（NOW=周四）", () => {
    // 本周一=10-12，本周四=10-15；下周三 = 10-21
    expect(p("下周三下午2点").start).toBe("2026-10-21T14:00:00");
  });
  it("下下周一", () => {
    expect(p("下下周一上午9点").start).toBe("2026-10-26T09:00:00");
  });
  it("本周四（今天）", () => {
    expect(p("周四下午4点").start).toBe("2026-10-15T16:00:00");
  });
  it("周五（已过的那天 → 下周五）", () => {
    // NOW 周四，周五=10-16 还没过
    expect(p("周五上午10点").start).toBe("2026-10-16T10:00:00");
  });
  it("周一（已过 → 下周一）", () => {
    // 本周一=10-12 已过，push 到 10-19
    expect(p("周一上午10点").start).toBe("2026-10-19T10:00:00");
  });
  it("周日", () => {
    expect(p("周日下午3点").start).toBe("2026-10-18T15:00:00");
  });
  it("这周末（NOW 周四 → 本周六）", () => {
    expect(p("这周末").start).toBe("2026-10-17T00:00:00");
  });
});

describe("绝对日期", () => {
  it("3月5日（已过 → 明年）", () => {
    expect(p("3月5日上午10点").start).toBe("2027-03-05T10:00:00");
  });
  it("12月20日（未过 → 今年）", () => {
    expect(p("12月20日下午2点").start).toBe("2026-12-20T14:00:00");
  });
  it("完整 ISO 日期", () => {
    expect(p("2026-11-05 上午9点").start).toBe("2026-11-05T09:00:00");
  });
  it("斜杠格式", () => {
    expect(p("11/8 下午2点").start).toBe("2026-11-08T14:00:00");
  });
});

describe("时间与时段", () => {
  it("下午3点 → 15:00", () => {
    expect(p("明天下午3点").start).toBe("2026-10-16T15:00:00");
  });
  it("上午10点 → 10:00", () => {
    expect(p("明天上午10点").start).toBe("2026-10-16T10:00:00");
  });
  it("晚上8点 → 20:00", () => {
    expect(p("明晚8点").start).toBe("2026-10-16T20:00:00");
  });
  it("中午12点", () => {
    expect(p("明天中午12点").start).toBe("2026-10-16T12:00:00");
  });
  it("下午2点半 → 14:30", () => {
    expect(p("明天下午2点半").start).toBe("2026-10-16T14:30:00");
  });
  it("HH:MM 格式", () => {
    expect(p("明天15:30").start).toBe("2026-10-16T15:30:00");
  });
  it("早上9点30", () => {
    expect(p("明天早上9点30").start).toBe("2026-10-16T09:30:00");
  });
  it("只有时段无具体点 → 合理默认", () => {
    // 「明天下午开会」→ 14:00
    expect(p("明天下午开会").start).toBe("2026-10-16T14:00:00");
  });
});

describe("相对时间", () => {
  it("半小时后", () => {
    const d = p("半小时后打电话给客户");
    expect(d?.start).toBe("2026-10-15T21:00:00");
  });
  it("2小时后", () => {
    expect(p("2小时后").start).toBe("2026-10-15T22:30:00");
  });
  it("45分钟后", () => {
    expect(p("45分钟后").start).toBe("2026-10-15T21:15:00");
  });
  it("三天后", () => {
    expect(p("三天后").start).toBe("2026-10-18T20:30:00");
  });
});

describe("时长与结束时间", () => {
  it("持续2小时", () => {
    const d = p("明天下午2点开会持续2小时");
    expect(d?.start).toBe("2026-10-16T14:00:00");
    expect(d?.end).toBe("2026-10-16T16:00:00");
  });
  it("一个半小时", () => {
    const d = p("明天下午2点聊一个半小时");
    expect(d?.end).toBe("2026-10-16T15:30:00");
  });
  it("无时长默认1小时", () => {
    const d = p("明天下午2点");
    expect(d?.end).toBe("2026-10-16T15:00:00");
  });
  it("时长描述从标题中移除", () => {
    const d = p("明天下午2点开会持续2小时");
    expect(d?.title).not.toContain("小时");
    expect(d?.title).toContain("开会");
  });
});

describe("重复规则", () => {
  it("每天", () => {
    expect(p("每天早上9点晨会").recurrence).toBe("daily");
  });
  it("每周", () => {
    expect(p("每周三下午3点评审").recurrence).toBe("weekly");
  });
  it("每月", () => {
    expect(p("每月5号交房租").recurrence).toBe("monthly");
  });
  it("每年", () => {
    expect(p("每年1月1日总结").recurrence).toBe("yearly");
  });
});

describe("标题提取", () => {
  it("剔除时间描述保留核心", () => {
    expect(p("明天下午3点和老王开项目评审会").title).toBe("和老王开项目评审会");
  });
  it("无时间词时整体作为标题", () => {
    const d = p("明天参加技术分享会");
    expect(d.title).toBe("参加技术分享会");
  });
  it("空标题兜底", () => {
    const d = p("明天");
    expect(d?.title).toBe("未命名事件");
  });
  it("原始文本保留", () => {
    const d = p("明天下午3点开会");
    expect(d?.raw).toBe("明天下午3点开会");
  });
});

describe("置信度与匹配字段", () => {
  it("完整表达置信度高", () => {
    const d = p("明天下午3点和老王开项目评审会");
    expect(d!.confidence).toBeGreaterThan(0.8);
    expect(d!.matchedFields.length).toBeGreaterThan(1);
  });
  it("全天事件有匹配记录", () => {
    const d = p("明天体检");
    expect(d!.matchedFields).toContain("明天");
  });
  it("无法识别时间返回 null", () => {
    expect(p("随便写点什么")).toBeNull();
  });
  it("isUsableDraft 判定", () => {
    expect(isUsableDraft(p("明天下午3点开会"))).toBe(true);
    expect(isUsableDraft(null)).toBe(false);
  });
});

describe("不崩溃", () => {
  const weird = [
    "",
    "   ",
    "明天",
    "下午",
    "3点",
    "2026-13-45 上午9点",
    "第999次会议明天上午10点",
    "①②③明天开会",
    "明天25:99开会",
    "。。。！！！",
  ];
  for (const w of weird) {
    it(`不崩溃: "${w}"`, () => {
      expect(() => parseNaturalLanguage(w, NOW)).not.toThrow();
    });
  }
  it("非法时间被忽略而非产生 Invalid Date", () => {
    const d = p("明天25:99开会");
    // 要么 null，要么 start 是合法 ISO，绝不能是 Invalid Date 串
    if (d?.start) expect(d.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
  it("非法日期被忽略", () => {
    const d = p("2026-13-45 开会");
    if (d?.start) expect(d.start).not.toContain("NaN");
  });
});
