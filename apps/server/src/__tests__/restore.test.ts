/**
 * 恢复状态机测试（P7 / S10、S18、S22）
 * =====================================
 * 覆盖：正常恢复、sha 校验、坏备份、确认开关、abort、resume、
 * 维护期间写入被拒、drain 超时保留 marker、启动自愈、提醒状态裁剪。
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-"));
const wsFile = path.join(tmpDir, "workspace.md");
const reminderState = path.join(tmpDir, ".reminder-state.json");
const configPath = path.join(tmpDir, "config.json");

process.env.WORKSPACE_FILE = wsFile;
process.env.REMINDER_STATE_FILE = reminderState;
process.env.APP_CONFIG_PATH = configPath;
fs.writeFileSync(configPath, JSON.stringify({ caldav: {} }), "utf-8");
for (const k of ["CALDAV_URL","CALDAV_ROOT_URL","CALDAV_USER","CALDAV_PASS","CALDAV_CALENDAR_URL"]) process.env[k] = "";

type WorkspaceMod = typeof import("../workspace.js");
type RestoreMod = typeof import("../restore.js");
type SyncMod = typeof import("../sync-control.js");
type StoreMod = typeof import("../workspace-store.js");
type SchedulerMod = typeof import("../notifications/scheduler.js");
type BackupsMod = typeof import("../backups.js");

let ws: WorkspaceMod;
let restore: RestoreMod;
let sync: SyncMod;
let store: StoreMod;
let scheduler: SchedulerMod;
let backups: BackupsMod;

beforeAll(async () => {
  ws = await import("../workspace.js");
  restore = await import("../restore.js");
  sync = await import("../sync-control.js");
  store = await import("../workspace-store.js");
  scheduler = await import("../notifications/scheduler.js");
  backups = await import("../backups.js");
});

function item(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "task" as const,
    title,
    due: "2026-11-10",
    remind: "2026-11-10T09:00:00",
    ...extra,
  };
}

function writeWs(items: unknown[]): void {
  fs.mkdirSync(path.dirname(wsFile), { recursive: true });
  fs.writeFileSync(wsFile, ws.serializeWorkspace(items as never, ""), "utf-8");
}

function shaOfFile(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function clean(): void {
  scheduler.stopReminderScheduler();
  sync.__resetSyncControlForTests();
  delete process.env.RESTORE_DRAIN_TIMEOUT_MS;
  for (const p of [
    wsFile,
    reminderState,
    restore.restoreMarkerPath(),
    restore.syncSuspendedPath(),
    path.join(tmpDir, ".caldav-sync-state.json"),
    path.join(tmpDir, ".webdav-state.json"),
  ]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(path.join(tmpDir, ".workspace-backups"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

beforeEach(clean);
afterEach(clean);

async function makeBackup(content: string): Promise<{ file: string; sha: string }> {
  const dir = path.join(tmpDir, ".workspace-backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = "workspace-2026-11-03T00-00-00-000Z-abc123.md";
  fs.writeFileSync(path.join(dir, file), content, "utf-8");
  return { file, sha: shaOfFile(path.join(dir, file)) };
}

describe("恢复主流程", () => {
  it("从备份恢复条目、清 marker、暂停同步", async () => {
    writeWs([item("aaaaaaaa", "备份里的任务")]);
    const backup = await makeBackup(fs.readFileSync(wsFile, "utf-8"));

    writeWs([item("bbbbbbbb", "当前任务")]);
    const result = await restore.runRestore({
      file: backup.file,
      sha256: backup.sha,
      confirm: true,
    });

    expect(result.items).toBe(1);
    expect(result.suspended).toBe(true);
    expect(fs.readFileSync(wsFile, "utf-8")).toContain("备份里的任务");
    expect(fs.readFileSync(wsFile, "utf-8")).not.toContain("当前任务");
    expect(restore.readRestoreMarker()).toBeNull();
    expect(restore.isSyncSuspended()).toBe(true);
    expect(sync.isSyncMaintenance()).toBe(false);
    expect(result.preRestoreBackup).toBeTruthy();
  });

  it("sha 不匹配 → 409，工作区不变", async () => {
    writeWs([item("aaaaaaaa", "A")]);
    const backup = await makeBackup(fs.readFileSync(wsFile, "utf-8"));
    writeWs([item("bbbbbbbb", "B")]);
    const before = fs.readFileSync(wsFile, "utf-8");

    await expect(
      restore.runRestore({
        file: backup.file,
        sha256: "0".repeat(64),
        confirm: true,
      }),
    ).rejects.toMatchObject({ code: "RESTORE_SHA_MISMATCH" });
    expect(fs.readFileSync(wsFile, "utf-8")).toBe(before);
  });

  it("不可解析的备份 → 400", async () => {
    const backup = await makeBackup("## 只有标题\n随便写点什么\n");
    await expect(
      restore.runRestore({ file: backup.file, sha256: backup.sha, confirm: true }),
    ).rejects.toMatchObject({ code: "RESTORE_UNPARSEABLE" });
  });

  it("没有 confirm → 400", async () => {
    writeWs([item("aaaaaaaa", "A")]);
    const backup = await makeBackup(fs.readFileSync(wsFile, "utf-8"));
    await expect(
      restore.runRestore({ file: backup.file, sha256: backup.sha }),
    ).rejects.toMatchObject({ code: "RESTORE_CONFIRM_REQUIRED" });
  });
});

describe("abort / resume", () => {
  it("abort 清理 marker 与维护态", async () => {
    fs.writeFileSync(
      restore.restoreMarkerPath(),
      JSON.stringify({
        phase: "failed",
        file: "x.md",
        sha256: "a".repeat(64),
        startedAt: new Date().toISOString(),
        epoch: 1,
      }),
      "utf-8",
    );
    sync.setSyncMaintenance(true);

    const r = restore.abortRestore();
    expect(r.aborted).toBe(true);
    expect(restore.readRestoreMarker()).toBeNull();
    expect(sync.isSyncMaintenance()).toBe(false);
  });

  it("没有 marker 时 abort → 409", () => {
    expect(() => restore.abortRestore()).toThrowError(/没有未完成的恢复/);
  });

  it("resume 非法 action → 400", async () => {
    await expect(restore.resumeSync("merge")).rejects.toMatchObject({
      code: "RESUME_ACTION_INVALID",
    });
  });

  it("没有暂停标记时 resume → 409", async () => {
    await expect(restore.resumeSync("pull")).rejects.toMatchObject({
      code: "SYNC_NOT_SUSPENDED",
    });
  });

  it("resume 清掉暂停标记（未配置 CalDAV 时不发请求）", async () => {
    fs.writeFileSync(
      restore.syncSuspendedPath(),
      JSON.stringify({ since: new Date().toISOString(), reason: "restore", epoch: 1 }),
      "utf-8",
    );
    const r = await restore.resumeSync("pull");
    expect(r.success).toBe(true);
    expect(r.action).toBe("pull");
    expect(restore.isSyncSuspended()).toBe(false);
  });
});

describe("维护窗口", () => {
  it("维护期间普通写入被拒", async () => {
    writeWs([item("aaaaaaaa", "A")]);
    sync.setSyncMaintenance(true);
    await expect(
      store.mutateWorkspace((w) => {
        w.items.push(item("bbbbbbbb", "B") as never);
      }),
    ).rejects.toMatchObject({ code: "MAINTENANCE" });
    expect(fs.readFileSync(wsFile, "utf-8")).not.toContain("B");
  });

  it("在途同步超时 → 保留 marker 与维护态", async () => {
    writeWs([item("aaaaaaaa", "A")]);
    const backup = await makeBackup(fs.readFileSync(wsFile, "utf-8"));
    process.env.RESTORE_DRAIN_TIMEOUT_MS = "60";

    const end = sync.beginSyncActivity("webdav");
    try {
      await expect(
        restore.runRestore({ file: backup.file, sha256: backup.sha, confirm: true }),
      ).rejects.toMatchObject({ code: "MAINTENANCE" });
    } finally {
      end();
    }
    const marker = restore.readRestoreMarker();
    expect(marker?.phase).toBe("failed");
    expect(sync.isSyncMaintenance()).toBe(true);
  });
});

describe("启动自愈", () => {
  it("marker + 固定快照仍在 → 保持冻结", async () => {
    writeWs([item("aaaaaaaa", "A")]);
    const content = fs.readFileSync(wsFile, "utf-8");
    const sha = createHash("sha256").update(content).digest("hex");
    const dir = path.join(tmpDir, ".workspace-backups");
    backups.pinBackup(dir, sha, content);
    fs.writeFileSync(
      restore.restoreMarkerPath(),
      JSON.stringify({
        phase: "written",
        file: "x.md",
        sha256: sha,
        startedAt: new Date().toISOString(),
        epoch: 1,
      }),
      "utf-8",
    );

    expect(restore.recoverRestoreOnStartup()).toBe("resumed");
    expect(sync.isSyncMaintenance()).toBe(true);
  });

  it("marker + 快照已失效 → 自动解除冻结", () => {
    fs.writeFileSync(
      restore.restoreMarkerPath(),
      JSON.stringify({
        phase: "prepared",
        file: "x.md",
        sha256: "b".repeat(64),
        startedAt: new Date().toISOString(),
        epoch: 1,
      }),
      "utf-8",
    );
    expect(restore.recoverRestoreOnStartup()).toBe("cleared");
    expect(restore.readRestoreMarker()).toBeNull();
    expect(sync.isSyncMaintenance()).toBe(false);
  });
});

describe("提醒状态裁剪", () => {
  it("只保留恢复后仍存在的 id|remind", () => {
    const now = Date.now();
    fs.writeFileSync(
      reminderState,
      JSON.stringify({
        sent: { "aaaaaaaa|2026-11-10T09:00:00": now, b: now },
        failed: { b: now },
      }),
      "utf-8",
    );
    scheduler.pruneReminderSent(new Set(["aaaaaaaa|2026-11-10T09:00:00"]));
    const state = JSON.parse(fs.readFileSync(reminderState, "utf-8"));
    expect(Object.keys(state.sent)).toEqual(["aaaaaaaa|2026-11-10T09:00:00"]);
    expect(Object.keys(state.failed)).toEqual([]);
  });
});
