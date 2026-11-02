import "dotenv/config";
import express from "express";
import cors from "cors";
import { initializeClient } from "./caldav.js";
import { calendarRouter } from "./routes/calendar.js";
import { mdBridgeRouter } from "./routes/md-bridge.js";
import { kanbanRouter } from "./routes/kanban.js";
import { webdavRouter } from "./routes/webdav.js";
import { nlpRouter } from "./routes/nlp.js";
import { configRouter } from "./routes/config.js";
import { pluginRouter } from "./routes/plugins.js";
import { workspaceRouter } from "./routes/workspace.js";
import { loadBridgeConfig } from "./md-ics-bridge.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

// Calendar routes
app.use("/api/calendar", calendarRouter);

// MD ↔ ICS Bridge routes
app.use("/api/md-bridge", mdBridgeRouter);

// 工作搭子看板 (Kanban) routes
app.use("/api/kanban", kanbanRouter);

// WebDAV 同步 routes（直接同步 md 文件，无需 ICS 转换）
app.use("/api/webdav", webdavRouter);

// 自然语言快速创建 routes（本地规则 + 可选 AI 增强）
app.use("/api/nlp", nlpRouter);

// 统一配置 routes（设置界面读写 config.json）
app.use("/api/config", configRouter);

// 插件 routes（扫描 plugins/ 目录，返回模块清单）
app.use("/api/plugins", pluginRouter);

// 统一数据源 routes（workspace.md —— 事件与任务的唯一事实源）
app.use("/api/workspace", workspaceRouter);

/**
 * 启动顺序：**先监听端口，再异步探测 CalDAV**。
 *
 * 为什么不能先 await initializeClient()：
 * CalDAV 服务器不通时（关着、网络受限、域名解析失败），
 * `davClient.login()` 会一直等到 TCP/HTTP 超时 —— 这个过程可能长达数十秒。
 * 而这段时间里 `app.listen()` 还没执行，**整个服务无法响应任何请求**，
 * 用户打开界面只能看到连接失败。
 *
 * 本工具的事实源是本地 workspace.md，CalDAV 只是可选同步通道。
 * 所以正确顺序是：立刻可用 → 后台探测 → 探测结果写入状态，
 * 由前端通过 /api/calendar/calendars 的 degraded 标记感知。
 */
async function start() {
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`🗂  Data source: http://localhost:${PORT}/api/workspace/info`);
    console.log(`📅 Calendar API: http://localhost:${PORT}/api/calendar/calendars`);
    console.log(`☁️  WebDAV:      http://localhost:${PORT}/api/webdav/status`);
    console.log(`✨ Quick create: http://localhost:${PORT}/api/nlp/status`);
    console.log(`⚙️  Config:      http://localhost:${PORT}/api/config`);

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
  });
}

start();
