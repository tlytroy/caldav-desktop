/**
 * createApp 边界测试（SDS S24 + S7/S16 的装配层部分）
 *
 * 这里不测业务路由，只测「顺序」本身：
 *  - 认证必须在静态与 SPA 之前，否则未授权的 /API/... 会拿到 200 + index.html
 *  - 路径规范化必须在认证之前，否则 /%61pi 会绕过 app.use("/api")
 *  - 错误中间件必须把 async rejection 映射成 JSON，而不是挂起或吐 HTML
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import express from "express";
import type { Server } from "node:http";
import { createApp, asyncHandler } from "../app.js";
import { ApiTokenError, WorkspaceReadError } from "../errors.js";
import {
  __resetSyncControlForTests,
  setStorageReadOnly,
  setSyncMaintenance,
} from "../sync-control.js";

const TOKEN = "a".repeat(64);

interface Ctx {
  server: Server;
  base: string;
}

async function listen(app: express.Express): Promise<Ctx> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function close(ctx: Ctx | null): Promise<void> {
  if (!ctx) return;
  await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
}

function pingRouter(): express.Router {
  const r = express.Router();
  r.get("/ping", (_req, res) => res.json({ pong: true }));
  r.post("/echo", (req, res) => res.json({ body: req.body ?? null }));
  r.get(
    "/boom",
    asyncHandler(async () => {
      throw new WorkspaceReadError("数据文件读取失败");
    }),
  );
  return r;
}

describe("createApp 认证参数", () => {
  it("缺省 / undefined 直接抛错，不允许默认裸奔", () => {
    expect(() => createApp({} as never)).toThrow(ApiTokenError);
    expect(() => createApp({ auth: undefined } as never)).toThrow(ApiTokenError);
  });

  it("空 token 与纯空白 token 抛错", () => {
    expect(() => createApp({ auth: { token: "" } })).toThrow(ApiTokenError);
    expect(() => createApp({ auth: { token: "   " } })).toThrow(ApiTokenError);
  });

  it("auth:false 允许显式关闭（v0.2.5 / 测试）", () => {
    expect(() => createApp({ auth: false, routers: [] })).not.toThrow();
  });
});

describe("createApp 认证与路径边界", () => {
  let ctx: Ctx | null = null;

  afterEach(async () => {
    await close(ctx);
    ctx = null;
    __resetSyncControlForTests();
  });

  it("无 token 时 /api 返回 401 JSON，带正确 token 通过", async () => {
    ctx = await listen(createApp({ auth: { token: TOKEN }, routers: [pingRouter()] }));

    const anon = await fetch(`${ctx.base}/api/ping`);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ code: "UNAUTHORIZED" });

    const wrong = await fetch(`${ctx.base}/api/ping`, {
      headers: { Authorization: `Bearer ${"b".repeat(64)}` },
    });
    expect(wrong.status).toBe(401);

    const empty = await fetch(`${ctx.base}/api/ping`, {
      headers: { Authorization: "Bearer   " },
    });
    expect(empty.status).toBe(401);

    const ok = await fetch(`${ctx.base}/api/ping`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ pong: true });
  });

  it("/health 永远公开", async () => {
    ctx = await listen(createApp({ auth: { token: TOKEN }, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version?: string };
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
  });

  it("/API 与 /Api 走同一条认证（大小写不敏感）", async () => {
    ctx = await listen(createApp({ auth: { token: TOKEN }, routers: [pingRouter()] }));
    for (const p of ["/API/ping", "/Api/ping", "/api/PING"]) {
      const res = await fetch(`${ctx.base}${p}`);
      expect(res.status, p).toBe(401);
    }
  });

  it("编码过的 /api 前缀返回 400，不落到静态资源", async () => {
    ctx = await listen(createApp({ auth: false, routers: [pingRouter()] }));
    for (const p of ["/%61pi/ping", "/%2fapi/ping", "/api%2Fping", "//api/ping"]) {
      const res = await fetch(`${ctx.base}${p}`);
      expect(res.status, p).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(["BAD_PATH", "ENCODED_API_PATH"]).toContain(body.code);
    }
  });

  it("/api// ping 仍先经过认证（Express 会把连续斜杠归一化）", async () => {
    // Express 4 在挂载点内部把 "//ping" 归一成 "/ping" 才会命中路由，
    // 但这发生在认证之后：未带 token 时永远是 401，不会泄露任何数据。
    ctx = await listen(createApp({ auth: { token: TOKEN }, routers: [pingRouter()] }));

    const anon = await fetch(`${ctx.base}/api//ping`);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ code: "UNAUTHORIZED" });

    const ok = await fetch(`${ctx.base}/api//ping`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.status).toBe(200);
  });

  it("未知 /api 返回 JSON 404", async () => {
    ctx = await listen(createApp({ auth: false, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("OPTIONS 预检返回 204", async () => {
    ctx = await listen(createApp({ auth: { token: TOKEN }, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/api/ping`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(204);
  });

  it("Origin: null 不下发 CORS 许可", async () => {
    ctx = await listen(createApp({ auth: false, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/api/ping`, {
      headers: { Origin: "null" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("非法 JSON → 400 BAD_JSON", async () => {
    ctx = await listen(createApp({ auth: false, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/api/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ this is not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_JSON" });
  });

  it("async handler 的 rejection 被映射为 JSON 500，绝不挂起", async () => {
    ctx = await listen(createApp({ auth: false, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/api/boom`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("<html");
    expect(JSON.parse(text)).toMatchObject({
      code: "WORKSPACE_READ_FAILED",
    });
  });
});

describe("createApp 静态资源与 SPA 顺序", () => {
  let ctx: Ctx | null = null;
  let staticDir = "";

  beforeEach(() => {
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-static-"));
    fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>app</title>");
    fs.mkdirSync(path.join(staticDir, "api"), { recursive: true });
    fs.writeFileSync(path.join(staticDir, "api", "secret.txt"), "should never be served");
    fs.mkdirSync(path.join(staticDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(staticDir, "assets", "app.js"), "console.log(1)");
  });

  afterEach(async () => {
    await close(ctx);
    ctx = null;
    __resetSyncControlForTests();
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  it("静态目录里的 api/ 不会被匿名读取", async () => {
    ctx = await listen(createApp({ auth: false, staticDir, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/api/secret.txt`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  it("页面路由回落到 index.html，缺失的 assets 保持 404", async () => {
    ctx = await listen(createApp({ auth: false, staticDir, routers: [pingRouter()] }));

    const page = await fetch(`${ctx.base}/calendar`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>app</title>");

    const asset = await fetch(`${ctx.base}/assets/app.js`);
    expect(asset.status).toBe(200);

    const missing = await fetch(`${ctx.base}/assets/missing.js`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("<title>app</title>");
  });

  it("/API 即使有静态目录也不会拿到 HTML", async () => {
    ctx = await listen(createApp({ auth: { token: TOKEN }, staticDir, routers: [pingRouter()] }));
    const res = await fetch(`${ctx.base}/API/workspace/items`);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("<title>app</title>");
  });
});

describe("createApp 只读与维护闸门", () => {
  let ctx: Ctx | null = null;

  afterEach(async () => {
    await close(ctx);
    ctx = null;
    __resetSyncControlForTests();
  });

  it("只读模式：写请求 503，读请求照常", async () => {
    setStorageReadOnly(true);
    ctx = await listen(
      createApp({ auth: false, routers: [pingRouter()], storageReadOnly: true }),
    );

    const write = await fetch(`${ctx.base}/api/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(write.status).toBe(503);
    expect(await write.json()).toMatchObject({ code: "WORKSPACE_READ_ONLY" });

    const read = await fetch(`${ctx.base}/api/ping`);
    expect(read.status).toBe(200);
  });

  it("维护模式：普通写 503，恢复白名单放行", async () => {
    ctx = await listen(createApp({ auth: false, routers: [pingRouter()] }));
    setSyncMaintenance(true);

    const write = await fetch(`${ctx.base}/api/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(write.status).toBe(503);
    expect(await write.json()).toMatchObject({ code: "MAINTENANCE" });

    // 白名单路径没有真实路由 → 走到 API 404，说明闸门确实放行了
    const allow = await fetch(`${ctx.base}/api/workspace/backups/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(allow.status).toBe(404);
    expect(await allow.json()).toMatchObject({ code: "NOT_FOUND" });

    const read = await fetch(`${ctx.base}/api/ping`);
    expect(read.status).toBe(200);
  });
});
