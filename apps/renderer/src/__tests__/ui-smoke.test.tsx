/**
 * 前端渲染冒烟测试
 *
 * 目的：验证「接口通了」不等于「界面能用」。
 * 用 jsdom + testing-library 真实挂载 React 组件，确认关键 UI 元素出现。
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// jsdom 环境（vitest 默认是 node，需要显式指定）
// @vitest-environment jsdom

// mock axios，避免真实网络请求
vi.mock("axios", () => {
  const mockAxios = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    create: () => mockAxios,
  };
  return { default: mockAxios };
});

import axios from "axios";

const mockedAxios = axios as any;

/** 构造一个 axios 风格响应 */
function resp(data: any) {
  return { data, status: 200, headers: {}, config: {} };
}

beforeAll(() => {
  // 所有请求返回空但合法的基础数据
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes("/api/md-bridge/events")) {
      return Promise.resolve(
        resp({
          success: true,
          events: [
            {
              uid: "e1",
              title: "测试事件",
              date: "2026-10-27T10:00:00",
              end: "2026-10-27T11:00:00",
              allDay: false,
            },
          ],
          body: "",
          filePath: "./events.md",
        }),
      );
    }
    if (url.includes("/api/kanban")) {
      return Promise.resolve(
        resp({
          success: true,
          todos: [
            {
              id: "k1",
              done: false,
              priority: "高",
              title: "测试任务",
              due: "2026-10-28",
            },
          ],
          projects: [],
          notes: [],
          body: "",
          filePath: "./工作搭子看板.md",
        }),
      );
    }
    if (url.includes("/api/nlp/status")) {
      return Promise.resolve(
        resp({
          success: true,
          localParser: true,
          aiEnabled: false,
          aiModel: null,
          speechEnabled: false,
        }),
      );
    }
    if (url.includes("/api/config")) {
      return Promise.resolve(
        resp({
          success: true,
          config: {
            language: "zh-CN",
            theme: "system",
            colorScheme: "classic",
            borderRadius: "rounded-lg",
            ai: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
              model: "gpt-4o-mini",
              timeoutMs: 30000,
              temperature: 0.1,
              whisperModel: "whisper-1",
              whisperLanguage: "zh",
            },
            caldav: {
              rootUrl: "",
              username: "",
              password: "",
              syncDirection: "bidirectional",
              autoSyncMinutes: 0,
            },
            webdav: {
              enabled: false,
              url: "",
              username: "",
              password: "",
              remoteDir: "CalDAV-Desktop",
              timeoutMs: 20000,
            },
            nlp: { preferAI: false, parserLocale: "zh-CN" },
            paths: { eventsFile: "./events.md", kanbanFile: "./工作搭子看板.md" },
          },
          file: { path: "/tmp/config.json", exists: true },
        }),
      );
    }
    return Promise.resolve(resp([]));
  });

  mockedAxios.post.mockResolvedValue(resp({ success: true }));
  mockedAxios.put.mockResolvedValue(resp({ success: true }));
  mockedAxios.patch.mockResolvedValue(resp({ success: true }));
  mockedAxios.delete.mockResolvedValue(resp({ success: true }));
});

describe("快速创建组件渲染", () => {
  it("渲染出输入框与解析按钮", async () => {
    const { default: QuickCreate } = await import(
      "../components/QuickCreate"
    );
    const { container } = render(
      React.createElement(QuickCreate, { onCreate: async () => {} }),
    );

    await waitFor(() => {
      expect(container.querySelector("input")).toBeTruthy();
    });
    // 直接查属性，避免 getByPlaceholder 对全角字符的正则匹配差异
    const input = container.querySelector("input")!;
    expect(input.getAttribute("placeholder")).toContain("说点什么");
    expect(screen.getByText("解析")).toBeTruthy();
  });

  it("有语音输入按钮", async () => {
    const { default: QuickCreate } = await import(
      "../components/QuickCreate"
    );
    const { container } = render(
      React.createElement(QuickCreate, { onCreate: async () => {} }),
    );
    await waitFor(() => {
      expect(container.querySelector("input")).toBeTruthy();
    });
    // 麦克风图标存在（lucide 的 svg）
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("设置界面渲染", () => {
  it("渲染出四个标签页", async () => {
    const { default: ConfigSettings } = await import(
      "../components/settings/ConfigSettings"
    );
    render(React.createElement(ConfigSettings));

    await waitFor(() => {
      expect(screen.getByText("通用")).toBeTruthy();
    });
    expect(screen.getByText("AI 解析")).toBeTruthy();
    expect(screen.getByText("同步")).toBeTruthy();
    expect(screen.getByText("数据文件")).toBeTruthy();
  });

  it("AI 标签页有可填的 endpoint 输入框", async () => {
    const { default: ConfigSettings } = await import(
      "../components/settings/ConfigSettings"
    );
    const { container } = render(React.createElement(ConfigSettings));

    await waitFor(() => {
      expect(screen.getByText("AI 解析")).toBeTruthy();
    });
    // 点 AI 标签页
    screen.getByText("AI 解析").click();

    await waitFor(() => {
      expect(screen.getByText("接口地址")).toBeTruthy();
    });
    expect(container.querySelectorAll("input").length).toBeGreaterThan(3);
  });
});

describe("i18n 生效", () => {
  it("英文界面显示英文文案", async () => {
    const { useI18nStore } = await import("../i18n");
    useI18nStore.getState().setLocale("en-US");

    const { default: ConfigSettings } = await import(
      "../components/settings/ConfigSettings"
    );
    render(React.createElement(ConfigSettings));

    await waitFor(() => {
      expect(screen.getByText("General")).toBeTruthy();
    });
    expect(screen.getByText("AI Parsing")).toBeTruthy();

    // 复原
    useI18nStore.getState().setLocale("zh-CN");
  });

  it("中文界面显示中文文案", async () => {
    const { useI18nStore } = await import("../i18n");
    useI18nStore.getState().setLocale("zh-CN");

    const { default: ConfigSettings } = await import(
      "../components/settings/ConfigSettings"
    );
    render(React.createElement(ConfigSettings));

    await waitFor(() => {
      expect(screen.getByText("通用")).toBeTruthy();
    });
  });
});
