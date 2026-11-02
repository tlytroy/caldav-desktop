import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 30000,
});

/**
 * 统一数据源客户端（workspace.md）
 * =================================
 *
 * 日历、看板、快速创建都通过这里读写**同一个文件**。
 * 模块之间的差别只是筛选条件（scope），不是数据来源。
 */

export type ItemKind = "task" | "event";
export type ItemPriority = "high" | "mid" | "low";

export interface WorkbenchItem {
  id: string;
  kind: ItemKind;
  title: string;
  start?: string;
  end?: string;
  due?: string;
  allDay?: boolean;
  done?: boolean;
  priority?: ItemPriority;
  recurrence?: string;
  project?: string;
  tags?: string[];
  description?: string;
  location?: string;
  status?: "confirmed" | "tentative" | "cancelled" | "needs-action";
  createdAt?: string;
  updatedAt?: string;
  /** 展开后的实例标记（instanceId 指向原始条目） */
  instanceId?: string;
  instanceDate?: string;
  /** 解析错误（服务端会带上，便于界面提示） */
  errors?: string[];
}

export interface ItemQuery {
  /** all | calendar | board —— 模块视角 */
  scope?: "all" | "calendar" | "board";
  kind?: ItemKind;
  start?: string;
  end?: string;
  includeDone?: boolean;
  /** 是否把重复事件展开成多个实例 */
  expand?: boolean;
}

export interface ValidationReport {
  total: number;
  valid: number;
  invalid: number;
  issues: Array<{ id?: string; title?: string; errors: string[] }>;
}

export interface RecurrenceOption {
  value: string;
  label: string;
}

/** 拉取条目列表 */
export async function fetchItems(
  query: ItemQuery = {},
): Promise<{ items: WorkbenchItem[]; filePath: string; notes: string }> {
  const params: Record<string, string> = {};
  if (query.scope) params.scope = query.scope;
  if (query.kind) params.kind = query.kind;
  if (query.start) params.start = query.start;
  if (query.end) params.end = query.end;
  if (query.includeDone !== undefined) {
    params.includeDone = String(query.includeDone);
  }
  if (query.expand) params.expand = "true";

  const { data } = await api.get("/api/workspace/items", { params });
  return {
    items: data.items || [],
    filePath: data.filePath,
    notes: data.notes || "",
  };
}

/** 创建条目 */
export async function createItem(
  item: Partial<WorkbenchItem>,
): Promise<WorkbenchItem> {
  const { data } = await api.post("/api/workspace/items", item);
  return data.item;
}

/** 更新条目（只传要改的字段） */
export async function updateItem(
  id: string,
  patch: Partial<WorkbenchItem>,
): Promise<WorkbenchItem> {
  const { data } = await api.put(`/api/workspace/items/${id}`, patch);
  return data.item;
}

/** 删除条目 */
export async function deleteItem(id: string): Promise<void> {
  await api.delete(`/api/workspace/items/${id}`);
}

/** 校验报告 */
export async function fetchValidation(): Promise<ValidationReport> {
  const { data } = await api.get("/api/workspace/validation");
  return data;
}

/** 数据源文件信息 */
export async function fetchWorkspaceInfo(): Promise<{
  filePath: string;
  total: number;
  valid: number;
  invalid: number;
  tasks: number;
  events: number;
  scheduled: number;
}> {
  const { data } = await api.get("/api/workspace/info");
  return data;
}

/** 重复规则选项 */
export async function fetchRecurrenceOptions(): Promise<RecurrenceOption[]> {
  const { data } = await api.get("/api/workspace/recurrence/options");
  return data.options || [];
}

/** 预览重复规则会展开成哪些日期 */
export async function previewRecurrence(
  rule: string,
  start: string,
  weeks = 8,
): Promise<{ label: string; dates: string[] }> {
  const { data } = await api.get("/api/workspace/recurrence/preview", {
    params: { rule, start, weeks: String(weeks) },
  });
  return { label: data.label, dates: data.dates || [] };
}

/** 把重复规则翻译成中文 */
export function describeRecurrence(rule?: string): string {
  if (!rule) return "不重复";
  const map: Record<string, string> = {
    "FREQ=DAILY": "每天",
    "FREQ=WEEKLY": "每周",
    "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR": "每周一至五",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR": "每周一、三、五",
    "FREQ=WEEKLY;BYDAY=SA,SU": "每周末",
    "FREQ=MONTHLY": "每月",
    "FREQ=MONTHLY;BYMONTHDAY=1": "每月1号",
    "FREQ=MONTHLY;BYMONTHDAY=15": "每月15号",
    "FREQ=YEARLY": "每年",
  };
  return map[rule] || rule;
}

// ===== ICS 导入 / 导出 =====
// 这是唯一需要格式转换的地方：md 是我们自定义的，ics 是标准格式。

export interface IcsImportPreview {
  parsed: number;
  toImport: number;
  skipped: number;
  preview: Array<{
    id: string;
    title: string;
    start?: string;
    allDay?: boolean;
    recurrence?: string;
  }>;
}

/** 导入 .ics（dryRun=true 时只预览不落盘） */
export async function importIcs(
  icsContent: string,
  opts: {
    mode?: "append" | "replace";
    kind?: "task" | "event";
    dryRun?: boolean;
    skipDuplicates?: boolean;
  } = {},
): Promise<IcsImportPreview & { imported?: number; total?: number; filePath?: string }> {
  const { data } = await api.post("/api/workspace/ics/import", {
    icsContent,
    mode: opts.mode ?? "append",
    kind: opts.kind ?? "event",
    dryRun: opts.dryRun ?? false,
    skipDuplicates: opts.skipDuplicates ?? true,
  });
  return data;
}

/** 导出 .ics 文本 */
export async function exportIcs(opts: {
  start?: string;
  end?: string;
  scope?: "all" | "calendar" | "board";
  expand?: boolean;
} = {}): Promise<{ ics: string; count: number }> {
  const params: Record<string, string> = {};
  if (opts.start) params.start = opts.start;
  if (opts.end) params.end = opts.end;
  if (opts.scope) params.scope = opts.scope;
  if (opts.expand) params.expand = "1";
  const { data } = await api.get("/api/workspace/ics/export", { params });
  return data;
}

/** 导出下载链接（用于 <a download> 或 window.open） */
export function exportIcsDownloadUrl(opts: {
  start?: string;
  end?: string;
  scope?: "all" | "calendar" | "board";
} = {}): string {
  const base = import.meta.env.VITE_API_URL || "";
  const params = new URLSearchParams({ download: "1" });
  if (opts.start) params.set("start", opts.start);
  if (opts.end) params.set("end", opts.end);
  if (opts.scope) params.set("scope", opts.scope);
  return `${base}/api/workspace/ics/export?${params.toString()}`;
}
