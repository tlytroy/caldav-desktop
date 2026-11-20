import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * F5 —— 同步中心（只读概览）
 *
 * 关键行为：
 *  1. 未配置同步时显示「未配置」引导，不报错、不阻塞；
 *  2. 已配置时展示各通道字段与上次同步时间；
 *  3. 冲突与事件分区展示，冲突只提示「不会自动覆盖」；
 *  4. 恢复挂起时显示三个 resume 方向按钮。
 */

const overviewFixture = {
  success: true,
  caldav: {
    configured: false,
    calendarUrl: "",
    autoSyncMinutes: 15,
    lastSyncAt: null,
    pendingCount: 0,
    localCount: 0,
    syncedCount: 0,
    lastError: null,
  },
  webdav: {
    configured: false,
    remoteDir: "",
    lastSyncedAt: null,
    lastKnownEtag: null,
    lastError: null,
  },
  events: [],
  conflicts: [],
  restorePending: false,
  autoSyncSuspended: false,
  maintenance: false,
  inFlight: { caldav: 0, webdav: 0, restore: 0 },
};

const fetchSyncOverview = vi.fn();
const resumeSync = vi.fn();
const abortRestore = vi.fn();

vi.mock("../api/sync", () => ({
  fetchSyncOverview: (...args: unknown[]) => fetchSyncOverview(...args),
  resumeSync: (...args: unknown[]) => resumeSync(...args),
}));

vi.mock("../api/backups", () => ({
  abortRestore: (...args: unknown[]) => abortRestore(...args),
}));

vi.mock("../api/webdav", () => ({
  fetchWebDAVStatus: vi.fn(),
  testWebDAVConnection: vi.fn(),
}));

vi.mock("../api/caldav-sync", () => ({
  testCalDAVConnection: vi.fn(),
}));

import SyncCenterPage from "../modules/sync";

beforeEach(() => {
  fetchSyncOverview.mockReset();
  resumeSync.mockReset();
  abortRestore.mockReset();
  // 放弃恢复会走 window.confirm，测试里默认同意
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("F5 同步中心", () => {
  it("未配置时显示引导，不显示冲突/事件列表为空态以外的错误", async () => {
    fetchSyncOverview.mockResolvedValue({ ...overviewFixture });
    render(<SyncCenterPage />);

    expect(await screen.findByText(/还没有配置同步/)).toBeTruthy();
    expect(screen.getByText(/workspace\.md/)).toBeTruthy();
    expect(screen.getByText(/打开同步设置/)).toBeTruthy();
    // 两个通道卡片都标记未配置
    expect(screen.getAllByText("未配置").length).toBe(2);
    // 冲突与事件空态
    expect(screen.getByText(/没有冲突/)).toBeTruthy();
    expect(screen.getByText(/还没有同步记录/)).toBeTruthy();
  });

  it("已配置时展示字段与上次同步时间，无「未配置」引导", async () => {
    fetchSyncOverview.mockResolvedValue({
      ...overviewFixture,
      caldav: {
        configured: true,
        calendarUrl: "https://dav.example.com/cal/",
        autoSyncMinutes: 30,
        lastSyncAt: "2026-11-03T02:00:00.000Z",
        pendingCount: 3,
        localCount: 12,
        syncedCount: 9,
        lastError: null,
      },
      webdav: {
        configured: true,
        remoteDir: "CalDAV-Desktop",
        lastSyncedAt: "2026-11-03T01:00:00.000Z",
        lastKnownEtag: "abc123def456ghi789",
        lastError: null,
      },
    });
    render(<SyncCenterPage />);

    await waitFor(() => {
      expect(screen.getByText("https://dav.example.com/cal/")).toBeTruthy();
    });
    expect(screen.queryByText(/还没有配置同步/)).toBeNull();
    expect(screen.getAllByText("已配置").length).toBe(2);
    expect(screen.getByText("CalDAV-Desktop")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("冲突与事件分别展示，冲突区域提示不会自动覆盖", async () => {
    fetchSyncOverview.mockResolvedValue({
      ...overviewFixture,
      caldav: { ...overviewFixture.caldav, configured: true, localCount: 1 },
      conflicts: [
        {
          ts: "2026-11-03T03:00:00.000Z",
          channel: "caldav",
          localId: "aaaa1111",
          summary: "「周会」本地与远端都修改过",
        },
      ],
      events: [
        {
          ts: "2026-11-03T03:01:00.000Z",
          channel: "caldav",
          kind: "error",
          message: "CalDAV 推送失败：401",
        },
      ],
    });
    render(<SyncCenterPage />);

    expect(await screen.findByText("「周会」本地与远端都修改过")).toBeTruthy();
    expect(screen.getByText(/不会自动覆盖/)).toBeTruthy();
    expect(screen.getByText("CalDAV 推送失败：401")).toBeTruthy();
    expect(screen.getByText(/冲突（1）/)).toBeTruthy();
    expect(screen.getByText(/最近事件（1）/)).toBeTruthy();
  });

  it("恢复挂起时显示三个方向按钮，点击调用 resumeSync", async () => {
    fetchSyncOverview.mockResolvedValue({
      ...overviewFixture,
      autoSyncSuspended: true,
    });
    resumeSync.mockResolvedValue({ success: true });
    render(<SyncCenterPage />);

    const pull = await screen.findByText("以云端为准");
    expect(screen.getByText("以本地为准")).toBeTruthy();
    expect(screen.getByText("双向合并")).toBeTruthy();

    await userEvent.click(pull);
    await waitFor(() => {
      expect(resumeSync).toHaveBeenCalledWith("pull");
    });
  });

  it("恢复挂起时提供「放弃本次恢复」逃生口（D31）", async () => {
    fetchSyncOverview.mockResolvedValue({
      ...overviewFixture,
      restorePending: true,
    });
    abortRestore.mockResolvedValue(undefined);
    render(<SyncCenterPage />);

    const abortBtn = await screen.findByText("放弃本次恢复");
    expect(screen.getByText(/恢复本身出问题时/)).toBeTruthy();

    await userEvent.click(abortBtn);
    await waitFor(() => {
      expect(abortRestore).toHaveBeenCalledTimes(1);
    });
    // 放弃后重新拉一次概览
    await waitFor(() => {
      expect(fetchSyncOverview).toHaveBeenCalledTimes(2);
    });
  });

  it("取消确认时不调用放弃接口", async () => {
    (window.confirm as any).mockReturnValue(false);
    fetchSyncOverview.mockResolvedValue({
      ...overviewFixture,
      restorePending: true,
    });
    render(<SyncCenterPage />);

    await userEvent.click(await screen.findByText("放弃本次恢复"));
    expect(abortRestore).not.toHaveBeenCalled();
  });

  it("加载失败显示错误块而不是白屏", async () => {
    fetchSyncOverview.mockRejectedValue(new Error("boom"));
    render(<SyncCenterPage />);

    expect(await screen.findByText("boom")).toBeTruthy();
  });
});
