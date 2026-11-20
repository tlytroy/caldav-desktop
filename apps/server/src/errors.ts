/**
 * 统一错误类型（v0.3.0）
 *
 * 为什么单独一个文件：
 *  - store / 路由 / 同步层都要抛同样的错误，HTTP 层才能稳定映射成 400/404/409/503；
 *  - 错误对象里不放绝对路径，500 响应不泄露服务器目录结构（SDS §3.2、S15）。
 */

/** 图校验问题（SDS §2.6） */
export interface GraphIssue {
  code: string;
  itemId?: string;
  message: string;
}

/** 恢复期间所有写请求 503（maintenance） */
export class MaintenanceError extends Error {
  readonly code = "MAINTENANCE";
  constructor(message = "正在恢复数据，请稍后再试") {
    super(message);
    this.name = "MaintenanceError";
  }
}

/** token 配置非法（启动期失败，不进入服务） */
export class ApiTokenError extends Error {
  readonly code = "API_TOKEN_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "ApiTokenError";
  }
}

/** workspace.md 读取/解析失败；绝不能被当成「空文件」继续写 */
export class WorkspaceReadError extends Error {
  readonly code = "WORKSPACE_READ_FAILED";
  constructor(message = "数据文件读取失败") {
    super(message);
    this.name = "WorkspaceReadError";
  }
}

/** 写入前校验失败（图校验 / 序列化 / 被修改的坏条目） */
export class WorkspaceValidationError extends Error {
  readonly code = "WORKSPACE_INVALID";
  readonly issues: GraphIssue[];
  constructor(message: string, issues: GraphIssue[] = []) {
    super(message);
    this.name = "WorkspaceValidationError";
    this.issues = issues;
  }
}

/** 业务层显式 HTTP 错误（404/409 等），由全局中间件映射 */
export class WorkspaceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "WORKSPACE_ERROR",
    /** 附加字段（errors / editableFields / hint 等），直接并入响应体 */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceHttpError";
  }
}

/** 排队等锁超时（5xx：稍后重试，且任务必须被取消，不能事后执行） */
export class LockTimeoutError extends Error {
  readonly code = "LOCK_TIMEOUT";
  constructor(message = "数据文件正忙，请稍后重试") {
    super(message);
    this.name = "LockTimeoutError";
  }
}

/** 锁内重入（编程错误，不允许在 withWorkspaceLock 内再调 mutateWorkspace） */
export class LockReentryError extends Error {
  readonly code = "LOCK_REENTRY";
  constructor(message = "内部错误：重复加锁") {
    super(message);
    this.name = "LockReentryError";
  }
}

/** 存储自检失败进入只读模式 */
export class WorkspaceReadOnlyError extends Error {
  readonly code = "WORKSPACE_READ_ONLY";
  constructor(message = "存储只读，写入已拒绝") {
    super(message);
    this.name = "WorkspaceReadOnlyError";
  }
}

/** 恢复/epoch 变化后，旧同步任务不得再提交 */
export class SyncEpochError extends Error {
  readonly code = "SYNC_EPOCH_ABORTED";
  constructor(message = "同步已中断（数据已恢复），请重试") {
    super(message);
    this.name = "SyncEpochError";
  }
}

/** WebDAV 合并结果不合法：PUT 之前就失败，远端不动 */
export class MergeInvalid extends Error {
  readonly code = "MERGE_INVALID";
  readonly status = 409;
  readonly issues: GraphIssue[];
  constructor(message = "合并结果不合法", issues: GraphIssue[] = []) {
    super(message);
    this.name = "MergeInvalid";
    this.issues = issues;
  }
}

/** 合并提交时本地已被改动：远端已是合并版，本地保留新改动 */
export class MergeConflict extends Error {
  readonly code = "MERGE_CONFLICT";
  readonly status = 409;
  constructor(
    message = "远端已写入合并版；本地保留你的新改动，请重新合并",
    readonly remoteEtag: string | null = null,
    readonly localHash: string | null = null,
  ) {
    super(message);
    this.name = "MergeConflict";
  }
}
