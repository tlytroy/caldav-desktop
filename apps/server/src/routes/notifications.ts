/**
 * 提醒推送 API
 *
 * 配置本身走 `/api/config`（notifications 段），这里只负责：
 *  - 告诉界面「有哪些渠道 / 配没配 / 启没启用」
 *  - 发测试消息
 *  - 立即执行一次检查（调试用）
 */

import express from "express";
import { getConfig } from "../config.js";
import {
  PUSH_CHANNELS,
  enabledChannelIds,
  sendTestPush,
  type PushChannelId,
} from "../notifications/push.js";
import {
  getReminderStatus,
  runReminderCheck,
} from "../notifications/scheduler.js";
import { asyncHandler } from "../http.js";

export const notificationsRouter = express.Router();

const VALID_IDS = new Set<string>(PUSH_CHANNELS.map((c) => c.id));

function channelState() {
  const n = getConfig().notifications.channels;
  return {
    wecom: { configured: !!n.wecom.webhookUrl, enabled: n.wecom.enabled },
    serverchan: {
      configured: !!n.serverchan.sendKey,
      enabled: n.serverchan.enabled,
    },
    pushplus: { configured: !!n.pushplus.token, enabled: n.pushplus.enabled },
    bark: { configured: !!n.bark.deviceKey, enabled: n.bark.enabled },
    ntfy: { configured: !!n.ntfy.topic, enabled: n.ntfy.enabled },
    webhook: { configured: !!n.webhook.url, enabled: n.webhook.enabled },
  } as Record<PushChannelId, { configured: boolean; enabled: boolean }>;
}

/** GET /api/notifications/channels —— 渠道清单 + 配置状态（不含密钥） */
notificationsRouter.get("/channels", (_req, res) => {
  const state = channelState();
  res.json({
    success: true,
    pushEnabled: getConfig().notifications.enabled,
    channels: PUSH_CHANNELS.map((c) => ({
      ...c,
      ...state[c.id],
    })),
  });
});

/** GET /api/notifications/status —— 调度状态 + 待推送数 + 上次推送时间 */
notificationsRouter.get("/status", (_req, res) => {
  try {
    const status = getReminderStatus();
    res.json({
      success: true,
      ...status,
      /** 已启用的渠道 id（便于界面显示） */
      enabledChannels: enabledChannelIds(),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * POST /api/notifications/test
 * Body: { channel?: "wecom" | "serverchan" | "pushplus" | "bark" | "ntfy" | "webhook" }
 *
 * 指定渠道时**忽略 enabled 开关**（方便边填边测）；不指定则发到所有已启用渠道。
 */
notificationsRouter.post("/test", asyncHandler(async (req, res) => {
  try {
    const raw = req.body?.channel;
    if (raw !== undefined && !VALID_IDS.has(String(raw))) {
      return res.status(400).json({
        error: `未知渠道：${raw}`,
        channels: [...VALID_IDS],
      });
    }
    const channel = raw ? (String(raw) as PushChannelId) : undefined;

    const state = channelState();
    const target = channel ? [channel] : enabledChannelIds();
    if (!target.length) {
      return res.status(400).json({
        error: "没有可用的推送渠道：请先填写渠道配置并打开「启用推送」",
      });
    }
    if (!target.some((id) => state[id]?.configured)) {
      return res.status(400).json({
        error: "所选渠道还没填配置（Webhook 地址 / SendKey / token 等）",
      });
    }

    const results = await sendTestPush(channel);
    res.json({
      success: results.some((r) => r.ok),
      results,
      message: results.every((r) => r.ok)
        ? "测试消息已发送"
        : "部分渠道发送失败，看 results 里的 error",
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}));

/**
 * POST /api/notifications/check
 * 立即执行一次「检查 + 推送」（调试 / 手动触发）。
 * 没启用推送时返回 due=0，不做任何网络请求。
 */
notificationsRouter.post("/check", async (_req, res) => {
  try {
    const r = await runReminderCheck();
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
