import axios from "axios";
import type {
  Calendar,
  CalendarEvent,
  CalDAVConfig,
  TestConnectionResult,
} from "../types";

// 创建 axios 实例
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 30000,
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    console.debug("API Request:", config.method?.toUpperCase(), config.url);
    return config;
  },
  (error) => {
    console.error("Request Error:", error);
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("Response Error:", error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// 获取日历列表
export async function fetchCalendars(): Promise<Calendar[]> {
  const response = await api.get("/api/calendar/calendars");
  return response.data;
}

// 获取日历事件
export async function fetchCalendarEvents(
  calendarUrl: string,
  start: Date,
  end: Date
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
  }));
}

// 创建事件 (接受CalendarEvent格式)
export async function createCalendarEvent(
  calendarUrl: string,
  eventData: Omit<CalendarEvent, "id">
): Promise<void> {
  await api.post("/api/calendar/events", {
    ...eventData,
    calendarUrl,
  });
}

// 更新事件 (接受CalendarEvent格式)
export async function updateCalendarEvent(
  eventId: string,
  calendarUrl: string,
  eventData: Omit<CalendarEvent, "id">
): Promise<void> {
  await api.put(`/api/calendar/events/${eventId}`, {
    ...eventData,
    calendarUrl,
  });
}

// 创建事件 (接受EventFormData格式)
export async function createCalendarEventFromForm(
  calendarUrl: string,
  formData: Omit<import("../types").EventFormData, "id">
): Promise<void> {
  const eventData: Omit<CalendarEvent, "id"> = {
    ...formData,
    start: formData.start.toISOString(),
    end: formData.end.toISOString(),
  };

  await api.post("/api/calendar/events", {
    ...eventData,
    calendarUrl,
  });
}

// 更新事件 (接受EventFormData格式)
export async function updateCalendarEventFromForm(
  eventId: string,
  calendarUrl: string,
  formData: Omit<import("../types").EventFormData, "id">
): Promise<void> {
  const eventData: Omit<CalendarEvent, "id"> = {
    ...formData,
    start: formData.start.toISOString(),
    end: formData.end.toISOString(),
  };

  await api.put(`/api/calendar/events/${eventId}`, {
    ...eventData,
    calendarUrl,
  });
}

// 删除事件
export async function deleteCalendarEvent(
  eventId: string,
  calendarUrl: string
): Promise<void> {
  await api.delete(`/api/calendar/events/${eventId}`, {
    params: { calendarUrl },
  });
}

// 获取配置
export async function fetchConfig(): Promise<Partial<CalDAVConfig>> {
  const response = await api.get("/api/calendar/config");
  return response.data;
}

// 保存配置
export async function saveConfig(
  config: CalDAVConfig
): Promise<{ message: string }> {
  const response = await api.post("/api/calendar/config", config);
  return response.data;
}

// 测试连接
export async function testConnection(
  config: CalDAVConfig
): Promise<TestConnectionResult> {
  const response = await api.post("/api/calendar/config/test", config);
  return response.data;
}
