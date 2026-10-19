import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 30000,
});

export interface KanbanTodo {
  id: string;
  done: boolean;
  priority: "高" | "中" | "低";
  title: string;
  due?: string;
  estimate?: number;
  project?: string;
  deferred?: number;
  doneDate?: string;
  /** 已绑定的日历事件 uid（双向绑定）；events.md 里反向记录 kanbanTaskId */
  calendarEventUid?: string;
}

export interface KanbanProject {
  name: string;
  current?: string;
  next?: string;
  blocker?: string;
  related: string[];
}

export interface KanbanNote {
  tags: string[];
  text: string;
}

export interface KanbanData {
  updated?: string;
  filePath?: string;
  todos: KanbanTodo[];
  projects: KanbanProject[];
  notes: KanbanNote[];
}

export interface KanbanCalendarPayload {
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  endTime?: string; // HH:mm
  allDay?: boolean;
}

export async function fetchKanban(): Promise<KanbanData> {
  const { data } = await api.get<KanbanData>("/api/kanban");
  return data;
}

/**
 * 新增任务，可选同时在 events.md 创建并互填链接字段。
 */
export async function addKanbanTask(
  task: Partial<KanbanTodo> & {
    calendar?: KanbanCalendarPayload;
  },
): Promise<{ success: boolean; todo: KanbanTodo }> {
  const { data } = await api.post("/api/kanban/task", task);
  return data;
}

export async function updateKanbanTask(
  id: string,
  patch: Partial<KanbanTodo> & {
    calendar?: KanbanCalendarPayload;
    clearCalendar?: boolean;
  },
): Promise<{ success: boolean; todo: KanbanTodo }> {
  const { data } = await api.patch(`/api/kanban/task/${id}`, patch);
  return data;
}

export async function deleteKanbanTask(id: string): Promise<void> {
  await api.delete(`/api/kanban/task/${id}`);
}

/**
 * 解除任务与日历事件的绑定（保留日历事件本身独立存在）。
 */
export async function unlinkKanbanCalendar(id: string): Promise<void> {
  await api.post(`/api/kanban/task/${id}/unlink-calendar`);
}
