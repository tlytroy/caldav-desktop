/**
 * 同步中心 / 同步控制路由（v0.3 / P7 + P8）
 * ============================================
 *
 *   GET  /api/sync/overview   只读快照（不联网，秒回）
 *   POST /api/sync/resume     { action: "pull" | "push" | "bidirectional" }
 *
 * 恢复工作区后同步会被暂停（`.sync-suspended.json`），必须由用户明确选择
 * 方向才重新开始，避免恢复完的下一瞬间被自动同步覆盖。
 */

import express from "express";

import { asyncHandler } from "../http.js";
import { resumeSync } from "../restore.js";
import { getSyncOverview } from "../sync-overview.js";

export const syncControlRouter = express.Router();

syncControlRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    res.json(getSyncOverview());
  }),
);

syncControlRouter.post(
  "/resume",
  asyncHandler(async (req, res) => {
    const result = await resumeSync((req.body ?? {}).action);
    res.json(result);
  }),
);
