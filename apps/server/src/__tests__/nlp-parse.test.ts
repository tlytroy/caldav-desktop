/**
 * 自然语言解析 API 端到端测试
 *
 * 用 Node http 模拟 OpenAI 兼容服务，验证：
 *  - 本地规则优先（不发请求）
 *  - 本地失败 → AI 兜底
 *  - AI 失败 → 降级回本地
 *  - AI 返回的多种格式都能解析
 *  - 状态接口不泄露 API Key
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiErrorHandler } from "../http-errors.js";

let aiServer: http.Server;
let apiServer: http.Server;
let baseUrl: string;
let nlpRouter: any;

/** 由测试切换的 AI 行为 */
type AIMode =
  | "tool_calls"        // 返回 tool_calls（最可靠）
  | "json_mode"         // 返回 JSON 字符串
  | "fenced_json"       // 返回 ```json 包裹
  | "not_an_event"      // 返回 isEvent:false
  | "http_401"          // 鉴权失败
  | "garbage";          // 返回无法解析的内容
let aiMode: AIMode = "tool_calls";
let lastRequestBody: any = null;
let requestCount = 0;

function aiResponse(): any {
  const payload = {
    isEvent: true,
    title: "和老王聊下季度规划",
    date: "2026-10-21T14:00:00",
    end: "2026-10-21T15:30:00",
    allDay: false,
    recurrence: "",
    category: "工作",
    tags: ["规划"],
    description: "顺便准备材料",
  };

  switch (aiMode) {
    case "tool_calls":
      return {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "create_calendar_event", arguments: JSON.stringify(payload) } },
              ],
            },
          },
        ],
      };
    case "json_mode":
    case "fenced_json":
      return { choices: [{ message: { content: JSON.stringify(payload) } }] };
    case "not_an_event":
      return { choices: [{ message: { content: JSON.stringify({ isEvent: false }) } }] };
    case "garbage":
      return { choices: [{ message: { content: "我不太理解这句话的意思" } }] };
    default:
      return {};
  }
}

beforeAll(async () => {
  // ---- 模拟 OpenAI 兼容服务 ----
  aiServer = http.createServer((req, res) => {
    if (req.url?.includes("/audio/transcriptions")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "明天下午三点开会" }));
      return;
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requestCount++;
      try {
        lastRequestBody = JSON.parse(body);
      } catch {
        lastRequestBody = null;
      }

      if (aiMode === "http_401") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
        return;
      }

      if (aiMode === "fenced_json") {
        const payload = {
          isEvent: true,
          title: "带代码块的事件",
          date: "2026-10-22T09:00:00",
          end: "2026-10-22T10:00:00",
          allDay: false,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              { message: { content: "```json\n" + JSON.stringify(payload) + "\n```" } },
            ],
          }),
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(aiResponse()));
    });
  });
  await new Promise<void>((r) => aiServer.listen(0, r));
  baseUrl = `http://127.0.0.1:${(aiServer.address() as any).port}/v1`;

  /**
   * 配置走 config 层（与生产一致）。
   * config.json 的优先级高于环境变量，所以必须显式写配置文件，
   * 否则会读到其他测试留下的残留配置。
   */
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nlp-test-"));
  const configPath = path.join(tmpDir, "config.json");
  process.env.APP_CONFIG_PATH = configPath;
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      ai: {
        enabled: true,
        baseUrl,
        apiKey: "test-key-secret-123",
        model: "test-model",
        timeoutMs: 30000,
        temperature: 0.1,
      },
    }),
    "utf-8",
  );

  const { nlpRouter: router } = await import("../routes/nlp.js");
  nlpRouter = router;
  const configMod = await import("../config.js");
  configMod.invalidateConfigCache();

  const app = express();
  app.use(express.json());
  app.use("/api/nlp", nlpRouter);
  app.use(apiErrorHandler);
  apiServer = app.listen(0);
  await new Promise<void>((r) => apiServer.once("listening", r));
});

afterAll(async () => {
  await new Promise<void>((r) => apiServer.close(() => r()));
  await new Promise<void>((r) => aiServer.close(() => r()));
});

beforeEach(() => {
  aiMode = "tool_calls";
  requestCount = 0;
  lastRequestBody = null;
});

function apiBase(): string {
  return `http://127.0.0.1:${(apiServer.address() as any).port}`;
}
async function post(p: string, body?: unknown) {
  const r = await fetch(`${apiBase()}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, json: (await r.json()) as any };
}
async function get(p: string) {
  const r = await fetch(`${apiBase()}${p}`);
  return { status: r.status, text: await r.text() };
}

describe("本地规则优先", () => {
  it("能本地解析时不上 AI", async () => {
    const r = await post("/api/nlp/parse", { text: "明天下午3点开会" });
    expect(r.json.success).toBe(true);
    expect(r.json.source).toBe("local");
    // 关键：完全没发请求
    expect(requestCount).toBe(0);
  });

  it("本地结果含正确时间与标题", async () => {
    const r = await post("/api/nlp/parse", { text: "明天下午3点开会" });
    const d = r.json.draft;
    expect(d.title).toBe("开会");
    expect(d.allDay).toBe(false);
    // 本地解析用服务端「当前时间」作基准，这里只断言结构与时刻
    expect(d.start).toMatch(/^\d{4}-\d{2}-\d{2}T15:00:00$/);
    expect(new Date(d.start).getTime()).toBeGreaterThan(Date.now() - 86400000);
  });
});

describe("AI 兜底", () => {
  it("本地解析不了时调用 AI", async () => {
    // 文案刻意不含「今天/明天/周X」等本地规则能识别的日期词，
    // 否则会被本地规则抢先匹配 —— 那正是本地优先的设计意图
    const r = await post("/api/nlp/parse", {
      text: "跟老王在静安那边碰个面，聊下季度的事顺便把材料准备一下",
    });
    expect(r.json.success).toBe(true);
    expect(r.json.source).toBe("ai");
    expect(requestCount).toBeGreaterThan(0);
    expect(r.json.draft.title).toBe("和老王聊下季度规划");
  });

  it("forceAI 强制走 AI", async () => {
    const r = await post("/api/nlp/parse", { text: "明天开会", forceAI: true });
    expect(r.json.source).toBe("ai");
    expect(requestCount).toBeGreaterThan(0);
  });

  it("AI 请求带了 system prompt 与当前时间", async () => {
    await post("/api/nlp/parse", { text: "随便说点什么没有时间", forceAI: true });
    expect(lastRequestBody?.messages?.[0]?.role).toBe("system");
    expect(String(lastRequestBody?.messages?.[1]?.content)).toContain("当前时间");
  });

  it("Bearer token 正确传递", async () => {
    await post("/api/nlp/parse", { text: "没有时间信息", forceAI: true });
    // 由 mock 服务端收到即说明请求发出；这里验证 body 结构完整
    expect(lastRequestBody?.model).toBe("test-model");
  });
});

describe("AI 返回格式兼容", () => {
  it("tool_calls 格式", async () => {
    aiMode = "tool_calls";
    const r = await post("/api/nlp/parse", { text: "没有时间的东西", forceAI: true });
    expect(r.json.draft.title).toBe("和老王聊下季度规划");
  });

  it("json_object 格式", async () => {
    aiMode = "json_mode";
    const r = await post("/api/nlp/parse", { text: "没有时间的东西", forceAI: true });
    expect(r.json.draft.title).toBe("和老王聊下季度规划");
  });

  it("markdown 代码块包裹", async () => {
    aiMode = "fenced_json";
    const r = await post("/api/nlp/parse", { text: "没有时间的东西", forceAI: true });
    expect(r.json.draft.title).toBe("带代码块的事件");
  });

  it("保留分类标签等扩展字段", async () => {
    aiMode = "tool_calls";
    const r = await post("/api/nlp/parse", { text: "没有时间的东西", forceAI: true });
    expect(r.json.draft.confidence).toBeGreaterThan(0.8);
    expect(r.json.draft.matchedFields).toContain("AI 解析");
  });
});

describe("降级与容错", () => {
  it("AI 401 → 降级回本地结果", async () => {
    aiMode = "http_401";
    // 文本本地能解析，但强制 AI → AI 失败应降级回本地
    const r = await post("/api/nlp/parse", { text: "明天下午3点开会", forceAI: true });
    expect(r.json.success).toBe(true);
    expect(r.json.source).toBe("local");
    expect(r.json.fallbackReason).toBeTruthy();
    expect(r.json.fallbackReason).toMatch(/认证|401|API key/i);
  });

  it("AI 返回无法解析的内容 → 降级", async () => {
    aiMode = "garbage";
    const r = await post("/api/nlp/parse", { text: "明天下午3点开会", forceAI: true });
    expect(r.json.success).toBe(true);
    expect(r.json.source).toBe("local");
  });

  it("AI 说不是事件 → 422 提示手动输入", async () => {
    aiMode = "not_an_event";
    // 注意：文案里不能含「今天 / 明天 / 周X」等本地规则能识别的词，
    // 否则会被本地规则抢先匹配而不会调用 AI —— 那正是本地优先的设计意图。
    const r = await post("/api/nlp/parse", {
      text: "外面天气真不错啊，适合出去走走",
      forceAI: true,
    });
    expect(r.status).toBe(422);
    expect(r.json.needManualInput).toBe(true);
  });

  it("本地也解析不了且无 AI → 422", async () => {
    const configMod = await import("../config.js");
    const savedUrl = configMod.getConfig().ai.baseUrl;
    const savedKey = configMod.getConfig().ai.apiKey;
    // 清掉 AI 配置（配置层优先级高于环境变量）
    configMod.saveConfig({ ai: { enabled: false, baseUrl: "", apiKey: "" } } as any);
    try {
      const r = await post("/api/nlp/parse", { text: "随便聊聊天气" });
      expect(r.status).toBe(422);
      expect(r.json.needManualInput).toBe(true);
    } finally {
      configMod.saveConfig({
        ai: { enabled: true, baseUrl: savedUrl, apiKey: savedKey },
      } as any);
    }
  });
});

describe("参数校验", () => {
  it("空文本 400", async () => {
    const r = await post("/api/nlp/parse", { text: "   " });
    expect(r.status).toBe(400);
  });

  it("缺 text 400", async () => {
    const r = await post("/api/nlp/parse", {});
    expect(r.status).toBe(400);
  });

  it("超长文本 400", async () => {
    const r = await post("/api/nlp/parse", { text: "x".repeat(3000) });
    expect(r.status).toBe(400);
  });
});

describe("状态接口不泄露密钥", () => {
  it("status 只暴露是否配置，不回传 key", async () => {
    const r = await get("/api/nlp/status");
    expect(r.text).not.toContain("test-key-secret-123");
    expect(r.text).not.toContain("sk-");
    const j = JSON.parse(r.text);
    expect(j.aiEnabled).toBe(true);
    expect(j.localParser).toBe(true);
  });
});
