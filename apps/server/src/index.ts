import "dotenv/config";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { resolveApiToken } from "./auth.js";
import { initializeClient } from "./caldav.js";
import { startCalDAVAutoSync } from "./caldav-sync.js";
import { recoverRestoreOnStartup } from "./restore.js";
import { startReminderScheduler } from "./notifications/scheduler.js";
import { cleanupStaleTmpFiles, verifyStorageSafety } from "./storage-check.js";
import { setStorageReadOnly } from "./sync-control.js";
import { workspaceFilePath } from "./workspace.js";
import * as path from "node:path";

/**
 * 进程入口：只管生命周期，不管路由顺序。
 *
 * 所有中间件顺序 / 鉴权边界都在 `createApp()` 里（见 app.ts 顶部注释），
 * 这样测试可以直接拿到 app 实例，不需要起端口、不需要 import 副作用。
 *
 * 启动顺序：**先监听端口，再异步探测 CalDAV**。
 * CalDAV 服务器不通时（关着、网络受限、域名解析失败），login 可能要等数十秒；
 * 如果先 await 它，整个服务在这段时间无法响应任何请求，用户只会看到连接失败。
 * 本工具的事实源是本地 workspace.md，CalDAV 只是可选同步通道。
 */
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST?.trim() || "0.0.0.0";
const STATIC_DIR = process.env.STATIC_DIR;

/**
 * P5 起启用单用户 Bearer 认证（D1）。
 *
 * 顺序很关键：**先拿 token，再做存储自检**。NAS 上 /data 只读时 token 写不进去，
 * 也要先在内存里生成并打印一次，而不是启动失败。
 */
const tokenInfo = resolveApiToken();
const app = createApp({
  auth: { token: tokenInfo.token },
  staticDir: STATIC_DIR,
});

function logRoutes(port: number): void {
  const base = `http://localhost:${port}`;
  console.log(`\n🚀 Server running at ${base}`);
  console.log(`🗂  Data source: ${base}/api/workspace/info`);
  console.log(`📅 Calendar API: ${base}/api/calendar/calendars`);
  console.log(`☁️  WebDAV:      ${base}/api/webdav/status`);
  console.log(`📆 CalDAV sync: ${base}/api/caldav/status`);
  console.log(`🔔 Notifications: ${base}/api/notifications/status`);
  if (STATIC_DIR) console.log(`🖥  Web UI:       ${base}/`);
  console.log(`✨ Quick create: ${base}/api/nlp/status`);
  console.log(`⚙️  Config:      ${base}/api/config`);
}

/**
 * 启动时的存储自检（SDS §2.4 / D28）。
 *
 * 只读挂载（Docker volume 挂错、NAS 权限、只读共享）不应该让服务直接退出：
 * 用户至少要能看到数据、能导出备份。所以这里失败就降级为只读运行，
 * 写接口统一返回 503 WORKSPACE_READ_ONLY，读接口照常。
 *
 * ALLOW_UNSAFE_FS=1 是显式逃生门：知道自己在干什么的部署可以强行写。
 */
function checkStorage(): boolean {
  const file = workspaceFilePath();
  const dir = path.dirname(file);
  try {
    const result = verifyStorageSafety(dir);
    if (!result.ok) throw new Error(result.error ?? "未知原因");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.env.ALLOW_UNSAFE_FS === "1") {
      console.warn(`⚠ 存储自检失败（ALLOW_UNSAFE_FS=1，继续以可写模式运行）：${message}`);
      return true;
    }
    console.error(`✖ 存储自检失败：${message}`);
    console.error("  已降级为只读运行：可以查看/导出数据，写入会返回 503。");
    console.error("  修复挂载权限后重启即可；确认环境安全可设置 ALLOW_UNSAFE_FS=1 强制可写。");
    setStorageReadOnly(true);
    return false;
  }

  // 清理上次进程崩溃留下的 tmp（只清旧文件，避免误删正在写的）
  try {
    cleanupStaleTmpFiles(dir);
  } catch {
    /* 清理失败不影响启动 */
  }
  return true;
}

function runAfterListen(): void {
  const writable = checkStorage();
  const restoreState = recoverRestoreOnStartup();
  if (restoreState === "resumed") {
    console.warn("⚠ 恢复未完成：写入已冻结，请重试恢复或取消后再继续使用");
  }

  // 只读模式下没有任何后台写任务：定时器只会一直失败刷日志
  if (!writable) {
    console.warn("⚠ 只读模式：已跳过 CalDAV 自动同步与提醒推送定时器");
    return;
  }

  // ---- CalDAV 自动同步（配置间隔 > 0 才真的发请求）----
  if (restoreState === "resumed") {
    console.warn("⚠ 恢复未完成：已暂停 CalDAV 自动同步与提醒推送，等待处理恢复");
    return;
  }
  startCalDAVAutoSync();

  // ---- 服务端提醒推送（没启用任何渠道时不做任何事）----
  startReminderScheduler();

  // ---- CalDAV 后台探测（不阻塞服务）----
  void (async () => {
    try {
      await initializeClient();
    } catch (error) {
      console.warn(
        "⚠ CalDAV 初始化失败（不影响本地数据源）:",
        error instanceof Error ? error.message : error,
      );
    }
  })();
}

function installShutdown(server: Server): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`\n[server] 收到 ${signal}，正在关闭…`);
    server.close(() => process.exit(0));
    // 兜底：keep-alive 连接没断干净时 5s 后强制退出
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function start(): void {
  const server = app.listen(PORT, HOST, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : PORT;
    logRoutes(port);
    runAfterListen();
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[server] 端口 ${PORT} 已被占用，请设置 PORT 换一个端口`);
    } else {
      console.error("[server] 监听失败：", error.message);
    }
    process.exit(1);
  });

  installShutdown(server);
}

start();
