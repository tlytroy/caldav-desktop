/**
 * CalDAV 同步 API（workspace.md ↔ CalDAV）
 *
 * 读写统一数据源 workspace.md —— 界面上点「推送 / 拉取」走这条。
 * （旧的 events.md / md-bridge 通道已在 v0.3 移除。）
 *
 * 设计原则沿用 WebDAV 通道：
 *  - 读接口（状态 / 日历列表）连不上时**降级**返回，不让页面报错
 *  - 同步接口（写）失败必须明确报错，不能假装成功
 */

import express from "express";
import {
  syncWorkspaceToCalDAV,
  getCalDAVSyncStatus,
  loadCalDAVSyncSettings,
  normalizeDirection,
  discoverCalendarUrl,
  __resetAutoSyncClock,
} from "../caldav-sync.js";
import { asyncHandler } from "../http.js";
import { isSyncSuspended } from "../restore.js";

export const caldavSyncRouter = express.Router();

/** 是不是「服务器连不上」这类外部问题 */
function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|network|principalUrl|cannot find|502|503|504|超时|aborted/i.test(
    msg,
  );
}

/** 同步失败的可读响应 */
function syncFailure(res: express.Response, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const connection = isConnectionError(err);
  res.status(connection ? 502 : 500).json({
    success: false,
    error: msg,
    kind: connection ? "connection" : "sync",
    message: connection
      ? "连接 CalDAV 服务器失败。本地数据不受影响，可在「设置 → 同步」里检查地址与账号。"
      : `同步失败：${msg}`,
  });
}

// ===== GET /api/caldav/status =====

/**
 * 同步状态摘要（**不发网络请求**，保证秒回）。
 *
 * 返回：是否已配置、目标日历、上次同步时间、待推送条数。
 */
caldavSyncRouter.get("/status", (_req, res) => {
  try {
    const s = loadCalDAVSyncSettings();
    const status = getCalDAVSyncStatus();
    res.json({
      success: true,
      ...status,
      rootUrl: s.rootUrl,
      hasCredentials: !!s.username,
      syncDirection: status.direction,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ===== GET /api/caldav/calendars =====

/**
 * 列出服务器上的日历（用于设置界面选择同步目标）。
 *
 * 服务器不可用时返回 200 + degraded + 空数组 —— 与 `/api/calendar/calendars`
 * 的降级口径一致：读不到日历不该让整个设置页报错。
 */
caldavSyncRouter.get("/calendars", async (_req, res) => {
  const settings = loadCalDAVSyncSettings();
  try {
    const { ensureAuthenticated, davClient } = await import("../caldav.js");
    await ensureAuthenticated();
    const cals = await davClient.fetchCalendars();
    // 优先 VEVENT 日历（与自动发现口径一致），否则取第一个
    const preferred =
      cals.find(
        (c: any) =>
          Array.isArray(c?.components) &&
          c.components.some((x: string) => /VEVENT/i.test(x)),
      ) || cals[0];
    const fallbackUrl = preferred ? String(preferred.url || "") : "";
    res.json({
      success: true,
      defaultCalendarUrl: fallbackUrl,
      calendars: cals.map((c: any) => ({
        url: String(c.url || ""),
        displayName: c.displayName || String(c.url || ""),
        components: c.components,
        ctag: c.ctag,
      })),
    });
  } catch (e) {
    const msg = (e as Error).message;

    // 自动发现（tsdav 找 principalUrl）失败时，退回到用户配置的日历 URL。
    // 同步本身只需要一个日历 URL —— 不该因为「发现」失败就完全不给选。
    if (settings.calendarUrl) {
      try {
        const base = settings.calendarUrl.endsWith("/")
          ? settings.calendarUrl
          : `${settings.calendarUrl}/`;
        const headers: Record<string, string> = {
          Depth: "0",
          "Content-Type": "application/xml; charset=utf-8",
        };
        if (settings.username) {
          headers.Authorization = `Basic ${Buffer.from(
            `${settings.username}:${settings.password}`,
            "utf-8",
          ).toString("base64")}`;
        }
        const probe = await fetch(base, {
          method: "PROPFIND",
          headers,
          body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>`,
          signal: AbortSignal.timeout(settings.timeoutMs),
        });
        if (probe.status === 207 || probe.ok) {
          return res.json({
            success: true,
            warning: `自动发现日历失败（${msg}），已使用配置的日历 URL`,
            calendars: [
              { url: base, displayName: settings.calendarUrl },
            ],
            defaultCalendarUrl: base,
          });
        }
      } catch {
        /* 探测也失败：走下面的降级 / 报错 */
      }
    }

    if (isConnectionError(e)) {
      return res.json({
        success: true,
        degraded: true,
        calendars: [],
        error: msg,
        message: "CalDAV 服务器当前不可用；本地数据不受影响。",
      });
    }
    res.status(500).json({ error: msg });
  }
});

// ===== POST /api/caldav/sync =====

/**
 * 执行一次同步。
 *
 * Body：
 *   - direction?: "push" | "pull" | "bidirectional"（缺省用配置里的方向）
 *   - calendarUrl?: string（缺省用配置里的日历，再缺省自动发现）
 *   - force?: boolean（忽略冲突保护：pull 时远端赢，push 时本地赢）
 */
caldavSyncRouter.post("/sync", asyncHandler(async (req, res) => {
  if (isSyncSuspended()) {
    return res.status(409).json({
      success: false,
      code: "SYNC_SUSPENDED",
      error: "同步已暂停：恢复工作区后需要先选择同步方向（拉取 / 推送 / 双向）",
    });
  }
  try {
    const { direction, calendarUrl, force, merge, uids } = req.body || {};
    const out = await syncWorkspaceToCalDAV({
      // 只有请求里**显式**给了方向才覆盖配置；空值表示「按设置里的方向」
      direction:
        typeof direction === "string" && direction.trim()
          ? normalizeDirection(direction)
          : undefined,
      calendarUrl: typeof calendarUrl === "string" ? calendarUrl : undefined,
      force: force === true,
      merge: merge === true,
      uids: Array.isArray(uids)
        ? uids.filter((u: unknown): u is string => typeof u === "string")
        : undefined,
    });
    // 同步完成但有冲突 / 部分对象失败时，用 207 表示「部分成功」，
    // 前端据此列出冲突项，而不是显示「全部成功」。
    const partial = out.conflicts.length > 0 || out.errors.length > 0;
    res.status(partial ? 207 : 200).json({
      partial,
      ...out,
    });
  } catch (e) {
    syncFailure(res, e);
  }
}));

// ===== POST /api/caldav/test =====

/**
 * 连通性测试：对目标日历发一次 PROPFIND（Depth:0）。
 * 不写入任何数据。
 */
caldavSyncRouter.post("/test", asyncHandler(async (req, res) => {
  const s = loadCalDAVSyncSettings();
  const target =
    (typeof req.body?.calendarUrl === "string" && req.body.calendarUrl) ||
    s.calendarUrl;

  if (!s.rootUrl && !target) {
    return res.status(400).json({
      success: false,
      message: "请先填写 CalDAV 服务器地址（rootUrl）",
    });
  }

  try {
    let url = target;
    if (!url) {
      url = await discoverCalendarUrl();
    }
    const base = url.endsWith("/") ? url : `${url}/`;
    const headers: Record<string, string> = {
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    };
    if (s.username) {
      headers.Authorization = `Basic ${Buffer.from(
        `${s.username}:${s.password}`,
        "utf-8",
      ).toString("base64")}`;
    }
    const res2 = await fetch(base, {
      method: "PROPFIND",
      headers,
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>`,
      signal: AbortSignal.timeout(s.timeoutMs),
    });

    if (res2.status === 401 || res2.status === 403) {
      return res.status(400).json({
        success: false,
        message: "认证失败：请检查用户名 / 密码",
        status: res2.status,
      });
    }
    if (res2.status !== 207 && !res2.ok) {
      return res.status(400).json({
        success: false,
        message: `服务器响应异常：${res2.status} ${res2.statusText}`,
        status: res2.status,
      });
    }
    res.json({
      success: true,
      message: `连接成功（HTTP ${res2.status}）`,
      calendarUrl: base,
    });
  } catch (e) {
    res.status(400).json({
      success: false,
      message: `连接失败：${(e as Error).message}`,
    });
  }
}));

// ===== POST /api/caldav/reset-auto-sync（调试用） =====

/**
 * 让自动同步的下一次检查立即生效（改完间隔不用等一轮）。
 * 不做网络请求。
 */
caldavSyncRouter.post("/reset-auto-sync", (_req, res) => {
  __resetAutoSyncClock();
  res.json({ success: true });
});
