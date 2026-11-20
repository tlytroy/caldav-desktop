/**
 * 前端认证（P5 / F1–F2）
 *
 * 只测三件必须成立的事：
 *  - token 存 / 取 / 清（不碰 URL、不碰 cookie）
 *  - 后端 401 时 AuthGate 显示令牌页；200 时直接放行
 *  - 建出来的 axios 实例真的带 Authorization
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const state: {
  status: number | null;
  reqHandler?: (c: any) => any;
} = { status: 200 };

vi.mock("axios", () => {
  const api: any = {
    get: vi.fn(() => {
      if (state.status === null) return Promise.reject(new Error("ECONNREFUSED"));
      if (state.status === 401) {
        return Promise.reject({ response: { status: 401 } });
      }
      return Promise.resolve({ data: { success: true }, status: state.status });
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    create: () => api,
    interceptors: {
      request: {
        use: (fn: (c: any) => any) => {
          state.reqHandler = fn;
        },
      },
      response: { use: () => {} },
    },
  };
  return { default: api };
});

import { clearApiToken, getApiToken, setApiToken } from "../api/token";
import { createApiClient } from "../api/client";
import { AuthGate } from "../components/auth/AuthGate";

beforeEach(() => {
  clearApiToken();
  state.status = 200;
  state.reqHandler = undefined;
});

describe("token 存取", () => {
  it("存取清", () => {
    expect(getApiToken()).toBe("");
    setApiToken("  abc  ");
    expect(getApiToken()).toBe("abc");
    clearApiToken();
    expect(getApiToken()).toBe("");
  });
});

describe("createApiClient", () => {
  it("有 token 时注入 Bearer 头", () => {
    setApiToken("tok-123");
    createApiClient(1000);
    const cfg = state.reqHandler?.({ headers: {} });
    expect(cfg.headers.Authorization).toBe("Bearer tok-123");
  });

  it("没有 token 时不带 Authorization", () => {
    createApiClient(1000);
    const cfg = state.reqHandler?.({ headers: {} });
    expect(cfg.headers.Authorization).toBeUndefined();
  });
});

describe("AuthGate", () => {
  it("后端未开认证（200）直接渲染子节点", async () => {
    render(
      <AuthGate>
        <div>应用内容</div>
      </AuthGate>,
    );
    expect(await screen.findByText("应用内容")).toBeTruthy();
  });

  it("401 时显示令牌页，且不渲染应用", async () => {
    state.status = 401;
    render(
      <AuthGate>
        <div>应用内容</div>
      </AuthGate>,
    );
    expect(await screen.findByText("需要访问令牌")).toBeTruthy();
    expect(screen.queryByText("应用内容")).toBeNull();
    expect(screen.getAllByText(/api-token\.txt/).length).toBeGreaterThan(0);
  });

  it("后端连不上时不挡路（交给离线横幅）", async () => {
    state.status = null;
    render(
      <AuthGate>
        <div>应用内容</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByText("应用内容")).toBeTruthy());
  });
});
