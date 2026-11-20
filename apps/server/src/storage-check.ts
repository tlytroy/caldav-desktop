/**
 * 原子写与存储自检（v0.3.0，SDS §2.4）
 *
 * 为什么需要：
 *  - 直接 writeFileSync 在断电/崩溃时会留下半截文件，而 workspace.md 是唯一事实源；
 *  - NAS / SMB / 9p 上 rename 可能短暂 EBUSY/EPERM，需要有限重试而不是降级直写；
 *  - 只读挂载（Docker 挂错、NAS 权限）不能一启动就退出，要能「只读运行」。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

/** rename 的可重试错误码（Windows / SMB 常见） */
const RETRYABLE_RENAME_CODES = new Set([
  "EPERM",
  "EBUSY",
  "EACCES",
  "ENOTEMPTY",
  "EEXIST",
]);

/** 重试等待：100/200/400/800/1600ms */
const RETRY_DELAYS_MS = [100, 200, 400, 800, 1600];

/** 同步 sleep（不引第三方依赖；Atomics.wait 是阻塞式，写入路径可接受） */
function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!RETRYABLE_RENAME_CODES.has(code) || attempt >= RETRY_DELAYS_MS.length) {
        throw err;
      }
      sleepSync(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * 原子写：写临时文件 → fsync → rename 覆盖目标。
 *
 * 任何一步失败都删除临时文件并抛出，**绝不降级成直接写目标文件**：
 * 直写在失败时反而会破坏旧数据。
 */
export function atomicWriteFile(
  filePath: string,
  content: string,
  /**
   * 落盘权限。默认 0600（密钥类）。
   * workspace.md 这类用户要直接用编辑器打开的文件必须传 0644 ——
   * 容器里是 app 用户（uid 100），宿主机是另一个 uid，
   * 0600 会让宿主机用户读不了唯一事实源（实测踩过）。
   */
  mode = 0o600,
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  let fd: number | null = null;

  try {
    fd = fs.openSync(tmp, "wx", mode);
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    // 测试钩子：模拟「写完 tmp、rename 之前崩溃」，用于验证旧文件仍可读
    if (process.env.WORKSPACE_CRASH_AFTER_TMP === "1") {
      process.kill(process.pid, "SIGKILL");
    }

    // openSync 的 mode 会被进程 umask 削掉（容器里常见 022 → 0644 变 0644 没问题，
    // 但 0600 也可能被削成 0600，保险起见显式 chmod 一次）
    try {
      fs.chmodSync(tmp, mode);
    } catch {
      /* 某些文件系统（9p/SMB）不支持 chmod，忽略 */
    }

    renameWithRetry(tmp, filePath);
    fsyncDirBestEffort(dir);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** POSIX 上 fsync 目录，保证 rename 元数据落盘；失败仅告警 */
function fsyncDirBestEffort(dir: string): void {
  if (process.platform === "win32") return;
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch (err) {
    console.warn("[storage] fsync 目录失败（忽略）：", (err as Error).message);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 存储自检：在数据目录里真的写一次、rename 一次、读回一次。
 *
 * 返回结果而不是直接 exit：调用方决定是否降级为只读（D28）。
 */
export function verifyStorageSafety(dir: string): { ok: boolean; error?: string } {
  const name = `.workspace-write-test-${process.pid}-${randomBytes(4).toString("hex")}`;
  const tmp = path.join(dir, `${name}.tmp`);
  const final = path.join(dir, name);

  try {
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, "ok", "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, final);
    const back = fs.readFileSync(final, "utf-8");
    if (back !== "ok") {
      return { ok: false, error: "写入后读回内容不一致" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    for (const file of [tmp, final]) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }
}

const TMP_PATTERN = /\.tmp\.(\d+)\.[0-9a-f]{12}$/;

/**
 * 清理崩溃残留的临时文件（默认 1 小时前的）。
 *
 * 只删符合我们命名规则的文件，其它文件一概不碰。
 */
export function cleanupStaleTmpFiles(dir: string, maxAgeMs = 60 * 60 * 1000): number {
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }

  const now = Date.now();
  for (const name of names) {
    if (!TMP_PATTERN.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs < maxAgeMs) continue;
      fs.unlinkSync(full);
      removed++;
    } catch {
      /* ignore */
    }
  }

  if (removed > 0) {
    console.warn(`[storage] 清理了 ${removed} 个崩溃残留临时文件：${dir}`);
  }
  return removed;
}
