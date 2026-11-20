/**
 * 备份（只读 API 的底层服务）
 * ==========================
 *
 * 备份文件放在 `data/.workspace-backups/`：
 *   - `workspace-<ISO>-<rand6>.md`  自动备份（写前复制），最多 20 份 / 50MB
 *   - `.pinned/<sha256>.md`         预览时固定的快照（24h 后清理）
 *   - `.pre-restore/`               恢复前备份（P7 使用）
 *
 * 这里的函数只被 `/api/workspace/backups*` 路由调用，不做任何写入 workspace 的操作。
 * 单个坏备份不能让整个列表 500 —— `itemCount` 用 tolerant parse，解析不了就是 `null`。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { WorkspaceHttpError } from "./errors.js";
import { atomicWriteFile } from "./storage-check.js";
import { isStorageReadOnly } from "./sync-control.js";
import {
  isParseableItem,
  parseWorkspace,
  readWorkspace,
  workspaceFilePath,
  type ParsedItem,
  type WorkbenchItem,
} from "./workspace.js";

/** 备份列表项（GET /api/workspace/backups） */
export interface BackupEntry {
  file: string;
  createdAt: string;
  size: number;
  /** 条目数；无法解析时为 null（不抛 500） */
  itemCount: number | null;
  pinned: boolean;
  pinnedSha256: string | null;
}

/** 预览 diff 中的单条 */
export interface BackupDiffItem {
  id: string;
  title: string;
  change: "added" | "removed" | "changed";
  fields?: string[];
}

export interface BackupDiff {
  added: number;
  removed: number;
  changed: number;
  items: BackupDiffItem[];
}

export interface PreviewResult {
  file: string;
  sha256: string;
  pinned: boolean;
  diff: BackupDiff;
}

/** 预览时比较的字段（与序列化字段保持一致） */
const DIFF_FIELDS: Array<keyof WorkbenchItem> = [
  "title",
  "kind",
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
];

/** 预览 diff 最多返回多少条明细 */
const MAX_DIFF_ITEMS = 20;

/** 固定快照目录 */
export function pinnedDir(backupsDir: string): string {
  return path.join(backupsDir, ".pinned");
}

/** 备份目录（跟随实际 workspace 文件路径） */
export function backupsDir(filePath = workspaceFilePath()): string {
  return path.join(path.dirname(filePath), ".workspace-backups");
}

/** 校验并解析备份文件名，防止路径穿越/符号链接逃逸 */
export function resolveBackupFile(
  file: unknown,
  filePath = workspaceFilePath(),
): { dir: string; abs: string; file: string } {
  if (typeof file !== "string" || !file.trim()) {
    throw new WorkspaceHttpError(400, "缺少备份文件名", "BACKUP_FILE_REQUIRED");
  }
  const name = file.trim();
  if (
    path.basename(name) !== name ||
    name.startsWith(".") ||
    !/\.md$/i.test(name) ||
    /[\\/]/.test(name)
  ) {
    throw new WorkspaceHttpError(400, `备份文件名不合法：${name}`, "BACKUP_FILE_INVALID");
  }

  const dir = backupsDir(filePath);
  const abs = path.join(dir, name);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new WorkspaceHttpError(404, `找不到备份：${name}`, "BACKUP_NOT_FOUND");
  }

  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    throw new WorkspaceHttpError(404, `找不到备份目录：${path.basename(dir)}`, "BACKUP_NOT_FOUND");
  }
  if (real !== realDir && !real.startsWith(realDir + path.sep)) {
    throw new WorkspaceHttpError(400, `备份文件名不合法：${name}`, "BACKUP_FILE_INVALID");
  }
  if (!fs.statSync(real).isFile()) {
    throw new WorkspaceHttpError(400, `备份文件名不合法：${name}`, "BACKUP_FILE_INVALID");
  }
  return { dir, abs: real, file: name };
}

/** 容错统计条目数：解析失败返回 null，不抛错 */
function countItemsTolerant(content: string): number | null {
  try {
    const ws = parseWorkspace(content);
    if (!ws.items.length) {
      // 空文件 = 0 条；有内容却一条都没解析出来 = 无法解析
      return content.trim() ? null : 0;
    }
    const items = ws.items.filter((it: ParsedItem) => isParseableItem(it));
    return items.length ? items.length : null;
  } catch {
    return null;
  }
}

/** 已固定的快照集合（sha256 → true） */
function pinnedSet(dir: string): Set<string> {
  try {
    const pd = pinnedDir(dir);
    return new Set(
      fs
        .readdirSync(pd)
        .filter((f) => /^[0-9a-f]{64}\.md$/.test(f))
        .map((f) => f.replace(/\.md$/, "")),
    );
  } catch {
    return new Set();
  }
}

/** 固定快照有效期 */
export const PINNED_TTL_MS = 24 * 60 * 60 * 1000;

/** 清理过期固定快照，返回删除数量 */
export function cleanupPinned(backupsDirPath: string, now = Date.now()): number {
  const pd = pinnedDir(backupsDirPath);
  let names: string[];
  try {
    names = fs.readdirSync(pd);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.md$/.test(name)) continue;
    try {
      const abs = path.join(pd, name);
      if (now - fs.statSync(abs).mtimeMs > PINNED_TTL_MS) {
        fs.unlinkSync(abs);
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/** 列出全部备份，最新在前 */
export function listBackups(filePath = workspaceFilePath()): BackupEntry[] {
  const dir = backupsDir(filePath);
  cleanupPinned(dir);
  const base = path.basename(filePath).replace(/\.md$/i, "");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const pinned = pinnedSet(dir);
  const entries: BackupEntry[] = [];

  for (const name of names) {
    if (!name.startsWith(`${base}-`) || !name.endsWith(".md")) continue;
    const abs = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    let content: string | null = null;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      content = null;
    }

    let sha: string | null = null;
    if (content !== null) {
      sha = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    }

    entries.push({
      file: name,
      createdAt: stat.mtime.toISOString(),
      size: stat.size,
      itemCount: content === null ? null : countItemsTolerant(content),
      pinned: sha !== null && pinned.has(sha),
      pinnedSha256: sha !== null && pinned.has(sha) ? sha : null,
    });
  }

  entries.sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0));
  return entries;
}

/** 把备份内容固定成 `.pinned/<sha256>.md`，返回是否固定成功 */
export function pinBackup(dir: string, sha256: string, content: string): boolean {
  if (isStorageReadOnly()) return false;
  try {
    const pd = pinnedDir(dir);
    fs.mkdirSync(pd, { recursive: true });
    const target = path.join(pd, `${sha256}.md`);
    if (fs.existsSync(target)) return true;
    // 备份是给人下载/拷走的，必须可读
    atomicWriteFile(target, content, 0o644);
    return true;
  } catch (err) {
    console.warn("[backups] 固定快照失败（继续预览）：", (err as Error).message);
    return false;
  }
}

/** 计算两份条目集合的 diff */
export function diffItems(
  backupItems: ParsedItem[],
  currentItems: ParsedItem[],
): BackupDiff {
  const before = new Map<string, ParsedItem>();
  for (const it of backupItems) if (it.id) before.set(it.id, it);
  const after = new Map<string, ParsedItem>();
  for (const it of currentItems) if (it.id) after.set(it.id, it);

  const items: BackupDiffItem[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [id, item] of before) {
    if (!after.has(id)) {
      removed += 1;
      items.push({ id, title: item.title || id, change: "removed" });
    }
  }
  for (const [id, item] of after) {
    const old = before.get(id);
    if (!old) {
      added += 1;
      items.push({ id, title: item.title || id, change: "added" });
      continue;
    }
    const fields: string[] = [];
    for (const field of DIFF_FIELDS) {
      if (JSON.stringify(old[field]) !== JSON.stringify(item[field])) {
        fields.push(field);
      }
    }
    if (fields.length) {
      changed += 1;
      items.push({ id, title: item.title || id, change: "changed", fields });
    }
  }

  return { added, removed, changed, items: items.slice(0, MAX_DIFF_ITEMS) };
}

/** 预览：算 sha + diff，并在可写时固定快照 */
export function previewBackup(
  file: unknown,
  filePath = workspaceFilePath(),
): PreviewResult {
  const { dir, abs, file: name } = resolveBackupFile(file, filePath);

  let content: string;
  try {
    content = fs.readFileSync(abs, "utf-8");
  } catch (err) {
    throw new WorkspaceHttpError(
      500,
      `读取备份失败：${(err as Error).message}`,
      "BACKUP_READ_FAILED",
    );
  }

  let backupItems: ParsedItem[];
  try {
    backupItems = parseWorkspace(content).items;
  } catch {
    throw new WorkspaceHttpError(400, `备份无法解析：${name}`, "BACKUP_UNPARSEABLE");
  }
  if (backupItems.length > 0 && backupItems.every((it) => !isParseableItem(it))) {
    throw new WorkspaceHttpError(400, `备份无法解析：${name}`, "BACKUP_UNPARSEABLE");
  }

  const sha256 = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  const pinned = pinBackup(dir, sha256, content);

  let currentItems: ParsedItem[] = [];
  try {
    currentItems = readWorkspace(filePath).items;
  } catch {
    // 当前文件读不出来时仍然允许预览（否则恰好是最需要备份的时候不可用）
    currentItems = [];
  }

  return {
    file: name,
    sha256,
    pinned,
    diff: diffItems(backupItems, currentItems),
  };
}

/** 导出：读取备份 Buffer（同样做路径校验） */
export function readBackupForExport(
  file: unknown,
  filePath = workspaceFilePath(),
): { file: string; content: Buffer } {
  const { abs, file: name } = resolveBackupFile(file, filePath);
  try {
    return { file: name, content: fs.readFileSync(abs) };
  } catch {
    throw new WorkspaceHttpError(404, `找不到备份：${name}`, "BACKUP_NOT_FOUND");
  }
}
