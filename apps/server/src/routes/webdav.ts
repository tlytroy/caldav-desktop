/**
 * WebDAV 同步 API 路由
 *
 * 与 CalDAV 通道的分工：
 *   - **WebDAV 通道**：workspace.md ↔ WebDAV 服务器（直接传文件，**无需转换**）
 *     这是「云同步」的主力 —— 多设备写同一份数据，且 md 仍是本地事实源，
 *     AI 随时能读写。坚果云 / Nextcloud / ownCloud / Box 都支持。
 *   - **CalDAV 通道**：workspace.md → ICS → CalDAV 服务器（跨日历软件互通）
 *     手机自带日历、Outlook、Google Calendar 靠这条。
 *
 * 同步的 md 文件：**只有 workspace.md**（统一数据源）。
 * 旧的 events.md 与 工作搭子看板.md 已合并进 workspace.md，不再单独同步。
 */

import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig, resolveDataPath } from "../config.js";
import {
  parseWorkspace,
  serializeWorkspace,
  type WorkbenchItem,
} from "../workspace.js";
import {
  loadWebDAVConfig,
  isWebDAVConfigured,
  statRemoteFile,
  getRemoteFile,
  putRemoteFile,
  readSyncState,
  writeSyncState,
  type WebDAVConfig,
} from "../webdav.js";
import { asyncHandler } from "../http.js";
import { isSyncSuspended } from "../restore.js";
import {
  beginSyncActivity,
  recordSyncConflict,
  recordSyncEvent,
} from "../sync-control.js";

export const webdavRouter = express.Router();

/** 恢复之后同步被暂停，必须由用户先选择方向（P7）。 */
function requireSyncNotSuspended(res: express.Response): boolean {
  if (isSyncSuspended()) {
    res.status(409).json({
      success: false,
      code: "SYNC_SUSPENDED",
      error: "同步已暂停：恢复工作区后需要先选择同步方向（拉取 / 推送 / 双向）",
    });
    return false;
  }
  return true;
}

/** 把 WebDAV 请求登记为「在途同步」，恢复流程会等它结束。 */
function markWebDAVActivity(res: express.Response): void {
  const end = beginSyncActivity("webdav");
  res.once("close", end);
}


/**
 * 当前要参与同步的本地文件清单。
 *
 * 现在只有**一个文件** —— workspace.md（统一数据源）。
 *
 * 为什么不再同步 events.md 与 工作搭子看板.md：
 * 那两个文件是旧「双文件 + 双向绑定」架构的产物，已经合并进 workspace.md。
 * 同步两个已废弃的文件只会制造混乱（两边不一致时以谁为准？）。
 *
 * 路径来源统一走 config.ts 的 resolveDataPath()：
 *   环境变量 > config.json（界面可改）> 默认值
 */
function syncTargets(_cfg: WebDAVConfig) {
  return [
    {
      key: "workspace",
      localPath: resolveDataPath("workspace"),
      filename: "workspace.md",
    },
  ];
}

/**
 * 远端目录名。
 *
 * 优先直接用配置层的目录名（用户在界面里填的）。
 * 兜底：若拿到的是完整路径（如旧的 WEBDAV_EVENTS_PATH=CalDAV-Desktop/events.md），
 * 取其目录部分。
 */
function remoteDirOf(cfg: WebDAVConfig): string {
  const configured = getConfig().webdav.remoteDir?.trim();
  if (configured) {
    // 配置层存的是纯目录名；若用户填了路径形式，取第一段
    const cleaned = configured.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!/\.md$/i.test(cleaned)) return cleaned;
    const idx = cleaned.lastIndexOf("/");
    return idx >= 0 ? cleaned.slice(0, idx) : cleaned;
  }

  const p = (cfg.remoteDir || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return "CalDAV-Desktop";
  const idx = p.lastIndexOf("/");
  if (/\.md$/i.test(p)) return idx >= 0 ? p.slice(0, idx) : "CalDAV-Desktop";
  return p;
}

function requireConfig(res: express.Response): WebDAVConfig | null {
  const cfg = loadWebDAVConfig();
  if (!isWebDAVConfigured(cfg)) {
    res.status(400).json({
      error: "WebDAV 未配置：请在 .env 中设置 WEBDAV_URL（并可选 WEBDAV_USER / WEBDAV_PASS）",
      config: { url: cfg.url, hasUser: !!cfg.username },
    });
    return null;
  }
  return cfg;
}

/** 生效中的 WebDAV 配置（把 remoteDir 收敛成目录名） */
function effectiveConfig(): WebDAVConfig {
  const cfg = loadWebDAVConfig();
  return { ...cfg, remoteDir: remoteDirOf(cfg) };
}

// ===== 合并（冲突时的第三个选项）=====

/** 合并报告 */
export interface MdMergeReport {
  /** 只在本地存在（远端没有）的条目 */
  localOnly: number;
  /** 只在远端存在（别的设备新增）的条目 */
  remoteOnly: number;
  /** 同 id、远端更新时间更新 → 采用远端 */
  fromRemote: number;
  /** 同 id、本地更新时间更新 → 保留本地 */
  fromLocal: number;
  /** 同 id、时间相同但内容不同 → 保留本地，需要人工确认 */
  conflicts: Array<{ id: string; title: string }>;
  /** 无法解析、被跳过的条目数 */
  invalid: number;
  total: number;
}

/** 比较内容时忽略「时间戳」本身 */
function contentSnapshot(item: WorkbenchItem): string {
  const { updatedAt: _u, createdAt: _c, ...rest } = item;
  return JSON.stringify(rest);
}

/**
 * 合并两份 workspace.md 文本。
 *
 * 规则：按 id 取并集 ——
 *  - 只有一边有 → 都保留（别的设备新增的不会丢）
 *  - 两边都有且内容不同 → 用 `updatedAt` 较新的一版
 *  - 时间相同 / 都没有时间 → 保留本地，并记入 conflicts
 *
 * 注意这是**条目级**合并，不是字段级：同一个 id 两边改了不同字段时，
 * 只会留较新那一版。字段级合并留给 CalDAV 通道（那边有同步基线）。
 */
export function mergeWorkspaceText(
  localText: string,
  remoteText: string,
): { text: string; report: MdMergeReport } {
  const local = parseWorkspace(localText);
  const remote = parseWorkspace(remoteText);
  const localItems = local.items.filter((i) => !i.errors);
  const remoteItems = remote.items.filter((i) => !i.errors);

  const byId = new Map<string, WorkbenchItem>();
  for (const it of localItems) byId.set(it.id, { ...it });

  const report: MdMergeReport = {
    localOnly: 0,
    remoteOnly: 0,
    fromRemote: 0,
    fromLocal: 0,
    conflicts: [],
    invalid:
      local.items.length -
      localItems.length +
      (remote.items.length - remoteItems.length),
    total: 0,
  };

  const remoteIds = new Set(remoteItems.map((i) => i.id));
  report.localOnly = localItems.filter((i) => !remoteIds.has(i.id)).length;

  for (const r of remoteItems) {
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, { ...r });
      report.remoteOnly++;
      continue;
    }
    if (contentSnapshot(l) === contentSnapshot(r)) continue;

    const lt = Date.parse(l.updatedAt || "") || 0;
    const rt = Date.parse(r.updatedAt || "") || 0;
    if (rt > lt) {
      byId.set(r.id, { ...r });
      report.fromRemote++;
    } else if (lt > rt) {
      report.fromLocal++;
    } else {
      report.conflicts.push({ id: r.id, title: r.title });
    }
  }

  // 笔记是自由文本，不去猜哪边对：两边都有就都留着，标个来源
  const ln = local.notes.trim();
  const rn = remote.notes.trim();
  let notes = ln || rn;
  if (ln && rn && ln !== rn) {
    notes = `${ln}\n\n<!-- 合并自远端 -->\n${rn}`;
  }

  report.total = byId.size;
  return { text: serializeWorkspace([...byId.values()], notes), report };
}

// ===== GET /api/webdav/status =====

/**
 * 查看 WebDAV 配置与远端文件状态，不做任何写操作。
 */
webdavRouter.get("/status", async (_req, res) => {
  const cfg = loadWebDAVConfig();
  if (!isWebDAVConfigured(cfg)) {
    return res.json({
      success: true,
      configured: false,
      remoteDir: remoteDirOf(cfg),
      files: [],
      message: "未配置 WEBDAV_URL",
    });
  }

  const eff = effectiveConfig();
  const files: Array<Record<string, unknown>> = [];

  for (const t of syncTargets(eff)) {
    const exists = fs.existsSync(t.localPath);
    const localSize = exists ? fs.statSync(t.localPath).size : 0;
    const localMtime = exists ? fs.statSync(t.localPath).mtimeMs : undefined;

    let remote: Record<string, unknown> = { exists: false };
    try {
      const info = await statRemoteFile(eff, t.filename);
      remote = {
        exists: info.exists,
        etag: info.etag,
        lastModified: info.lastModified,
        size: info.size,
      };
    } catch (e) {
      remote = { exists: false, error: (e as Error).message };
    }

    const state = readSyncState(t.localPath);
    files.push({
      key: t.key,
      filename: t.filename,
      local: { path: t.localPath, exists, size: localSize, mtime: localMtime },
      remote,
      lastSyncedEtag: state.etags[t.filename],
      lastSyncedAt: state.syncedAt?.[t.filename],
      /** 远端是否在上次同步后被改动过（用于提示） */
      remoteChangedSinceLastSync:
        info_etag_changed(state, t.filename, remote),
    });
  }

  res.json({
    success: true,
    configured: true,
    url: eff.url,
    remoteDir: eff.remoteDir,
    hasCredentials: !!eff.username,
    files,
  });
});

function info_etag_changed(
  state: { etags: Record<string, string> },
  filename: string,
  remote: Record<string, unknown>,
): boolean {
  const known = state.etags[filename];
  if (!known) return true; // 从未同步过，视为已变化
  const cur = remote.etag as string | undefined;
  if (!cur) return false; // 远端无 ETag，无法判断，保守认为没变
  return cur !== known;
}

// ===== POST /api/webdav/push =====

/**
 * 把本地 md 文件推送到远端。
 *
 * Body:
 *   - files?: "workspace"[]  只推指定文件；缺省全部（v0.3 只有 workspace）
 *   - force?: boolean  忽略 ETag 检查强制覆盖（远端被他人改动时用）
 *
 * 默认带 `If-Match` 乐观锁：远端自上次同步后被改动时会返回 412，
 * 避免静默覆盖其他设备上的修改。
 */
webdavRouter.post("/push", asyncHandler(async (req, res) => {
  if (!requireSyncNotSuspended(res)) return;
  markWebDAVActivity(res);
  const cfg = requireConfig(res);
  if (!cfg) return;
  const eff = effectiveConfig();

  const wanted: string[] = Array.isArray(req.body?.files)
    ? req.body.files
    : syncTargets(effectiveConfig()).map((t) => t.key);
  const force = req.body?.force === true;

  const results: Array<Record<string, unknown>> = [];

  for (const t of syncTargets(eff)) {
    if (!wanted.includes(t.key)) continue;

    try {
      if (!fs.existsSync(t.localPath)) {
        results.push({ key: t.key, filename: t.filename, ok: false, error: "本地文件不存在" });
        continue;
      }

      const content = fs.readFileSync(t.localPath, "utf-8");
      const state = readSyncState(t.localPath);
      const known = state.etags[t.filename];

      // force 或从未同步过 → 无条件覆盖；否则带 If-Match 乐观锁
      let expected: string | undefined;
      if (!force) {
        const info = await statRemoteFile(eff, t.filename);
        // 仅当本地记录的 ETag 与远端当前一致时才乐观锁；
        // 不一致说明远端已被他人改动，交给用户决策
        if (info.exists && known && info.etag === known) {
          expected = known;
        } else if (info.exists && known && info.etag !== known && !force) {
          results.push({
            key: t.key,
            filename: t.filename,
            ok: false,
            conflict: true,
            error: "远端文件已被其他设备修改，请先拉取或使用 force 覆盖",
            localEtag: known,
            remoteEtag: info.etag,
          });
          recordSyncConflict({
            channel: "webdav",
            remoteEtag: info.etag,
            localHash: known,
            summary: "推送时远端文件已被其他设备修改",
          });
          continue;
        }
      }

      const { etag } = await putRemoteFile(eff, t.filename, content, expected);

      state.etags[t.filename] = etag || known || "";
      state.syncedAt = state.syncedAt || {};
      state.syncedAt[t.filename] = new Date().toISOString();
      writeSyncState(t.localPath, state);

      results.push({
        key: t.key,
        filename: t.filename,
        ok: true,
        etag,
        bytes: Buffer.byteLength(content, "utf-8"),
        forced: force || !expected,
      });
    } catch (e) {
      results.push({ key: t.key, filename: t.filename, ok: false, error: (e as Error).message });
    }
  }

  const anyOk = results.some((r) => r.ok);
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  recordSyncEvent(
    "webdav",
    failCount > 0 && !anyOk ? "error" : "push",
    `WebDAV 推送：成功 ${okCount}，失败 ${failCount}`,
  );
  for (const r of results) {
    if (r.ok === false && typeof r.error === "string") {
      recordSyncEvent("webdav", "error", String(r.error));
    }
  }
  res.status(anyOk ? 200 : 500).json({
    success: anyOk,
    remoteDir: eff.remoteDir,
    results,
  });
}));

// ===== POST /api/webdav/pull =====

/**
 * 从远端拉取 md 文件覆盖本地。
 *
 * Body:
 *   - files?: "workspace"[]  只拉指定文件；缺省全部（v0.3 只有 workspace）
 *   - force?: boolean  即使远端 ETag 与上次同步相同也覆盖本地
 *
 * 默认只在「远端确实变化过」时才覆盖本地，避免无意义地冲掉本地未同步的改动。
 * 拉取前会自动备份本地文件为 `.bak`，防止误覆盖导致数据丢失。
 */
webdavRouter.post("/pull", asyncHandler(async (req, res) => {
  if (!requireSyncNotSuspended(res)) return;
  markWebDAVActivity(res);
  const cfg = requireConfig(res);
  if (!cfg) return;
  const eff = effectiveConfig();

  const wanted: string[] = Array.isArray(req.body?.files)
    ? req.body.files
    : syncTargets(effectiveConfig()).map((t) => t.key);
  const force = req.body?.force === true;

  const results: Array<Record<string, unknown>> = [];

  for (const t of syncTargets(eff)) {
    if (!wanted.includes(t.key)) continue;

    try {
      const info = await statRemoteFile(eff, t.filename);
      if (!info.exists) {
        results.push({ key: t.key, filename: t.filename, ok: false, error: "远端文件不存在" });
        continue;
      }

      const state = readSyncState(t.localPath);
      const known = state.etags[t.filename];

      // 远端没变化且非 force → 跳过，不覆盖本地
      if (!force && known && info.etag && info.etag === known) {
        results.push({
          key: t.key,
          filename: t.filename,
          ok: true,
          skipped: true,
          reason: "远端无变化",
        });
        continue;
      }

      const remoteContent = await getRemoteFile(eff, t.filename);
      if (remoteContent === null) {
        results.push({ key: t.key, filename: t.filename, ok: false, error: "下载失败：文件已不存在" });
        continue;
      }

      // 备份本地，避免误覆盖丢数据
      let backupPath: string | undefined;
      if (fs.existsSync(t.localPath)) {
        backupPath = `${t.localPath}.bak`;
        fs.copyFileSync(t.localPath, backupPath);
      }

      fs.mkdirSync(path.dirname(t.localPath), { recursive: true });
      fs.writeFileSync(t.localPath, remoteContent, "utf-8");

      state.etags[t.filename] = info.etag || "";
      state.syncedAt = state.syncedAt || {};
      state.syncedAt[t.filename] = new Date().toISOString();
      writeSyncState(t.localPath, state);

      results.push({
        key: t.key,
        filename: t.filename,
        ok: true,
        bytes: Buffer.byteLength(remoteContent, "utf-8"),
        backupPath,
        overwritten: true,
      });
    } catch (e) {
      results.push({ key: t.key, filename: t.filename, ok: false, error: (e as Error).message });
    }
  }

  const anyOk = results.some((r) => r.ok);
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  recordSyncEvent(
    "webdav",
    failCount > 0 && !anyOk ? "error" : "pull",
    `WebDAV 拉取：成功 ${okCount}，失败 ${failCount}`,
  );
  for (const r of results) {
    if (r.ok === false && typeof r.error === "string") {
      recordSyncEvent("webdav", "error", String(r.error));
    }
  }
  res.status(anyOk ? 200 : 500).json({
    success: anyOk,
    remoteDir: eff.remoteDir,
    results,
  });
}));

// ===== POST /api/webdav/merge =====

/**
 * 冲突时的第三个选项：把远端条目与本地条目**合并**，然后两端都写同一份。
 *
 * 顺序很重要：先带 If-Match 推远端，成功后再写本地。
 * 这样合并期间远端又被别人改动时，本地不会被改坏（返回 409 让用户重试）。
 *
 * 覆盖本地前会备份为 `.bak`。
 */
webdavRouter.post("/merge", async (_req, res) => {
  if (!requireSyncNotSuspended(res)) return;
  markWebDAVActivity(res);
  const cfg = requireConfig(res);
  if (!cfg) return;
  const eff = effectiveConfig();
  const t = syncTargets(eff)[0];

  try {
    const info = await statRemoteFile(eff, t.filename);
    if (!info.exists) {
      return res.status(400).json({
        success: false,
        error: "远端还没有 workspace.md；先「推送到 WebDAV」建立基线，再合并",
      });
    }

    const remoteText = await getRemoteFile(eff, t.filename);
    if (remoteText === null) throw new Error("下载远端文件失败");
    const localText = fs.existsSync(t.localPath)
      ? fs.readFileSync(t.localPath, "utf-8")
      : "";

    const { text, report } = mergeWorkspaceText(localText, remoteText);

    // 先推远端（乐观锁）；失败则本地完全不动
    let etag: string | undefined;
    try {
      ({ etag } = await putRemoteFile(eff, t.filename, text, info.etag));
    } catch (e) {
      const msg = (e as Error).message;
      if (/412/.test(msg)) {
        recordSyncConflict({
          channel: "webdav",
          remoteEtag: info.etag,
          summary: "合并期间远端又被修改了，需要重新合并",
        });
        return res.status(409).json({
          success: false,
          error: "合并期间远端又被修改了，请刷新状态后重试",
        });
      }
      throw e;
    }

    // 本地写入 + 备份
    let backupPath: string | undefined;
    if (fs.existsSync(t.localPath)) {
      backupPath = `${t.localPath}.bak`;
      fs.copyFileSync(t.localPath, backupPath);
    }
    fs.mkdirSync(path.dirname(t.localPath), { recursive: true });
    fs.writeFileSync(t.localPath, text, "utf-8");

    const state = readSyncState(t.localPath);
    state.etags[t.filename] = etag || "";
    state.syncedAt = state.syncedAt || {};
    state.syncedAt[t.filename] = new Date().toISOString();
    writeSyncState(t.localPath, state);

    recordSyncEvent(
      "webdav",
      "merge",
      `WebDAV 合并：远端新增 ${report.remoteOnly}，本地新增 ${report.localOnly}，` +
        `冲突 ${report.conflicts.length}，总条目 ${report.total}`,
    );
    for (const c of report.conflicts) {
      recordSyncConflict({
        channel: "webdav",
        localId: c.id,
        summary: `「${c.title}」两边同时修改且时间相同，保留本地，需人工确认`,
      });
    }

    res.json({
      success: true,
      filename: t.filename,
      merged: report,
      etag,
      backupPath,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ===== POST /api/webdav/test =====

/** 连通性测试：检查配置与远端目录是否可达 */
webdavRouter.post("/test", async (_req, res) => {
  const cfg = requireConfig(res);
  if (!cfg) return;
  const eff = effectiveConfig();

  try {
    // 用 PROPFIND Depth:0 探测根目录
    const base = eff.url.endsWith("/") ? eff.url : `${eff.url}/`;
    const probe = await fetch(base, {
      method: "PROPFIND",
      headers: {
        Authorization: `Basic ${
          typeof Buffer !== "undefined"
            ? Buffer.from(`${eff.username}:${eff.password}`, "utf-8").toString("base64")
            : ""
        }`,
        Depth: "0",
      },
      signal: AbortSignal.timeout(eff.timeoutMs),
    });

    if (probe.status === 401 || probe.status === 403) {
      return res.status(400).json({
        success: false,
        message: "认证失败：请检查 WEBDAV_USER / WEBDAV_PASS",
        status: probe.status,
      });
    }
    if (![200, 207, 207].includes(probe.status) && probe.status !== 404) {
      return res.status(400).json({
        success: false,
        message: `服务器响应异常：${probe.status} ${probe.statusText}`,
        status: probe.status,
      });
    }

    res.json({
      success: true,
      message: `连接成功（HTTP ${probe.status}）`,
      url: eff.url,
      remoteDir: eff.remoteDir,
    });
  } catch (e) {
    res.status(400).json({
      success: false,
      message: `连接失败：${(e as Error).message}`,
    });
  }
});
