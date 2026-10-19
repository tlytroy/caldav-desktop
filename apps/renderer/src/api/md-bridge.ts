/**
 * MD-Bridge API 客户端
 *
 * 日历数据来源：events.md（本地 markdown 文件，YAML frontmatter 存储事件）
 * 写入事件：直接写 events.md；可选调 /api/md-bridge/sync/caldav 推送到 CalDAV
 *
 * 这是用户的设计意图（REF/MD_ICS_BRIDGE.md）：
 *   - md 是单一事实源，ics 派生
 *   - 编辑全在 md 上，ics 仅同步时生成
 *   - md 可以用 WebDAV 同步
 */
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 30000,
});

export interface MdEvent {
  uid?: string;
  title: string;
  date: string;        // YYYY-MM-DDTHH:mm:ss(.SSS)Z
  end?: string;
  allDay?: boolean;
  status?: "confirmed" | "tentative" | "cancelled" | "needs-action";
  category?: string;
  tags?: string[];
  priority?: "high" | "medium" | "low";
  recurrence?: "daily" | "weekly" | "monthly" | "yearly";
  description?: string;
  updated?: string;
  source?: "caldav" | "md" | "ai";
  /** 关联的工作搭子任务 ID（双向绑定） */
  kanbanTaskId?: string;
}

export interface EventsFileResp {
  success: true;
  events: MdEvent[];
  body: string;
  filePath: string;
}

export interface AddMdEventResult {
  success: true;
  event: MdEvent;
  totalCount: number;
  kanbanTaskId?: string;
}

/**
 * 读取 events.md 里所有事件（不依赖 CalDAV，离线可用）。
 * 这是日历模块默认的数据源。
 */
export async function fetchMdEvents(): Promise<EventsFileResp> {
  const r = await api.get("/api/md-bridge/events");
  return r.data;
}

export interface KanbanPayload {
  priority?: "高" | "中" | "低";
  project?: string;
  due?: string;
}

/**
 * 向 events.md 追加一个新事件。立即生效，写入磁盘。
 * 可选同时在工作搭子看板创建一条任务（kanban={priority, project, due?})，
 * 两者互填链接字段。
 */
export async function addMdEvent(
  event: MdEvent,
  kanban?: KanbanPayload,
): Promise<AddMdEventResult> {
  const r = await api.post("/api/md-bridge/events/add", { event, kanban });
  return r.data;
}

/**
 * 从 events.md 删除指定事件（按 uid）。
 * 若事件绑定了 kanbanTaskId，连带删除对应的看板任务。
 */
export async function deleteMdEvent(
  uid: string,
): Promise<{ success: true; removed: boolean; unlinkedTaskId?: string }> {
  const r = await api.delete(`/api/md-bridge/events/${encodeURIComponent(uid)}`);
  return r.data;
}

/**
 * 更新 events.md 中指定 uid 的事件字段。保留 kanbanTaskId 不被覆盖。
 */
export async function updateMdEvent(
  uid: string,
  patch: Partial<MdEvent>,
): Promise<{ success: true; event: MdEvent }> {
  const r = await api.put(`/api/md-bridge/events/${encodeURIComponent(uid)}`, patch);
  return r.data;
}

/**
 * 把 events.md 推送到 CalDAV（如果配置了 CalDAV）。
 * 用于：用户从 UI 创建/修改事件后做一次正向同步。
 * 默认 direction=push（md → CalDAV），不拉取远程，避免覆盖本地修改。
 */
export async function syncMdToCaldav(opts?: {
  direction?: "push" | "pull" | "bidirectional";
  calendarUrl?: string;
}): Promise<{ success: boolean; results?: any }> {
  const r = await api.post("/api/md-bridge/sync/caldav", {
    direction: opts?.direction || "push",
    calendarUrl: opts?.calendarUrl,
  });
  return r.data;
}

// ===== iCalendar 文件导入 / 导出 =====

export interface IcsImportResult {
  success: true;
  importedCount: number;
  skippedCount: number;
  totalCount: number;
  filePath?: string;
}

/** 导入预览结果（dryRun，不写盘） */
export interface IcsImportPreview {
  success: true;
  dryRun: true;
  parsedCount: number;
  importedCount: number;
  skippedCount: number;
  events: MdEvent[];
}

/**
 * 把一份 .ics 文件导入 events.md。
 *
 * @param icsContent .ics 全文
 * @param opts.mode "append"（默认，保留现有事件）| "replace"（先清空再导入）
 */
export async function importIcsFile(
  icsContent: string,
  opts?: { mode?: "append" | "replace"; dryRun?: boolean },
): Promise<IcsImportResult | IcsImportPreview> {
  const r = await api.post("/api/md-bridge/ics/import", {
    icsContent,
    mode: opts?.mode || "append",
    dryRun: opts?.dryRun,
  });
  return r.data;
}

/**
 * 导出 events.md 为单个 .ics 文件文本。
 * @param range 可选日期范围过滤
 */
export async function exportIcs(range?: {
  start?: string;
  end?: string;
}): Promise<{ success: true; icsContent: string; count: number }> {
  const r = await api.get("/api/md-bridge/ics/export", { params: range });
  return r.data;
}

/** 导出文件的下载 URL（直接给浏览器/系统下载用） */
export function exportIcsDownloadUrl(range?: {
  start?: string;
  end?: string;
}): string {
  const base = import.meta.env.VITE_API_URL || "";
  const params = new URLSearchParams({ download: "1" });
  if (range?.start) params.set("start", range.start);
  if (range?.end) params.set("end", range.end);
  return `${base}/api/md-bridge/ics/export?${params.toString()}`;
}