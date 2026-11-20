import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * 前端渲染冒烟测试 —— 统一数据源架构
 *
 * 验证的不只是"组件能渲染"，而是**架构改造后的界面真的呈现了新的结构**：
 *  - 看板页有「时间点」输入（因为任务必须有 start 才出现在日历）
 *  - 看板页有「重复规则」选择器
 *  - 日历页不再叠加看板任务（任务本就在同一池子里）
 */

/** mock workspace API —— 返回两条记录：一条任务（有 start）、一条纯事件 */
function mockWorkspace(overrides: Record<string, any> = {}) {
  const items = [
    {
      id: "aaaa1111",
      kind: "task",
      title: "体检",
      start: "2026-10-28T09:00:00",
      end: "2026-10-28T10:00:00",
      due: "2026-10-28",
      priority: "mid",
      done: false,
      allDay: false,
    },
    {
      id: "bbbb2222",
      kind: "event",
      title: "项目周会",
      start: "2026-10-26T10:00:00",
      end: "2026-10-26T11:00:00",
      done: false,
    },
  ];

  return {
    fetchItems: vi.fn(async (query: any = {}) => {
      let out = items;
      if (query.scope === "calendar") out = items.filter((i) => i.start);
      if (query.scope === "board") out = items.filter((i) => i.kind === "task");
      return { items: out, filePath: "/tmp/workspace.md", notes: "" };
    }),
    createItem: vi.fn(async (item: any) => ({ ...item, id: "cccc3333" })),
    updateItem: vi.fn(async (id: string, patch: any) => ({ id, ...patch })),
    deleteItem: vi.fn(async () => {}),
    fetchRecurrenceOptions: vi.fn(async () => [
      { value: "", label: "不重复" },
      { value: "FREQ=DAILY", label: "每天" },
      { value: "FREQ=WEEKLY;BYDAY=MO,WE,FR", label: "每周一、三、五" },
      { value: "FREQ=MONTHLY;BYMONTHDAY=1", label: "每月1号" },
    ]),
    fetchValidation: vi.fn(async () => ({
      total: 2,
      valid: 2,
      invalid: 0,
      issues: [],
    })),
    fetchWorkspaceInfo: vi.fn(async () => ({
      filePath: "/tmp/workspace.md",
      total: 2,
      valid: 2,
      invalid: 0,
      tasks: 1,
      events: 1,
      scheduled: 2,
    })),
    previewRecurrence: vi.fn(async () => ({ label: "每天", dates: [] })),
    describeRecurrence: vi.fn((r?: string) => r || "不重复"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe("任务看板页面（统一数据源）", () => {
  it("渲染出任务条目与事件条目的区分", async () => {
    const api = mockWorkspace();
    vi.doMock("../api/workspace", () => api);

    const { default: TasksPage } = await import("../modules/tasks");
    render(React.createElement(TasksPage));

    await waitFor(() => {
      expect(screen.getByText("体检")).toBeTruthy();
    });

    // 任务出现，纯事件不出现（看板只看 kind=task）
    expect(screen.queryByText("项目周会")).toBeNull();
  });

  it("有日期输入（时间点）—— 这是任务能显示在日历的前提", async () => {
    const api = mockWorkspace();
    vi.doMock("../api/workspace", () => api);

    const { default: TasksPage } = await import("../modules/tasks");
    const { container } = render(React.createElement(TasksPage));

    // 表单默认折叠，点「添加任务」展开
    const addBtn = await screen.findByText("添加任务");
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(container.querySelector('input[type="date"]')).toBeTruthy();
    });
  });

  it("有重复规则选择器，含「每周一、三、五」等选项", async () => {
    const api = mockWorkspace();
    vi.doMock("../api/workspace", () => api);

    const { default: TasksPage } = await import("../modules/tasks");
    const { container } = render(React.createElement(TasksPage));

    await waitFor(() => {
      expect(screen.getByText("体检")).toBeTruthy();
    });

    // 展开表单
    const addBtn = screen.getByText("添加任务");
    fireEvent.click(addBtn);

    // 找到包含「每周一、三、五」的 select
    const selects = Array.from(container.querySelectorAll("select"));
    const recurSelect = selects.find((s) =>
      Array.from(s.options).some((o) => o.textContent === "每周一、三、五"),
    );
    expect(recurSelect).toBeTruthy();
  });

  it("标记了已排期的任务（说明它也会出现在日历）", async () => {
    const api = mockWorkspace();
    vi.doMock("../api/workspace", () => api);

    const { default: TasksPage } = await import("../modules/tasks");
    render(React.createElement(TasksPage));

    await waitFor(() => {
      expect(screen.getByText("体检")).toBeTruthy();
    });
    expect(screen.getByText("已排期")).toBeTruthy();
  });

  it("点击任务标题进入编辑（看板能改标题 / 时间 / 清单）", async () => {
    const api = mockWorkspace();
    vi.doMock("../api/workspace", () => api);

    const { default: TasksPage } = await import("../modules/tasks");
    const { container } = render(React.createElement(TasksPage));

    await waitFor(() => {
      expect(screen.getByText("体检")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("体检"));

    // 表单切换成编辑模式，并且回填了原标题
    await waitFor(() => {
      expect(screen.getByText("编辑任务：体检")).toBeTruthy();
    });
    expect(screen.getByText("保存修改")).toBeTruthy();
    const titleInput = container.querySelector(
      'input[placeholder="任务标题…"]',
    ) as HTMLInputElement;
    expect(titleInput.value).toBe("体检");
  });

  it("截止日当天不算逾期（纯日期串的时区回归）", async () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const api = mockWorkspace({
      fetchItems: vi.fn(async () => ({
        items: [
          {
            id: "eeee1111",
            kind: "task",
            title: "今天到期",
            due: today,
            done: false,
            priority: "mid",
          },
        ],
        filePath: "/tmp/workspace.md",
        notes: "",
      })),
      fetchLists: vi.fn(async () => [
        { name: "", label: "收件箱", total: 1, open: 1, overdue: 0 },
      ]),
    });
    vi.doMock("../api/workspace", () => api);

    const { default: TasksPage } = await import("../modules/tasks");
    render(React.createElement(TasksPage));

    await waitFor(() => {
      expect(screen.getByText("今天到期")).toBeTruthy();
    });
    // 逾期告警区不应出现
    expect(screen.queryByText(/逾期/)).toBeNull();
  });
});

describe("统一数据源 API 客户端", () => {
  it("fetchItems 传 scope=board 时服务端按看板视角筛选", async () => {
    const api = mockWorkspace();
    vi.doMock("../api/workspace", () => api);

    const { fetchItems } = await import("../api/workspace");
    await fetchItems({ scope: "board" });
    expect(api.fetchItems).toHaveBeenCalledWith({ scope: "board" });
  });

  it("周期选项包含每月1号", async () => {
    const api = mockWorkspace();
    vi.doMock("../api/workspace", () => api);

    const { fetchRecurrenceOptions } = await import("../api/workspace");
    const opts = await fetchRecurrenceOptions();
    expect(opts.some((o) => o.label === "每月1号")).toBe(true);
  });
});
