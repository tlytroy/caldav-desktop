import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SyncStatusBar } from "../components/ui/SyncStatusBar";
import { useSyncStore } from "../store/syncStore";

describe("SyncStatusBar", () => {
  const mockOnManualSync = vi.fn();

  beforeEach(() => {
    mockOnManualSync.mockClear();
    useSyncStore.setState({
      syncInterval: 300000,
      lastSyncTime: null,
      isSyncing: false,
      syncStatus: "idle",
      syncError: null,
    });
  });

  it("should render idle status by default", () => {
    render(<SyncStatusBar onManualSync={mockOnManualSync} />);
    expect(screen.getByText("等待同步")).toBeInTheDocument();
  });

  it("should render syncing status", () => {
    render(
      <SyncStatusBar onManualSync={mockOnManualSync} isSyncing={true} syncStatus="syncing" />,
    );
    expect(screen.getByText("正在同步...")).toBeInTheDocument();
  });

  it("should render success status", () => {
    render(
      <SyncStatusBar
        onManualSync={mockOnManualSync}
        syncStatus="success"
      />,
    );
    expect(screen.getByText("同步成功")).toBeInTheDocument();
  });

  it("should render error status with error message", () => {
    render(
      <SyncStatusBar
        onManualSync={mockOnManualSync}
        syncStatus="error"
        syncError="Connection failed"
      />,
    );
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
  });

  it("should render default error message when no error provided", () => {
    render(
      <SyncStatusBar
        onManualSync={mockOnManualSync}
        syncStatus="error"
      />,
    );
    expect(screen.getByText("同步失败")).toBeInTheDocument();
  });

  it("should display formatted last sync time", () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    render(
      <SyncStatusBar
        onManualSync={mockOnManualSync}
        syncStatus="success"
        lastSyncTime={fiveMinutesAgo}
      />,
    );
    expect(screen.getByText(/5分钟前/)).toBeInTheDocument();
  });

  it("should display '刚刚' for very recent sync", () => {
    const justNow = Date.now() - 10 * 1000;
    render(
      <SyncStatusBar
        onManualSync={mockOnManualSync}
        syncStatus="success"
        lastSyncTime={justNow}
      />,
    );
    expect(screen.getByText(/刚刚/)).toBeInTheDocument();
  });

  it("should display '从未' when no last sync time", () => {
    render(<SyncStatusBar onManualSync={mockOnManualSync} />);
    expect(screen.queryByText(/上次同步/)).not.toBeInTheDocument();
  });

  it("should call onManualSync when sync button is clicked", () => {
    render(<SyncStatusBar onManualSync={mockOnManualSync} />);
    fireEvent.click(screen.getByText("同步"));
    expect(mockOnManualSync).toHaveBeenCalledOnce();
  });

  it("should disable sync button when syncing", () => {
    render(
      <SyncStatusBar onManualSync={mockOnManualSync} isSyncing={true} />,
    );
    const syncButton = screen.getByText("同步").closest("button");
    expect(syncButton).toBeDisabled();
  });

  it("should show sync interval selector", () => {
    render(<SyncStatusBar onManualSync={mockOnManualSync} />);
    expect(screen.getByText("手动同步")).toBeInTheDocument();
    expect(screen.getByText("每5分钟")).toBeInTheDocument();
    expect(screen.getByText("每10分钟")).toBeInTheDocument();
    expect(screen.getByText("每30分钟")).toBeInTheDocument();
  });

  it("should update sync interval when selector changes", () => {
    render(<SyncStatusBar onManualSync={mockOnManualSync} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "600000" } });
    expect(useSyncStore.getState().syncInterval).toBe(600000);
  });

  it("should set sync interval to null when selecting manual", () => {
    render(<SyncStatusBar onManualSync={mockOnManualSync} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "0" } });
    expect(useSyncStore.getState().syncInterval).toBeNull();
  });
});