import * as fs from "node:fs";
import * as path from "node:path";
import crypto from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import cors from "cors";
import { calendarRouter } from "./routes/calendar.js";
import { webdavRouter } from "./routes/webdav.js";
import { nlpRouter } from "./routes/nlp.js";
import { configRouter } from "./routes/config.js";
import { pluginRouter } from "./routes/plugins.js";
import { workspaceRouter } from "./routes/workspace.js";
import { caldavSyncRouter } from "./routes/caldav-sync.js";
import { notificationsRouter } from "./routes/notifications.js";
import { backupsRouter } from "./routes/backups.js";
import { syncControlRouter } from "./routes/sync-control.js";
import { ApiTokenError } from "./errors.js";
import { tokenMatches } from "./auth.js";
import { apiErrorHandler } from "./http-errors.js";
import { isStorageReadOnly, isSyncMaintenance } from "./sync-control.js";

// 兼容旧 import 路径；实现放在 http.ts，避免 app.ts ↔ routes 循环依赖
export { asyncHandler } from "./http.js";

/**
 * 应用装配（v0.3.0）
 * ================
 *
 * 拆成 createApp() 的原因：
 *  - 测试可以拿到真正的 Express 实例，不用起端口、不用 import 副作用；
 *  - 中间件顺序是安全边界，用显式代码 + 测试固定下来；
 *  - index.ts 只负责进程生命周期（监听、定时器、退出）。
 *
 * 顺序（SDS §3.2，改动必须同步测试）：
 *   trust proxy → cors → /health → 路径规范化 → /api 认证 → json
 *   → 只读闸门 → 维护闸门 → API 路由 → API 404 → 静态 → SPA → 404 → 错误中间件
 *
 * 关键点：**认证必须在静态与 SPA 兜底之前**。否则没有 token 的
 * `GET /API/workspace/items` 会拿到 200 + index.html：既泄露页面，又掩盖 401。
 */

export interface CreateAppOptions {
  /**
   * 认证配置：
   *  - `false`：仅测试 / v0.2.5（无 token 的只读备份版本）；
   *  - `{ token }`：v0.3.0，Bearer token 校验。
   * 不传、传空 token 直接抛错 —— 不允许「忘记配置就裸奔」。
   */
  auth: false | { token: string };
  /** 前端静态目录（Docker / Electron 由后端一起服务） */
  staticDir?: string;
  /** 反向代理层数；仅影响 req.ip 与日志，不影响鉴权 */
  trustProxyHops?: number;
  /** 存储自检失败后进入只读模式（SDS §2.4 / D28） */
  storageReadOnly?: boolean;
  /** 测试注入：替换 API 路由（默认挂载全部） */
  routers?: express.Router[];
}


/** 维护态放行的写接口：恢复中仍要能预览、取消恢复 */
const MAINTENANCE_ALLOW: Array<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/workspace\/backups\/preview\/?$/ },
  { method: "GET", path: /^\/workspace\/backups\/?$/ },
  { method: "GET", path: /^\/workspace\/backups\/export\/?$/ },
  { method: "POST", path: /^\/workspace\/backups\/restore\/?$/ },
  { method: "POST", path: /^\/workspace\/backups\/restore\/abort\/?$/ },
];

function stripApiPrefix(req: Request): string {
  const url = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  return url.replace(/^\/api/i, "") || "/";
}

function isMaintenanceAllowed(req: Request): boolean {
  const method = req.method.toUpperCase();
  const p = stripApiPrefix(req);
  return MAINTENANCE_ALLOW.some((r) => r.method === method && r.path.test(p));
}

function corsOptions(): cors.CorsOptions {
  const allowList = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isProd = process.env.NODE_ENV === "production";

  return {
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      // `Origin: null`（sandbox iframe / file://）一律拒绝
      if (origin === "null") return callback(null, false);
      if (allowList.includes(origin)) return callback(null, true);
      if (!isProd && /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)) {
        return callback(null, true);
      }
      callback(null, false);
    },
  };
}

/** 校验 auth 参数：不允许缺省，不允许空 token */
function normalizeAuthOption(
  auth: CreateAppOptions["auth"],
): { token: string } | null {
  if (auth === false) return null;
  if (!auth || typeof auth !== "object") {
    throw new ApiTokenError(
      "createApp 需要显式认证配置：测试/只读版本用 { auth: false }，正式版本用 { auth: { token } }",
    );
  }
  const token = typeof auth.token === "string" ? auth.token.trim() : "";
  if (!token) throw new ApiTokenError("认证 token 不能为空");
  return { token };
}

/** Bearer token 校验 */
function bearerAuth(expected: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!m || !m[1]!.trim()) {
      res.status(401).json({ error: "需要访问令牌", code: "UNAUTHORIZED" });
      return;
    }
    if (!tokenMatches(expected, m[1]!.trim())) {
      res.status(401).json({ error: "访问令牌无效", code: "UNAUTHORIZED" });
      return;
    }
    next();
  };
}

/**
 * 路径规范化：挡住 `/%61pi/...`、`/api%2F...`、`//api/...` 这类绕过认证的写法。
 *
 * Express 4 的 `app.use("/api")` 匹配原始 req.url，而 `express.static` 会自行解码，
 * 两者对同一请求理解不一致就是鉴权绕过。
 */
const canonicalizeApiPath: RequestHandler = (req, res, next) => {
  const rawPath = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  if (/%(?:2f|5c)/i.test(rawPath)) {
    res.status(400).json({ error: "非法路径编码", code: "BAD_PATH" });
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    res.status(400).json({ error: "非法路径编码", code: "BAD_PATH" });
    return;
  }
  const lower = decoded.toLowerCase();
  if (
    (lower === "/api" || lower.startsWith("/api/")) &&
    !/^\/api(\/|$)/i.test(rawPath)
  ) {
    res.status(400).json({ error: "非法路径编码", code: "ENCODED_API_PATH" });
    return;
  }
  if (/^\/{2,}/.test(decoded)) {
    res.status(400).json({ error: "非法路径", code: "BAD_PATH" });
    return;
  }
  next();
};

export function createApp(opts: CreateAppOptions): express.Express {
  const auth = normalizeAuthOption(opts.auth);
  const staticDir = opts.staticDir;
  const indexHtml = staticDir ? path.join(staticDir, "index.html") : null;
  const hasSpa = Boolean(indexHtml && fs.existsSync(indexHtml));

  const app = express();
  app.disable("x-powered-by");

  const hops = Number(opts.trustProxyHops ?? process.env.TRUST_PROXY_HOPS ?? 0);
  if (Number.isFinite(hops) && hops > 0) {
    app.set("trust proxy", Math.floor(hops));
    console.warn(
      `[http] 信任 ${Math.floor(hops)} 层反向代理；错误配置会让 req.ip 失真（不影响鉴权）`,
    );
  }

  app.use(cors(corsOptions()));

  // 健康检查永远公开（Docker healthcheck、Electron 启动探测依赖它）
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: process.env.APP_VERSION ?? "dev" });
  });

  app.use(canonicalizeApiPath);

  // ---- 认证：必须在静态资源与 SPA 之前 ----
  if (auth) app.use("/api", bearerAuth(auth.token));

  app.use(express.json({ limit: "1mb" }));

  // ---- 只读闸门：存储自检失败后只允许读 ----
  if (opts.storageReadOnly ?? isStorageReadOnly()) {
    app.use("/api", (req, res, next) => {
      const method = req.method.toUpperCase();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
      const p = stripApiPrefix(req);
      if (
        method === "POST" &&
        /^\/workspace\/backups\/(preview|restore\/abort)\/?$/.test(p)
      ) {
        return next();
      }
      res.status(503).json({
        error: "存储当前为只读模式，写入已拒绝",
        code: "WORKSPACE_READ_ONLY",
      });
    });
  }

  // ---- 维护闸门：恢复期间只有白名单可写 ----
  app.use("/api", (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    if (!isSyncMaintenance()) return next();
    if (isMaintenanceAllowed(req)) return next();
    res.status(503).json({
      error: "正在恢复数据，请稍后再试",
      code: "MAINTENANCE",
    });
  });

  // ---- API 路由 ----
  if (opts.routers) {
    for (const router of opts.routers) app.use("/api", router);
  } else {
    app.use("/api/calendar", calendarRouter);
    app.use("/api/webdav", webdavRouter);
    app.use("/api/nlp", nlpRouter);
    app.use("/api/config", configRouter);
    app.use("/api/plugins", pluginRouter);
    app.use("/api/workspace", workspaceRouter);
    app.use("/api/caldav", caldavSyncRouter);
    app.use("/api/workspace/backups", backupsRouter);
    app.use("/api/sync", syncControlRouter);
    app.use("/api/notifications", notificationsRouter);
  }

  // 未知 /api 返回 JSON 404，绝不落到静态文件
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  });

  // ---- 静态资源 + SPA ----
  if (staticDir && hasSpa) {
    app.use(
      express.static(staticDir, {
        index: false,
        fallthrough: true,
        setHeaders(res, filePath) {
          if (/\.(?:js|css|woff2?|png|svg|webp)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    app.get(
      /^\/(?!api(\/|$)|health$|assets\/|sw\.js$|workbox-|manifest\.json$).*/i,
      (req, res, next) => {
        let decodedPath = req.path || "";
        try {
          decodedPath = decodeURIComponent(decodedPath);
        } catch {
          /* 上面已挡非法编码，这里保底 */
        }
        if (/^\/api(\/|$)/i.test(decodedPath)) {
          res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
          return;
        }
        res.sendFile(indexHtml!, (err) => {
          if (err) next(err);
        });
      },
    );
  }

  // ---- 最终 404 ----
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  });

  // ---- 统一错误映射（共享模块：生产与路由测试同一份行为） ----
  app.use(apiErrorHandler);

  return app;
}
