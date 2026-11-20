/**
 * 备份只读 API 的单元测试（SDS §8.1 S9）
 *
 * 覆盖：列表容错、itemCount=null、预览 diff/sha/固定快照、路径穿越、
 * 只读模式不固定、同毫秒备份不覆盖、轮转上限。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backupsDir,
  diffItems,
  listBackups,
  previewBackup,
  readBackupForExport,
  resolveBackupFile,
} from "../backups.js";
import { WorkspaceHttpError } from "../errors.js";
import { setStorageReadOnly } from "../sync-control.js";
import {
  backupWorkspaceFile,
  parseWorkspace,
  serializeWorkspace,
  type WorkbenchItem,
} from "../workspace.js";

let tmp: string;
let wsFile: string;

function writeWorkspaceFile(items: WorkbenchItem[]): void {
  fs.writeFileSync(wsFile, serializeWorkspace(items), "utf-8");
}

function backupFile(name: string, content: string): void {
  const dir = backupsDir(wsFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, "utf-8");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backups-test-"));
  wsFile = path.join(tmp, "workspace.md");
  setStorageReadOnly(false);
});

afterEach(() => {
  setStorageReadOnly(false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("备份列表", () => {
  it("没有目录时返回空数组", () => {
    expect(listBackups(wsFile)).toEqual([]);
  });

  it("列出备份并按文件名倒序", () => {
    writeWorkspaceFile([{ id: "aaaaaaa1", kind: "task", title: "当前" }]);
    backupFile(
      "workspace-2026-11-01T10-00-00-000Z-aaaaaa.md",
      serializeWorkspace([{ id: "bbbbbbb2", kind: "task", title: "旧" }]),
    );
    backupFile(
      "workspace-2026-11-02T10-00-00-000Z-bbbbbb.md",
      serializeWorkspace([{ id: "ccccccc3", kind: "task", title: "新" }]),
    );

    const list = listBackups(wsFile);
    expect(list).toHaveLength(2);
    expect(list[0].file).toContain("2026-11-02");
    expect(list[0].itemCount).toBe(1);
    expect(list[0].size).toBeGreaterThan(0);
    expect(list[0].pinned).toBe(false);
    expect(list[0].pinnedSha256).toBeNull();
  });

  it("无法解析的备份 itemCount 为 null 而不是抛错", () => {
    backupFile("workspace-bad.md", "这不是 markdown 条目");
    const list = listBackups(wsFile);
    expect(list).toHaveLength(1);
    expect(list[0].itemCount).toBeNull();
  });

  it("部分坏条的备份仍能统计出可解析条目数", () => {
    backupFile(
      "workspace-partial.md",
      serializeWorkspace([
        { id: "ddddddd4", kind: "task", title: "好条目" },
        { id: "bad", kind: "task", title: "" } as WorkbenchItem,
      ]),
    );
    const list = listBackups(wsFile);
    expect(list[0].itemCount).toBe(2);
  });

  it("忽略非本工作区的文件与子目录", () => {
    backupFile("other-2026-11-01.md", "x");
    backupFile("workspace-x.txt", "x");
    fs.mkdirSync(path.join(backupsDir(wsFile), "workspace-dir.md"), { recursive: true });
    expect(listBackups(wsFile)).toEqual([]);
  });
});

describe("备份轮转", () => {
  it("同毫秒连续备份不会互相覆盖", () => {
    writeWorkspaceFile([{ id: "aaaaaaa1", kind: "task", title: "v0" }]);
    const first = backupWorkspaceFile(wsFile);
    const second = backupWorkspaceFile(wsFile);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(fs.existsSync(first!)).toBe(true);
    expect(fs.existsSync(second!)).toBe(true);
  });

  it("最多保留 20 份", () => {
    writeWorkspaceFile([{ id: "aaaaaaa1", kind: "task", title: "v0" }]);
    for (let i = 0; i < 25; i++) backupWorkspaceFile(wsFile);
    const files = fs
      .readdirSync(backupsDir(wsFile))
      .filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(20);
  });

  it("已固定的备份不会被轮转删掉（固定期间可恢复）", () => {
    writeWorkspaceFile([{ id: "aaaaaaa1", kind: "task", title: "pinned" }]);
    const first = backupWorkspaceFile(wsFile)!;
    const content = fs.readFileSync(first, "utf-8");
    const sha = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    const pd = path.join(backupsDir(wsFile), ".pinned");
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, `${sha}.md`), content, "utf-8");

    for (let i = 0; i < 30; i++) backupWorkspaceFile(wsFile);

    expect(fs.existsSync(first)).toBe(true);
    const entry = listBackups(wsFile).find((b) => b.file === path.basename(first));
    expect(entry?.pinned).toBe(true);
    expect(entry?.pinnedSha256).toBe(sha);
  });

  it("固定快照 24h 后自动过期", () => {
    writeWorkspaceFile([{ id: "aaaaaaa1", kind: "task", title: "expiring" }]);
    const file = backupWorkspaceFile(wsFile)!;
    const content = fs.readFileSync(file, "utf-8");
    const sha = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    const pd = path.join(backupsDir(wsFile), ".pinned");
    fs.mkdirSync(pd, { recursive: true });
    const pin = path.join(pd, `${sha}.md`);
    fs.writeFileSync(pin, content, "utf-8");
    expect(listBackups(wsFile).find((b) => b.file === path.basename(file))?.pinned).toBe(true);

    const old = Date.now() - 25 * 60 * 60 * 1000;
    fs.utimesSync(pin, new Date(old), new Date(old));

    expect(listBackups(wsFile).find((b) => b.file === path.basename(file))?.pinned).toBe(false);
    expect(fs.existsSync(pin)).toBe(false);
  });
});

describe("路径校验", () => {
  it("拒绝路径穿越", () => {
    expect(() => resolveBackupFile("../workspace.md", wsFile)).toThrow(WorkspaceHttpError);
    expect(() => resolveBackupFile("a/b.md", wsFile)).toThrow(WorkspaceHttpError);
    expect(() => resolveBackupFile(".hidden.md", wsFile)).toThrow(WorkspaceHttpError);
    expect(() => resolveBackupFile("", wsFile)).toThrow(WorkspaceHttpError);
    expect(() => resolveBackupFile(undefined, wsFile)).toThrow(WorkspaceHttpError);
  });

  it("拒绝绝对路径", () => {
    expect(() => resolveBackupFile("/etc/passwd.md", wsFile)).toThrow(WorkspaceHttpError);
  });

  it("不存在的备份返回 404", () => {
    fs.mkdirSync(backupsDir(wsFile), { recursive: true });
    try {
      resolveBackupFile("workspace-missing.md", wsFile);
      throw new Error("应当抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceHttpError);
      expect((err as WorkspaceHttpError).status).toBe(404);
    }
  });
});

describe("预览", () => {
  it("计算 sha256、diff 与固定快照", () => {
    writeWorkspaceFile([
      { id: "aaaaaaa1", kind: "task", title: "保留" },
      { id: "bbbbbbb2", kind: "task", title: "当前版本" },
      { id: "ddddddd4", kind: "task", title: "会被修改", due: "2026-11-05" },
    ]);
    const backupContent = serializeWorkspace([
      { id: "aaaaaaa1", kind: "task", title: "保留" },
      { id: "ccccccc3", kind: "task", title: "备份独有" },
      { id: "ddddddd4", kind: "task", title: "会被修改", due: "2026-11-01" },
    ]);
    backupFile("workspace-preview.md", backupContent);

    const result = previewBackup("workspace-preview.md", wsFile);
    expect(result.sha256).toBe(
      crypto.createHash("sha256").update(backupContent, "utf-8").digest("hex"),
    );
    expect(result.pinned).toBe(true);
    expect(result.diff.added).toBe(1);
    expect(result.diff.removed).toBe(1);
    expect(result.diff.changed).toBe(1);

    const changes = result.diff.items.map((i) => [i.id, i.change]);
    expect(changes).toContainEqual(["ccccccc3", "removed"]);
    expect(changes).toContainEqual(["bbbbbbb2", "added"]);
    expect(changes).toContainEqual(["ddddddd4", "changed"]);

    const pinnedPath = path.join(backupsDir(wsFile), ".pinned", `${result.sha256}.md`);
    expect(fs.existsSync(pinnedPath)).toBe(true);

    const list = listBackups(wsFile);
    expect(list[0].pinned).toBe(true);
    expect(list[0].pinnedSha256).toBe(result.sha256);
  });

  it("只读模式下不固定快照但仍返回 sha 与 diff", () => {
    writeWorkspaceFile([{ id: "aaaaaaa1", kind: "task", title: "当前" }]);
    backupFile(
      "workspace-ro.md",
      serializeWorkspace([{ id: "bbbbbbb2", kind: "task", title: "备份" }]),
    );
    setStorageReadOnly(true);

    const result = previewBackup("workspace-ro.md", wsFile);
    expect(result.pinned).toBe(false);
    expect(result.sha256).toHaveLength(64);
    expect(fs.existsSync(path.join(backupsDir(wsFile), ".pinned"))).toBe(false);
  });

  it("当前 workspace 读取失败时仍可预览", () => {
    backupFile(
      "workspace-ok.md",
      serializeWorkspace([{ id: "aaaaaaa1", kind: "task", title: "备份" }]),
    );
    // 当前文件是坏数据（所有条目都认不出来）
    fs.writeFileSync(wsFile, "## 标题\n这不是字段\n", "utf-8");

    const result = previewBackup("workspace-ok.md", wsFile);
    expect(result.diff.added).toBe(0);
    expect(result.diff.removed).toBe(1);
  });

  it("无法解析的备份返回 400", () => {
    backupFile("workspace-broken.md", "## 无法识别\n\n随便写点什么");
    try {
      previewBackup("workspace-broken.md", wsFile);
      throw new Error("应当抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceHttpError);
      expect((err as WorkspaceHttpError).status).toBe(400);
    }
  });

  it("缺失文件名返回 400", () => {
    try {
      previewBackup(undefined, wsFile);
      throw new Error("应当抛错");
    } catch (err) {
      expect((err as WorkspaceHttpError).status).toBe(400);
    }
  });
});

describe("导出", () => {
  it("返回原始字节", () => {
    const content = serializeWorkspace([{ id: "aaaaaaa1", kind: "task", title: "导出" }]);
    backupFile("workspace-export.md", content);
    const out = readBackupForExport("workspace-export.md", wsFile);
    expect(out.file).toBe("workspace-export.md");
    expect(out.content.toString("utf-8")).toBe(content);
  });

  it("穿越路径返回 400", () => {
    try {
      readBackupForExport("../workspace.md", wsFile);
      throw new Error("应当抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceHttpError);
      expect((err as WorkspaceHttpError).status).toBe(400);
    }
  });
});

describe("diff 明细", () => {
  it("字段级改动只报变化的字段", () => {
    const backup = parseWorkspace(
      serializeWorkspace([
        { id: "aaaaaaa1", kind: "task", title: "标题", due: "2026-11-01", priority: "high" },
      ]),
    );
    const current = parseWorkspace(
      serializeWorkspace([
        { id: "aaaaaaa1", kind: "task", title: "标题", due: "2026-11-02", priority: "high" },
      ]),
    );
    const diff = diffItems(backup.items, current.items);
    expect(diff.changed).toBe(1);
    expect(diff.items[0].fields).toEqual(["due"]);
  });

  it("明细最多 20 条但计数是全量", () => {
    const backup = parseWorkspace(serializeWorkspace([]));
    const current = parseWorkspace(
      serializeWorkspace(
        Array.from({ length: 30 }, (_, i) => ({
          id: `aaaaaa${String(i).padStart(2, "0")}`,
          kind: "task" as const,
          title: `条目 ${i}`,
        })),
      ),
    );
    const diff = diffItems(backup.items, current.items);
    expect(diff.added).toBe(30);
    expect(diff.items).toHaveLength(20);
  });
});
