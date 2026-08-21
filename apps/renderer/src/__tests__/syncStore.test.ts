import { describe, it, expect, beforeEach } from "vitest";
import { useSyncStore } from "../store/syncStore";

describe("syncStore", () => {
  beforeEach(() => {
    useSyncStore.setState({
      syncInterval: 300000,
      lastSyncTime: null,
      isSyncing: false,
      syncStatus: "idle",
      syncError: null,
      cachedEvents: {},
      cacheTimestamps: {},
    });
  });

  it("should initialize with default values", () => {
    const state = useSyncStore.getState();
    expect(state.syncInterval).toBe(300000);
    expect(state.lastSyncTime).toBeNull();
    expect(state.isSyncing).toBe(false);
    expect(state.syncStatus).toBe("idle");
    expect(state.syncError).toBeNull();
    expect(state.cachedEvents).toEqual({});
    expect(state.cacheTimestamps).toEqual({});
  });

  it("should set sync interval", () => {
    useSyncStore.getState().setSyncInterval(600000);
    expect(useSyncStore.getState().syncInterval).toBe(600000);
  });

  it("should set sync interval to null for manual sync", () => {
    useSyncStore.getState().setSyncInterval(null);
    expect(useSyncStore.getState().syncInterval).toBeNull();
  });

  it("should set last sync time", () => {
    const now = Date.now();
    useSyncStore.getState().setLastSyncTime(now);
    expect(useSyncStore.getState().lastSyncTime).toBe(now);
  });

  it("should set isSyncing", () => {
    useSyncStore.getState().setIsSyncing(true);
    expect(useSyncStore.getState().isSyncing).toBe(true);
    useSyncStore.getState().setIsSyncing(false);
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it("should set sync status", () => {
    useSyncStore.getState().setSyncStatus("success");
    expect(useSyncStore.getState().syncStatus).toBe("success");
    useSyncStore.getState().setSyncStatus("error");
    expect(useSyncStore.getState().syncStatus).toBe("error");
    useSyncStore.getState().setSyncStatus("idle");
    expect(useSyncStore.getState().syncStatus).toBe("idle");
  });

  it("should set sync error", () => {
    useSyncStore.getState().setSyncError("Connection failed");
    expect(useSyncStore.getState().syncError).toBe("Connection failed");
    useSyncStore.getState().setSyncError(null);
    expect(useSyncStore.getState().syncError).toBeNull();
  });

  it("should set cached events for a calendar URL", () => {
    const events = [{ uid: "1", summary: "Event 1" }];
    useSyncStore.getState().setCachedEvents("http://example.com/cal", events);
    expect(
      useSyncStore.getState().cachedEvents["http://example.com/cal"],
    ).toEqual(events);
    expect(
      useSyncStore.getState().cacheTimestamps["http://example.com/cal"],
    ).toBeGreaterThan(0);
  });

  it("should clear cache for a specific calendar URL", () => {
    useSyncStore
      .getState()
      .setCachedEvents("http://example.com/cal", [{ uid: "1" }]);
    useSyncStore.getState().clearCache("http://example.com/cal");
    expect(
      useSyncStore.getState().cachedEvents["http://example.com/cal"],
    ).toBeUndefined();
  });

  it("should clear all cache when no URL specified", () => {
    useSyncStore
      .getState()
      .setCachedEvents("http://example.com/cal1", [{ uid: "1" }]);
    useSyncStore
      .getState()
      .setCachedEvents("http://example.com/cal2", [{ uid: "2" }]);
    useSyncStore.getState().clearCache();
    expect(useSyncStore.getState().cachedEvents).toEqual({});
    expect(useSyncStore.getState().cacheTimestamps).toEqual({});
  });

  it("should remove event from cache", () => {
    useSyncStore.getState().setCachedEvents("http://example.com/cal", [
      { uid: "1", summary: "Event 1" },
      { uid: "2", summary: "Event 2" },
    ]);
    useSyncStore.getState().removeEventFromCache("http://example.com/cal", "1");
    const events =
      useSyncStore.getState().cachedEvents["http://example.com/cal"];
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("2");
  });

  it("should not modify cache when removing non-existent event", () => {
    useSyncStore
      .getState()
      .setCachedEvents("http://example.com/cal", [{ uid: "1" }]);
    useSyncStore
      .getState()
      .removeEventFromCache("http://example.com/cal", "999");
    const events =
      useSyncStore.getState().cachedEvents["http://example.com/cal"];
    expect(events).toHaveLength(1);
  });

  it("should force sync by updating lastSyncTime to current time", () => {
    const before = Date.now();
    useSyncStore.getState().forceSync();
    const after = useSyncStore.getState().lastSyncTime;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBeLessThanOrEqual(Date.now());
  });
});
