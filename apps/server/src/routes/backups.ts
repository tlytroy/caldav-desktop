/**
 * 备份路由（只读）
 * ================
 *
 *   GET  /api/workspace/backups                 列表（v0.2.5 起公开，只读）
 *   POST /api/workspace/backups/preview         预览：sha256 + diff + 固定快照
 *   GET  /api/workspace/backups/export?file=    下载备份原文
 *
 * v0.3.0 才加入 `POST /api/workspace/backups/restore`（P7）。
 * 这里的所有路由都在维护闸门白名单里，恢复窗口内仍可预览/取消。
 */

import express from "express";

import { asyncHandler } from "../http.js";
import { WorkspaceHttpError } from "../errors.js";
import { workspaceFilePath } from "../workspace.js";
import {
  listBackups,
  previewBackup,
  readBackupForExport,
} from "../backups.js";
import {
  abortRestore,
  getRestoreStatus,
  runRestore,
} from "../restore.js";

export const backupsRouter = express.Router();

/** GET /api/workspace/backups */
backupsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      filePath: workspaceFilePath(),
      backups: listBackups(),
    });
  }),
);

/** POST /api/workspace/backups/preview  { file } */
backupsRouter.post(
  "/preview",
  asyncHandler(async (req, res) => {
    const file = (req.body ?? {}).file;
    if (typeof file !== "string" || !file.trim()) {
      throw new WorkspaceHttpError(400, "缺少备份文件名", "BACKUP_FILE_REQUIRED");
    }
    const result = previewBackup(file);
    res.json({ success: true, ...result });
  }),
);

/** GET /api/workspace/backups/restore/status —— 恢复状态（维护窗口内可用） */
backupsRouter.get(
  "/restore/status",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, ...getRestoreStatus() });
  }),
);

/** POST /api/workspace/backups/restore  { file, sha256, confirm: true } */
backupsRouter.post(
  "/restore",
  asyncHandler(async (req, res) => {
    const result = await runRestore(req.body ?? {});
    res.json(result);
  }),
);

/** POST /api/workspace/backups/restore/abort —— 放弃未完成的恢复 */
backupsRouter.post(
  "/restore/abort",
  asyncHandler(async (_req, res) => {
    res.json(abortRestore());
  }),
);

/** GET /api/workspace/backups/export?file=... */
backupsRouter.get(
  "/export",
  asyncHandler(async (req, res) => {
    const { file, content } = readBackupForExport(req.query.file);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file)}"`,
    );
    res.setHeader("Content-Length", String(content.length));
    res.send(content);
  }),
);
