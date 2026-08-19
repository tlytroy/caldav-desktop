// 日历数据类型
export interface Calendar {
  id: string;
  displayName: string;
  url: string;
}

// 事件分类类型
export interface EventCategory {
  id: string;
  name: string;
  color: string;
}

// 事件标签类型
export interface EventTag {
  id: string;
  name: string;
  color: string;
}

// 重复规则类型
export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  endDate?: string;
  count?: number;
}

// 日历事件类型
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  category?: EventCategory;
  tags?: EventTag[];
  recurrence?: RecurrenceRule;
}

// CalDAV配置类型
export interface CalDAVConfig {
  url: string;
  username: string;
  password: string;
}

// 表单数据类型
export interface EventFormData {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  description: string;
  category?: EventCategory;
  tags?: EventTag[];
  recurrence?: RecurrenceRule;
}

// 测试连接结果类型
export interface TestConnectionResult {
  success: boolean;
  message: string;
}

// 加载状态类型
export type LoadingState = "idle" | "loading" | "success" | "error";

// 事件过滤条件类型
export interface EventFilter {
  categoryId?: string;
  tagIds?: string[];
  searchText?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

// ===== 待办/任务类型 =====
export type TaskStatus = "pending" | "in-progress" | "completed" | "cancelled";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string; // ISO date string
  completedDate?: string; // ISO date string
  category?: EventCategory;
  tags?: EventTag[];
  calendarUrl?: string; // Linked calendar event URL
  createdAt: string;
  updatedAt: string;
}

// ===== Markdown ↔ ICS Bridge Types =====
export interface ICSConversionResult {
  success: boolean;
  message: string;
  uid?: string;
  icsContent?: string;
}

export interface MDConversionResult {
  success: boolean;
  message: string;
  mdContent?: string;
  uid?: string;
}

// MD 元数据格式规范 (Front Matter)
export interface MDFrontMatter {
  title: string;
  date: string; // ISO date
  end?: string; // ISO date (event end)
  allDay?: boolean;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  category?: string;
  tags?: string[];
  recurrence?: string; // e.g. "weekly", "monthly"
  uid?: string; // matching ICS UID for bi-directional sync
  source?: string; // "caldav" | "manual"
  updated?: string; // last updated timestamp
}

// MD 转 ICS 配置
export interface MDBridgeConfig {
  enabled: boolean;
  watchDir: string;
  syncDirection: "md-to-ics" | "ics-to-md" | "bidirectional";
  autoSyncMinutes: number;
  targetCalendarUrl?: string;
}
