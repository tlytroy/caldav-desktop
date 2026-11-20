/**
 * AI 解析服务（OpenAI 兼容接口）
 *
 * 定位：**增强通道**，不是主通道。
 *
 * 为什么不让 AI 直接负责解析：
 *   本地中文规则解析已能覆盖「明天下午3点开会」这类高频表达，且是毫秒级、
 *   断网可用、结果确定。AI 只在本地解析失败或用户显式请求时介入，
 *   处理规则难以覆盖的长句，例如：
 *     「下周三下午跟老王在静安那边聊下季度的事，顺便把材料准备一下」
 *
 * 安全：API Key 只存在于服务端 .env / 环境变量，**绝不返回给前端**。
 * 前端只知道「配没配」。
 *
 * 兼容策略：
 *   - 优先尝试 function calling / tool use（结构最可靠）
 *   - 回退到 JSON mode（response_format: json_object）
 *   - 都不支持时回退到「让模型直接输出 JSON 文本」再自行提取
 */

import {
  parseNaturalLanguage,
  isUsableDraft,
  type ParsedDraft,
} from "./zh-time.js";
import { getConfig, getSecret } from "../config.js";

export interface AIConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** 温度；事件抽取任务用低温度更稳定 */
  temperature: number;
}

/**
 * 读取 AI 配置。
 *
 * 数据来源优先级：config.json（界面写入）> 环境变量 / .env > 默认值。
 * 详见 config.ts 的说明。
 */
export function loadAIConfig(): AIConfig {
  const cfg = getConfig();
  return {
    enabled: cfg.ai.enabled || (!!cfg.ai.baseUrl && !!cfg.ai.apiKey),
    baseUrl: (cfg.ai.baseUrl || "").replace(/\/+$/, ""),
    apiKey: cfg.ai.apiKey || getSecret("ai.apiKey"),
    model: cfg.ai.model || "gpt-4o-mini",
    timeoutMs: cfg.ai.timeoutMs || 30000,
    temperature: typeof cfg.ai.temperature === "number" ? cfg.ai.temperature : 0.1,
  };
}

export function isAIConfigured(cfg: AIConfig): boolean {
  return cfg.enabled && !!cfg.baseUrl && !!cfg.apiKey;
}

/** 解析结果（含来源，便于前端展示"这是 AI 理解的还是规则理解的"） */
export interface ParseOutcome extends ParsedDraft {
  /** 最终采用的解析来源 */
  source: "local" | "ai";
  /** 本地解析结果（若成功且未使用 AI） */
  localDraft?: ParsedDraft | null;
  /** 降级原因（AI 失败时说明原因） */
  fallbackReason?: string;
}

const SYSTEM_PROMPT = `你是一个日历事件解析器。用户输入中文口语，你要提取成结构化事件。

严格要求：
1. 只输出 JSON，不要任何解释文字、不要 markdown 代码块。
2. 字段说明：
   - title: 事件标题，去掉时间描述和相关连接词（如"明天下午3点和老王开会" → "和老王开会"）
   - date: ISO 8601 本地时间字符串，格式 "YYYY-MM-DDTHH:mm:ss"。无具体时间则用该日 00:00:00
   - end: ISO 8601 结束时间；用户说了时长就按时长算，否则默认开始后 1 小时
   - allDay: true 表示全天事件（用户只说了日期没说时间）
   - category: 分类建议，从这些里选一个：工作/个人/家庭/健康/其他
   - tags: 字符串数组，最多 3 个
   - description: 补充说明，可为空字符串
3. 关于日期计算，必须以当前时间为基准。相对日期（明天/下周三）要换算成绝对日期。
4. 如果用户说的内容完全不包含日程信息（只是闲聊或纯任务描述），返回 {"isEvent": false}。
5. 不确定的字段用你的最佳判断，不要留空导致用户困惑。`;

const FUNCTION_SCHEMA = {
  name: "create_calendar_event",
  description: "创建一个日历事件",
  parameters: {
    type: "object",
    properties: {
      isEvent: { type: "boolean", description: "是否确实是一个日历事件" },
      title: { type: "string", description: "事件标题" },
      date: { type: "string", description: "开始时间 ISO 8601，如 2026-10-21T14:00:00" },
      end: { type: "string", description: "结束时间 ISO 8601" },
      allDay: { type: "boolean", description: "是否全天事件" },
      recurrence: {
        type: "string",
        enum: ["", "daily", "weekly", "monthly", "yearly"],
        description: "重复规则，空字符串表示不重复",
      },
      category: { type: "string", description: "分类：工作/个人/家庭/健康/其他" },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "标签，最多 3 个",
      },
      description: { type: "string", description: "补充说明" },
    },
    required: ["isEvent", "title", "date", "end", "allDay"],
  },
};

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
}

/** 调用 OpenAI 兼容 /chat/completions */
async function chat(cfg: AIConfig, userText: string, useTools: boolean): Promise<any> {
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `当前时间：${new Date().toLocaleString("zh-CN", { hour12: false })}\n用户输入：${userText}`,
    },
  ];

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    stream: false,
  };

  if (useTools) {
    body.tools = [{ type: "function", function: FUNCTION_SCHEMA }];
    body.tool_choice = { type: "function", function: { name: FUNCTION_SCHEMA.name } };
  } else {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });

  const text = await res.text();
  let data: ChatCompletionResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`AI 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(data.error?.message || `AI 请求失败（HTTP ${res.status}）`);
  }
  return data.choices?.[0]?.message;
}

/** 从模型回复里提取结构化对象（兼容 tool_calls / content / 裸 JSON 三种形态） */
export function extractAiPayload(msg: any): any | null {
  if (!msg) return null;

  // 1) tool_calls
  const tc = msg.tool_calls?.[0]?.function;
  if (tc?.arguments) {
    try {
      return JSON.parse(tc.arguments);
    } catch {
      /* 落到下面 */
    }
  }

  // 2) content（可能是 JSON 对象，也可能是 ```json 包裹）
  const content = typeof msg.content === "string" ? msg.content.trim() : "";
  if (content) {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : content;
    try {
      return JSON.parse(candidate);
    } catch {
      // 提取第一个 {...} 片段再试
      const brace = candidate.match(/\{[\s\S]*\}/);
      if (brace) {
        try {
          return JSON.parse(brace[0]);
        } catch {
          /* 放弃 */
        }
      }
    }
  }
  return null;
}

/** 校验并归一化 AI 返回的对象 */
function normalizeAiPayload(p: any): ParsedDraft | null {
  if (!p || typeof p !== "object") return null;
  if (p.isEvent === false) return null;
  if (!p.title || !p.date) return null;

  const startRaw = String(p.date);
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return null;

  let end: Date | null = null;
  if (p.end) {
    const e = new Date(String(p.end));
    if (!Number.isNaN(e.getTime())) end = e;
  }
  // AI 没给结束时间 → 默认 +1 小时
  if (!end) end = new Date(start.getTime() + 3600000);
  // 结束不晚于开始 → 兜底
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 3600000);
  }

  const toLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${hh}:${mi}:00`;
  };

  const rec =
    p.recurrence && p.recurrence !== "" ? p.recurrence : undefined;

  return {
    title: String(p.title).slice(0, 200),
    start: toLocal(start),
    end: toLocal(end),
    allDay: p.allDay === true,
    recurrence: ["daily", "weekly", "monthly", "yearly"].includes(rec)
      ? (rec as ParsedDraft["recurrence"])
      : undefined,
    confidence: 0.9,
    matchedFields: ["AI 解析"],
    raw: "",
  };
}

/**
 * 解析入口：本地规则优先，必要时降级到 AI。
 *
 * @param text 用户原文
 * @param opts.forceAI 跳过本地规则，直接问 AI
 */
export async function parseEventText(
  text: string,
  opts?: { forceAI?: boolean; preferLocal?: boolean },
): Promise<ParseOutcome | null> {
  const cfg = loadAIConfig();

  // ---- 本地规则解析（快路径） ----
  const localDraft = parseNaturalLanguage(text);

  // 默认：本地解析够好就不打扰 AI
  if (!opts?.forceAI && localDraft && isUsableDraft(localDraft)) {
    return { ...localDraft, source: "local", localDraft };
  }

  if (!isAIConfigured(cfg)) {
    // 没配 AI：本地失败就返回 null，让前端提示用户手动填写
    return localDraft ? { ...localDraft, source: "local", localDraft } : null;
  }

  // ---- AI 通道 ----
  let lastError = "";
  // 依次尝试：tool calling → json mode → 裸 JSON
  for (const useTools of [true, false]) {
    try {
      const msg = await chat(cfg, text, useTools);
      const payload = extractAiPayload(msg);
      const parsed = normalizeAiPayload(payload);
      if (parsed) {
        return {
          ...parsed,
          source: "ai",
          raw: text,
          localDraft,
        };
      }
      lastError = "AI 返回内容无法解析为事件";
    } catch (e) {
      lastError = (e as Error).message;
      // 鉴权 / 模型不存在这类错误不必重试另一种模式
      if (/401|403|404|model_not_found|invalid_api_key/i.test(lastError)) {
        break;
      }
    }
  }

  // AI 失败 → 降级回本地结果（若有）
  if (localDraft) {
    return {
      ...localDraft,
      source: "local",
      localDraft,
      fallbackReason: `AI 解析失败，已回退到本地规则：${lastError}`,
    };
  }
  return null;
}
