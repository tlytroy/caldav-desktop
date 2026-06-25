import { useState, useEffect, useCallback } from "react";
import type { CalendarEvent, LoadingState } from "../types";
import {
  fetchCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../api/calendar";
import { useSyncStore } from "../store/syncStore";

// 从环境变量获取默认日期范围
const DEFAULT_DATE_RANGE_DAYS = parseInt(
  import.meta.env.VITE_DEFAULT_DATE_RANGE_DAYS || "30"
);

// 缓存过期时间（毫秒）- 1小时
const CACHE_EXPIRY_TIME = 60 * 60 * 1000;

export function useCalendarEvents(calendarUrl: string | null) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);

  // 从同步存储中获取状态
  const {
    syncInterval,
    lastSyncTime,
    isSyncing,
    syncStatus,
    syncError,
    cachedEvents,
    cacheTimestamps,
    setLastSyncTime,
    setIsSyncing,
    setSyncStatus,
    setSyncError,
    setCachedEvents,
    clearCache
  } = useSyncStore();

  // 检查缓存是否有效
  const isCacheValid = useCallback((url: string) => {
    if (!cachedEvents[url] || !cacheTimestamps[url]) return false;
    const cacheAge = Date.now() - cacheTimestamps[url];
    return cacheAge < CACHE_EXPIRY_TIME;
  }, [cachedEvents, cacheTimestamps]);

  // 从缓存或服务器加载事件
  const loadEvents = useCallback(
    async (startDate?: Date, endDate?: Date, forceRefresh = false) => {
      if (!calendarUrl) return;

      // 如果有有效的缓存且不强制刷新，直接使用缓存
      if (!forceRefresh && isCacheValid(calendarUrl)) {
        setEvents(cachedEvents[calendarUrl]);
        setLoadingState("success");
        return;
      }

      setLoadingState("loading");
      setError(null);

      try {
        // 如果没有提供日期范围，则使用默认范围
        const start = startDate || new Date();
        const end =
          endDate ||
          new Date(
            start.getTime() + DEFAULT_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000
          );

        const fetchedEvents = await fetchCalendarEvents(
          calendarUrl,
          start,
          end
        );

        // 更新缓存
        setCachedEvents(calendarUrl, fetchedEvents);
        setEvents(fetchedEvents);
        setLoadingState("success");
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "获取事件失败";
        setError(errorMessage);
        setLoadingState("error");

        // 如果有缓存，即使获取失败也显示缓存数据
        if (cachedEvents[calendarUrl]) {
          setEvents(cachedEvents[calendarUrl]);
          setLoadingState("success");
        }
      }
    },
    [calendarUrl, cachedEvents, isCacheValid, setCachedEvents]
  );

  // 执行同步操作
  const performSync = useCallback(async () => {
    if (!calendarUrl || isSyncing) return;

    setIsSyncing(true);
    setSyncStatus("syncing");
    setSyncError(null);

    try {
      // 强制从服务器加载最新数据
      await loadEvents(undefined, undefined, true);
      setLastSyncTime(Date.now());
      setSyncStatus("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "同步失败";
      setSyncError(errorMessage);
      setSyncStatus("error");
    } finally {
      setIsSyncing(false);
    }
  }, [calendarUrl, isSyncing, loadEvents, setIsSyncing, setSyncStatus, setSyncError, setLastSyncTime]);

  // 创建事件
  const createEvent = useCallback(
    async (eventData: Omit<CalendarEvent, "id">) => {
      if (!calendarUrl) throw new Error("未选择日历");

      try {
        await createCalendarEvent(calendarUrl, eventData);
        // 清除缓存并重新同步
        clearCache(calendarUrl);
        await performSync();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "创建事件失败";
        throw new Error(errorMessage);
      }
    },
    [calendarUrl, clearCache, performSync]
  );

  // 更新事件
  const updateEvent = useCallback(
    async (eventId: string, eventData: Omit<CalendarEvent, "id">) => {
      if (!calendarUrl) throw new Error("未选择日历");

      try {
        await updateCalendarEvent(eventId, calendarUrl, eventData);
        // 清除缓存并重新同步
        clearCache(calendarUrl);
        await performSync();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "更新事件失败";
        throw new Error(errorMessage);
      }
    },
    [calendarUrl, clearCache, performSync]
  );

  // 删除事件
  const deleteEvent = useCallback(
    async (eventId: string) => {
      if (!calendarUrl) throw new Error("未选择日历");

      try {
        await deleteCalendarEvent(eventId, calendarUrl);
        // 清除缓存并重新同步
        clearCache(calendarUrl);
        await performSync();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "删除事件失败";
        throw new Error(errorMessage);
      }
    },
    [calendarUrl, clearCache, performSync]
  );

  // 强制同步
  const forceSync = useCallback(async () => {
    await performSync();
  }, [performSync]);

  // 初始化加载
  useEffect(() => {
    if (calendarUrl) {
      loadEvents();
    }
  }, [calendarUrl, loadEvents]);

  // 设置定时同步
  useEffect(() => {
    if (!calendarUrl || !syncInterval) return;

    const intervalId = setInterval(() => {
      performSync();
    }, syncInterval);

    return () => clearInterval(intervalId);
  }, [calendarUrl, syncInterval, performSync]);

  // 响应外部强制同步请求
  useEffect(() => {
    if (lastSyncTime === 0) {
      performSync();
    }
  }, [lastSyncTime, performSync]);

  return {
    events,
    loadingState,
    error,
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    forceSync,
    isSyncing,
    syncStatus,
    syncError,
    lastSyncTime,
  };
}