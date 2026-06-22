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
  import.meta.env.VITE_DEFAULT_DATE_RANGE_DAYS || "30"
);

export function useCalendarEvents(calendarUrl: string | null) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(
    async (startDate?: Date, endDate?: Date) => {
      if (!calendarUrl) return;

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
        setEvents(fetchedEvents);
        setLoadingState("success");
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "获取事件失败";
        setError(errorMessage);
        setLoadingState("error");
      }
    },
    [calendarUrl]
  );

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

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return {
    events,
    loadingState,
    error,
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent,
  };
}
