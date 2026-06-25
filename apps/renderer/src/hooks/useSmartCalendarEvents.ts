import { useState, useEffect, useCallback } from "react";
import type { CalendarEvent, LoadingState } from "../types";
import {
  fetchCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../api/calendar";

// 从环境变量获取默认日期范围
const DEFAULT_DATE_RANGE_DAYS = parseInt(
  import.meta.env.VITE_DEFAULT_DATE_RANGE_DAYS || "60"
);

interface UseSmartCalendarEventsOptions {
  prefetchDays?: number; // 预加载天数
  bufferSize?: number;   // 缓冲区大小（天）
}

export function useSmartCalendarEvents(
  calendarUrl: string | null,
  options: UseSmartCalendarEventsOptions = {}
) {
  const { prefetchDays = 30, bufferSize = 15 } = options;

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [visibleDateRange, setVisibleDateRange] = useState<{
    start: Date;
    end: Date;
  } | null>(null);

  // 计算需要加载的日期范围（包含缓冲区）
  const getLoadRange = useCallback((startDate: Date, endDate: Date) => {
    const bufferedStart = new Date(startDate);
    bufferedStart.setDate(bufferedStart.getDate() - bufferSize);

    const bufferedEnd = new Date(endDate);
    bufferedEnd.setDate(bufferedEnd.getDate() + bufferSize);

    return { start: bufferedStart, end: bufferedEnd };
  }, [bufferSize]);

  // 加载指定日期范围的事件
  const loadEventsInRange = useCallback(async (
    startDate: Date,
    endDate: Date
  ) => {
    if (!calendarUrl) return [];

    try {
      const fetchedEvents = await fetchCalendarEvents(
        calendarUrl,
        startDate,
        endDate
      );
      return fetchedEvents;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "获取事件失败";
      throw new Error(errorMessage);
    }
  }, [calendarUrl]);

  // 加载事件（智能加载当前视图所需的数据）
  const loadEvents = useCallback(async (
    startDate?: Date,
    endDate?: Date
  ) => {
    if (!calendarUrl) return;

    setLoadingState("loading");
    setError(null);

    try {
      // 如果没有提供日期范围，则使用默认范围
      const start = startDate || new Date();
      const end = endDate || new Date(
        start.getTime() + DEFAULT_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000
      );

      // 设置可见日期范围
      setVisibleDateRange({ start, end });

      // 计算实际需要加载的范围（包含缓冲区）
      const loadRange = getLoadRange(start, end);

      const fetchedEvents = await loadEventsInRange(
        loadRange.start,
        loadRange.end
      );

      setEvents(fetchedEvents);
      setLoadingState("success");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "获取事件失败";
      setError(errorMessage);
      setLoadingState("error");
    }
  }, [calendarUrl, getLoadRange, loadEventsInRange]);

  // 预加载未来/过去的事件
  const prefetchEvents = useCallback(async (direction: 'past' | 'future') => {
    if (!visibleDateRange || !calendarUrl) return;

    try {
      const prefetchStart = direction === 'past'
        ? new Date(visibleDateRange.start.getTime() - prefetchDays * 24 * 60 * 60 * 1000)
        : new Date(visibleDateRange.end.getTime());

      const prefetchEnd = direction === 'past'
        ? new Date(visibleDateRange.start.getTime())
        : new Date(visibleDateRange.end.getTime() + prefetchDays * 24 * 60 * 60 * 1000);

      const newEvents = await loadEventsInRange(prefetchStart, prefetchEnd);

      // 合并新事件到现有事件中，避免重复
      setEvents(prevEvents => {
        const eventMap = new Map(prevEvents.map(e => [e.id, e]));
        newEvents.forEach(e => eventMap.set(e.id, e));
        return Array.from(eventMap.values());
      });
    } catch (err) {
      console.warn("预加载事件失败:", err);
    }
  }, [visibleDateRange, calendarUrl, prefetchDays, loadEventsInRange]);

  const createEvent = useCallback(
    async (eventData: Omit<CalendarEvent, "id">) => {
      if (!calendarUrl) throw new Error("未选择日历");

      try {
        await createCalendarEvent(calendarUrl, eventData);
        await loadEvents(); // 重新加载事件
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "创建事件失败";
        throw new Error(errorMessage);
      }
    },
    [calendarUrl, loadEvents]
  );

  const updateEvent = useCallback(
    async (eventId: string, eventData: Omit<CalendarEvent, "id">) => {
      if (!calendarUrl) throw new Error("未选择日历");

      try {
        await updateCalendarEvent(eventId, calendarUrl, eventData);
        await loadEvents(); // 重新加载事件
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "更新事件失败";
        throw new Error(errorMessage);
      }
    },
    [calendarUrl, loadEvents]
  );

  const deleteEvent = useCallback(
    async (eventId: string) => {
      if (!calendarUrl) throw new Error("未选择日历");

      try {
        await deleteCalendarEvent(eventId, calendarUrl);
        await loadEvents(); // 重新加载事件
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "删除事件失败";
        throw new Error(errorMessage);
      }
    },
    [calendarUrl, loadEvents]
  );

  // 当日历URL改变时加载事件
  useEffect(() => {
    if (calendarUrl) {
      loadEvents();
    }
  }, [calendarUrl, loadEvents]);

  return {
    events,
    loadingState,
    error,
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    prefetchEvents,
    visibleDateRange,
  };
}