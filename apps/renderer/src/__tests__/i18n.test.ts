/**
 * i18n 语言包一致性测试
 *
 * 关键：两个语言包的 key 必须**完全一致**。
 * 少一个 key → 界面会静默显示另一个语言或直接显示 key 字符串。
 */

import { describe, it, expect } from "vitest";
import { zhCN } from "../i18n/locales/zh-CN.js";
import { enUS } from "../i18n/locales/en-US.js";

function flatten(obj: any, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(key);
    else if (v && typeof v === "object") out.push(...flatten(v, key));
  }
  return out;
}

const zhKeys = flatten(zhCN).sort();
const enKeys = flatten(enUS).sort();

describe("语言包一致性", () => {
  it("两个语言包都有内容", () => {
    expect(zhKeys.length).toBeGreaterThan(50);
    expect(enKeys.length).toBeGreaterThan(50);
  });

  it("key 数量一致", () => {
    expect(enKeys.length).toBe(zhKeys.length);
  });

  it("zh-CN 没有 en-US 缺失的 key", () => {
    const missing = zhKeys.filter((k) => !enKeys.includes(k));
    expect(missing).toEqual([]);
  });

  it("en-US 没有 zh-CN 缺失的 key", () => {
    const missing = enKeys.filter((k) => !zhKeys.includes(k));
    expect(missing).toEqual([]);
  });

  it("没有空字符串", () => {
    const empties: string[] = [];
    const walk = (o: any, prefix = "") => {
      for (const [k, v] of Object.entries(o)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") {
          if (!v.trim()) empties.push(key);
        } else if (v && typeof v === "object") walk(v, key);
      }
    };
    walk(zhCN);
    walk(enUS);
    expect(empties).toEqual([]);
  });

  it("占位符在两个语言包中一致", () => {
    const placeholders = (s: string) =>
      (s.match(/\{(\w+)\}/g) || []).sort().join(",");

    const zhMap = new Map<string, string>();
    const walk = (o: any, prefix = "") => {
      for (const [k, v] of Object.entries(o)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") zhMap.set(key, placeholders(v));
        else if (v && typeof v === "object") walk(v, key);
      }
    };
    walk(zhCN);

    const enMap = new Map<string, string>();
    const walkEn = (o: any, prefix = "") => {
      for (const [k, v] of Object.entries(o)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") enMap.set(key, placeholders(v));
        else if (v && typeof v === "object") walkEn(v, key);
      }
    };
    walkEn(enUS);

    const mismatch: string[] = [];
    for (const [k, zhPh] of zhMap) {
      if (zhPh !== enMap.get(k)) mismatch.push(`${k}: zh=[${zhPh}] en=[${enMap.get(k)}]`);
    }
    expect(mismatch).toEqual([]);
  });
});
