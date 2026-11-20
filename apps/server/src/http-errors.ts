import type { ErrorRequestHandler } from "express";
import {
  LockTimeoutError,
  MaintenanceError,
  MergeConflict,
  MergeInvalid,
  SyncEpochError,
  WorkspaceHttpError,
  WorkspaceReadError,
  WorkspaceReadOnlyError,
  WorkspaceValidationError,
} from "./errors.js";

/**
 * 统一错误映射（SDS §3.2 / S15）。
 *
 * 单独一个模块的原因：路由测试用的是「只挂 workspace 路由」的裸 express，
 * 如果没有这层中间件，路由里抛出的 404/409 会变成默认 HTML 错误页或者挂住。
 * 生产代码（app.ts）与测试共用同一份映射，避免两套行为漂移。
 *
 * 关键约定：
 *  - 响应里不出现绝对路径（防止泄露服务器目录结构）；
 *  - 未知错误必须落到 500 JSON，而不是 Express 默认 HTML。
 */
export const apiErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const e = err as { type?: string; status?: number } & Error;

  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ error: "请求体不是合法 JSON", code: "BAD_JSON" });
    return;
  }
  if (e instanceof WorkspaceReadError) {
    res.status(500).json({ error: e.message, code: e.code });
    return;
  }
  if (e instanceof WorkspaceValidationError) {
    res.status(400).json({ error: e.message, code: e.code, issues: e.issues });
    return;
  }
  if (e instanceof MergeInvalid) {
    res.status(409).json({ error: e.message, code: e.code, issues: e.issues });
    return;
  }
  if (e instanceof MergeConflict) {
    res.status(409).json({
      error: e.message,
      code: e.code,
      remoteEtag: e.remoteEtag,
      localHash: e.localHash,
    });
    return;
  }
  if (e instanceof WorkspaceHttpError) {
    res.status(e.status).json({ ...e.details, error: e.message, code: e.code });
    return;
  }
  if (e instanceof WorkspaceReadOnlyError) {
    res.status(503).json({ error: e.message, code: e.code });
    return;
  }
  if (e instanceof MaintenanceError) {
    res.status(503).json({ error: e.message, code: e.code });
    return;
  }
  if (e instanceof LockTimeoutError) {
    res.status(503).json({ error: e.message, code: e.code });
    return;
  }
  if (e instanceof SyncEpochError) {
    res.status(503).json({ error: e.message, code: e.code });
    return;
  }

  // 未知错误：日志保留细节，响应不泄露绝对路径
  console.error("[http] 未处理错误：", err);
  res.status(500).json({ error: "服务器内部错误", code: "INTERNAL_ERROR" });
};
