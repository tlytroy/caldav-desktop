import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let workspaceRouter: any;
let tmpDir: string;
let wsFile: string;
let baseUrl: string;
let server: any;

/** 启动一个只挂 workspace 路由的测试服务器 */
beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-api-test-"));
  wsFile = path.join(tmpDir, "workspace.md");
  process.env.WORKSPACE_FILE = wsFile;

  ({ workspaceRouter } = await import("../routes/workspace.js"));

  const app = express();
  app.use(express.json());
  app.use("/api/workspace", workspaceRouter);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.WORKSPACE_FILE;
});

beforeEach(() => {
  if (fs.existsSync(wsFile)) fs.unlinkSync(wsFile);
});

async function get(p: string) {
  const res = await fetch(`${baseUrl}${p}`);
  return { status: res.status, json: await res.json() };
}

async function post(p: string, body: any) {
  const res = await fetch(`${baseUrl}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function put(p: string, body: any) {
  const res = await fetch(`${baseUrl}${p}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function del(p: string) {
  const res = await fetch(`${baseUrl}${p}`, { method: "DELETE" });
  return { status: res.status, json: await res.json() };
}

describe("workspace API —— 列表与筛选", () => {
  it("空文件时返回空列表", async () => {
    const r = await get("/api/workspace/items");
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([]);
    expect(r.json.count).toBe(0);
  });

  it("创建后能列出来", async () => {
    await post("/api/workspace/items", {
      title: "体检",
      kind: "task",
      start: "2026-10-28T09:00:00",
      end: "2026-10-28T10:00:00",
    });
    const r = await get("/api/workspace/items");
    expect(r.json.count).toBe(1);
    expect(r.json.items[0].title).toBe("体检");
  });

  it("scope=calendar 只返回有 start 的", async () => {
    await post("/api/workspace/items", {
      title: "有时间的",
      kind: "task",
      start: "2026-10-01T09:00:00",
    });
    await post("/api/workspace/items", { title: "无时间的", kind: "task" });
    const r = await get("/api/workspace/items?scope=calendar");
    expect(r.json.count).toBe(1);
    expect(r.json.items[0].title).toBe("有时间的");
  });

  it("scope=board 只返回 task", async () => {
    await post("/api/workspace/items", { title: "任务", kind: "task" });
    await post("/api/workspace/items", { title: "事件", kind: "event" });
    const r = await get("/api/workspace/items?scope=board");
    expect(r.json.count).toBe(1);
    expect(r.json.items[0].title).toBe("任务");
  });

  it("同一条件：任务同时出现在日历与看板视图", async () => {
    await post("/api/workspace/items", {
      title: "体检",
      kind: "task",
      start: "2026-10-28T09:00:00",
    });
    const cal = await get("/api/workspace/items?scope=calendar");
    const board = await get("/api/workspace/items?scope=board");
    expect(cal.json.items.map((i: any) => i.title)).toContain("体检");
    expect(board.json.items.map((i: any) => i.title)).toContain("体检");
  });

  it("按日期范围过滤", async () => {
    await post("/api/workspace/items", {
      title: "十月",
      start: "2026-10-15T09:00:00",
    });
    await post("/api/workspace/items", {
      title: "十一月",
      start: "2026-11-15T09:00:00",
    });
    const r = await get(
      "/api/workspace/items?start=2026-10-01&end=2026-10-31",
    );
    expect(r.json.count).toBe(1);
    expect(r.json.items[0].title).toBe("十月");
  });

  it("includeDone=false 排除已完成", async () => {
    await post("/api/workspace/items", {
      title: "做完了",
      kind: "task",
      done: true,
    });
    const r = await get("/api/workspace/items?includeDone=false");
    expect(r.json.count).toBe(0);
  });
});

describe("workspace API —— 创建时的 schema 校验", () => {
  it("缺少 title 被拒绝", async () => {
    const r = await post("/api/workspace/items", { kind: "task" });
    expect(r.status).toBe(400);
    expect(r.json.errors.join(" ")).toContain("title");
  });

  it("非法 kind 被拒绝", async () => {
    const r = await post("/api/workspace/items", {
      title: "x",
      kind: "不存在的类型",
    });
    expect(r.status).toBe(400);
    expect(r.json.errors.join(" ")).toContain("kind");
  });

  it("非法 priority 被拒绝", async () => {
    const r = await post("/api/workspace/items", {
      title: "x",
      priority: "urgent",
    });
    expect(r.status).toBe(400);
    expect(r.json.errors.join(" ")).toContain("priority");
  });

  it("非法时间格式被拒绝", async () => {
    const r = await post("/api/workspace/items", {
      title: "x",
      start: "2026/10/01 9:00",
    });
    expect(r.status).toBe(400);
    expect(r.json.errors.join(" ")).toContain("start");
  });

  it("非法 RRULE 被拒绝", async () => {
    const r = await post("/api/workspace/items", {
      title: "x",
      recurrence: "FREQ=HOURLY",
    });
    expect(r.status).toBe(400);
    expect(r.json.errors.join(" ")).toContain("recurrence");
  });

  it("未知字段被拒绝（AI 乱写防护）", async () => {
    const r = await post("/api/workspace/items", {
      title: "x",
      恶意字段: "y",
    });
    expect(r.status).toBe(400);
    expect(r.json.errors.join(" ")).toContain("未知字段");
  });

  it("end 不晚于 start 被拒绝", async () => {
    const r = await post("/api/workspace/items", {
      title: "x",
      start: "2026-10-01T10:00:00",
      end: "2026-10-01T09:00:00",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("end");
  });

  it("id 重复被拒绝", async () => {
    await post("/api/workspace/items", { id: "12345678", title: "甲" });
    const r = await post("/api/workspace/items", { id: "12345678", title: "乙" });
    expect(r.status).toBe(409);
  });

  it("不传 id 时自动生成", async () => {
    const r = await post("/api/workspace/items", { title: "自动 id" });
    expect(r.status).toBe(201);
    expect(r.json.item.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("合法条目带 RRULE 能创建", async () => {
    const r = await post("/api/workspace/items", {
      title: "晨会",
      kind: "event",
      start: "2026-10-05T09:00:00",
      end: "2026-10-05T10:00:00",
      recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    });
    expect(r.status).toBe(201);
    expect(r.json.item.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });
});

describe("workspace API —— 更新与删除", () => {
  it("更新标题", async () => {
    const c = await post("/api/workspace/items", { title: "旧标题" });
    const id = c.json.item.id;
    const r = await put(`/api/workspace/items/${id}`, { title: "新标题" });
    expect(r.status).toBe(200);
    expect(r.json.item.title).toBe("新标题");
  });

  it("更新 id 字段被拒绝（不可改主键）", async () => {
    const c = await post("/api/workspace/items", { title: "x" });
    const id = c.json.item.id;
    const r = await put(`/api/workspace/items/${id}`, { id: "aaaaaaaa" });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("id");
  });

  it("更新未知字段被拒绝并列出可改字段", async () => {
    const c = await post("/api/workspace/items", { title: "x" });
    const id = c.json.item.id;
    const r = await put(`/api/workspace/items/${id}`, { 乱写: 1 });
    expect(r.status).toBe(400);
    expect(Array.isArray(r.json.editableFields)).toBe(true);
    expect(r.json.editableFields).toContain("title");
  });

  it("更新时同样做 schema 校验", async () => {
    const c = await post("/api/workspace/items", { title: "x" });
    const id = c.json.item.id;
    const r = await put(`/api/workspace/items/${id}`, { priority: "urgent" });
    expect(r.status).toBe(400);
  });

  it("删除一条", async () => {
    const c = await post("/api/workspace/items", { title: "待删" });
    const id = c.json.item.id;
    const r = await del(`/api/workspace/items/${id}`);
    expect(r.status).toBe(200);
    expect(r.json.removed.title).toBe("待删");
    const list = await get("/api/workspace/items");
    expect(list.json.count).toBe(0);
  });

  it("删除不存在的条目返回 404", async () => {
    const r = await del("/api/workspace/items/zzzzzzzz");
    expect(r.status).toBe(404);
  });

  it("更新不存在的条目返回 404", async () => {
    const r = await put("/api/workspace/items/zzzzzzzz", { title: "x" });
    expect(r.status).toBe(404);
  });

  it("标记完成", async () => {
    const c = await post("/api/workspace/items", {
      title: "任务",
      kind: "task",
    });
    const id = c.json.item.id;
    const r = await put(`/api/workspace/items/${id}`, { done: true });
    expect(r.json.item.done).toBe(true);
  });
});

describe("workspace API —— 校验报告", () => {
  it("文件干净时无问题", async () => {
    await post("/api/workspace/items", { title: "正常" });
    const r = await get("/api/workspace/validation");
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(1);
    expect(r.json.invalid).toBe(0);
  });

  it("能探测到被改坏的数据", async () => {
    // 直接往文件里写一条坏数据（模拟 AI 乱改）
    fs.writeFileSync(
      wsFile,
      `---
schema: workbench/v1
---

## 好的
- id: 11111111
- kind: task

## 坏的
- id: 22222222
- kind: 瞎写的类型
`,
      "utf-8",
    );
    const r = await get("/api/workspace/validation");
    expect(r.json.total).toBe(2);
    expect(r.json.invalid).toBe(1);
    expect(r.json.issues).toHaveLength(1);
  });

  it("坏数据不会污染正常条目", async () => {
    fs.writeFileSync(
      wsFile,
      `---
schema: workbench/v1
---

## 好的
- id: 11111111
- kind: task
- title: 好的条目
`,
      "utf-8",
    );
    const r = await get("/api/workspace/items");
    expect(r.json.count).toBe(1);
    expect(r.json.items[0].title).toBe("好的条目");
  });
});

describe("workspace API —— 重复规则", () => {
  it("展开重复事件成多个实例", async () => {
    await post("/api/workspace/items", {
      title: "晨会",
      kind: "event",
      start: "2026-10-05T09:00:00",
      end: "2026-10-05T10:00:00",
      recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    });
    const r = await get(
      "/api/workspace/items?expand=true&start=2026-10-01&end=2026-10-20",
    );
    expect(r.json.count).toBeGreaterThanOrEqual(4);
    // 实例带 instanceId 指向原始条目
    for (const it of r.json.items) {
      expect(it.instanceId).toBeTruthy();
      expect(it.instanceDate).toBeTruthy();
    }
  });

  it("预览重复规则", async () => {
    const r = await get(
      "/api/workspace/recurrence/preview?rule=FREQ%3DWEEKLY%3BBYDAY%3DMO%2CWE%2CFR&start=2026-10-05T09%3A00%3A00&weeks=2",
    );
    expect(r.status).toBe(200);
    expect(r.json.label).toBe("每周一、三、五");
    // 2 周区间 = 起始日 + 14 天（含边界），共 7 个实例
    expect(r.json.dates).toEqual([
      "2026-10-05",
      "2026-10-07",
      "2026-10-09",
      "2026-10-12",
      "2026-10-14",
      "2026-10-16",
      "2026-10-19",
    ]);
  });

  it("预览非法 RRULE 返回 400", async () => {
    const r = await get(
      "/api/workspace/recurrence/preview?rule=FREQ%3DHOURLY&start=2026-10-05T09%3A00%3A00",
    );
    expect(r.status).toBe(400);
  });

  it("重复规则选项列表可读", async () => {
    const r = await get("/api/workspace/recurrence/options");
    expect(r.status).toBe(200);
    expect(r.json.options.length).toBeGreaterThan(5);
    expect(r.json.options.some((o: any) => o.label === "每周一、三、五")).toBe(true);
  });
});

describe("workspace API —— 文件信息", () => {
  it("返回数据源位置与统计", async () => {
    await post("/api/workspace/items", {
      title: "任务",
      kind: "task",
      start: "2026-10-01T09:00:00",
    });
    await post("/api/workspace/items", {
      title: "事件",
      kind: "event",
      start: "2026-10-02T09:00:00",
    });
    const r = await get("/api/workspace/info");
    expect(r.status).toBe(200);
    expect(r.json.filePath).toContain("workspace.md");
    expect(r.json.total).toBe(2);
    expect(r.json.tasks).toBe(1);
    expect(r.json.events).toBe(1);
    expect(r.json.scheduled).toBe(2);
  });
});
