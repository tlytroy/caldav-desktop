/**
 * WebDAV 同步 API 路由
 *
 * 与 CalDAV 通道的分工（见 REF/MD_ICS_BRIDGE.md）：
 *   - CalDAV 通道：events.md → ICS → CalDAV 服务器（跨日历软件互通）
 *   - WebDAV 通道：md 文件本身 ↔ WebDAV 服务器（**无需 ICS 转换**）
 *
 * WebDAV 通道的价值：用户可能没有 CalDAV 服务器，但只要有任意支持 WebDAV
 * 的云盘（Nextcloud / ownCloud / 坚果云 / Box）就能多设备同步，
 * 且 md 仍是唯一事实源、AI 仍可直接读写。
 *
 * 同步的 md 文件：
 *   - events.md（日历事件）
 *   - 工作搭子看板.md（待办 / 项目 / 速记）
 */

import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
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

export const webdavRouter = express.Router();

/**
 * 解析本地 md 文件路径。
 *
 * 注意：`.env` 里 `MD_EVENTS_FILE=./events.md` 是**相对进程 cwd** 的。
 * 项目里此前有两种写法并存（`path.resolve(cwd)` 与直接用相对串），
 * 虽然结果相同但语义混乱。这里统一成绝对路径。
 */
function resolveLocalPath(raw: string, fallbackName: string): string {
  const p = (raw || "").trim();
  if (!p) return path.resolve(process.cwd(), fallbackName);
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/** 当前要参与同步的本地文件清单 */
function syncTargets(cfg: WebDAVConfig) {
  const eventsFile = resolveLocalPath(
    process.env.MD_EVENTS_FILE || "",
    "events.md",
  );
  const kanbanFile = resolveLocalPath(
    process.env.KANBAN_FILE_PATH || "",
    "工作搭子看板.md",
  );
  return [
    { key: "events", localPath: eventsFile, filename: "events.md" },
    { key: "kanban", localPath: kanbanFile, filename: "工作搭子看板.md" },
  ];
}

/** 远端目录名：取 WEBDAV_EVENTS_PATH 的目录部分 */
function remoteDirOf(cfg: WebDAVConfig): string {
  const p = cfg.remoteDir.replace(/^\/+/, "");
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(0, idx) : p;
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
 *   - files?: ("events"|"kanban")[]  只推指定文件；缺省全部
 *   - force?: boolean  忽略 ETag 检查强制覆盖（远端被他人改动时用）
 *
 * 默认带 `If-Match` 乐观锁：远端自上次同步后被改动时会返回 412，
 * 避免静默覆盖其他设备上的修改。
 */
webdavRouter.post("/push", async (req, res) => {
  const cfg = requireConfig(res);
  if (!cfg) return;
  const eff = effectiveConfig();

  const wanted: string[] = Array.isArray(req.body?.files)
    ? req.body.files
    : ["events", "kanban"];
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
  res.status(anyOk ? 200 : 500).json({
    success: anyOk,
    remoteDir: eff.remoteDir,
    results,
  });
});

// ===== POST /api/webdav/pull =====

/**
 * 从远端拉取 md 文件覆盖本地。
 *
 * Body:
 *   - files?: ("events"|"kanban")[]  只拉指定文件；缺省全部
 *   - force?: boolean  即使远端 ETag 与上次同步相同也覆盖本地
 *
 * 默认只在「远端确实变化过」时才覆盖本地，避免无意义地冲掉本地未同步的改动。
 * 拉取前会自动备份本地文件为 `.bak`，防止误覆盖导致数据丢失。
 */
webdavRouter.post("/pull", async (req, res) => {
  const cfg = requireConfig(res);
  if (!cfg) return;
  const eff = effectiveConfig();

  const wanted: string[] = Array.isArray(req.body?.files)
    ? req.body.files
    : ["events", "kanban"];
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
  res.status(anyOk ? 200 : 500).json({
    success: anyOk,
    remoteDir: eff.remoteDir,
    results,
  });
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
