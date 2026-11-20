/**
 * workspace 写锁（v0.3.0，SDS §2.3）
 *
 * 约束：
 *  - 进程内 FIFO 队列，只包「读-改-写」，网络 IO 必须放在锁外；
 *  - 排队超过 timeout → LockTimeoutError，且**必须从队列移除**，
 *    否则客户端已经收到 503，后台却又写了一次盘（SDS D30）；
 *  - 锁内再调 withWorkspaceLock → LockReentryError（编程错误，绝不静默通过）。
 *
 * 不做跨进程锁：单实例是硬前提，文档与 DEV_RULES 已写明。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { LockReentryError, LockTimeoutError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10_000;

const lockContext = new AsyncLocalStorage<true>();

interface QueueEntry {
  run: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
  /** 已取消（超时）或已执行，二者互斥 */
  settled: boolean;
}

const queue: QueueEntry[] = [];
let active = false;

/** 当前是否在 workspace 锁内（同步判断，用于防止重入） */
export function isWorkspaceLockHeld(): boolean {
  return lockContext.getStore() === true;
}

/** 是否有任务正在执行（监控/测试用） */
export function isWorkspaceLockBusy(): boolean {
  return active;
}

/** 排队中的任务数（监控/测试用） */
export function workspaceLockQueueSize(): number {
  return queue.length;
}

function pump(): void {
  if (active) return;
  const next = queue.shift();
  if (!next) return;

  // 超时后被取消的条目：跳过，继续找下一个可执行任务
  if (next.settled) {
    pump();
    return;
  }

  next.settled = true;
  if (next.timer) {
    clearTimeout(next.timer);
    next.timer = null;
  }
  active = true;
  next.run();
}

function release(): void {
  active = false;
  pump();
}

/**
 * 串行执行 fn。timeoutMs 只约束「排队等待」时间，不中断已开始执行的任务。
 */
export function withWorkspaceLock<T>(
  fn: () => Promise<T> | T,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  if (lockContext.getStore() === true) {
    return Promise.reject(
      new LockReentryError(
        "检测到 workspace 锁重入：锁内不能再次调用 mutateWorkspace，请改用 mutateWorkspaceText",
      ),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      settled: false,
      timer: null,
      reject,
      run: () => {
        // 在 ALS 上下文里执行，异步分支也能识别重入
        lockContext.run(true, () => {
          Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(release);
        });
      },
    };

    if (timeoutMs > 0 && !Number.isNaN(timeoutMs)) {
      entry.timer = setTimeout(() => {
        if (entry.settled) return; // 已经开始执行，不再超时
        entry.settled = true;
        entry.timer = null;
        reject(new LockTimeoutError());
        // 条目留在队列里但已 settled，pump 会跳过它
        // （不能直接 splice：此时可能正在 pump 中遍历）
        pump();
      }, timeoutMs);
      // 定时器不应阻止进程退出
      entry.timer.unref?.();
    }

    queue.push(entry);
    pump();
  });
}

/** 仅测试：清空队列与活动状态 */
export function __resetWorkspaceLockForTests(): void {
  for (const entry of queue) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  queue.length = 0;
  active = false;
}
