/**
 * CalDAV 同步通道（workspace.md ↔ CalDAV）
 * =========================================
 *
 * ## 这条通道与 WebDAV 通道的分工
 *
 * - **WebDAV**：把 workspace.md 原样传到网盘（多设备同步同一份 md，不转换）
 * - **CalDAV**：把条目转成 VEVENT 推到日历服务器（手机 / Outlook / Google 能看见）
 *
 * 两者互不依赖，也都不影响本地：本地功能始终读写 workspace.md。
 *
 * ## 为什么重写（而不是继续用旧通道）
 *
 * 旧通道同步的是**已废弃的 events.md**，
 * 与统一数据源（workspace.md）不是同一份数据 —— 用户在界面上点「推送 CalDAV」，
 * 推上去的其实是另一份文件的旧内容。这是 README 里标注的最高优先级缺口。
 *
 * ## 关键设计
 *
 * 1. **UID 落盘**：拉取时把远端的 UID 存进条目的 `uid` 字段。否则本地改完
 *    再推回去会被服务器当成新事件 —— 手机上出现重复日程。
 * 2. **指纹 + ETag 双向判断**：`state` 文件记录上次同步时的字段指纹与远端 ETag。
 *    本地改没改、远端改没改都靠它判断，从而做到：
 *      - 没变化的不重传（省流量、不刷新别人的日历提醒）
 *      - **两边都改过时不静默覆盖**，报 conflict 交给用户
 * 3. **增量拉取**：PROPFIND 拿到 ETag，和 state 一致的对象不 GET。
 * 4. **状态文件与 workspace.md 同目录**（`.caldav-sync-state.json`），
 *    不进 git，丢了也只是下次全量重拉（不会丢数据）。
 *
 * ## 已知边界（明确不做，避免误伤）
 *
 * - 只同步**有 start 的条目**（VEVENT）。纯截止日期的任务是 VTODO，暂不同步。
 * - 不同步「远端删除」：如果别的设备删了事件，本地条目会保留。
 *   自动删本地数据风险太大，宁可手动清理。
 * - 重复事件的例外实例（RECURRENCE-ID）跳过 —— 合并规则太复杂，
 *   盲写会把主事件覆盖成「只剩一天」。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "./config.js";
import {
  readWorkspace,
  workspaceFilePath,
  newItemId,
  type ParsedItem,
  type WorkbenchItem,
} from "./workspace.js";
import { fingerprintItems, mutateWorkspace } from "./workspace-store.js";
import {
  assertWritable,
  beginSyncActivity,
  currentSyncEpoch,
  recordSyncConflict,
  recordSyncEvent,
} from "./sync-control.js";
import {
  itemsToIcs,
  parseIcsEvents,
  icsEventToItem,
  idFromUid,
  legacyIdFromUid,
  type IcsEvent,
} from "./ics-convert.js";

export type SyncDirection = "push" | "pull" | "bidirectional";

/** 同步用的配置（全部来自统一配置层，界面改完立即生效） */
export interface CalDAVSyncSettings {
  rootUrl: string;
  /** 具体日历的 URL；为空时用 PROPFIND / tsdav 自动发现第一个 */
  calendarUrl: string;
  username: string;
  password: string;
  direction: SyncDirection;
  autoSyncMinutes: number;
  timeoutMs: number;
}

/**
 * 方向归一化。
 *
 * 配置层历史上同时存在 `md-to-caldav` / `push` 两套写法，
 * 直接比较字符串会导致「填了配置但什么都不发生」—— 这里统一收口。
 */
export function normalizeDirection(raw: string | undefined): SyncDirection {
  const v = (raw || "").trim().toLowerCase();
  switch (v) {
    case "push":
    case "md-to-caldav":
    case "md2caldav":
      return "push";
    case "pull":
    case "caldav-to-md":
    case "caldav2md":
      return "pull";
    case "bidirectional":
    case "both":
    case "":
      return "bidirectional";
    default:
      return "bidirectional";
  }
}

/** 读取同步配置 */
export function loadCalDAVSyncSettings(): CalDAVSyncSettings {
  const cfg = getConfig();
  const env = process.env;
  return {
    rootUrl: cfg.caldav.rootUrl || env.CALDAV_ROOT_URL || env.CALDAV_URL || "",
    calendarUrl:
      cfg.caldav.calendarUrl ||
      env.CALDAV_CALENDAR_URL ||
      "",
    username: cfg.caldav.username || env.CALDAV_USER || "",
    password: cfg.caldav.password || env.CALDAV_PASS || "",
    direction: normalizeDirection(cfg.caldav.syncDirection),
    autoSyncMinutes: Number(cfg.caldav.autoSyncMinutes) || 0,
    timeoutMs: Number(cfg.caldav.timeoutMs) || 15000,
  };
}

// ===== 状态文件 =====

/** 单个日历对象的同步状态 */
export interface SyncStateItem {
  uid: string;
  /** 对应的本地条目 id（用户改名/改时间不影响） */
  id: string;
  /** 远端对象的完整 URL */
  href: string;
  /** 上次同步时远端的 ETag */
  etag?: string;
  /** 上次同步时的本地字段指纹 —— 用来判断「本地改没改」 */
  fingerprint: string;
  /**
   * 上次同步时的字段快照 —— 字段级「合并」需要它做基线。
   * 旧状态文件没有这一项；没有基线时合并退化为「保留本地」。
   */
  fields?: Record<string, unknown>;
  syncedAt: string;
}

interface SyncState {
  version: 1;
  calendars: Record<
    string,
    { lastSyncAt?: string; items: Record<string, SyncStateItem> }
  >;
}

/**
 * 状态文件位置：与 workspace.md 同目录。
 * 这样换了数据文件路径，状态不会串到别的数据集上。
 */
export function syncStatePath(): string {
  if (process.env.CALDAV_SYNC_STATE_FILE) return process.env.CALDAV_SYNC_STATE_FILE;
  return path.join(path.dirname(workspaceFilePath()), ".caldav-sync-state.json");
}

export function readSyncState(): SyncState {
  try {
    const p = syncStatePath();
    if (!fs.existsSync(p)) return { version: 1, calendars: {} };
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!parsed || parsed.version !== 1 || typeof parsed.calendars !== "object") {
      return { version: 1, calendars: {} };
    }
    return parsed as SyncState;
  } catch (e) {
    console.warn("[CalDAV] 读取同步状态失败（按首次同步处理）：", (e as Error).message);
    return { version: 1, calendars: {} };
  }
}

function writeSyncState(state: SyncState): void {
  try {
    const p = syncStatePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.warn("[CalDAV] 写入同步状态失败：", (e as Error).message);
  }
}

// ===== 字段指纹 =====

/**
 * 参与同步的字段。
 *
 * 刻意**不包含** `kind` / `list` / `parent` / `done` —— 这些是本地组织方式，
 * ICS 里没有对应字段，改它们不该触发一次网络往返。
 */
const SYNC_FIELDS = [
  "title",
  "start",
  "end",
  "allDay",
  "description",
  "location",
  "project",
  "priority",
  "recurrence",
  "status",
] as const;

function normalizeStatus(s: string | undefined): string {
  return (s || "confirmed").toLowerCase();
}

/** 条目 → 参与同步的字段快照（指纹与三方合并共用同一份定义） */
export function itemFields(item: WorkbenchItem): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of SYNC_FIELDS) {
    if (k === "status") {
      o[k] = normalizeStatus(item.status);
      continue;
    }
    if (k === "allDay") {
      // false 与 undefined 在 ICS 里是同一件事（非全天）。
      // 这里统一成 true / null，否则「本地 undefined、远端 false」
      // 会被当成「远端改过」，每次同步都白跑一次。
      o[k] = item.allDay ? true : null;
      continue;
    }
    o[k] = (item as any)[k] ?? null;
  }
  // 空的 end 与「等于 start 的 end」在 ICS 里都是零长度事件
  if (o.start && o.end && String(o.end) <= String(o.start)) o.end = null;
  o.tags = [...(item.tags ?? [])].map((t) => t.trim()).filter(Boolean).sort();
  return o;
}

/** ICS 事件 → 同一形状的字段快照 */
export function eventFields(ev: IcsEvent): Record<string, unknown> {
  const o: Record<string, unknown> = {
    title: ev.title,
    start: ev.start,
    end: ev.end ?? null,
    allDay: ev.allDay ? true : null,
    description: ev.description ?? null,
    location: ev.location ?? null,
    project: ev.project ?? null,
    priority: ev.priority ?? null,
    recurrence: ev.recurrence ?? null,
    status: normalizeStatus(ev.status),
  };
  if (o.start && o.end && String(o.end) <= String(o.start)) o.end = null;
  o.tags = [...(ev.tags ?? [])].map((t) => t.trim()).filter(Boolean).sort();
  return o;
}

/** 条目 → 指纹（稳定 JSON） */
export function itemFingerprint(item: WorkbenchItem): string {
  return JSON.stringify(itemFields(item));
}

/** ICS 事件 → 指纹（用于「远端改没改」） */
function eventFingerprint(ev: IcsEvent): string {
  return JSON.stringify(eventFields(ev));
}

/** 字段快照 → 条目（只覆盖参与同步的字段，uid / kind / list / parent / done 保留） */
function applyFieldsToItem(
  item: WorkbenchItem,
  f: Record<string, unknown>,
): WorkbenchItem {
  return {
    ...item,
    title: typeof f.title === "string" ? f.title : item.title,
    start: (f.start as string | null) ?? undefined,
    end: (f.end as string | null) ?? undefined,
    allDay: f.allDay ? true : undefined,
    description: (f.description as string | null) ?? undefined,
    location: (f.location as string | null) ?? undefined,
    project: (f.project as string | null) ?? undefined,
    priority: (f.priority as WorkbenchItem["priority"] | null) ?? undefined,
    recurrence: (f.recurrence as string | null) ?? undefined,
    status: (f.status as WorkbenchItem["status"]) ?? undefined,
    tags: Array.isArray(f.tags) && f.tags.length ? (f.tags as string[]) : undefined,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 字段级三方合并。
 *
 * 逐字段判断：
 *  - 两边相同 → 不变
 *  - 只有远端改（本地 == 基线）→ 用远端
 *  - 只有本地改（远端 == 基线）→ 保留本地
 *  - 两边都改 → **保留本地**，并记录冲突字段（不猜用户想留哪个）
 *
 * 没有基线（旧状态文件 / 首次同步）时退化为「保留本地」：
 * 宁可少合并一点，也不静默丢掉本地修改。
 */
function mergeFields(
  localF: Record<string, unknown>,
  remoteF: Record<string, unknown>,
  baseF?: Record<string, unknown>,
): { fields: Record<string, unknown>; conflictFields: string[] } {
  const out: Record<string, unknown> = { ...localF };
  const conflictFields: string[] = [];
  for (const key of Object.keys(remoteF)) {
    const l = localF[key];
    const r = remoteF[key];
    if (JSON.stringify(l) === JSON.stringify(r)) continue;
    if (!baseF) continue;
    const b = baseF[key];
    if (JSON.stringify(l) === JSON.stringify(b)) {
      out[key] = r;
    } else if (JSON.stringify(r) !== JSON.stringify(b)) {
      conflictFields.push(key);
    }
  }
  return { fields: out, conflictFields };
}

// ===== HTTP（最小 CalDAV 客户端） =====
//
// 不用 tsdav 读写对象，原因：
//  - 需要精确控制 ETag / If-Match（冲突检测）
//  - 需要按需 GET（增量拉取）
//  - tsdav 在部分 Radicale 版本上 fetchCalendarObjects 返回集合本身而非事件

function authHeader(s: CalDAVSyncSettings): Record<string, string> {
  if (!s.username) return {};
  const raw = `${s.username}:${s.password}`;
  return { Authorization: `Basic ${Buffer.from(raw, "utf-8").toString("base64")}` };
}

async function davRequest(
  s: CalDAVSyncSettings,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...authHeader(s),
      ...((init.headers as Record<string, string>) || {}),
    },
    signal: AbortSignal.timeout(s.timeoutMs),
  });
}

function describeHttpError(status: number, statusText: string): string {
  switch (status) {
    case 401:
    case 403:
      return `认证失败（${status}）：请检查 CalDAV 用户名 / 密码`;
    case 404:
      return "日历不存在（404）：请检查日历 URL 是否填对（要包含最后的 /）";
    case 405:
      return "服务器不接受该操作（405）";
    case 412:
      return "远端对象已被其他设备修改（412）";
    case 507:
      return "服务器存储空间不足（507）";
    default:
      return `CalDAV 请求失败：${status} ${statusText}`;
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(decodeXml(href.trim()), base).href;
  } catch {
    return href;
  }
}

function normalizeEtag(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let e = raw.trim();
  if (e.startsWith("W/")) e = e.slice(2);
  e = e.replace(/^"|"$/g, "");
  return e || undefined;
}

/** 远端对象（`event` 缺失 = 本次没下载，内容与上次同步一致） */
export interface RemoteObject {
  href: string;
  etag?: string;
  uid?: string;
  event?: IcsEvent;
}

/**
 * 列出日历里的所有对象。
 *
 * - PROPFIND Depth:1 拿 href + ETag
 * - ETag 与 state 一致的对象**不下载**（增量）
 * - 文件名以 .ics 结尾的才算事件对象
 */
export async function listRemoteObjects(
  s: CalDAVSyncSettings,
  calendarUrl: string,
  known: Record<string, SyncStateItem>,
): Promise<RemoteObject[]> {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

  const res = await davRequest(s, base, {
    method: "PROPFIND",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
    },
    body,
  });

  if (res.status !== 207 && !res.ok) {
    throw new Error(describeHttpError(res.status, res.statusText));
  }
  const xml = await res.text();

  // 按状态缓存：href → 记录（用于判断「这个 href 上次的 ETag 是什么」）
  const knownByHref = new Map<string, SyncStateItem>();
  for (const st of Object.values(known)) knownByHref.set(st.href, st);

  const blocks = [
    ...xml.matchAll(
      /<(?:[a-zA-Z]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?response>/gi,
    ),
  ].map((m) => m[1]);

  const out: RemoteObject[] = [];
  for (const block of blocks) {
    const hrefM = block.match(
      /<(?:[a-zA-Z]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?href>/i,
    );
    if (!hrefM) continue;
    const href = resolveUrl(hrefM[1], base);
    if (!/\.ics(?:$|\?)/i.test(href)) continue;

    const etagM = block.match(
      /<(?:[a-zA-Z]+:)?getetag\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?getetag>/i,
    );
    const etag = etagM ? normalizeEtag(decodeXml(etagM[1])) : undefined;

    const prev = knownByHref.get(href);
    // ETag 一致 → 远端没变，跳过下载
    if (prev && etag && prev.etag === etag) {
      out.push({ href, etag, uid: prev.uid });
      continue;
    }

    try {
      const obj = await getRemoteObject(s, href);
      if (!obj) continue;
      out.push({ href, etag: obj.etag ?? etag, uid: obj.event?.uid, event: obj.event });
    } catch (e) {
      console.warn(`[CalDAV] 读取对象失败 ${href}：`, (e as Error).message);
    }
  }

  return out;
}

/** 下载并解析单个远端对象 */
async function getRemoteObject(
  s: CalDAVSyncSettings,
  href: string,
): Promise<{ etag?: string; event: IcsEvent } | null> {
  const res = await davRequest(s, href, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(describeHttpError(res.status, res.statusText));
  const text = await res.text();
  const events = parseIcsEvents(text);
  const event = events.find((e) => e.uid) ?? events[0];
  if (!event) return null;
  return {
    etag: normalizeEtag(res.headers.get("etag")),
    event,
  };
}

/**
 * 生成安全的远端文件名（UID 里可能有斜杠、空格、中文）。
 *
 * 本来就是「文件名安全」的短 UID 直接用它（`a1b2c3d4.ics`）——
 * 与旧版 md-bridge 的命名一致，迁移时不会因为换个文件名而重复建对象。
 */
function filenameForUid(uid: string): string {
  const safe = uid
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (safe && safe === uid && uid.length <= 64 && !uid.startsWith(".")) {
    return `${uid}.ics`;
  }
  return `${safe.slice(0, 60) || "event"}-${idFromUid(uid)}.ics`;
}

/** 新对象的远端 URL */
function hrefForNewObject(calendarUrl: string, uid: string): string {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return new URL(filenameForUid(uid), base).href;
}

// ===== 同步主流程 =====

export interface SyncAction {
  uid: string;
  id: string;
  title: string;
  action: "created" | "updated" | "merged";
  /** 合并时：两边都改过、最终保留本地的字段名 */
  conflictFields?: string[];
}

export interface SyncConflict {
  uid: string;
  id: string;
  title: string;
  reason: string;
}

export interface CalDAVSyncResult {
  success: boolean;
  direction: SyncDirection;
  calendarUrl: string;
  pushed: SyncAction[];
  pulled: SyncAction[];
  /** 字段级合并的条目（本地 + 远端的并集，随后会推回远端） */
  merged: SyncAction[];
  /** 内容没变化而跳过的条目数 */
  skipped: number;
  conflicts: SyncConflict[];
  errors: string[];
  localTotal: number;
  remoteTotal: number;
  syncedAt: string;
}

/** 找出要参与同步的本地条目：有 start 的（日历视图同一个口径） */
function calendarItems(items: ParsedItem[]): WorkbenchItem[] {
  return items.filter((i) => !i.errors && !!i.start);
}

/** 判断本地条目对应的 UID */
function uidOf(item: WorkbenchItem): string {
  return item.uid || item.id;
}

function allocItemId(uid: string, items: WorkbenchItem[]): string {
  const base = idFromUid(uid);
  const used = new Set(items.map((i) => i.id));
  if (!used.has(base)) return base;
  // 极少数哈希碰撞：退化成随机 id（uid 仍然保证远端唯一）
  let candidate = newItemId();
  while (used.has(candidate)) candidate = newItemId();
  return candidate;
}

/** 把远端事件合并到已有条目上（保留纯本地字段） */
function applyEventToItem(
  item: WorkbenchItem,
  ev: IcsEvent,
): WorkbenchItem {
  const endIsZeroLength = !ev.end || !ev.start || ev.end <= ev.start;
  return {
    ...item,
    uid: ev.uid || item.uid,
    title: ev.title,
    start: ev.start,
    end: endIsZeroLength ? undefined : ev.end,
    allDay: ev.allDay ? true : undefined,
    description: ev.description,
    location: ev.location,
    project: ev.project,
    priority: ev.priority,
    recurrence: ev.recurrence,
    // 远端没写 STATUS 时保留本地原值，避免每次拉取都往 md 里塞一行
    // `status: confirmed`（内容没变却反复改文件）
    status: ev.status
      ? (ev.status as WorkbenchItem["status"])
      : item.status,
    tags: ev.tags && ev.tags.length ? ev.tags : undefined,
    updatedAt: ev.lastModified || new Date().toISOString(),
  };
}

/** 由远端事件新建条目（保留 uid，id 由 uid 确定性推导） */
function itemFromEvent(
  ev: IcsEvent,
  items: WorkbenchItem[],
  nowIso: string,
): WorkbenchItem {
  const created = icsEventToItem(ev, { kind: "event" });
  created.id = allocItemId(ev.uid, items);
  created.uid = ev.uid;
  created.createdAt = nowIso;
  created.updatedAt = ev.lastModified || nowIso;
  if (created.end && created.start && created.end <= created.start) {
    created.end = undefined;
  }
  return created;
}

/** 发现第一个可用日历（未显式配置 calendarUrl 时） */
export async function discoverCalendarUrl(): Promise<string> {
  const { ensureAuthenticated, davClient } = await import("./caldav.js");
  await ensureAuthenticated();
  const cals = await davClient.fetchCalendars();
  if (!cals || cals.length === 0) {
    throw new Error("CalDAV 服务器上没有找到日历");
  }
  const preferred = cals.find((c: any) => {
    const comps = c?.components;
    return Array.isArray(comps) && comps.some((x: string) => /VEVENT/i.test(x));
  });
  return String((preferred || cals[0]).url || "");
}

/** 解析日历 URL：显式参数 > 配置 > 自动发现 */
async function resolveCalendarUrl(
  s: CalDAVSyncSettings,
  explicit?: string,
): Promise<string> {
  const url = (explicit || s.calendarUrl || "").trim();
  if (url) return url;
  return discoverCalendarUrl();
}

let inFlight: Promise<CalDAVSyncResult> | null = null;

/**
 * 执行一次同步。
 *
 * 同一时间只允许一个同步在跑（手动点击 + 自动定时可能撞车），
 * 撞车时直接复用同一个 Promise，避免重复 PUT。
 */
export function syncWorkspaceToCalDAV(
  opts: {
    direction?: SyncDirection | string;
    calendarUrl?: string;
    /** true = 忽略冲突保护（pull 时远端赢，push 时本地赢） */
    force?: boolean;
    /** true = 冲突时做字段级合并（本地改的保留，远端改的采纳） */
    merge?: boolean;
    /** 只处理这些 UID（解决单个冲突时用，避免 force 波及别的条目） */
    uids?: string[];
  } = {},
): Promise<CalDAVSyncResult> {
  if (inFlight) return inFlight;
  // 恢复流程会调用 waitForInFlightSync() 等它结束；必须注册，
  // 否则恢复完的下一瞬间这次同步可能把旧数据写回去。
  const endActivity = beginSyncActivity("caldav");
  inFlight = doSync(opts).finally(() => {
    inFlight = null;
    endActivity();
  });
  return inFlight;
}

async function doSync(opts: {
  direction?: SyncDirection | string;
  calendarUrl?: string;
  force?: boolean;
  merge?: boolean;
  uids?: string[];
}): Promise<CalDAVSyncResult> {
  // 恢复（restore）会把 epoch 推进一格：网络阶段结束、真正落盘前必须校验，
  // 否则会把恢复前的旧数据写回刚恢复好的文件。见 SDS §2.7。
  const epochAtStart = currentSyncEpoch();
  const settings = loadCalDAVSyncSettings();
  const direction = normalizeDirection(opts.direction ?? settings.direction);
  const calendarUrl = await resolveCalendarUrl(settings, opts.calendarUrl);
  if (!calendarUrl) throw new Error("未配置 CalDAV 日历 URL");

  const nowIso = new Date().toISOString();
  const state = readSyncState();
  const calState = state.calendars[calendarUrl] ?? { items: {} };
  const known = calState.items;
  // 限定 UID 时只处理这些条目（冲突逐条解决，不连带覆盖别人）
  const onlyUids =
    opts.uids && opts.uids.length > 0 ? new Set(opts.uids) : null;

  const result: CalDAVSyncResult = {
    success: true,
    direction,
    calendarUrl,
    pushed: [],
    pulled: [],
    merged: [],
    skipped: 0,
    conflicts: [],
    errors: [],
    localTotal: 0,
    remoteTotal: 0,
    syncedAt: nowIso,
  };

  // ---- 远端清单（增量：ETag 没变的不下载）----
  const remoteList = await listRemoteObjects(settings, calendarUrl, known);
  result.remoteTotal = remoteList.length;

  const byUid = new Map<string, RemoteObject>();
  for (const r of remoteList) {
    // 例外实例（RECURRENCE-ID）与主事件同 UID，不能占用「主对象」的位置，
    // 否则 push 会写到例外实例上，把主事件改成只剩一天。
    if (r.uid && !r.event?.recurrenceId) byUid.set(r.uid, r);
  }

  const ws = readWorkspace();
  const items: ParsedItem[] = ws.items.map((i) => ({ ...i }));
  let wsChanged = false;

  // ===== Pull：远端 → 本地 =====
  if (direction === "pull" || direction === "bidirectional") {
    for (const remote of remoteList) {
      const ev = remote.event;
      if (!ev || !ev.uid) continue;
      if (onlyUids && !onlyUids.has(ev.uid)) continue;
      if (ev.recurrenceId) {
        // 重复事件的例外实例：合并规则复杂，跳过（不覆盖主事件）
        result.skipped++;
        continue;
      }

      const remoteFp = eventFingerprint(ev);
      let local = items.find((i) => !i.errors && uidOf(i) === ev.uid);

      // 迁移兼容：升级前从 ICS 导入的老条目没有 uid，id 是用旧的「去掉非 hex 字符」
      // 推导出来的。这里把它认领到远端 UID 上，避免第一次同步就多出一条重复。
      // 只有唯一候选时才认领 —— 旧算法对非 hex UID 全部落成 00000000，
      // 那种情况认领可能抓错条目，宁可不认。
      if (!local) {
        const legacy = legacyIdFromUid(ev.uid);
        if (legacy !== "00000000") {
          const candidates = items.filter(
            (i) => !i.errors && !i.uid && i.id === legacy,
          );
          if (candidates.length === 1) {
            local = candidates[0];
            local.uid = ev.uid;
            // uid 是新字段，必须落盘（否则下次同步又会重复一轮）
            wsChanged = true;
          }
        }
      }

      const base = known[ev.uid];

      if (!local) {
        const created = itemFromEvent(ev, items, nowIso);
        items.push(created);
        wsChanged = true;
        result.pulled.push({
          uid: ev.uid,
          id: created.id,
          title: created.title,
          action: "created",
        });
        known[ev.uid] = {
          uid: ev.uid,
          id: created.id,
          href: remote.href,
          etag: remote.etag,
          fingerprint: remoteFp,
          fields: eventFields(ev),
          syncedAt: nowIso,
        };
        continue;
      }

      const localFp = itemFingerprint(local);
      let takeRemote: boolean;

      if (base) {
        const localChanged = localFp !== base.fingerprint;
        const remoteChanged = remoteFp !== base.fingerprint;
        if (!localChanged && !remoteChanged) {
          result.skipped++;
          continue;
        }
        if (localChanged && remoteChanged && !opts.force) {
          if (opts.merge) {
            // ★ 字段级合并：本地改的字段保留，只有远端改的字段采纳。
            // 两边都改同一字段时保留本地，并把字段名报出来。
            const localF = itemFields(local);
            const remoteF = eventFields(ev);
            const { fields, conflictFields } = mergeFields(
              localF,
              remoteF,
              base.fields,
            );
            const merged = applyFieldsToItem(local, fields);
            merged.uid = local.uid;
            items[items.indexOf(local)] = merged;
            wsChanged = true;
            result.merged.push({
              uid: ev.uid,
              id: merged.id,
              title: merged.title,
              action: "merged",
              conflictFields,
            });
            // 故意不更新 known：让 push 阶段把「合并结果」推回远端
            continue;
          }

          // ★ 两边都改了：不静默覆盖，报冲突让用户决定
          result.conflicts.push({
            uid: ev.uid,
            id: local.id,
            title: local.title,
            reason: "本地与远端都修改过（默认保留本地，可强制推送、拉取或合并）",
          });
          recordSyncConflict({
            channel: "caldav",
            localId: local.id,
            remoteHref: remote.href,
            remoteEtag: remote.etag,
            summary: `「${local.title}」本地与远端都修改过`,
          });
          continue;
        }
        takeRemote = opts.force || (!localChanged && remoteChanged);
      } else {
        // 没有基线（首次同步 / 状态丢失）：比时间戳，谁新用谁
        const localTime = Date.parse(local.updatedAt || "") || 0;
        const remoteTime = Date.parse(ev.lastModified || "") || 0;
        takeRemote = opts.force || remoteTime > localTime;
      }

      if (!takeRemote) {
        result.skipped++;
        continue;
      }

      const idx = items.indexOf(local);
      const merged = applyEventToItem(local, ev);
      items[idx] = merged;
      wsChanged = true;
      result.pulled.push({
        uid: ev.uid,
        id: merged.id,
        title: merged.title,
        action: "updated",
      });
      known[ev.uid] = {
        uid: ev.uid,
        id: merged.id,
        href: remote.href,
        etag: remote.etag,
        fingerprint: remoteFp,
        fields: eventFields(ev),
        syncedAt: nowIso,
      };
    }
  }

  // ===== Push：本地 → 远端 =====
  if (direction === "push" || direction === "bidirectional") {
    // pull 之后条目可能被更新过，重新取一次
    const toPush = calendarItems(items);

    for (const item of toPush) {
      const uid = uidOf(item);
      if (onlyUids && !onlyUids.has(uid)) continue;
      const fp = itemFingerprint(item);
      const base = known[uid];
      const remote = byUid.get(uid);

      // 刚刚从远端合并下来的条目，内容已经一致，不再回传
      const localChanged = !base || base.fingerprint !== fp;
      if (!opts.force && !localChanged) {
        result.skipped++;
        continue;
      }

      // pull 阶段报了冲突的，push 阶段不要覆盖远端（除非用户 force）
      if (!opts.force && result.conflicts.some((c) => c.uid === uid)) {
        result.skipped++;
        continue;
      }

      const href =
        remote?.href || base?.href || hrefForNewObject(calendarUrl, uid);
      const etag = remote?.etag || base?.etag;
      const body = itemsToIcs([{ ...item, uid }]);
      const action: "created" | "updated" = remote || base ? "updated" : "created";

      try {
        const headers: Record<string, string> = {
          "Content-Type": "text/calendar; charset=utf-8",
        };
        // 乐观锁：只有确认远端还是上次那个版本时才覆盖
        if (etag && !opts.force) headers["If-Match"] = `"${etag}"`;

        const res = await davRequest(settings, href, {
          method: "PUT",
          headers,
          body,
        });

        if (res.status === 412) {
          if (opts.force) {
            // force：去掉 If-Match 再试一次
            const retry = await davRequest(settings, href, {
              method: "PUT",
              headers: { "Content-Type": "text/calendar; charset=utf-8" },
              body,
            });
            if (!retry.ok && retry.status !== 204) {
              throw new Error(describeHttpError(retry.status, retry.statusText));
            }
            known[uid] = {
              uid,
              id: item.id,
              href,
              etag: normalizeEtag(retry.headers.get("etag")) ?? etag,
              fingerprint: fp,
              fields: itemFields(item),
              syncedAt: nowIso,
            };
            result.pushed.push({ uid, id: item.id, title: item.title, action });
            continue;
          }
          result.conflicts.push({
            uid,
            id: item.id,
            title: item.title,
            reason: "推送到远端时发现对象已被其他设备修改（412）",
          });
          recordSyncConflict({
            channel: "caldav",
            localId: item.id,
            remoteHref: href,
            remoteEtag: etag,
            summary: `「${item.title}」推送时远端已被其他设备修改（412）`,
          });
          continue;
        }

        if (!res.ok && res.status !== 204) {
          throw new Error(describeHttpError(res.status, res.statusText));
        }

        known[uid] = {
          uid,
          id: item.id,
          href,
          etag: normalizeEtag(res.headers.get("etag")) ?? etag,
          fingerprint: fp,
          fields: itemFields(item),
          syncedAt: nowIso,
        };
        result.pushed.push({ uid, id: item.id, title: item.title, action });
      } catch (e) {
        result.errors.push(
          `推送「${item.title}」失败：${(e as Error).message}`,
        );
      }
    }
  }

  // ---- 落盘 ----
  //
  // 网络阶段（PROPFIND / GET / PUT）全部在锁外，只有这里短暂进锁，
  // 并且只写「本次同步真正改动过」的条目：
  //   · 同步期间用户在界面上改的其它条目不会被快照覆盖
  //   · 同一文件里并发发生的其它写入也不会被吞掉
  if (wsChanged) {
    const snapshotFp = fingerprintItems(ws.items);
    const workingFp = fingerprintItems(items);
    const changedIds = new Set<string>();
    for (const [id, fp] of workingFp) {
      if (snapshotFp.get(id) !== fp) changedIds.add(id);
    }
    const workingById = new Map(items.map((i) => [i.id, i]));
    await mutateWorkspace(
      (fresh) => {
        for (const id of changedIds) {
          const next = workingById.get(id);
          if (!next) continue;
          const idx = fresh.items.findIndex((i) => i.id === id);
          if (idx >= 0) fresh.items[idx] = next;
          else fresh.items.push(next);
        }
      },
      { epoch: epochAtStart },
    );
  }

  assertWritable(epochAtStart, "CalDAV 同步状态写入");
  calState.items = known;
  calState.lastSyncAt = nowIso;
  state.calendars[calendarUrl] = calState;
  state.version = 1;
  writeSyncState(state);

  try {
    result.localTotal = calendarItems(readWorkspace().items).length;
  } catch {
    // 统计值而已，读不到不该让整次同步失败
    result.localTotal = 0;
  }
  result.success = result.errors.length === 0;

  // 同步中心：记一条摘要事件（最近 20 条，重启清空）
  recordSyncEvent(
    "caldav",
    result.success ? "sync" : "error",
    `CalDAV ${direction}：推送 ${result.pushed.length}，拉取 ${result.pulled.length}，` +
      `合并 ${result.merged.length}，冲突 ${result.conflicts.length}，` +
      `跳过 ${result.skipped}，错误 ${result.errors.length}`,
  );
  for (const err of result.errors) recordSyncEvent("caldav", "error", err);

  return result;
}

// ===== 状态摘要（给界面用，不发网络请求） =====

export interface CalDAVSyncStatus {
  configured: boolean;
  calendarUrl: string;
  direction: SyncDirection;
  autoSyncMinutes: number;
  lastSyncAt?: string;
  /** 上次同步记录了多少个对象 */
  syncedCount: number;
  /** 本地有多少条会参与同步（有 start 的条目） */
  localCount: number;
  /** 本地改过但还没推上去的条数 */
  pendingCount: number;
  stateFilePath: string;
}

export function getCalDAVSyncStatus(): CalDAVSyncStatus {
  const s = loadCalDAVSyncSettings();
  const state = readSyncState();
  const url = s.calendarUrl;
  const calState = url ? state.calendars[url] : undefined;
  const known = calState?.items ?? {};

  const ws = readWorkspace();
  const locals = calendarItems(ws.items);
  let pending = 0;
  for (const it of locals) {
    const uid = uidOf(it);
    const base = known[uid];
    if (!base || base.fingerprint !== itemFingerprint(it)) pending++;
  }

  return {
    configured: !!(s.rootUrl || url) && !!s.username,
    calendarUrl: url,
    direction: s.direction,
    autoSyncMinutes: s.autoSyncMinutes,
    lastSyncAt: calState?.lastSyncAt,
    syncedCount: Object.keys(known).length,
    localCount: locals.length,
    pendingCount: pending,
    stateFilePath: syncStatePath(),
  };
}

// ===== 自动同步 =====
//
// 每分钟检查一次「距上次自动同步是否已经超过配置的间隔」。
// 这样在设置界面把间隔从 0 改成 30 之后**不用重启**，下一次 tick 就会生效。

let autoTimer: NodeJS.Timeout | null = null;
let lastAutoRun = 0;

async function autoSyncTick(): Promise<void> {
  const s = loadCalDAVSyncSettings();
  if (!s.autoSyncMinutes || s.autoSyncMinutes <= 0) return;
  if (!s.rootUrl && !s.calendarUrl) return;
  if (!s.username) return;
  if (Date.now() - lastAutoRun < s.autoSyncMinutes * 60_000) return;

  lastAutoRun = Date.now();
  try {
    const r = await syncWorkspaceToCalDAV({});
    console.log(
      `[CalDAV] 自动同步完成：推送 ${r.pushed.length}，拉取 ${r.pulled.length}，` +
        `冲突 ${r.conflicts.length}，错误 ${r.errors.length}`,
    );
  } catch (e) {
    console.warn("[CalDAV] 自动同步失败：", (e as Error).message);
  }
}

/** 启动自动同步定时器（幂等；配置为 0 时不产生任何请求） */
export function startCalDAVAutoSync(): void {
  if (autoTimer) return;
  autoTimer = setInterval(() => {
    void autoSyncTick();
  }, 60_000);
  // 不阻止进程退出（测试 / 关闭服务）
  autoTimer.unref?.();
  // 启动后立刻检查一次（配置了间隔则马上同步，不必等 1 分钟）
  void autoSyncTick();
  const s = loadCalDAVSyncSettings();
  if (s.autoSyncMinutes > 0) {
    console.log(
      `[CalDAV] 已启用自动同步，间隔 ${s.autoSyncMinutes} 分钟（workspace.md ↔ CalDAV）`,
    );
  }
}

export function stopCalDAVAutoSync(): void {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  lastAutoRun = 0;
}

/** 仅供测试：重置自动同步节拍 */
export function __resetAutoSyncClock(): void {
  lastAutoRun = 0;
}
