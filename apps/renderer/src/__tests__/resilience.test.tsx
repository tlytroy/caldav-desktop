/**
 * 韧性 UI 测试（P4 / F8–F9）
 *
 * 覆盖两件“出事时才有用”的东西：
 *  - 后端不可达 → 明确横幅，不能假装保存
 *  - 渲染崩溃 → 500 页面 + 3 步手工恢复，不是白屏
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const state = { fail: true, infoCalls: 0 };

vi.mock("axios", () => {
  const api = {
    get: vi.fn((url: string) => {
      if (url.includes("/api/workspace/info")) {
        state.infoCalls += 1;
        return state.fail
          ? Promise.reject(new Error("ECONNREFUSED"))
          : Promise.resolve({ data: { success: true } });
      }
      return Promise.resolve({ data: {} });
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    create: () => api,
    interceptors: {
      request: { use: () => {} },
      response: { use: () => {} },
    },
  };
  return { default: api };
});

import { ConnectionBanner } from "../components/ConnectionBanner";
import { ErrorFallback, GlobalErrorBoundary } from "../components/ui/ErrorBoundary";

function Boom(): React.ReactElement {
  throw new Error("kaboom");
}

describe("ConnectionBanner（F8）", () => {
  beforeEach(() => {
    state.fail = true;
    state.infoCalls = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("后端不可达时显示横幅与“不会保存”提示", async () => {
    render(<ConnectionBanner />);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("无法连接后端")).toBeTruthy();
    expect(screen.getByText("此时不会保存任何修改")).toBeTruthy();
  });

  it("点重试后恢复连接，横幅消失", async () => {
    render(<ConnectionBanner />);
    await screen.findByRole("status");

    state.fail = false;
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("连接正常时不渲染任何东西", async () => {
    state.fail = false;
    const { container } = render(<ConnectionBanner />);
    await waitFor(() => expect(state.infoCalls).toBeGreaterThan(0));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe("ErrorFallback（F9）", () => {
  it("显示错误信息、3 步恢复与两个按钮", () => {
    render(<ErrorFallback error={new Error("boom")} resetErrorBoundary={() => {}} />);
    expect(screen.getByText("页面出错了")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getByText("三步手工恢复")).toBeTruthy();
    expect(screen.getByText(/下载最近的备份/)).toBeTruthy();
    expect(screen.getByText("重试渲染")).toBeTruthy();
    expect(screen.getByText("刷新页面")).toBeTruthy();
  });

  it("重试按钮调用 resetErrorBoundary", () => {
    const reset = vi.fn();
    render(<ErrorFallback error={new Error("x")} resetErrorBoundary={reset} />);
    fireEvent.click(screen.getByText("重试渲染"));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("GlobalErrorBoundary 捕获子树异常并渲染兜底页", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <GlobalErrorBoundary>
        <Boom />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByText("页面出错了")).toBeTruthy();
  });
});
