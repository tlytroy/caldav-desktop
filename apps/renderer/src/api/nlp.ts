/**
 * 自然语言快速创建 API 客户端
 *
 * 数据流：输入文本 → POST /api/nlp/parse → 展示草稿预览 → 用户确认
 *        → POST /api/workspace/items（落盘到 workspace.md）
 *
 * 注意：解析端点**不写文件**，必须由用户确认后才创建，
 * 避免误识别直接污染唯一事实源。
 */

import { createApiClient } from "./client";

const api = createApiClient(40000);

/** 解析结果来源 */
export type ParseSource = "local" | "ai";

export interface ParsedDraft {
  title: string;
  /** ISO 本地时间字符串；null 表示未确定 */
  start: string | null;
  end: string | null;
  allDay: boolean;
  recurrence?: "daily" | "weekly" | "monthly" | "yearly";
  confidence: number;
  matchedFields: string[];
  raw: string;
  source: ParseSource;
  localDraft?: ParsedDraft | null;
  fallbackReason?: string;
}

export interface ParseResult {
  success: true;
  draft: ParsedDraft;
  source: ParseSource;
  fallbackReason?: string;
}

/** AI / 本地解析器 / 语音能力可用性 */
export interface NlpStatus {
  success: true;
  localParser: boolean;
  aiEnabled: boolean;
  aiModel: string | null;
  speechEnabled: boolean;
}

/** 查询解析能力。API Key 不会返回给前端，这里只暴露"配没配" */
export async function fetchNlpStatus(): Promise<NlpStatus> {
  const { data } = await api.get("/api/nlp/status");
  return data;
}

/**
 * 解析自然语言为事件草稿。
 *
 * @param text 用户输入
 * @param opts.forceAI 跳过本地规则直接问 AI（本地解析不出来时用户可手动触发）
 */
export async function parseNaturalLanguageText(
  text: string,
  opts?: { forceAI?: boolean },
): Promise<ParseResult> {
  const { data } = await api.post("/api/nlp/parse", {
    text,
    forceAI: opts?.forceAI,
  });
  return data;
}

/**
 * 语音转写（走后端 Whisper）。需要后端配置 AI。
 * @param audioBlob 录音数据
 */
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audioBlob, "audio.webm");
  const { data } = await api.post("/api/nlp/transcribe", form, {
    timeout: 120000, // Whisper 转写较慢
  });
  return data.text || "";
}

// ===== 展示辅助 =====

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 把解析结果格式化成人类可读的日期时间描述 */
export function formatDraftWhen(d: {
  start: string | null;
  end: string | null;
  allDay: boolean;
}): string {
  if (!d.start) return "未确定时间";
  const s = new Date(d.start);
  if (Number.isNaN(s.getTime())) return "时间无效";

  const dateStr = `${s.getMonth() + 1}月${s.getDate()}日 ${WEEKDAYS[s.getDay()]}`;
  if (d.allDay) return `${dateStr}（全天）`;

  const hh = String(s.getHours()).padStart(2, "0");
  const mm = String(s.getMinutes()).padStart(2, "0");
  let out = `${dateStr} ${hh}:${mm}`;

  if (d.end) {
    const e = new Date(d.end);
    if (!Number.isNaN(e.getTime()) && e.getTime() !== s.getTime()) {
      const eh = String(e.getHours()).padStart(2, "0");
      const em = String(e.getMinutes()).padStart(2, "0");
      out += ` – ${eh}:${em}`;
    }
  }
  return out;
}

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
  yearly: "每年",
};

/** 重复规则的中文标签 */
export function recurrenceLabel(r?: string): string {
  return r ? RECURRENCE_LABEL[r] || r : "";
}
