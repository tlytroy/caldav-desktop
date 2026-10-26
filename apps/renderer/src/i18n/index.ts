/**
 * 轻量 i18n 框架
 *
 * 为什么自己写而不引 i18next：
 *  - 这个工具要跑在 Electron / Capacitor 里，依赖越少打包越小
 *  - 只需要字符串替换 + 复数/日期格式化，不需要复杂的 ICU 特性
 *  - 服务端（AI 提示词、错误信息）也要用同一套语言包，不能前后端各写一份
 *
 * 用法：
 *   const t = useI18n();
 *   t("settings.tabs.ai")            // 查 zh-CN，缺失则回退 en-US，再缺返回 key
 *   t("event.count", { n: 3 })       // 参数插值
 *
 * 语言包放在 src/locales/*.ts，服务端与前端共用（服务端用相对路径 import）。
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";

export type Locale = "zh-CN" | "en-US";

export type TranslationTree = typeof zhCN;

/** 合并后的语言包：key 路径 → 字符串 */
type Flat = Record<string, string>;

function flatten(obj: any, prefix = ""): Flat {
  const out: Flat = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object") Object.assign(out, flatten(v, key));
  }
  return out;
}

const DICTIONARIES: Record<Locale, Flat> = {
  "zh-CN": flatten(zhCN),
  "en-US": flatten(enUS),
};

export const AVAILABLE_LOCALES: Array<{ code: Locale; label: string }> = [
  { code: "zh-CN", label: "简体中文" },
  { code: "en-US", label: "English" },
];

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: "zh-CN",
      setLocale: (locale) => set({ locale }),
    }),
    { name: "i18n-storage" },
  ),
);

/** 翻译函数（可在 React 组件外使用） */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  let text = DICTIONARIES[locale]?.[key];
  // 回退到 en-US，再回退到 key 本身
  if (text === undefined) text = DICTIONARIES["en-US"][key];
  if (text === undefined) return key;

  if (params) {
    text = text.replace(/\{(\w+)\}/g, (m, name) => {
      const v = params[name];
      return v === undefined ? m : String(v);
    });
  }
  return text;
}

/** 按 locale 格式化日期 */
export function formatDate(
  locale: Locale,
  date: Date | string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(
    locale,
    opts || { year: "numeric", month: "2-digit", day: "2-digit" },
  ).format(d);
}

/** 按 locale 格式化时间 */
export function formatTime(
  locale: Locale,
  date: Date | string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(
    locale,
    opts || { hour: "2-digit", minute: "2-digit", hour12: false },
  ).format(d);
}

/** 按 locale 格式化日期时间 */
export function formatDateTime(
  locale: Locale,
  date: Date | string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(
    locale,
    opts || {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  ).format(d);
}

/** 相对时间描述（"3 天前" / "in 3 days"） */
export function formatRelative(locale: Locale, date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31536000000],
    ["month", 2592000000],
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(Math.round(diffMs / 1000), "second");
}

/** React hook：返回翻译函数与当前语言 */
export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  return {
    locale,
    setLocale,
    t: (key: string, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    formatDate: (d: Date | string, o?: Intl.DateTimeFormatOptions) =>
      formatDate(locale, d, o),
    formatTime: (d: Date | string, o?: Intl.DateTimeFormatOptions) =>
      formatTime(locale, d, o),
    formatDateTime: (d: Date | string, o?: Intl.DateTimeFormatOptions) =>
      formatDateTime(locale, d, o),
    formatRelative: (d: Date | string) => formatRelative(locale, d),
  };
}
