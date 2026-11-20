import type {
  Calendar,
  CalendarEvent,
  CalDAVConfig,
  TestConnectionResult,
} from "../types";

// 创建 axios 实例
import { createApiClient } from "./client";

const api = createApiClient(30000);

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    console.debug("API Request:", config.method?.toUpperCase(), config.url);
    return config;
  },
  (error) => {
    console.error("Request Error:", error);
    return Promise.reject(error);
  },
);

// 响应拦截器
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("Response Error:", error.response?.data || error.message);
    return Promise.reject(error);
  },
);

// 获取日历列表
/**
 * 获取日历列表。
 *
 * CalDAV 服务器不可用时，后端会返回**降级响应**（200 + 空数组 + degraded 标记）
 * 而不是 500 —— 本地 md 数据照常可用，不该因为服务器挂了整个页面报错。
 */
export async function fetchCalendars(): Promise<Calendar[]> {
  const response = await api.get("/api/calendar/calendars");
  const data = response.data;
  if (data && typeof data === "object" && data.degraded) {
    // 记下降级状态，界面据此提示用户
    markSyncDegraded(data.error || "CalDAV 不可用");
    return [];
  }
  markSyncAvailable();
  return Array.isArray(data) ? data : [];
}

/** CalDAV 降级状态（全局，供界面读取） */
let syncDegradedReason: string | null = null;
const syncDegradedListeners = new Set<(reason: string | null) => void>();

export function markSyncDegraded(reason: string) {
  syncDegradedReason = reason;
  syncDegradedListeners.forEach((fn) => fn(reason));
}
export function markSyncAvailable() {
  syncDegradedReason = null;
  syncDegradedListeners.forEach((fn) => fn(null));
}
export function getSyncDegradedReason(): string | null {
  return syncDegradedReason;
}
export function subscribeSyncDegraded(fn: (reason: string | null) => void) {
  syncDegradedListeners.add(fn);
  return () => syncDegradedListeners.delete(fn);
}

// 获取日历事件
export async function fetchCalendarEvents(
  calendarUrl: string,
  start: Date,
  end: Date,
): Promise<CalendarEvent[]> {
  const response = await api.get("/api/calendar/events", {
    params: {
      start: start.toISOString(),
      end: end.toISOString(),
      calendarUrl,
    },
  });

  return response.data.map((event: any) => ({
    id: event.uid,
    title: event.summary?.trim() || "无标题事件",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    allDay: !event.start?.dateTime,
    description: event.description?.trim(),
    category: event.category,
    tags: event.tags,
    priority: event.priority,
    recurrence: event.recurrence,
  }));
}

// 事件数据可以是 CalendarEvent 格式（string 类型日期）或 EventFormData 格式（Date 类型日期）
type EventInputData =
  | Omit<CalendarEvent, "id">
  | {
      title: string;
      start: Date | string;
      end: Date | string;
      allDay?: boolean;
      description?: string;
      category?: unknown;
      tags?: unknown[];
      priority?: string;
      recurrence?: unknown;
    };

// 将事件数据中的 Date 字段转为 ISO 字符串
function serializeEventData(
  eventData: EventInputData,
): Record<string, unknown> {
  const data = { ...eventData } as Record<string, unknown>;
  if (data.start instanceof Date) {
    data.start = data.start.toISOString();
  }
  if (data.end instanceof Date) {
    data.end = data.end.toISOString();
  }
  return data;
}

// 创建事件
export async function createCalendarEvent(
  calendarUrl: string,
  eventData: EventInputData,
): Promise<void> {
  await api.post("/api/calendar/events", {
    ...serializeEventData(eventData),
    calendarUrl,
  });
}

// 更新事件
export async function updateCalendarEvent(
  eventId: string,
  calendarUrl: string,
  eventData: EventInputData,
): Promise<void> {
  await api.put(`/api/calendar/events/${eventId}`, {
    ...serializeEventData(eventData),
    calendarUrl,
  });
}

// 删除事件
export async function deleteCalendarEvent(
  eventId: string,
  calendarUrl: string,
): Promise<any> {
  try {
    // 对eventId进行编码，以防包含特殊字符
    const encodedEventId = encodeURIComponent(eventId);
    const response = await api.delete(
      `/api/calendar/events/${encodedEventId}`,
      {
        params: { calendarUrl },
      },
    );
    return response.data;
  } catch (error: any) {
    // 如果是404错误，可能是事件已被删除或者ID不匹配
    if (error.response?.status === 404) {
      console.warn(
        `Event ${eventId} not found on server, it may have already been deleted`,
      );
      return {
        success: true,
        message: "Event not found, possibly already deleted",
      };
    }
    // 其他错误重新抛出
    throw error;
  }
}

// 获取配置
export async function fetchConfig(): Promise<Partial<CalDAVConfig>> {
  const response = await api.get("/api/calendar/config");
  return response.data;
}

// 保存配置
export async function saveConfig(
  config: CalDAVConfig,
): Promise<{ message: string }> {
  const response = await api.post("/api/calendar/config", config);
  return response.data;
}

// 测试连接
export async function testConnection(
  config: CalDAVConfig,
): Promise<TestConnectionResult> {
  const response = await api.post("/api/calendar/config/test", config);
  return response.data;
}
