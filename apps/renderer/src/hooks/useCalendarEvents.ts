import { useState, useEffect, useCallback } from "react";
import type { LoadingState } from "../types";
import {
  fetchMdEvents,
  addMdEvent,
  updateMdEvent,
  deleteMdEvent,
  syncMdToCaldav,
  type MdEvent,
  type KanbanPayload,
} from "../api/md-bridge";

/**
 * useCalendarEvents - 日历事件 hook（MD 优先架构）
 *
 * 数据流：
 *   events.md（本地事实源）→ useCalendarEvents → FullCalendar
 *   用户创建/删除事件 → POST /api/md-bridge/events/add 或 DELETE
 *   （可选）完成后调 syncMdToCaldav() 推送到 CalDAV
 *
 * `calendarUrl` 现在仅作为「CalDAV 同步目标」使用，可选。
 * 不再阻塞 UI：就算没配置 CalDAV，日历也能完整显示。
 *
 * 双向绑定：createEvent 第二参数 kanban 可让后端同时在 工作搭子看板 创建任务并互填链接；
 * deleteEvent 第二参数 cascade=true 表示删除事件时联动删除绑定的看板任务。
 */
export function useCalendarEvents(_calendarUrl?: string | null, refreshKey?: number) {
  const [events, setEvents] = useState<MdEvent[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  /** 从 events.md 读取（不依赖网络，不走 CalDAV） */
  const loadEvents = useCallback(async () => {
    setLoadingState("loading");
    setError(null);
    try {
      const r = await fetchMdEvents();
      setEvents(r.events || []);
      setLoadingState("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "读取 events.md 失败";
      setError(msg);
      setLoadingState("error");
      setEvents([]); // 失败时清空，不要显示陈旧缓存
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // 外部数据变更（如自然语言快速创建写盘）后重读 events.md
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      loadEvents();
    }
  }, [refreshKey, loadEvents]);

  /**
   * 创建事件：写 events.md，UI 立即刷新。
   * 若传 kanban payload，则同时在 工作搭子看板 创建任务并互填链接。
   */
  const createEvent = useCallback(
    async (
      data: Omit<MdEvent, "uid" | "updated" | "source">,
      kanban?: KanbanPayload,
    ): Promise<MdEvent> => {
      const r = await addMdEvent({ ...data, source: "md" }, kanban);
      setEvents((prev) => {
        const idx = prev.findIndex((e) => e.uid === r.event.uid);
        if (idx >= 0) prev[idx] = r.event;
        else prev.push(r.event);
        return [...prev];
      });
      return r.event;
    },
    [],
  );

  /**
   * 更新事件（保留 kanbanTaskId 不被覆盖）
   */
  const updateEvent = useCallback(
    async (uid: string, patch: Partial<MdEvent>): Promise<MdEvent> => {
      const r = await updateMdEvent(uid, patch);
      setEvents((prev) => {
        const idx = prev.findIndex((e) => e.uid === uid);
        if (idx >= 0) prev[idx] = r.event;
        return [...prev];
      });
      return r.event;
    },
    [],
  );

  /**
   * 删除事件：从 events.md 移除。
   * 若 cascade=true 且事件本身绑定了 kanbanTaskId，连带删除看板任务；
   * 否则后端会保留看板任务、仅解除绑定（避免误删）。
   */
  const deleteEvent = useCallback(
    async (uid: string, cascade?: boolean) => {
      await deleteMdEvent(uid);
      setEvents((prev) => prev.filter((e) => e.uid !== uid));
      // cascade 语义目前由后端根据 kanbanTaskId 自动判断，这里只是预留
      void cascade;
    },
    [],
  );

  /** 推送 events.md 到 CalDAV（如果配置了）。失败不影响本地数据 */
  const pushToCaldav = useCallback(async () => {
    try {
      const r = await syncMdToCaldav({ direction: "push" });
      setLastSyncTime(Date.now());
      return r;
    } catch (err) {
      console.warn("[useCalendarEvents] push to CalDAV failed:", err);
      return null;
    }
  }, []);

  /** 拉取远程 CalDAV → events.md（保留本地优先：仅追加不覆盖） */
  const pullFromCaldav = useCallback(async () => {
    try {
      const r = await syncMdToCaldav({ direction: "pull" });
      setLastSyncTime(Date.now());
      // 拉取后重读本地
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