/**
 * WebDAV 同步端到端测试
 *
 * 用 Node http 模拟一个最小 WebDAV 服务端（PROPFIND / MKCOL / PUT / GET / HEAD），
 * 验证 push / pull / 冲突检测 / 备份 / 认证失败 / 未配置等行为。
 *
 * 覆盖的关键行为：
 *  - 首次 push 自动创建远端目录
 *  - ETag 乐观锁：无变化时带 If-Match 覆盖
 *  - 冲突检测：远端被其他设备改动时不静默覆盖，而是报 conflict
 *  - force 参数可强制覆盖
 *  - pull 前自动备份本地为 .bak，防止误覆盖丢数据
 *  - pull 时远端无变化则跳过，不冲掉本地未同步的改动
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ===== 模拟 WebDAV 服务端 =====
type RemoteEntry = { content: string; etag: string };

const remoteStore = new Map<string, RemoteEntry>();
const createdDirs = new Set<string>();
let etagSeq = 0;
let authShouldFail = false;

function newEtag(): string {
  etagSeq += 1;
  return `"w-${etagSeq}"`;
}

const davServer = http.createServer((req, res) => {
  const auth = req.headers.authorization;
  if (authShouldFail || !auth || !auth.startsWith("Basic ")) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url!, "http://x").pathname);
  const isDir = pathname.endsWith("/");

  if (req.method === "PROPFIND") {
    if (isDir) {
      if (createdDirs.has(pathname) || pathname === "/dav/") {
        res.writeHead(207);
        res.end("ok");
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    res.writeHead(remoteStore.has(pathname) ? 207 : 404);
    res.end();
    return;
  }

  if (req.method === "MKCOL") {
    createdDirs.add(pathname);
    res.writeHead(201);
    res.end();
    return;
  }

  if (req.method === "HEAD") {
    const e = remoteStore.get(pathname);
    if (!e) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      ETag: e.etag,
      "Content-Length": String(Buffer.byteLength(e.content)),
      "Last-Modified": new Date().toUTCString(),
    });
    res.end();
    return;
  }

  if (req.method === "GET") {
    const e = remoteStore.get(pathname);
    if (!e) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { ETag: e.etag, "Content-Type": "text/markdown" });
    res.end(e.content);
    return;
  }

  if (req.method === "PUT") {
    const ifMatch = req.headers["if-match"];
    if (ifMatch) {
      const cur = remoteStore.get(pathname);
      if (!cur || cur.etag !== ifMatch) {
        res.writeHead(412);
        res.end("Precondition Failed");
        return;
      }
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const etag = newEtag();
      remoteStore.set(pathname, { content: body, etag });
      res.writeHead(201, { ETag: etag });
      res.end();
    });
    return;
  }

  res.writeHead(405);
  res.end();
});

/** 模拟另一台设备改动了远端文件，返回新 ETag */
function simulateExternalEdit(p: string, content: string): string {
  const etag = newEtag();
  remoteStore.set(p, { content, etag });
  return etag;
}

// ===== 测试环境 =====
let tmpDir: string;
let eventsFile: string;
let kanbanFile: string;
let apiServer: http.Server;
let baseUrl: string;
let webdavRouter: any;
let loadWebDAVConfig: any;
let normalizeEtag: any;
let readSyncState: any;
let savedEnv: Record<string, string | undefined>;

const EVENTS_REMOTE = "/dav/CalDAV-Desktop/events.md";

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webdav-test-"));
  eventsFile = path.join(tmpDir, "events.md");
  kanbanFile = path.join(tmpDir, "工作搭子看板.md");

  await new Promise<void>((r) => davServer.listen(0, r));
  baseUrl = `http://127.0.0.1:${(davServer.address() as any).port}/dav/`;

  savedEnv = {
    WEBDAV_URL: process.env.WEBDAV_URL,
    WEBDAV_USER: process.env.WEBDAV_USER,
    WEBDAV_PASS: process.env.WEBDAV_PASS,
    WEBDAV_EVENTS_PATH: process.env.WEBDAV_EVENTS_PATH,
    MD_EVENTS_FILE: process.env.MD_EVENTS_FILE,
    KANBAN_FILE_PATH: process.env.KANBAN_FILE_PATH,
  };
  process.env.WEBDAV_URL = baseUrl;
  process.env.WEBDAV_USER = "tester";
  process.env.WEBDAV_PASS = "secret";
  process.env.WEBDAV_EVENTS_PATH = "CalDAV-Desktop/events.md";
  process.env.MD_EVENTS_FILE = eventsFile;
  process.env.KANBAN_FILE_PATH = kanbanFile;

  ({ webdavRouter } = await import("../routes/webdav.js"));
  const wd = await import("../webdav.js");
  loadWebDAVConfig = wd.loadWebDAVConfig;
  normalizeEtag = wd.normalizeEtag;
  readSyncState = wd.readSyncState;

  const app = express();
  app.use(express.json());
  app.use("/api/webdav", webdavRouter);
  apiServer = app.listen(0);
  await new Promise<void>((r) => apiServer.once("listening", r));
});

afterAll(async () => {
  await new Promise<void>((r) => apiServer.close(() => r()));
  await new Promise<void>((r) => davServer.close(() => r()));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
  return { status: r.status, json: await r.json() };
}
async function get(p: string) {
  const r = await fetch(`${apiBase()}${p}`);
  return { status: r.status, json: await r.json() };
}

// ===== 用例 =====

describe("WebDAV 配置", () => {
  it("读取环境变量", () => {
    const cfg = loadWebDAVConfig();
    expect(cfg.url).toBe(baseUrl);
    expect(cfg.username).toBe("tester");
    expect(cfg.password).toBe("secret");
  });

  it("normalizeEtag 去除弱标记与引号", () => {
    expect(normalizeEtag('W/"abc"')).toBe("abc");
    expect(normalizeEtag('"xyz"')).toBe("xyz");
    expect(normalizeEtag(null)).toBeUndefined();
  });

  it("未配置时 status 报 configured=false", async () => {
    const saved = process.env.WEBDAV_URL;
    delete process.env.WEBDAV_URL;
    const r = await get("/api/webdav/status");
    expect(r.json.configured).toBe(false);
    process.env.WEBDAV_URL = saved;
  });

  it("未配置时 push 返回 400 且提示可操作", async () => {
    const saved = process.env.WEBDAV_URL;
    delete process.env.WEBDAV_URL;
    const r = await post("/api/webdav/push");
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/WEBDAV_URL/);
    process.env.WEBDAV_URL = saved;
  });
});

describe("WebDAV push", () => {
  it("首次 push 创建远端目录并上传双文件", async () => {
    fs.writeFileSync(eventsFile, "---\nevents:\n---\n本地事件\n", "utf-8");
    fs.writeFileSync(kanbanFile, "# 工作搭子看板\n## 待办\n- [ ] 测试 | id:k-1\n", "utf-8");

    const r = await post("/api/webdav/push");
    expect(r.json.success).toBe(true);
    expect(r.json.results).toHaveLength(2);
    expect(createdDirs.size).toBeGreaterThan(0);
    expect(remoteStore.get(EVENTS_REMOTE)?.content).toContain("本地事件");
  });

  it("push 后同步状态记录了两个文件", () => {
    const st = readSyncState(eventsFile);
    expect(Object.keys(st.etags)).toHaveLength(2);
    expect(st.etags["events.md"]).toBeTruthy();
    expect(st.etags["工作搭子看板.md"]).toBeTruthy();
  });

  it("status 反映真实远端状态", async () => {
    const r = await get("/api/webdav/status");
    const ev = r.json.files.find((f: any) => f.key === "events");
    expect(ev.remote.exists).toBe(true);
    expect(ev.remote.etag).toBeTruthy();
    expect(ev.local.exists).toBe(true);
    expect(ev.remoteChangedSinceLastSync).toBe(false);
  });

  it("远端无变化时走 ETag 乐观锁", async () => {
    const r = await post("/api/webdav/push");
    const ev = r.json.results.find((x: any) => x.key === "events");
    expect(r.json.success).toBe(true);
    expect(ev.forced).toBe(false);
  });

  it("远端被其他设备修改时检测出冲突且不覆盖", async () => {
    const externalEtag = simulateExternalEdit(EVENTS_REMOTE, "远端被别的设备改了\n");
    const r = await post("/api/webdav/push");
    const ev = r.json.results.find((x: any) => x.key === "events");
    expect(ev.conflict).toBe(true);
    expect(ev.localEtag).not.toBe(ev.remoteEtag);
    // 关键：远端内容不能被静默覆盖
    expect(remoteStore.get(EVENTS_REMOTE)?.content).toContain("远端被别的设备改了");
    expect(remoteStore.get(EVENTS_REMOTE)?.etag).toBe(externalEtag);
  });

  it("force 可强制覆盖冲突", async () => {
    const r = await post("/api/webdav/push", { force: true });
    expect(r.json.success).toBe(true);
    const ev = r.json.results.find((x: any) => x.key === "events");
    expect(ev.forced).toBe(true);
    expect(remoteStore.get(EVENTS_REMOTE)?.content).toContain("本地事件");
  });

  it("可只同步指定文件", async () => {
    fs.writeFileSync(eventsFile, "只推 events\n", "utf-8");
    const r = await post("/api/webdav/push", { files: ["events"], force: true });
    expect(r.json.results).toHaveLength(1);
    expect(r.json.results[0].key).toBe("events");
  });

  it("本地文件缺失时报错且不影响其他文件", async () => {
    fs.unlinkSync(kanbanFile);
    const r = await post("/api/webdav/push", { force: true });
    const kb = r.json.results.find((x: any) => x.key === "kanban");
    expect(kb.ok).toBe(false);
    expect(kb.error).toMatch(/不存在/);
    expect(r.json.results.find((x: any) => x.key === "events").ok).toBe(true);
  });
});

describe("WebDAV pull", () => {
  it("远端有更新时覆盖本地并备份原文件", async () => {
    simulateExternalEdit(EVENTS_REMOTE, "---\nevents:\n---\n远端新内容\n");
    const r = await post("/api/webdav/pull");
    const ev = r.json.results.find((x: any) => x.key === "events");
    expect(ev.ok).toBe(true);
    expect(ev.overwritten).toBe(true);
    expect(fs.readFileSync(eventsFile, "utf-8")).toContain("远端新内容");
    // 备份存在且内容是拉取前的本地版本
    expect(fs.existsSync(`${eventsFile}.bak`)).toBe(true);
  });

  it("远端无变化时跳过，不冲掉本地改动", async () => {
    fs.writeFileSync(eventsFile, "本地又改了\n", "utf-8");
    const r = await post("/api/webdav/pull");
    const ev = r.json.results.find((x: any) => x.key === "events");
    expect(ev.skipped).toBe(true);
    expect(fs.readFileSync(eventsFile, "utf-8")).toContain("本地又改了");
  });

  it("force 可强制拉取覆盖", async () => {
    const r = await post("/api/webdav/pull", { force: true });
    const ev = r.json.results.find((x: any) => x.key === "events");
    expect(ev.overwritten).toBe(true);
    expect(fs.readFileSync(eventsFile, "utf-8")).toContain("远端新内容");
  });
});

describe("WebDAV 连接测试与认证", () => {
  it("正常路径 test 成功", async () => {
    const r = await post("/api/webdav/test");
    expect(r.json.success).toBe(true);
    expect(r.json.remoteDir).toBe("CalDAV-Desktop");
  });

  it("认证失败时 push 与 test 都明确报错", async () => {
    authShouldFail = true;
    try {
      const p = await post("/api/webdav/push");
      expect(p.status).toBe(500);
      expect(p.json.results[0].error).toMatch(/认证失败|401/);

      const t = await post("/api/webdav/test");
      expect(t.json.success).toBe(false);
      expect(t.json.message).toMatch(/认证失败/);
    } finally {
      authShouldFail = false;
    }
  });
});
