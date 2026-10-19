/**
 * 中文自然语言时间解析器
 *
 * 为什么需要它（而不是直接调 AI）：
 *   1. **延迟**：AI 每次输入都要等网络往返（数百 ms ~ 数秒），而"快速创建"
 *      的核心体验就是敲完即成。
 *   2. **可用性**：断网 / AI 服务挂了时，本工具的快速创建必须仍然能用 ——
 *      md 是本地唯一事实源，不该被网络依赖绑住。
 *   3. **正确性**：AI 会「自信地」编造日期（如把「下周三」算错），
 *      而错误日期比"没识别出来"危险得多 —— 用户会以为已经建好了。
 *
 * 策略：本地规则做快速路径与兜底，AI 只在本地解析失败或用户显式请求时才介入。
 *
 * 覆盖范围（中文日历场景的高频表达）：
 *   - 相对日：今天 / 明天 / 后天 / 大后天 / 昨天
 *   - 星期：下周三 / 本周五 / 这周日 / 下下周一 / 周三
 *   - 农历式口语：下个月初 / 这周末 / 下周末 / 月底
 *   - 绝对日期：3月5日 / 3/5 / 2026-03-05 / 3月5号
 *   - 时间：下午3点 / 上午10点半 / 晚上8点 / 15:30 / 3点 / 9点30
 *   - 时段：早上 / 上午 / 中午 / 下午 / 晚上 / 凌晨
 *   - 相对时间：半小时后 / 2小时后 / 10分钟后 / 三天后
 *   - 时长与推算：持续2小时 / 1个半小时
 *   - 重复：每天 / 每周一 / 每月5号 / 工作日
 *
 * @see REF/NATURAL_LANGUAGE.md 设计说明
 */

/** 解析出的事件草稿 */
export interface ParsedDraft {
  /** 事件标题（已剔除时间描述） */
  title: string;
  /** 开始时间 ISO 字符串；仅识别到日期无具体时间时为 null（=全天） */
  start: string | null;
  /** 结束时间 ISO；未指定时由 duration 推导或按全天处理 */
  end: string | null;
  allDay: boolean;
  /** 重复规则（RRULE 风格），本地仅识别简单周期 */
  recurrence?: "daily" | "weekly" | "monthly" | "yearly";
  /** 解析置信度 0~1；低值时前端应提示用户确认 */
  confidence: number;
  /** 识别到的字段列表，用于前端展示"我理解对了吗" */
  matchedFields: string[];
  /** 供 AI 通道参考的原始文本 */
  raw: string;
}

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 中文数字转阿拉伯数字（支持 1~99，覆盖「十」「十五」「二十三」） */
export function cnToNumber(s: string): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0;
  let current = 0;
  let seenAny = false;
  for (const ch of s) {
    const v = CN_NUM[ch];
    if (v === undefined) return null;
    seenAny = true;
    if (v === 10) {
      // 「十」=10，「二十三」= 23
      current = current === 0 ? 10 : current * 10;
      total += current;
      current = 0;
    } else {
      current = v;
    }
  }
  return seenAny ? total + current : null;
}

const WEEKDAY_MAP: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
};

/**
 * 把「周日=0」的星期序号转成「周一开头」的偏移量。
 *
 * 常见错误：直接用 WEEKDAY_MAP 的值去 `addDays(mondayFirst, value)`，
 * 会整体错位一天（周日=0 被当成周一）。必须做基准转换：
 *   周一=0, 周二=1, ..., 周六=5, 周日=6
 */
function weekdayToMondayFirstOffset(weekday: number): number {
  return weekday === 0 ? 6 : weekday - 1;
}

/** 基准时间：允许注入，便于测试 */
function base(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** ISO 周一为一周之首 */
function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = (r.getDay() + 6) % 7; // 周一=0
  return addDays(r, -day);
}

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}:00`;
}

interface TimeHit {
  hour: number;
  minute: number;
  /** 是否显式说了「点/时」；未说则可能是「下午」这种模糊时段 */
  explicit: boolean;
}

/** 时段词 → 默认小时（用于「下午开会」这种没写具体点的情况） */
const PERIOD_HOUR: Record<string, number> = {
  凌晨: 3, 早上: 8, 早晨: 8, 清晨: 7, 上午: 10, 中午: 12,
  午后: 14, 下午: 14, 傍晚: 18, 晚上: 19, 晚: 19, 夜里: 21, 半夜: 23,
};

/**
 * 解析中文时长：2小时 / 半小时 / 1个半小时 / 45分钟
 * @returns 分钟数；无法识别返回 null
 */
export function parseDuration(text: string): number | null {
  // 「一个半小时」「1个半小时」都表示 90 分钟
  let m = text.match(/(\d+|[一二两三四五六七八九十]+)\s*个?\s*半\s*小时/);
  if (m) {
    const n = cnToNumber(m[1]);
    return n === null ? 30 : n * 60 + 30;
  }
  // 「半小时」= 30 分钟
  if (/半\s*小时/.test(text)) return 30;
  m = text.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:个)?\s*小时/);
  if (m) {
    const n = cnToNumber(m[1]);
    return n === null ? null : n * 60;
  }
  m = text.match(/(\d+|[一二两三四五六七八九十]+)\s*分钟/);
  if (m) {
    const n = cnToNumber(m[1]);
    return n === null ? null : n;
  }
  return null;
}

/** 识别重复规则，返回 { rule, matched } */
function detectRecurrence(
  text: string,
): { rule?: ParsedDraft["recurrence"]; matched: string } {  if (/每个?工作日|每周一?[二三四五六五]?.*上班|工作日每天/.test(text)) {
    return { rule: "weekly", matched: "工作日" };
  }
  if (/每个?周末|每周末/.test(text)) {
    return { rule: "weekly", matched: "每周末" };
  }
  if (/每天|每日|天天/.test(text)) {
    return { rule: "daily", matched: "每天" };
  }
  if (/每(?:周|星期)/.test(text)) {
    return { rule: "weekly", matched: "每周" };
  }
  if (/每个?月/.test(text)) {
    return { rule: "monthly", matched: "每月" };
  }
  if (/每年/.test(text)) {
    return { rule: "yearly", matched: "每年" };
  }
  return { matched: "" };
}

/**
 * 解析自然语言为事件草稿。
 *
 * @param input 用户原文，如「明天下午3点和老王开项目评审会」
 * @param now 基准时间，默认当前时间（测试可注入）
 */
export function parseNaturalLanguage(
  input: string,
  now: Date = new Date(),
): ParsedDraft | null {
  const text = input.trim();
  if (!text) return null;

  const matchedFields: string[] = [];
  let titleSource = text;
  let date: Date | null = null;
  let time: TimeHit | null = null;
  let hadDateWord = false;
  let hadPeriod = false;

  // ---------- 1. 相对时间：X分钟后 / X小时后 / X天后 ----------
  // 注意「半小时后」没有数字前缀，必须把「半」单独作为一种数词处理
  const relMatch = text.match(
    /(\d+|[一二两三四五六七八九十]+|半)\s*(分钟|小时|天)后/,
  );
  if (relMatch) {
    const n = relMatch[1] === "半" ? 0.5 : cnToNumber(relMatch[1]);
    if (n !== null) {
      const t = new Date(now);
      const unit = relMatch[2];
      // 注意：0.5 小时不能用 setHours(now.getHours() + 0.5) ——
      // Date.setHours 对小数会截断（20.5 → 20），必须换算成分钟
      if (unit === "分钟") t.setMinutes(t.getMinutes() + n);
      else if (unit === "小时") t.setMinutes(t.getMinutes() + n * 60);
      else t.setDate(t.getDate() + n);
      // 相对时间自带日期与时间，不需要再往下匹配日期词
      date = base(t);
      time = { hour: t.getHours(), minute: t.getMinutes(), explicit: true };
      hadDateWord = true;
      matchedFields.push(`相对时间：${relMatch[0]}`);
      titleSource = titleSource.replace(relMatch[0], "");
    }
  }

  // ---------- 2. 相对日期 ----------
  if (!date) {
    const relDays: Array<[RegExp, number, string]> = [
      [/大后天/, 3, "大后天"],
      [/后天/, 2, "后天"],
      [/明天|明日|次日/, 1, "明天"],
      [/今天|今日|今晚|今早|今儿/, 0, "今天"],
      [/昨天|昨日/, -1, "昨天"],
    ];
    for (const [re, offset, label] of relDays) {
      if (re.test(text)) {
        date = addDays(base(now), offset);
        hadDateWord = true;
        matchedFields.push(label);
        titleSource = titleSource.replace(re, "");
        break;
      }
    }
  }

  // ---------- 3. 星期：下周三 / 本周五 / 周日 ----------
  if (!date && !hadDateWord) {
    const weekMatch = text.match(
      /(下下|下|本|这|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/,
    );
    if (weekMatch) {
      const prefix = weekMatch[1] || "本";
      const weekday = WEEKDAY_MAP[weekMatch[2]];
      const offsetInWeek = weekdayToMondayFirstOffset(weekday);
      const weekStart = startOfWeek(base(now));
      let offsetWeeks = 0;
      if (prefix === "下") offsetWeeks = 1;
      else if (prefix === "下下") offsetWeeks = 2;
      else if (prefix === "上") offsetWeeks = -1;

      let d = addDays(weekStart, offsetInWeek + offsetWeeks * 7);

      // 「本周三」而今天已是周四 → 中文习惯指下周三
      if (prefix === "本" || prefix === "这") {
        const todayOffset = (now.getDay() + 6) % 7;
        if (offsetInWeek < todayOffset) d = addDays(d, 7);
      }
      date = d;
      hadDateWord = true;
      matchedFields.push(weekMatch[0].trim());
      titleSource = titleSource.replace(weekMatch[0], "");
    }
  }

  // ---------- 4. 这周末 / 下周末 ----------
  if (!date) {
    const weekendMatch = text.match(/(这|本|下|下个)?\s*周末/);
    if (weekendMatch) {
      const prefix = weekendMatch[1] || "这";
      const weekStart = startOfWeek(base(now));
      // 周六在「周一开头」的周里是 index 5
      let d = addDays(weekStart, 5);
      if (prefix === "下" || prefix === "下个") {
        d = addDays(d, 7);
      } else {
        const todayOffset = (now.getDay() + 6) % 7;
        if (todayOffset > 5) d = addDays(d, 7); // 已过周末则指下个
      }
      date = d;
      hadDateWord = true;
      matchedFields.push(weekendMatch[0].trim());
      titleSource = titleSource.replace(weekendMatch[0], "");
    }
  }

  // ---------- 5. 月底 / 下个月初 ----------
  if (!date) {
    const monthEdge = text.match(/(这个?月|下个?月)(初|底|中旬|中)/);
    if (monthEdge) {
      const isNext = monthEdge[1].includes("下");
      const pos = monthEdge[2];
      const d = new Date(base(now));
      d.setMonth(d.getMonth() + (isNext ? 1 : 0));
      if (pos === "初") d.setDate(1);
      else if (pos === "中旬") d.setDate(15);
      else {
        // 月底 = 该月最后一天
        d.setMonth(d.getMonth() + 1, 0);
      }
      date = d;
      hadDateWord = true;
      matchedFields.push(monthEdge[0]);
      titleSource = titleSource.replace(monthEdge[0], "");
    }
  }

  // ---------- 6. 绝对日期：3月5日 / 3/5 / 2026-03-05 ----------
  if (!date) {
    // 每月/每月5号 —— 「N号」表示每月第 N 天
    const monthlyDay = text.match(/每\s*个?月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/);
    if (monthlyDay) {
      const day = cnToNumber(monthlyDay[1]);
      if (day !== null && day >= 1 && day <= 31) {
        date = new Date(base(now));
        date.setDate(day);
        if (date.getTime() < base(now).getTime()) date.setMonth(date.getMonth() + 1);
        hadDateWord = true;
        matchedFields.push(monthlyDay[0]);
        titleSource = titleSource.replace(monthlyDay[0], "");
      }
    }
  }

  if (!date) {
    // 每年M月D号 —— 「每年1月1日」属于重复+日期，日期按最近一次处理
    const yearlyDate = text.match(/每年\s*(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2})\s*[日号]?/);
    if (yearlyDate) {
      const mo = cnToNumber(yearlyDate[1]);
      const dd = cnToNumber(yearlyDate[2]);
      if (mo !== null && dd !== null && mo >= 1 && mo <= 12) {
        date = new Date(base(now));
        date.setMonth(mo - 1, dd);
        if (date.getTime() < base(now).getTime()) {
          date.setFullYear(date.getFullYear() + 1);
        }
        hadDateWord = true;
        matchedFields.push(yearlyDate[0]);
        titleSource = titleSource.replace(yearlyDate[0], "");
      }
    }
  }

  if (!date) {
    // 2026-03-05 或 2026/3/5
    let m = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/);
    if (m) {
      date = new Date(base(now));
      date.setFullYear(+m[1], +m[2] - 1, +m[3]);
      hadDateWord = true;
      matchedFields.push(m[0]);
      titleSource = titleSource.replace(m[0], "");
    } else {
      // 3月5日 / 3月5号 / 3/5 / 3-5
      m = text.match(/(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*[日号]?/);
      if (m) {
        date = new Date(base(now));
        date.setMonth(+m[1] - 1, +m[2]);
        // 若推算出的日期已过去（如 1月5日 而现在是 6月），认为是明年
        if (date.getTime() < base(now).getTime() - 86400000) {
          date.setFullYear(date.getFullYear() + 1);
        }
        hadDateWord = true;
        matchedFields.push(m[0]);
        titleSource = titleSource.replace(m[0], "");
      } else {
        // 仅月份：3月 / 三月
        m = text.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*月(?![\d一二三四五六七八九十])/);
        if (m) {
          const mo = cnToNumber(m[1]);
          if (mo !== null && mo >= 1 && mo <= 12) {
            date = new Date(base(now));
            const today = date.getDate();
            date.setMonth(mo - 1, today);
            if (date.getTime() < base(now).getTime()) {
              date.setFullYear(date.getFullYear() + 1);
            }
            hadDateWord = true;
            matchedFields.push(`${m[1]}月`);
            titleSource = titleSource.replace(m[0], "");
          }
        }
      }
    }
  }

  // ---------- 7. 时间：下午3点 / 15:30 / 3点半 ----------
  if (!time) {
    // 时段词
    for (const [word, hour] of Object.entries(PERIOD_HOUR)) {
      if (text.includes(word)) {
        time = { hour, minute: 0, explicit: false };
        hadPeriod = true;
        matchedFields.push(word);
        titleSource = titleSource.replace(word, "");
        break;
      }
    }

    // HH:MM
    const colonMatch = text.match(/\b(\d{1,2}):(\d{2})\b/);
    // N点 / N点半 / N点M
    const hourMatch = text.match(
      /(\d{1,2}|[一二两三四五六七八九十]+)\s*[点时]\s*(半|(\d{1,2})\s*分?)?/,
    );

    if (colonMatch) {
      const h = +colonMatch[1];
      const mi = +colonMatch[2];
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
        time = { hour: h, minute: mi, explicit: true };
        matchedFields.push(colonMatch[0]);
        titleSource = titleSource.replace(colonMatch[0], "");
      }
    } else if (hourMatch) {
      const h = cnToNumber(hourMatch[1]);
      if (h !== null && h >= 0 && h <= 24) {
        let mi = 0;
        if (hourMatch[2] === "半") mi = 30;
        else if (hourMatch[3]) mi = +hourMatch[3];

        let finalHour = h % 24;
        // 时段词修正：「下午3点」→ 15:00；「晚上8点」→ 20:00
        if (hadPeriod && !hourMatch[1].match(/\d/)) {
          // 中文数字 + 时段
          finalHour = h;
        }
        if (hadPeriod) {
          const period = matchedFields.find((f) => f in PERIOD_HOUR);
          const ph = period ? PERIOD_HOUR[period] : 10;
          if (ph >= 12 && finalHour < 12) finalHour += 12;
          else if (ph === 0 && finalHour === 12) finalHour = 0;
        }

        time = { hour: finalHour, minute: mi, explicit: true };
        matchedFields.push(hourMatch[0].trim());
        titleSource = titleSource.replace(hourMatch[0], "");
      }
    }
  }

  // ---------- 8. 时长 → 推导结束时间 ----------
  const durationMin = parseDuration(text);
  if (durationMin) {
    matchedFields.push(`时长 ${durationMin} 分钟`);
    // 从 title 中移除时长描述
    titleSource = titleSource
      .replace(/(\d+|[一二两三四五六七八九十]+)\s*个?\s*半?\s*小时(半)?(钟)?/g, "")
      .replace(/(\d+|[一二两三四五六七八九十]+)\s*分钟/g, "");
  }

  // ---------- 9. 重复规则 ----------
  const rec = detectRecurrence(text);
  if (rec.rule) {
    matchedFields.push(`重复：${rec.matched}`);
    titleSource = titleSource.replace(rec.matched, "");
  }

  // ---------- 10. 整理标题 ----------
  // 只清理分隔用的标点。
  // 注意：「和 / 跟 / 与」在中文标题里常是正常用词（「和老王开会」），
  // 不能剥掉 —— 只在句首/句尾且明显是连接词时才去掉。
  const title = titleSource
    .replace(/^[，,。、\s]*/, "")
    .replace(/[，,、\s]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // ---------- 11. 组装结果 ----------
  if (!date && !time) {
    // 完全没识别出时间信息 —— 返回 null 让调用方决定走 AI 还是让用户补填
    return null;
  }

  // 「明天/下周三」等相对日期说清是哪天，即使没写时刻也算全天；
  // 但「今天」本身不是完整日期，没写时刻时应视为"今天待定时间"而非全天。
  const isExplicitDate =
    hadDateWord && !/^(今天|今日|今晚|今早|今儿)$/.test(matchedFields[0] || "");
  const allDay = !time && isExplicitDate;

  let start: string | null = null;
  let end: string | null = null;

  if (allDay && date) {
    start = isoOf(date);
    // 全天事件 end 为次日 00:00（ICS DTEND 排他）
    end = isoOf(addDays(date, 1));
  } else if (date && time) {
    const s = new Date(date);
    s.setHours(time.hour, time.minute, 0, 0);
    // 「今天下午3点」而此刻已 20:30 → 中文口语里通常指已经过去的那天，
    // 但建到过去没有意义，顺延到明天更符合"我要建个日程"的意图
    if (
      matchedFields[0] &&
      /^(今天|今日|今晚|今早|今儿)$/.test(matchedFields[0]) &&
      s.getTime() < now.getTime()
    ) {
      s.setDate(s.getDate() + 1);
      matchedFields.push("（该时间已过，顺延至明天）");
    }
    start = isoOf(s);
    const e = new Date(s);
    e.setMinutes(e.getMinutes() + (durationMin || 60));
    end = isoOf(e);
  } else if (time) {
    // 只有时间没有日期：默认今天（若已过则明天）
    const s = new Date(base(now));
    s.setHours(time.hour, time.minute, 0, 0);
    if (s.getTime() < now.getTime()) s.setDate(s.getDate() + 1);
    start = isoOf(s);
    const e = new Date(s);
    e.setMinutes(e.getMinutes() + (durationMin || 60));
    end = isoOf(e);
  } else if (date) {
    start = isoOf(date);
    end = isoOf(addDays(date, 1));
  }

  // 置信度：识别到的字段越多越高
  let confidence = 0.3;
  if (hadDateWord) confidence += 0.3;
  if (time) confidence += 0.25;
  if (time?.explicit) confidence += 0.1;
  if (durationMin) confidence += 0.05;
  confidence = Math.min(confidence, 1);

  return {
    title: title || "未命名事件",
    start,
    end,
    allDay,
    recurrence: rec.rule,
    confidence,
    matchedFields,
    raw: text,
  };
}

/**
 * 从标题中剥离时间描述后是否还有有效内容。
 * 用于判断「AI 解析结果」是否可用。
 */
export function isUsableDraft(d: ParsedDraft | null): boolean {
  return !!d && !!d.start && d.title.length > 0;
}
