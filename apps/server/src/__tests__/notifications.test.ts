/**
 * 推送渠道 + 服务端提醒检查测试
 *
 * 全部打本地 mock HTTP 服务，不访问企业微信 / Server酱 等真实服务。
 * 覆盖：
 *  - 六个渠道的请求格式（路径 / body / 方法）
 *  - 部分渠道失败时如实返回 error
 *  - 提醒去重（同一条目同一提醒只推一次）
 *  - 超过 24 小时不补推
 *  - 失败后 5 分钟内不重试
 *  - 敏感字段（webhook / token）掩码写入不会覆盖真实值
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let push: typeof import("../notifications/push.js");
let scheduler: typeof import("../notifications/scheduler.js");
let configMod: typeof import("../config.js");
let workspaceMod: typeof import("../workspace.js");

interface Captured {
  method: string;
  path: string;
  body: string;
  headers: http.IncomingHttpHeaders;
}

const captured: Captured[] = [];
let base = "";
let tmpDir = "";
let configPath = "";
let wsPath = "";
let statePath = "";
let server: http.Server;
let savedEnv: Record<string, string | undefined> = {};

function json(res: http.ServerResponse, code: number, obj: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function notificationsConfig(over: Partial<Record<string, unknown>> = {}) {
  return {
    enabled: true,
    channels: {
      wecom: { enabled: true, webhookUrl: `${base}/wecom` },
      serverchan: { enabled: true, sendKey: "SCTKEY" },
      pushplus: { enabled: true, token: "PPTOKEN" },
      bark: {
        enabled: true,
        serverUrl: `${base}/bark`,
        deviceKey: "DEV",
      },
      ntfy: {
        enabled: true,
        url: `${base}/ntfy`,
        topic: "topic1",
        token: "",
      },
      webhook: { enabled: true, url: `${base}/hook` },
      ...(over as any),
    },
  };
}

/** 写配置并让缓存失效 */
function configure(notifications: any) {
  fs.writeFileSync(configPath, JSON.stringify({ notifications }, null, 2));
  configMod.invalidateConfigCache();
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-test-"));
  configPath = path.join(tmpDir, "config.json");
  wsPath = path.join(tmpDir, "workspace.md");
  statePath = path.join(tmpDir, ".reminder-state.json");

  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = decodeURIComponent(new URL(req.url!, "http://x").pathname);
      captured.push({
        method: req.method || "",
        path: p,
        body,
        headers: req.headers,
      });

      if (p === "/wecom") return json(res, 200, { errcode: 0, errmsg: "ok" });
      if (p === "/sct/SCTKEY.send") return json(res, 200, { code: 0 });
      if (p === "/pushplus/send") return json(res, 200, { code: 200 });
      if (p.startsWith("/bark/DEV/")) return json(res, 200, { code: 200 });
      if (p === "/ntfy") return json(res, 200, {});
      if (p === "/hook") return json(res, 200, { ok: true });
      if (p === "/hook-fail") {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      json(res, 404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  savedEnv = {
    APP_CONFIG_PATH: process.env.APP_CONFIG_PATH,
    WORKSPACE_FILE: process.env.WORKSPACE_FILE,
    REMINDER_STATE_FILE: process.env.REMINDER_STATE_FILE,
    SERVERCHAN_API_BASE: process.env.SERVERCHAN_API_BASE,
    PUSHPLUS_API_BASE: process.env.PUSHPLUS_API_BASE,
  };
  process.env.APP_CONFIG_PATH = configPath;
  process.env.WORKSPACE_FILE = wsPath;
  process.env.REMINDER_STATE_FILE = statePath;
  process.env.SERVERCHAN_API_BASE = `${base}/sct`;
  process.env.PUSHPLUS_API_BASE = `${base}/pushplus`;

  configMod = await import("../config.js");
  workspaceMod = await import("../workspace.js");
  push = await import("../notifications/push.js");
  scheduler = await import("../notifications/scheduler.js");

  configure(notificationsConfig());
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  captured.length = 0;
  for (const p of [wsPath, statePath]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  configure(notificationsConfig());
});

describe("推送渠道格式", () => {
  it("六个渠道都能发出，且请求格式正确", async () => {
    const results = await push.sendPush({
      title: "项目评审",
      body: "11-03 10:00 · 日程",
    });
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(captured).toHaveLength(6);

    const byPath = (suffix: string) =>
      captured.find((c) => c.path === suffix || c.path.startsWith(suffix));

    const wecom = byPath("/wecom")!;
    expect(wecom.method).toBe("POST");
    expect(JSON.parse(wecom.body).text.content).toContain("项目评审");

    const sc = byPath("/sct/SCTKEY.send")!;
    expect(sc.method).toBe("POST");
    expect(sc.body).toContain("title=");

    const pp = byPath("/pushplus/send")!;
    expect(JSON.parse(pp.body).token).toBe("PPTOKEN");

    const bark = byPath("/bark/DEV/")!;
    expect(bark.method).toBe("GET");

    const ntfy = byPath("/ntfy")!;
    expect(JSON.parse(ntfy.body).topic).toBe("topic1");

    const hook = byPath("/hook")!;
    const hookBody = JSON.parse(hook.body);
    expect(hookBody.source).toBe("caldav-desktop");
    expect(hookBody.title).toBe("项目评审");
  });

  it("渠道返回业务错误时如实报告（不假装成功）", async () => {
    configure(
      notificationsConfig({
        webhook: { enabled: true, url: `${base}/hook-fail` },
        wecom: { enabled: false, webhookUrl: "" },
        serverchan: { enabled: false, sendKey: "" },
        pushplus: { enabled: false, token: "" },
        bark: { enabled: false, serverUrl: "", deviceKey: "" },
        ntfy: { enabled: false, url: "", topic: "", token: "" },
      }),
    );
    const results = await push.sendPush({ title: "x", body: "y" });
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/HTTP 500/);
  });

  it("总开关关闭时不发任何请求", async () => {
    configure({ ...notificationsConfig(), enabled: false });
    const results = await push.sendPush({ title: "x", body: "y" });
    expect(results).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });
});

describe("服务端提醒检查", () => {
  it("到点的提醒推送一次，第二次不重复", async () => {
    configure(notificationsConfig());
    const remind = localIso(new Date(Date.now() - 60_000));
    fs.writeFileSync(
      wsPath,
      workspaceMod.serializeWorkspace(
      [
        {
          id: "aaa11111",
          kind: "event",
          title: "到点会议",
          start: remind,
          remind,
        },
      ],
      "",
      ),
      "utf-8",
    );

    const r1 = await scheduler.runReminderCheck();
    expect(r1.channels).toBe(6);
    expect(r1.due).toBe(1);
    expect(r1.sent).toBe(1);
    expect(captured.length).toBeGreaterThanOrEqual(6);

    const r2 = await scheduler.runReminderCheck();
    expect(r2.due).toBe(0);
    expect(r2.sent).toBe(0);
  });

  it("超过 24 小时不补推", async () => {
    configure(notificationsConfig());
    const remind = localIso(new Date(Date.now() - 25 * 3600_000));
    fs.writeFileSync(
      wsPath,
      workspaceMod.serializeWorkspace(
      [
        {
          id: "bbb22222",
          kind: "event",
          title: "昨天的会",
          start: remind,
          remind,
        },
      ],
      "",
      ),
      "utf-8",
    );
    const r = await scheduler.runReminderCheck();
    expect(r.due).toBe(0);
  });

  it("推送失败记录重试时间，5 分钟内不再重试", async () => {
    configure(
      notificationsConfig({
        webhook: { enabled: true, url: `${base}/hook-fail` },
        wecom: { enabled: false, webhookUrl: "" },
        serverchan: { enabled: false, sendKey: "" },
        pushplus: { enabled: false, token: "" },
        bark: { enabled: false, serverUrl: "", deviceKey: "" },
        ntfy: { enabled: false, url: "", topic: "", token: "" },
      }),
    );
    const remind = localIso(new Date(Date.now() - 60_000));
    fs.writeFileSync(
      wsPath,
      workspaceMod.serializeWorkspace(
      [
        {
          id: "ccc33333",
          kind: "task",
          title: "失败任务",
          start: remind,
          remind,
        },
      ],
      "",
      ),
      "utf-8",
    );

    const r1 = await scheduler.runReminderCheck();
    expect(r1.failed).toBe(1);
    expect(r1.sent).toBe(0);

    const r2 = await scheduler.runReminderCheck();
    expect(r2.due).toBe(0); // 5 分钟退避中
  });

  it("已完成 / 已取消的条目不推", async () => {
    configure(notificationsConfig());
    const remind = localIso(new Date(Date.now() - 60_000));
    fs.writeFileSync(
      wsPath,
      workspaceMod.serializeWorkspace(
      [
        {
          id: "ddd44444",
          kind: "task",
          title: "已完成",
          start: remind,
          remind,
          done: true,
        },
        {
          id: "eee55555",
          kind: "event",
          title: "已取消",
          start: remind,
          remind,
          status: "cancelled",
        },
      ],
      "",
      ),
      "utf-8",
    );
    const r = await scheduler.runReminderCheck();
    expect(r.due).toBe(0);
  });
});

describe("敏感字段掩码（深层路径）", () => {
  it("读取配置时 webhook / token 被掩码", () => {
    configure(notificationsConfig());
    const redacted = configMod.redactConfig(configMod.getConfig());
    expect(redacted.notifications.channels.webhook.url).toContain("****");
    expect(redacted.notifications.channels.serverchan.sendKey).toContain("****");
    expect(redacted.notifications.channels.pushplus.token).toContain("****");
    // 非敏感字段原样
    expect(redacted.notifications.channels.ntfy.topic).toBe("topic1");
  });

  it("回传掩码不会覆盖真实值", () => {
    configure(notificationsConfig());
    const masked = configMod.redactConfig(configMod.getConfig());
    configMod.saveConfig({
      notifications: masked.notifications,
    } as any);
    const actual = configMod.getConfig();
    expect(actual.notifications.channels.webhook.url).toBe(`${base}/hook`);
    expect(actual.notifications.channels.serverchan.sendKey).toBe("SCTKEY");
  });
});
