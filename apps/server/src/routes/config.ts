/**
 * 配置 API 路由
 *
 * 用途：让设置界面能读写配置，不必去改 .env。
 *
 * 安全：
 *  - 敏感字段（API Key / 密码）读取时返回掩码，绝不返回明文
 *  - 写入时收到掩码值视为「未修改」，保留原值
 *  - config.json 默认加入 .gitignore
 */

import express from "express";
import {
  getConfig,
  saveConfig,
  redactConfig,
  configFilePath,
  hasConfigFile,
  DEFAULT_CONFIG,
  type AppConfig,
} from "../config.js";

export const configRouter = express.Router();

/** 允许通过请求体指定要改哪些顶层段（避免前端误传整份） */
const WRITABLE_SECTIONS = [
  "language",
  "theme",
  "colorScheme",
  "borderRadius",
  "ai",
  "caldav",
  "webdav",
  "nlp",
  "paths",
] as const;

/**
 * GET /api/config
 * 返回当前配置（敏感字段已脱敏）+ 配置来源信息
 */
configRouter.get("/", (_req, res) => {
  const cfg = getConfig();
  res.json({
    success: true,
    config: redactConfig(cfg),
    /** 界面提示用：配置文件是否存在 */
    file: {
      path: configFilePath(),
      exists: hasConfigFile(),
    },
  });
});

/**
 * PUT /api/config
 * 写入配置（部分更新）
 *
 * Body: { language?, theme?, colorScheme?, borderRadius?, ai?, caldav?, webdav?, nlp? }
 */
configRouter.put("/", (req, res) => {
  try {
    const body = req.body || {};
    const patch: Partial<AppConfig> = {};

    for (const key of WRITABLE_SECTIONS) {
      if (body[key] !== undefined) {
        (patch as any)[key] = body[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        error: `没有可写入的配置项。可写字段：${WRITABLE_SECTIONS.join(", ")}`,
      });
    }

    const saved = saveConfig(patch);
    res.json({
      success: true,
      config: redactConfig(saved),
      message: "配置已保存",
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/config/reset
 * 重置某一段配置到默认值（保留敏感字段不变）
 */
configRouter.post("/reset", (req, res) => {
  try {
    const section = req.body?.section;
    if (!section || !WRITABLE_SECTIONS.includes(section)) {
      return res.status(400).json({
        error: `section 无效。可重置：${WRITABLE_SECTIONS.join(", ")}`,
      });
    }
    // 整段重置 = 用默认值覆盖；saveConfig 的深合并会处理
    const saved = saveConfig({
      [section]: DEFAULT_CONFIG[section as keyof AppConfig],
    } as any);
    res.json({
      success: true,
      config: redactConfig(saved),
      message: "已重置为默认值",
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
