import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import express from "express";
import type { Server } from "node:http";

/**
 * S11 —— 同步中心只读概览（SDS §5 / §8.1）
 *
 * 重点验证：
 *  1. 未配置任何同步时也能正常返回（离线可用的硬约束）；
 *  2. `GET /api/sync/overview` 不发任何网络请求（配置指向不可达地址也立即返回）；
 *  3. 事件/冲突环形缓冲：各最多 20 条、按时间序、reset 清空；
 *  4. 概览能反映 maintenance / restorePending / inFlight。
 */

let tmpDir = "";
let server: Server | null = null;
let base = "";
let syncControl: typeof import("../sync-control.js");
let overview: typeof import("../sync-overview.js");
let config: typeof import("../config.js");
let restore: typeof import("../restore.js");

async function listen(app: express.Express): Promise<void> {
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
}

async function getJson(pathname: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${pathname}`);
  const body = await res.json();
  return { status: res.status, body };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-overview-"));
  process.env.WORKSPACE_FILE = path.join(tmpDir, "workspace.md");
  process.env.APP_CONFIG_PATH = path.join(tmpDir, "config.json");
  fs.writeFileSync(process.env.WORKSPACE_FILE, "# 工作台\n", "utf-8");
  fs.writeFileSync(process.env.APP_CONFIG_PATH, "{}", "utf-8");

  syncControl = await import("../sync-control.js");
  overview = await import("../sync-overview.js");
  config = await import("../config.js");
  restore = await import("../restore.js");
  const { syncControlRouter } = await import("../routes/sync-control.js");
  const { apiErrorHandler } = await import("../http-errors.js");

  const app = express();
  app.use(express.json());
  app.use("/api/sync", syncControlRouter);
  app.use(apiErrorHandler);

  syncControl.__resetSyncControlForTests();
  config.invalidateConfigCache();
  await listen(app);
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.WORKSPACE_FILE;
  delete process.env.APP_CONFIG_PATH;
});

describe("S11 同步中心概览", () => {
  it("未配置任何同步时也正常返回，且标记为未配置", async () => {
    // vitest 会加载仓库根目录 .env（里面有真实的 CALDAV_URL/WEBDAV_URL），
    // 这里显式清空，模拟「用户没配同步」的干净安装。
    // 注意：`configFromEnv()` 在 process.env 未定义时会**回退读取仓库根 .env**，
    // 所以这里必须显式赋空串（`??` 只在 null/undefined 时回退）而不是 delete。
    const keys = [
      "CALDAV_ROOT_URL",
      "CALDAV_URL",
      "CALDAV_USER",
      "CALDAV_PASS",
      "CALDAV_CALENDAR_URL",
      "WEBDAV_URL",
      "WEBDAV_USER",
      "WEBDAV_PASS",
      "WEBDAV_EVENTS_PATH",
    ];
    const saved: Record<string, string | undefined> = {};
    for (const key of keys) {
      saved[key] = process.env[key];
      process.env[key] = "";
    }
    config.invalidateConfigCache();
    try {
      const { status, body } = await getJson("/api/sync/overview");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.caldav.configured).toBe(false);
      expect(body.webdav.configured).toBe(false);
      expect(body.events).toEqual([]);
      expect(body.conflicts).toEqual([]);
      expect(body.restorePending).toBe(false);
      expect(body.autoSyncSuspended).toBe(false);
      expect(body.maintenance).toBe(false);
      expect(body.inFlight).toEqual({ caldav: 0, webdav: 0, restore: 0 });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      config.invalidateConfigCache();
    }
  });

  it("配置了不可达的 CalDAV/WebDAV 地址也不联网，接口立即返回", async () => {
    fs.writeFileSync(
      process.env.APP_CONFIG_PATH!,
      JSON.stringify({
        caldav: {
          rootUrl: "http://127.0.0.1:1",
          username: "tester",
          password: "secret",
          calendarUrl: "http://127.0.0.1:1/dav/cal/",
          timeoutMs: 30000,
        },
        webdav: {
          enabled: true,
          url: "http://127.0.0.1:1/dav/",
          username: "tester",
          password: "secret",
          remoteDir: "CalDAV-Desktop",
          timeoutMs: 30000,
        },
      }),
      "utf-8",
    );
    config.invalidateConfigCache();

    const started = Date.now();
    const { status, body } = await getJson("/api/sync/overview");
    const elapsed = Date.now() - started;

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.caldav.configured).toBe(true);
    expect(body.webdav.configured).toBe(true);
    expect(body.webdav.remoteDir).toBe("CalDAV-Desktop");
    // 关键：没有发网络请求，远低于任何超时
    expect(elapsed).toBeLessThan(2000);
  });

  it("事件环最多保留 20 条，且按时间序（旧→新）", () => {
    for (let i = 1; i <= 25; i += 1) {
      syncControl.recordSyncEvent("caldav", "sync", `event-${i}`);
    }
    const events = syncControl.getSyncEvents();
    expect(events).toHaveLength(20);
    expect(events[0].message).toBe("event-6");
    expect(events[19].message).toBe("event-25");
    expect(events.every((e) => e.channel === "caldav")).toBe(true);
  });

  it("冲突环最多保留 20 条", () => {
    for (let i = 1; i <= 23; i += 1) {
      syncControl.recordSyncConflict({ channel: "webdav", summary: `conflict-${i}` });
    }
    const conflicts = syncControl.getSyncConflicts();
    expect(conflicts).toHaveLength(20);
    expect(conflicts[0].summary).toBe("conflict-4");
    expect(conflicts[19].summary).toBe("conflict-23");
  });

  it("超长事件消息被截断到 500 字符 + 省略号", () => {
    syncControl.recordSyncEvent("caldav", "error", "x".repeat(900));
    const [event] = syncControl.getSyncEvents();
    expect(event.message.length).toBe(501);
    expect(event.message.endsWith("…")).toBe(true);
  });

  it("概览里的 lastError 取该通道最近一条错误事件", () => {
    syncControl.recordSyncEvent("caldav", "sync", "正常");
    syncControl.recordSyncEvent("caldav", "error", "第一次失败");
    syncControl.recordSyncEvent("caldav", "sync", "又正常了");
    syncControl.recordSyncEvent("caldav", "error", "最近一次失败");
    syncControl.recordSyncEvent("webdav", "error", "WebDAV 失败");

    const ov = overview.getSyncOverview();
    expect(ov.caldav.lastError).toBe("最近一次失败");
    expect(ov.webdav.lastError).toBe("WebDAV 失败");
  });

  it("inFlight 反映在途同步，end() 后归零", () => {
    const endCal = syncControl.beginSyncActivity("caldav");
    const endWd = syncControl.beginSyncActivity("webdav");
    const endWd2 = syncControl.beginSyncActivity("webdav");

    let ov = overview.getSyncOverview();
    expect(ov.inFlight).toEqual({ caldav: 1, webdav: 2, restore: 0 });

    endCal();
    endWd();
    ov = overview.getSyncOverview();
    expect(ov.inFlight).toEqual({ caldav: 0, webdav: 1, restore: 0 });

    endWd2();
    ov = overview.getSyncOverview();
    expect(ov.inFlight).toEqual({ caldav: 0, webdav: 0, restore: 0 });
  });

  it("reset 清空事件与冲突（模拟重启）", () => {
    syncControl.recordSyncEvent("caldav", "sync", "a");
    syncControl.recordSyncConflict({ channel: "caldav", summary: "b" });

    syncControl.__resetSyncControlForTests();

    expect(syncControl.getSyncEvents()).toEqual([]);
    expect(syncControl.getSyncConflicts()).toEqual([]);
  });

  it("维护态在概览里可见", async () => {
    syncControl.setSyncMaintenance(true);
    try {
      const { status, body } = await getJson("/api/sync/overview");
      expect(status).toBe(200);
      expect(body.maintenance).toBe(true);
    } finally {
      syncControl.setSyncMaintenance(false);
    }
  });

  it("恢复 marker 存在时 restorePending 为 true", async () => {
    fs.writeFileSync(
      restore.restoreMarkerPath(),
      JSON.stringify({
        startedAt: new Date().toISOString(),
        file: "workspace-20260101-000000-abc123.md",
        sha256: "a".repeat(64),
        phase: "pre-restore",
      }),
      "utf-8",
    );
    try {
      const { status, body } = await getJson("/api/sync/overview");
      expect(status).toBe(200);
      expect(body.restorePending).toBe(true);
    } finally {
      fs.rmSync(restore.restoreMarkerPath(), { force: true });
    }
  });
});
