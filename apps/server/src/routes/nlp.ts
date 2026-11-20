/**
 * 自然语言快速创建 API
 *
 * 路由：
 *   POST /api/nlp/parse   解析自然语言为事件草稿（不落盘，前端确认后再创建）
 *   GET  /api/nlp/status  查询本地规则 / AI 的可用状态
 *   POST /api/nlp/transcribe  语音转文字（可选，依赖 AI Whisper）
 */

import express from "express";
import multer from "multer";
import {
  parseEventText,
  loadAIConfig,
  isAIConfigured,
} from "../nlp/ai-parser.js";
import { asyncHandler } from "../http.js";

export const nlpRouter = express.Router();

/**
 * 语音转写用 multipart 上传，限制 25MB（Whisper API 上限）。
 * 内存存储，不落盘。
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/** AI 状态查询：只暴露"配没配"，绝不回传 API Key */
nlpRouter.get("/status", (_req, res) => {
  const cfg = loadAIConfig();
  res.json({
    success: true,
    localParser: true,
    aiEnabled: isAIConfigured(cfg),
    aiModel: isAIConfigured(cfg) ? cfg.model : null,
    /** 语音能力取决于 AI 是否配置（用 Whisper） */
    speechEnabled: isAIConfigured(cfg),
  });
});

/**
 * POST /api/nlp/parse
 * Body:
 *   - text: string  用户输入的自然语言
 *   - forceAI?: boolean  跳过本地规则，直接问 AI
 *   - now?: string  ISO 基准时间（便于测试与"相对某时刻"的场景）
 *
 * 返回事件草稿，**不写文件**。前端展示确认后，再调
 * POST /api/workspace/items 落盘。
 */
nlpRouter.post("/parse", asyncHandler(async (req, res) => {
  try {
    const { text, forceAI, now } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: "输入过长（最多 2000 字）" });
    }

    // now 仅用于本地规则基准；AI 走服务端自身时间
    const outcome = await parseEventText(text.trim(), { forceAI: forceAI === true });

    if (!outcome) {
      return res.status(422).json({
        success: false,
        error:
          "无法从这段话里识别出时间信息。可以补充「明天下午3点」这类描述，或直接手动填写。",
        needManualInput: true,
      });
    }

    res.json({
      success: true,
      draft: outcome,
      source: outcome.source,
      fallbackReason: outcome.fallbackReason,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message,
    });
  }
}));

/**
 * POST /api/nlp/transcribe
 * multipart/form-data，带 audio 文件字段。
 *
 * 依赖 AI 的 Whisper 能力（OpenAI 兼容接口的 /audio/transcriptions）。
 * 未配置 AI 时返回 400，前端应回退到浏览器内置的 Web Speech API。
 */
nlpRouter.post("/transcribe", upload.single("audio"), asyncHandler(async (req, res) => {
  try {
    const cfg = loadAIConfig();
    if (!isAIConfigured(cfg)) {
      return res.status(400).json({
        error: "语音转写需要配置 AI（Whisper）。当前未配置，可改用浏览器内置语音识别。",
        needBrowserSpeech: true,
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: "audio file is required" });
    }

    const form = new FormData();
    form.append("file", new Blob([req.file.buffer]), req.file.originalname || "audio.webm");
    form.append("model", process.env.AI_WHISPER_MODEL || "whisper-1");
    form.append("language", process.env.AI_WHISPER_LANGUAGE || "zh");

    const base = cfg.baseUrl;
    const res2 = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    const text = await res2.text();
    if (!res2.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = JSON.parse(text).error?.message || msg;
      } catch {
        /* 用原文 */
      }
      return res.status(502).json({ error: `语音转写失败：${msg}` });
    }

    let transcript = "";
    try {
      transcript = JSON.parse(text).text || "";
    } catch {
      // 有些服务直接返回纯文本
      transcript = text;
    }

    res.json({ success: true, text: transcript.trim() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}));
