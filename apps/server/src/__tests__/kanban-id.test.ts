/**
 * 工作搭子看板：任务 id 持久化与行序漂移回归测试
 *
 * 背景：早期实现用「行序」当任务 id（t0/t1/t2...），而 POST /task 新建任务时
 * 用时间戳做 id、写回 md 时又不保存 id。三套体系混用的后果是：
 *   - 新增任务 unshift 到队首 → 所有存量任务 id 整体错位
 *   - 删 A 会按错位的行序找到 B，连带删掉 B 的日历事件
 * 现在 id 持久化在 md 的 `| id:` 字段，本测试锁定该行为。
 */

import { describe, it, expect } from "vitest";
import { parseKanban, serializeKanban } from "../routes/kanban.js";

describe("任务 id 持久化", () => {
  it("id 写入 md 并可回读", () => {
    const text = serializeKanban({
      todos: [
        { id: "k-1", done: false, priority: "高", title: "任务一", calendarEventUid: "uid-1" },
        { id: "k-2", done: false, priority: "中", title: "任务二" },
      ],
      projects: [],
      notes: [],
    });
    expect(text).toContain("id:k-1");
    expect(text).toContain("日历:uid-1");

    const back = parseKanban(text);
    expect(back.todos.map((t) => t.id)).toEqual(["k-1", "k-2"]);
    expect(back.todos[0].calendarEventUid).toBe("uid-1");
    expect(back.todos[0].priority).toBe("高");
  });
});

describe("行序漂移回归（核心修复点）", () => {
  const base = parseKanban(
    serializeKanban({
      todos: [
        { id: "k-1", done: false, priority: "高", title: "任务一", calendarEventUid: "uid-1" },
        { id: "k-2", done: false, priority: "中", title: "任务二" },
      ],
      projects: [],
      notes: [],
    }),
  );

  it("新增任务插到队首后，存量 id 不变", () => {
    const after = serializeKanban({
      ...base,
      todos: [{ id: "k-new", done: false, priority: "低", title: "新任务" }, ...base.todos],
    });
    const ids = parseKanban(after).todos.map((t) => t.id);
    expect(ids).toEqual(["k-new", "k-1", "k-2"]);
    // 旧实现会得到 ["k-new", "t1", "t2"] 之类，存量 id 被顶掉
    expect(ids).toContain("k-1");
    expect(ids).toContain("k-2");
  });

  it("删除中间任务后，其余任务与绑定不受影响", () => {
    const all = parseKanban(
      serializeKanban({
        ...base,
        todos: [{ id: "k-new", done: false, priority: "低", title: "新任务" }, ...base.todos],
      }),
    );
    const after = parseKanban(
      serializeKanban({ ...all, todos: all.todos.filter((t) => t.id !== "k-1") }),
    );
    expect(after.todos).toHaveLength(2);
    expect(after.todos.find((t) => t.id === "k-2")?.title).toBe("任务二");
    expect(after.todos.some((t) => t.id === "k-1")).toBe(false);
  });
});

describe("旧格式兼容", () => {
  const legacy = [
    "# 工作搭子看板",
    "> 最后更新：2026-01-01T00:00:00.000Z",
    "",
    "## 待办",
    "- [ ] [高] 老任务A | 截止:2026-09-01",
    "- [ ] [中] 老任务B | 日历:uid-legacy",
    "",
    "## 项目",
    "## 速记",
  ].join("\n");

  it("无 id 字段的旧文件仍可解析", () => {
    const back = parseKanban(legacy);
    expect(back.todos).toHaveLength(2);
    expect(back.todos[0].title).toBe("老任务A");
    expect(back.todos[0].due).toBe("2026-09-01");
  });

  it("保留旧文件的日历绑定", () => {
    expect(parseKanban(legacy).todos[1].calendarEventUid).toBe("uid-legacy");
  });

  it("回退为行序 id，保证唯一性", () => {
    const ids = parseKanban(legacy).todos.map((t) => t.id);
    expect(ids).toEqual(["t0", "t1"]);
  });
});

describe("项目 / 速记 / 完成态往返", () => {
  it("项目字段完整保留", () => {
    const back = parseKanban(
      serializeKanban({
        todos: [{ id: "k-9", done: false, priority: "低", title: "T" }],
        projects: [
          { name: "示例项目", current: "在做A", next: "做B", blocker: "无", related: ["任务一", "任务二"] },
        ],
        notes: [],
      }),
    );
    expect(back.projects[0].name).toBe("示例项目");
    expect(back.projects[0].current).toBe("在做A");
    expect(back.projects[0].related).toHaveLength(2);
  });

  it("速记标签与正文保留", () => {
    const back = parseKanban(
      serializeKanban({
        todos: [],
        projects: [],
        notes: [{ tags: ["灵感", "产品"], text: "想到一个点子" }],
      }),
    );
    expect(back.notes[0].tags).toHaveLength(2);
    expect(back.notes[0].text).toBe("想到一个点子");
  });

  it("完成标记与完成日期保留", () => {
    const back = parseKanban(
      serializeKanban({
        todos: [{ id: "k-d", done: true, priority: "中", title: "已完成", doneDate: "2026-08-19" }],
        projects: [],
        notes: [],
      }),
    );
    expect(back.todos[0].done).toBe(true);
    expect(back.todos[0].doneDate).toBe("2026-08-19");
  });
});
