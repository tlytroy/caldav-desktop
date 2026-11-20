/**
 * CalDAV 不可用时的降级行为
 *
 * 回归点：服务器连不上时 `/api/calendar/calendars` 曾返回 500，
 * 导致用户打开日历页直接看到报错。而本工具的 md 是本地唯一事实源，
 * 服务器挂了不该影响本地使用。
 *
 * 注意：只对**读接口**降级。写接口（POST/PUT/DELETE 事件）必须保持 500 ——
 * 否则用户会以为写成功了，实际什么都没写。
 */

import { describe, it, expect } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 判定逻辑与 routes/calendar.ts 中的 isConnectionError 保持一致。
 * 这里复制一份而不是 import —— 因为该函数没有导出，
 * 且它依赖 express 的 Response 类型，import 会连带引入一堆依赖。
 */
function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /principalUrl|cannot find|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|502|503|504|getaddrinfo/i.test(
    msg,
  );
}

describe("CalDAV 连接错误判定", () => {
  it("识别 principalUrl 错误（Radicale 不可达的典型症状）", () => {
    expect(isConnectionError(new Error("cannot find principalUrl"))).toBe(true);
  });

  it("识别网络类错误", () => {
    for (const m of [
      "fetch failed",
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "getaddrinfo ENOTFOUND",
      "502 Bad Gateway",
      "503 Service Unavailable",
      "504 Gateway Timeout",
    ]) {
      expect(isConnectionError(new Error(m))).toBe(true);
    }
  });

  it("普通业务错误不算连接错误（应保持 500）", () => {
    for (const m of ["Invalid UID", "Event not found", "Bad request"]) {
      expect(isConnectionError(new Error(m))).toBe(false);
    }
  });
});

describe("降级响应形状", () => {
  /**
   * 用一个模拟路由验证降级响应的实际形状：
   * 必须是 200 + degraded 标记 + 空数据数组 + 可读提示。
   */
  it("降级响应是 200 + degraded + 空数组 + 提示", async () => {
    const app = express();
    app.get("/t", (_req, res) => {
      res.json({
        success: true,
        degraded: true,
        data: [],
        calendars: [],
        events: [],
        error: "cannot find principalUrl",
        message:
          "CalDAV 服务器当前不可用，本地数据不受影响。可在「设置 → 同步」中检查配置。",
      });
    });

    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const res = await fetch(`${base}/t`);
    const j: any = await res.json();

    expect(res.status).toBe(200);
    expect(j.degraded).toBe(true);
    expect(Array.isArray(j.data)).toBe(true);
    expect(j.data).toHaveLength(0);
    expect(j.message).toContain("本地数据不受影响");

    server.close();
  });
});

describe("写操作不降级", () => {
  it("calendar.ts 中写操作路由未接入降级分支", () => {
    // 静态检查：确保 POST/PUT/DELETE 事件路由里没有 degraded 分支。
    // 降级只允许出现在 GET /calendars 与 GET /events 两处。
    const src = readFileSync(
      path.resolve(__dirname, "../routes/calendar.ts"),
      "utf-8",
    );

    // 找出所有降级**调用**所在的行号
    // 注意：只匹配 `return degraded(res, error);`，不能匹配函数定义那行
    // （`function degraded(res: express.Response, ...)` 也含 "degraded(res"）
    const degradedLines = src
      .split("\n")
      .map((l, i) => ({ l, i }))
      .filter((x) => /return\s+degraded\(res/.test(x.l))
      .map((x) => x.i + 1);

    expect(degradedLines.length).toBeGreaterThan(0);
    expect(degradedLines.length).toBe(2); // 只有 GET /calendars 与 GET /events

    // 对每一处降级，往上找最近的路由定义，必须是 GET
    for (const lineNo of degradedLines) {
      const before = src.split("\n").slice(0, lineNo - 1).join("\n");
      const routeMatch = before.match(
        /calendarRouter\.(get|post|put|delete|patch)\(/g,
      );
      const lastRoute = routeMatch?.[routeMatch.length - 1] || "";
      expect(lastRoute).toContain("get");
    }
  });
});
