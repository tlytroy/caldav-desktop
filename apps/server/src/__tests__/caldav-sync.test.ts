/**
 * CalDAV 同步通道测试（workspace.md ↔ CalDAV）
 *
 * 用 Node http 模拟一个最小 CalDAV 服务端（PROPFIND / GET / PUT），
 * 验证的是真正会出问题的地方：
 *
 *  - 推送时 UID 来自条目（本地新建 = id；远端拉来的 = 原 UID），
 *    否则本地改完再推会在服务器上多一份
 *  - 没变化不重传；ETag 变了才重新下载（增量）
 *  - 拉取写入 workspace.md 时保留 uid，重复拉取不产生重复条目
 *  - 两边都改过 → 报 conflict、保留本地、不覆盖远端
 *  - force 才允许覆盖
 *  - RECURRENCE-ID 例外实例不覆盖主事件
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { invalidateConfigCache } from "../config.js";
import { caldavSyncRouter } from "../routes/caldav-sync.js";
import {
  readWorkspace,
  serializeWorkspace,
  workspaceFilePath,
  type WorkbenchItem,
} from "../workspace.js";
import { idFromUid, legacyIdFromUid } from "../ics-convert.js";
import { apiErrorHandler } from "../http-errors.js";
import {
  syncWorkspaceToCalDAV,
  syncStatePath,
  getCalDAVSyncStatus,
  normalizeDirection,
} from "../caldav-sync.js";

// ===== 模拟 CalDAV 服务端 =====

type RemoteEntry = { content: string; etag: string };
const store = new Map<string, RemoteEntry>();
let etagSeq = 0;
let putCount = 0;
let getCount = 0;
let authShouldFail = false;

function newEtag(): string {
  etagSeq += 1;
  return `"e${etagSeq}"`;
}

function objectPath(filename: string): string {
  return `/dav/cal/${filename}`;
}

const davServer = http.createServer((req, res) => {
  const auth = req.headers.authorization;
  if (authShouldFail || !auth || !auth.startsWith("Basic ")) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url!, "http://x").pathname);

  if (req.method === "PROPFIND") {
    const origin = `http://${req.headers.host}`;
    const parts: string[] = [];
    for (const [p, entry] of store) {
      parts.push(
        `<d:response><d:href>${p}</d:href><d:propstat><d:prop>` +
          `<d:getetag>${entry.etag}</d:getetag>` +
          `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
    }
    const xml =
      `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:">` +
      // 集合自身（不是 .ics，会被解析器忽略）
      `<d:response><d:href>/dav/cal/</d:href><d:propstat><d:prop>` +
      `<d:resourcetype><d:collection/></d:resourcetype>` +
      `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
      parts.join("") +
      `</d:multistatus>`;
    void origin;
    res.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(xml);
    return;
  }

  if (req.method === "GET") {
    const e = store.get(pathname);
    if (!e) {
      res.writeHead(404);
      res.end();
      return;
    }
    getCount += 1;
    res.writeHead(200, {
      "Content-Type": "text/calendar; charset=utf-8",
      ETag: e.etag,
    });
    res.end(e.content);
    return;
  }

  if (req.method === "PUT") {
    putCount += 1;
    const ifMatch = req.headers["if-match"];
    if (ifMatch) {
      const cur = store.get(pathname);
      if (!cur || cur.etag !== String(ifMatch)) {
        res.writeHead(412);
        res.end("Precondition Failed");
        return;
      }
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const etag = newEtag();
      store.set(pathname, { content: body, etag });
      res.writeHead(201, { ETag: etag });
      res.end();
    });
    return;
  }

  res.writeHead(405);
  res.end();
});

// ===== 测试脚手架 =====

let baseUrl = "";
let tmpDir = "";
let configPath = "";

function icsFor(opts: {
  uid: string;
  summary: string;
  start?: string;
  end?: string;
  lastModified?: string;
  recurrenceId?: string;
  description?: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    opts.lastModified ? `LAST-MODIFIED:${opts.lastModified}` : "",
    opts.recurrenceId ? `RECURRENCE-ID:${opts.recurrenceId}` : "",
    `DTSTART:${opts.start || "20261102T090000"}`,
    `DTEND:${opts.end || "20261102T100000"}`,
    `SUMMARY:${opts.summary}`,
    opts.description ? `DESCRIPTION:${opts.description}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function seedRemote(filename: string, content: string): void {
  store.set(objectPath(filename), { content, etag: newEtag() });
}

function clearWorld(): void {
  store.clear();
  etagSeq = 0;
  putCount = 0;
  getCount = 0;
  authShouldFail = false;
  for (const f of [
    path.join(tmpDir, "workspace.md"),
    path.join(tmpDir, ".caldav-sync-state.json"),
  ]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  process.env.WORKSPACE_FILE = path.join(tmpDir, "workspace.md");
  // config.json 的优先级高于环境变量，必须显式隔离，
  // 否则本机真实配置（radical.00771100.xyz）会盖掉 mock 地址，测试挂起。
  process.env.APP_CONFIG_PATH = configPath;
  writeCalDAVConfig();
  process.env.CALDAV_ROOT_URL = baseUrl;
  process.env.CALDAV_USER = "tester";
  process.env.CALDAV_PASS = "secret";
  process.env.CALDAV_CALENDAR_URL = `${baseUrl}/dav/cal/`;
  process.env.CALDAV_TIMEOUT_MS = "5000";
  delete process.env.CALDAV_SYNC_STATE_FILE;
  invalidateConfigCache();
}

function seedWorkspace(items: WorkbenchItem[]): void {
  fs.writeFileSync(workspaceFilePath(), serializeWorkspace(items, ""), "utf-8");
}

/**
 * 覆盖临时 config.json 里的 CalDAV 配置。
 * config.json 优先级高于环境变量，测试里改地址必须走这里。
 */
function writeCalDAVConfig(overrides: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      caldav: {
        rootUrl: baseUrl,
        username: "tester",
        password: "secret",
        calendarUrl: `${baseUrl}/dav/cal/`,
        timeoutMs: 5000,
        ...overrides,
      },
    }),
    "utf-8",
  );
  invalidateConfigCache();
}

const meeting: WorkbenchItem = {
  id: "aaaabbbb",
  kind: "task",
  title: "项目周会",
  start: "2026-11-02T10:00:00",
  end: "2026-11-02T11:00:00",
  priority: "high",
  list: "工作",
  done: false,
};

beforeAll(async () => {
  await new Promise<void>((resolve) => davServer.listen(0, "127.0.0.1", resolve));
  const addr = davServer.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "caldav-sync-"));
  configPath = path.join(tmpDir, "config.json");
});

afterAll(async () => {
  await new Promise<void>((resolve) => davServer.close(() => resolve()));
  delete process.env.APP_CONFIG_PATH;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ===== 用例 =====

describe("方向归一化", () => {
  it("兼容旧写法", () => {
    expect(normalizeDirection("md-to-caldav")).toBe("push");
    expect(normalizeDirection("caldav-to-md")).toBe("pull");
    expect(normalizeDirection("both")).toBe("bidirectional");
    expect(normalizeDirection(undefined)).toBe("bidirectional");
  });
});

describe("推送（本地 → CalDAV）", () => {
  it("新建远端对象，UID 用条目 id，字段完整", async () => {
    clearWorld();
    seedWorkspace([meeting]);

    const r = await syncWorkspaceToCalDAV({ direction: "push" });

    expect(r.success).toBe(true);
    expect(r.pushed).toHaveLength(1);
    expect(r.pushed[0].action).toBe("created");

    const remote = store.get(objectPath("aaaabbbb.ics"));
    expect(remote).toBeTruthy();
    expect(remote!.content).toContain("UID:aaaabbbb");
    expect(remote!.content).toContain("SUMMARY:项目周会");
    expect(remote!.content).toContain("PRIORITY:1");
    // DTSTART 用本地时间（浮动时间），不带 Z
    expect(remote!.content).toContain("DTSTART:20261102T100000");
  });

  it("第二次推送无变化 → 跳过，不再 PUT", async () => {
    clearWorld();
    seedWorkspace([meeting]);

    await syncWorkspaceToCalDAV({ direction: "push" });
    const putsAfterFirst = putCount;

    const r = await syncWorkspaceToCalDAV({ direction: "push" });
    expect(r.pushed).toHaveLength(0);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(putCount).toBe(putsAfterFirst);
  });

  it("修改本地后再次推送 → 更新同一个远端对象（不新建）", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    seedWorkspace([{ ...meeting, title: "项目周会（改期）" }]);
    const r = await syncWorkspaceToCalDAV({ direction: "push" });

    expect(r.pushed).toHaveLength(1);
    expect(r.pushed[0].action).toBe("updated");
    expect(store.size).toBe(1);
    expect(store.get(objectPath("aaaabbbb.ics"))!.content).toContain(
      "SUMMARY:项目周会（改期）",
    );
  });
});

describe("拉取（CalDAV → 本地）", () => {
  it("新建本地条目，UID 落盘，id 由 UID 确定性推导", async () => {
    clearWorld();
    seedRemote("remote-1.ics", icsFor({ uid: "remote-uid-1", summary: "远端会议" }));

    const r = await syncWorkspaceToCalDAV({ direction: "pull" });

    expect(r.pulled).toHaveLength(1);
    expect(r.pulled[0].action).toBe("created");

    const ws = readWorkspace();
    expect(ws.items).toHaveLength(1);
    const item = ws.items[0];
    expect(item.uid).toBe("remote-uid-1");
    expect(item.id).toBe(idFromUid("remote-uid-1"));
    expect(item.title).toBe("远端会议");
    expect(item.start).toBe("2026-11-02T09:00:00");
  });

  it("重复拉取不产生重复条目", async () => {
    clearWorld();
    seedRemote("remote-1.ics", icsFor({ uid: "remote-uid-1", summary: "远端会议" }));

    await syncWorkspaceToCalDAV({ direction: "pull" });
    const r2 = await syncWorkspaceToCalDAV({ direction: "pull" });

    expect(r2.pulled).toHaveLength(0);
    expect(readWorkspace().items).toHaveLength(1);
  });

  it("老数据（无 uid、旧算法 id）会被认领，不重复新建", async () => {
    clearWorld();
    seedRemote("legacy.ics", icsFor({ uid: "remote-uid-1", summary: "老事件" }));
    // 模拟升级前的数据：id 由旧算法得到，没有 uid
    seedWorkspace([
      {
        id: legacyIdFromUid("remote-uid-1"),
        kind: "event",
        title: "老事件",
        start: "2026-11-02T09:00:00",
        end: "2026-11-02T10:00:00",
      },
    ]);

    const r = await syncWorkspaceToCalDAV({ direction: "pull" });

    const ws = readWorkspace();
    expect(ws.items).toHaveLength(1);
    expect(ws.items[0].uid).toBe("remote-uid-1");
    // 内容一致，不算一次拉取更新
    expect(r.pulled).toHaveLength(0);
  });

  it("增量：ETag 没变的对象不重新下载", async () => {
    clearWorld();
    seedRemote("remote-1.ics", icsFor({ uid: "remote-uid-1", summary: "远端会议" }));
    await syncWorkspaceToCalDAV({ direction: "pull" });

    const getsAfterFirst = getCount;
    await syncWorkspaceToCalDAV({ direction: "pull" });
    expect(getCount).toBe(getsAfterFirst);
  });

  it("远端修改 → 拉取后本地更新", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    // 模拟另一台设备改了远端
    seedRemote(
      "aaaabbbb.ics",
      icsFor({
        uid: "aaaabbbb",
        summary: "项目周会（别人改的）",
        lastModified: "20261102T120000Z",
      }),
    );

    const r = await syncWorkspaceToCalDAV({ direction: "bidirectional" });
    expect(r.pulled).toHaveLength(1);
    expect(r.pulled[0].action).toBe("updated");

    const item = readWorkspace().items[0];
    expect(item.title).toBe("项目周会（别人改的）");
    expect(item.uid).toBeUndefined(); // 本地条目 uid === id，不必重复存
    // 本地纯字段（清单）不能被远端覆盖掉
    expect(item.list).toBe("工作");
  });
});

describe("冲突处理", () => {
  it("两边都改过 → 报 conflict，保留本地，远端不动", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    // 本地改
    seedWorkspace([{ ...meeting, title: "本地改的标题" }]);
    // 远端也改
    seedRemote(
      "aaaabbbb.ics",
      icsFor({
        uid: "aaaabbbb",
        summary: "远端改的标题",
        lastModified: "20261102T130000Z",
      }),
    );

    const r = await syncWorkspaceToCalDAV({ direction: "bidirectional" });

    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].uid).toBe("aaaabbbb");
    expect(r.pushed).toHaveLength(0);
    expect(readWorkspace().items[0].title).toBe("本地改的标题");
    expect(store.get(objectPath("aaaabbbb.ics"))!.content).toContain(
      "SUMMARY:远端改的标题",
    );
  });

  it("merge：不同字段各改一边 → 合并后两边都保留", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    // 本地改标题
    seedWorkspace([{ ...meeting, title: "周会（本地改）" }]);
    // 远端改描述（标题保持原样）
    seedRemote(
      "aaaabbbb.ics",
      icsFor({
        uid: "aaaabbbb",
        summary: "项目周会",
        description: "远端加的说明",
        lastModified: "20261102T140000Z",
      }),
    );

    const r = await syncWorkspaceToCalDAV({
      direction: "bidirectional",
      merge: true,
      uids: ["aaaabbbb"],
    });

    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].conflictFields).toEqual([]);

    const item = readWorkspace().items[0];
    expect(item.title).toBe("周会（本地改）");
    expect(item.description).toBe("远端加的说明");

    // 合并结果已推回远端
    const remote = store.get(objectPath("aaaabbbb.ics"))!.content;
    expect(remote).toContain("SUMMARY:周会（本地改）");
    expect(remote).toContain("DESCRIPTION:远端加的说明");
  });

  it("merge：同一字段两边都改 → 保留本地并报告字段", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    seedWorkspace([{ ...meeting, title: "本地标题" }]);
    seedRemote(
      "aaaabbbb.ics",
      icsFor({
        uid: "aaaabbbb",
        summary: "远端标题",
        description: "远端加的说明",
        lastModified: "20261102T140000Z",
      }),
    );

    const r = await syncWorkspaceToCalDAV({
      direction: "bidirectional",
      merge: true,
      uids: ["aaaabbbb"],
    });

    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].conflictFields).toContain("title");

    const item = readWorkspace().items[0];
    expect(item.title).toBe("本地标题");
    expect(item.description).toBe("远端加的说明");

    const remote = store.get(objectPath("aaaabbbb.ics"))!.content;
    expect(remote).toContain("SUMMARY:本地标题");
    expect(remote).toContain("DESCRIPTION:远端加的说明");
  });

  it("按 UID 范围 force：只解决这条冲突，不波及其它条目", async () => {
    clearWorld();
    const other: WorkbenchItem = {
      id: "dddd1111",
      kind: "event",
      title: "另一个会",
      start: "2026-11-04T09:00:00",
      end: "2026-11-04T10:00:00",
    };
    seedWorkspace([meeting, other]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    // 两条都：本地改 + 远端改 → 两条冲突
    seedWorkspace([
      { ...meeting, title: "周会（本地）" },
      { ...other, title: "另一会（本地）" },
    ]);
    seedRemote(
      "aaaabbbb.ics",
      icsFor({
        uid: "aaaabbbb",
        summary: "周会（远端）",
        lastModified: "20261102T130000Z",
      }),
    );
    seedRemote(
      "dddd1111.ics",
      icsFor({
        uid: "dddd1111",
        summary: "另一会（远端）",
        lastModified: "20261102T130000Z",
      }),
    );

    const first = await syncWorkspaceToCalDAV({ direction: "bidirectional" });
    expect(first.conflicts).toHaveLength(2);

    // 只把「项目周会」这条以本地为准推上去
    const r = await syncWorkspaceToCalDAV({
      direction: "push",
      force: true,
      uids: ["aaaabbbb"],
    });
    expect(r.pushed).toHaveLength(1);
    expect(store.get(objectPath("aaaabbbb.ics"))!.content).toContain(
      "SUMMARY:周会（本地）",
    );
    // 另一条远端的修改必须原样保留（不能被 force 顺手覆盖）
    expect(store.get(objectPath("dddd1111.ics"))!.content).toContain(
      "SUMMARY:另一会（远端）",
    );
  });

  it("force push 允许用本地覆盖远端", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    seedWorkspace([{ ...meeting, title: "本地改的标题" }]);
    seedRemote(
      "aaaabbbb.ics",
      icsFor({
        uid: "aaaabbbb",
        summary: "远端改的标题",
        lastModified: "20261102T130000Z",
      }),
    );

    const r = await syncWorkspaceToCalDAV({ direction: "push", force: true });

    expect(r.conflicts).toHaveLength(0);
    expect(r.pushed.length).toBeGreaterThanOrEqual(1);
    expect(store.get(objectPath("aaaabbbb.ics"))!.content).toContain(
      "SUMMARY:本地改的标题",
    );
  });

  it("远端对象被删后重建（ETag 变化）不会误判成功", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    await syncWorkspaceToCalDAV({ direction: "push" });

    // 模拟远端内容被替换成另一个对象（同 href 新 ETag）
    seedRemote("aaaabbbb.ics", icsFor({ uid: "aaaabbbb", summary: "被替换" }));

    const r = await syncWorkspaceToCalDAV({ direction: "pull" });
    expect(r.pulled).toHaveLength(1);
    expect(readWorkspace().items[0].title).toBe("被替换");
  });
});

describe("边界", () => {
  it("RECURRENCE-ID 例外实例不覆盖主事件", async () => {
    clearWorld();
    seedRemote(
      "master.ics",
      icsFor({
        uid: "series-1",
        summary: "每周例会",
        start: "20261101T090000",
        end: "20261101T100000",
      }),
    );
    // 例外实例：同 UID，只改某一天
    seedRemote(
      "override.ics",
      icsFor({
        uid: "series-1",
        summary: "本周改到下午",
        start: "20261108T150000",
        end: "20261108T160000",
        recurrenceId: "20261108T090000",
      }),
    );

    const r = await syncWorkspaceToCalDAV({ direction: "pull" });

    const ws = readWorkspace();
    expect(ws.items).toHaveLength(1);
    expect(ws.items[0].title).toBe("每周例会");
    expect(r.skipped).toBeGreaterThanOrEqual(1);
  });

  it("没有 start 的条目（纯截止日期任务）不参与同步", async () => {
    clearWorld();
    seedWorkspace([
      { id: "ccccdddd", kind: "task", title: "买牛奶", due: "2026-11-05" },
    ]);

    const r = await syncWorkspaceToCalDAV({ direction: "push" });
    expect(r.pushed).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("同步状态文件与 workspace.md 同目录", () => {
    clearWorld();
    expect(syncStatePath()).toBe(path.join(tmpDir, ".caldav-sync-state.json"));
  });

  it("状态摘要能反映待推送数量", async () => {
    clearWorld();
    seedWorkspace([meeting]);

    const before = getCalDAVSyncStatus();
    expect(before.localCount).toBe(1);
    expect(before.pendingCount).toBe(1);

    await syncWorkspaceToCalDAV({ direction: "push" });
    const after = getCalDAVSyncStatus();
    expect(after.pendingCount).toBe(0);
    expect(after.syncedCount).toBe(1);
    expect(after.lastSyncAt).toBeTruthy();
  });
});

// ===== HTTP 路由 =====
// 引擎测试通过不代表接口接对了：这里验证路由挂载、状态码与错误文案。

describe("HTTP 路由（/api/caldav）", () => {
  async function startApp(): Promise<{
    server: http.Server;
    base: string;
  }> {
    const app = express();
    app.use(express.json());
    app.use("/api/caldav", caldavSyncRouter);
  app.use(apiErrorHandler);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    return { server, base };
  }

  it("GET /status 返回配置与待推送数量", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    const { server, base } = await startApp();
    try {
      const res = await fetch(`${base}/api/caldav/status`);
      const j: any = await res.json();
      expect(res.status).toBe(200);
      expect(j.configured).toBe(true);
      expect(j.localCount).toBe(1);
      expect(j.pendingCount).toBe(1);
      expect(j.calendarUrl).toContain("/dav/cal/");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("自动发现失败但配了日历 URL → 退回该 URL，不报 degraded", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    const { server, base } = await startApp();
    try {
      const res = await fetch(`${base}/api/caldav/calendars`);
      const j: any = await res.json();
      expect(res.status).toBe(200);
      // 模拟服务端不实现 principal 发现 → tsdav 会失败，走 URL 回退
      expect(j.success).toBe(true);
      expect(j.degraded).toBeUndefined();
      expect(j.calendars).toHaveLength(1);
      expect(j.calendars[0].url).toContain("/dav/cal/");
      expect(j.warning).toContain("已使用配置的日历 URL");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("POST /sync 推送成功 → 200 + 结果", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    const { server, base } = await startApp();
    try {
      const res = await fetch(`${base}/api/caldav/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "push" }),
      });
      const j: any = await res.json();
      expect(res.status).toBe(200);
      expect(j.success).toBe(true);
      expect(j.pushed).toHaveLength(1);
      expect(store.size).toBe(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("POST /sync 连不上 → 502 + 「本地数据不受影响」", async () => {
    clearWorld();
    seedWorkspace([meeting]);
    // 指到一个必然拒绝连接的端口（config.json 优先级更高，两处都要改）
    process.env.CALDAV_ROOT_URL = "http://127.0.0.1:1";
    process.env.CALDAV_CALENDAR_URL = "http://127.0.0.1:1/dav/cal/";
    writeCalDAVConfig({
      rootUrl: "http://127.0.0.1:1",
      calendarUrl: "http://127.0.0.1:1/dav/cal/",
    });

    const { server, base } = await startApp();
    try {
      const res = await fetch(`${base}/api/caldav/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "pull" }),
      });
      const j: any = await res.json();
      expect(res.status).toBe(502);
      expect(j.kind).toBe("connection");
      expect(j.message).toContain("本地数据不受影响");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
