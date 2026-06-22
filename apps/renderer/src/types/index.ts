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
