import { useState, useEffect, useCallback } from "react";
import type { LoadingState } from "../types";
import {
  fetchItems,
  createItem,
  updateItem,
  deleteItem,
  type WorkbenchItem,
} from "../api/workspace";

/**
 * useCalendarEvents —— 日历视图（workspace.md 的一部分）
 *
 * ## 架构
 *
 * 日历不再是独立的数据源，而是**统一数据源的一个视图**：
 *
 *   workspace.md（唯一事实源）
 *        ↓ 按 scope=calendar + 展开重复规则筛选
 *   日历模块
 *
 * 看板模块读的是**同一个文件**，只是筛选条件不同。
 * 所以「体检」这类任务会同时出现在两个视图里 —— 因为它就是同一条记录。
 *
 * @param refreshKey 外部数据变更时自增，触发重读
 */
export function useCalendarEvents(_calendarUrl?: string | null, refreshKey?: number) {
  const [events, setEvents] = useState<WorkbenchItem[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  /**
   * 读取日历视图的数据。
   *
   * expand=true 让服务端把重复事件展开成多个实例
   * （「每周一三五」在月视图里显示成 13 个独立的格子）。
   */
  const loadEvents = useCallback(async () => {
    setLoadingState("loading");
    setError(null);
    try {
      const r = await fetchItems({ scope: "calendar", expand: true });
      setEvents(r.items || []);
      setLoadingState("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "读取数据源失败";
      setError(msg);
      setLoadingState("error");
      setEvents([]); // 失败时清空，不要显示陈旧缓存
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // 外部数据变更（如自然语言快速创建写盘）后重读
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      loadEvents();
    }
  }, [refreshKey, loadEvents]);

  /**
   * 创建条目。
   *
   * kind 决定它出现在哪：task 同时出现在看板与日历，event 只在日历。
   * 不再需要「同时创建看板任务」这种跨文件操作 —— 一条记录就够。
   */
  const createEvent = useCallback(
    async (
      data: Partial<WorkbenchItem> & { title: string },
    ): Promise<WorkbenchItem> => {
      const r = await createItem({
        kind: "event",
        ...data,
      });
      setEvents((prev) => [...prev, r]);
      return r;
    },
    [],
  );

  /** 更新条目 */
  const updateEvent = useCallback(
    async (id: string, patch: Partial<WorkbenchItem>): Promise<WorkbenchItem> => {
      const r = await updateItem(id, patch);
      // 展开后的实例 id 形如 "abc@2026-10-05"，更新时要用原始 id
      const originalId = r.instanceId || id.split("@")[0];
      setEvents((prev) =>
        prev.map((e) =>
          (e.instanceId || e.id) === originalId ? { ...e, ...r } : e,
        ),
      );
      return r;
    },
    [],
  );

  /**
   * 删除条目。
   *
   * 删一条就是删一条 —— 没有级联、没有解绑。
   * 因为在统一数据源里不存在「绑定的另一份数据」。
   */
  const deleteEvent = useCallback(async (id: string) => {
    const originalId = id.split("@")[0];
    await deleteItem(originalId);
    setEvents((prev) => prev.filter((e) => (e.instanceId || e.id) !== originalId));
  }, []);

  /** 推送数据源到 CalDAV（如果配置了）。失败不影响本地数据 */
  const pushToCaldav = useCallback(async () => {
    try {
      const { syncMdToCaldav } = await import("../api/md-bridge");
      const r = await syncMdToCaldav({ direction: "push" });
      setLastSyncTime(Date.now());
      return r;
    } catch (err) {
      console.warn("[useCalendarEvents] push to CalDAV failed:", err);
      return null;
    }
  }, []);

  /** 拉取远程 CalDAV → 数据源（保留本地优先：仅追加不覆盖） */
  const pullFromCaldav = useCallback(async () => {
    try {
      const { syncMdToCaldav } = await import("../api/md-bridge");
      const r = await syncMdToCaldav({ direction: "pull" });
      setLastSyncTime(Date.now());
      await loadEvents();
      return r;
    } catch (err) {
      console.warn("[useCalendarEvents] pull from CalDAV failed:", err);
      return null;
    }
  }, [loadEvents]);

  /** 全量双向同步 */
  const bidirectionalSync = useCallback(async () => {
    try {
      const { syncMdToCaldav } = await import("../api/md-bridge");
      const r = await syncMdToCaldav({ direction: "bidirectional" });
      setLastSyncTime(Date.now());
      await loadEvents();
      return r;
    } catch (err) {
      console.warn("[useCalendarEvents] bidirectional sync failed:", err);
      return null;
    }
  }, [loadEvents]);

  return {
    events,
    loadingState,
    error,
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    pushToCaldav,
    pullFromCaldav,
    bidirectionalSync,
    lastSyncTime,
  };
}
