/**
 * workspace 唯一写入口（v0.3.0，SDS §2.2）
 *
 * 所有业务写入都必须经过这里：
 *  锁 → 读最新快照 → 修改 → 序列化 → 容错回读校验 → 图校验 → 备份 → 原子写。
 *
 * 这样做的理由：
 *  - 读-改-写之间不能有别的写入插进来（否则后写覆盖先写）；
 *  - 写之前必须确认「写出来的文本自己还能读回来」，否则一次序列化 bug 就会毁掉事实源；
 *  - 只读/恢复期间必须能拦住已经排队的写请求。
 */

import * as path from "node:path";
import {
  WorkspaceReadError,
  WorkspaceValidationError,
  type GraphIssue,
} from "./errors.js";
import { assertWritable, currentSyncEpoch } from "./sync-control.js";
import { withWorkspaceLock } from "./workspace-lock.js";
import {
  backupWorkspaceFile,
  isParseableItem,
  parseWorkspace,
  readWorkspace,
  serializeWorkspace,
  workspaceFilePath,
  type ParsedItem,
  type WorkspaceFile,
} from "./workspace.js";
import { atomicWriteFile } from "./storage-check.js";

export interface MutateOptions {
  filePath?: string;
  /** changed=只校验新增/修改条目（默认）；all=整文件；false=跳过（仅导入/测试） */
  validate?: "changed" | "all" | false;
  timeoutMs?: number;
  /** 同步调用方在开始时记下的 epoch；提交时会校验，恢复/重置后拒绝写入 */
  epoch?: number;
}

export interface MutateResult<T> {
  result: T;
  filePath: string;
}

const FINGERPRINT_FIELDS = [
  "id",
  "uid",
  "kind",
  "title",
  "start",
  "end",
  "due",
  "remind",
  "allDay",
  "done",
  "priority",
  "recurrence",
  "list",
  "parent",
  "project",
  "tags",
  "description",
  "location",
  "status",
  "createdAt",
  "updatedAt",
] as const;

/** 条目指纹：用于判断哪些条目被修改（含 extra/rawBlock，避免静默丢失） */
export function itemFingerprint(item: ParsedItem): string {
  const view: Record<string, unknown> = {};
  for (const key of FINGERPRINT_FIELDS) {
    view[key] = (item as unknown as Record<string, unknown>)[key];
  }
  view.extra = item.extra?.map((f) => `${f.key}=${f.value}`) ?? [];
  view.rawBlock = item.rawBlock ?? null;
  return JSON.stringify(view);
}

/** id → 指纹；没有 id 的坏块用 `#index` 占位，保证顺序变化也能被发现 */
export function fingerprintItems(items: ParsedItem[]): Map<string, string> {
  const map = new Map<string, string>();
  items.forEach((item, index) => {
    const key = item.id || `#${index}`;
    map.set(key, itemFingerprint(item));
  });
  return map;
}

/** 计算新增/修改/删除的 id 集合；删除的 id 也会返回（用于孤儿检查） */
export function changedIdsOf(
  before: Map<string, string>,
  after: Map<string, string>,
): Set<string> {
  const changed = new Set<string>();
  for (const [id, fp] of after) {
    if (before.get(id) !== fp) changed.add(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) changed.add(id);
  }
  return changed;
}

/** 校验 parent 存在、无自环/环、end > start、remind 可解析 */
export function validateWorkspaceGraph(
  items: ParsedItem[],
  opts: { onlyIds?: Set<string>; includeHistorical?: boolean } = {},
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const only = opts.includeHistorical ? null : opts.onlyIds;

  const byId = new Map<string, ParsedItem[]>();
  for (const item of items) {
    if (!item.id) continue;
    const list = byId.get(item.id) ?? [];
    list.push(item);
    byId.set(item.id, list);
  }

  const exists = new Set(byId.keys());

  // 删除父条目时，留下的子条目本身没变，但已经变成孤儿——必须把它们拉进校验范围
  const effectiveScope = new Set<string>(only ?? []);
  if (only && only.size) {
    for (const item of items) {
      if (item.parent && only.has(item.parent) && !exists.has(item.parent)) {
        if (item.id) effectiveScope.add(item.id);
      }
    }
  }

  const inScope = (id: string | undefined): boolean => {
    if (!only) return true;
    if (!id) return false;
    return effectiveScope.has(id);
  };

  for (const [id, dupes] of byId) {
    if (dupes.length <= 1) continue;
    if (!inScope(id)) continue;
    issues.push({
      code: "DUPLICATE_ID",
      itemId: id,
      message: `id 重复：${id}（${dupes.length} 条）`,
    });
  }

  for (const item of items) {
    if (!inScope(item.id)) continue;

    if (item.parent) {
      if (item.parent === item.id) {
        issues.push({
          code: "SELF_PARENT",
          itemId: item.id,
          message: `条目 ${item.id} 的 parent 指向自己`,
        });
      } else if (!exists.has(item.parent)) {
        issues.push({
          code: "ORPHAN_CHILD",
          itemId: item.id,
          message: `条目 ${item.id} 的 parent ${item.parent} 不存在`,
        });
      }
    }

    if (item.start && item.end) {
      const start = new Date(item.start).getTime();
      const end = new Date(item.end).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        issues.push({
          code: "INVALID_RANGE",
          itemId: item.id,
          message: `条目 ${item.id} 的 end 必须晚于 start`,
        });
      }
    }

    if (item.remind && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(item.remind)) {
      issues.push({
        code: "INVALID_REMIND",
        itemId: item.id,
        message: `条目 ${item.id} 的 remind 不是合法本地时间`,
      });
    }
  }

  // 环检测：只在被改条目参与的链上做，避免历史脏数据阻塞写入
  const cycleReported = new Set<string>();
  for (const item of items) {
    if (!inScope(item.id) || !item.id) continue;
    if (cycleReported.has(item.id)) continue;
    const seen = new Set<string>([item.id]);
    let cursor = item.parent;
    while (cursor) {
      if (seen.has(cursor)) {
        for (const id of seen) cycleReported.add(id);
        issues.push({
          code: "PARENT_CYCLE",
          itemId: item.id,
          message: `parent 链存在环：${[...seen].join(" → ")}`,
        });
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.[0]?.parent;
    }
  }

  return issues;
}

/**
 * 写文本前的容错回读校验。
 *
 * 允许空文件 / 只剩 notes（删除最后一条是合法操作），
 * 但「有 ## 块却一条都认不出来」必须拒绝——那是序列化 bug。
 */
function assertTextIsUsable(text: string): ParsedItem[] {
  const parsed = parseWorkspace(text);
  if (parsed.items.length === 0) return parsed.items;

  const parseable = parsed.items.filter(isParseableItem);
  if (parseable.length === 0) {
    throw new WorkspaceReadError(
      "写入前回读失败：生成的文本中没有可解析条目，已放弃写入",
    );
  }
  return parsed.items;
}

function validateOutcome(
  parsedItems: ParsedItem[],
  changed: Set<string>,
  mode: "changed" | "all" | false,
): void {
  if (mode === false) return;

  const issues: GraphIssue[] =
    mode === "all"
      ? validateWorkspaceGraph(parsedItems, { includeHistorical: true })
      : validateWorkspaceGraph(parsedItems, { onlyIds: changed });

  if (!issues.length) return;
  throw new WorkspaceValidationError(
    `数据校验失败：${issues.map((i) => i.message).join("；")}`,
    issues,
  );
}

function writeText(filePath: string, text: string, backup: boolean): void {
  if (backup) backupWorkspaceFile(filePath);
  // workspace.md 是唯一事实源，用户会直接用编辑器打开：0644
  atomicWriteFile(filePath, text, 0o644);
}

/**
 * 唯一通用写入口：在锁内读最新快照，交给 fn 修改，然后校验并原子写。
 *
 * fn 直接修改 `ws.items` / `ws.notes`（或返回新的 items）。
 * 返回的 `result` 原样透传。
 */
export async function mutateWorkspace<T>(
  fn: (ws: WorkspaceFile) => T | Promise<T>,
  opts: MutateOptions = {},
): Promise<MutateResult<T>> {
  const filePath = opts.filePath ?? workspaceFilePath();
  const mode = opts.validate ?? "changed";

  return withWorkspaceLock(async () => {
    // 拿到锁之后再检查：恢复开始前排队、恢复结束后才轮到执行的写必须被拦住
    assertWritable(opts.epoch, "工作区写入");
    // fn 让出事件循环期间 restore 可能 invalidateSyncEpoch()+setSyncMaintenance(true)；
    // 提交前必须复核，否则在途旧快照会静默覆盖恢复结果且调用方收到「成功」。
    const epochAtEntry = currentSyncEpoch();

    const ws = readWorkspace(filePath);
    const before = fingerprintItems(ws.items);

    const result = await fn(ws);

    const after = fingerprintItems(ws.items);
    const changed = changedIdsOf(before, after);

    const text = serializeWorkspace(ws.items, ws.notes, {
      frontmatterRaw: ws.frontmatterRaw,
      unknownBlocks: ws.unknownBlocks,
    });

    const parsedItems = assertTextIsUsable(text);
    validateOutcome(parsedItems, changed, mode);

    assertWritable(epochAtEntry, "工作区写入");
    writeText(filePath, text, true);
    return { result, filePath };
  }, opts.timeoutMs);
}

/**
 * 写调用方给出的完整文本（WebDAV merge / restore）。
 *
 * 与 mutateWorkspace 的区别：文本由调用方生成，但仍要在同一把锁内
 * 完成「读基线 → 生成文本 → 回读校验 → 原子写」，避免两次读快照。
 */
export async function mutateWorkspaceText<T>(
  fn: (ws: WorkspaceFile) => { result: T; text: string } | Promise<{ result: T; text: string }>,
  opts: MutateOptions = {},
): Promise<MutateResult<T>> {
  const filePath = opts.filePath ?? workspaceFilePath();
  const mode = opts.validate ?? "changed";

  return withWorkspaceLock(async () => {
    assertWritable(opts.epoch, "工作区写入");
    const epochAtEntry = currentSyncEpoch();

    const ws = readWorkspace(filePath);
    const before = fingerprintItems(ws.items);

    const { result, text } = await fn(ws);

    const parsedItems = assertTextIsUsable(text);
    const after = fingerprintItems(parsedItems);
    const changed = changedIdsOf(before, after);
    validateOutcome(parsedItems, changed, mode);

    assertWritable(epochAtEntry, "工作区写入");
    writeText(filePath, text, true);
    return { result, filePath };
  }, opts.timeoutMs);
}

/** 备份目录（跟随实际文件路径） */
export function workspaceBackupDir(filePath = workspaceFilePath()): string {
  return path.join(path.dirname(filePath), ".workspace-backups");
}
