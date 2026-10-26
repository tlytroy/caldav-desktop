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

async function start() {
  // CalDAV 连接失败**不应阻止服务启动**。
  //
  // 理由：本工具的主要事实源是本地 md 文件，CalDAV 只是可选同步通道。
  // `initializeClient()` 内部已经捕获错误并返回空数组，这里若再 exit(1)，
  // 就会导致「没有 CalDAV 服务器、只想用 md + WebDAV」的用户完全无法启动。
  try {
    await initializeClient();
  } catch (error) {
    console.warn(
      "⚠ CalDAV 初始化失败，但服务继续启动（md 与 WebDAV 通道仍可用）:",
      error instanceof Error ? error.message : error,
    );
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`📅 Calendar API: http://localhost:${PORT}/api/calendar/calendars`);
    console.log(`🗂  MD bridge:   http://localhost:${PORT}/api/md-bridge/events`);
    console.log(`📋 Kanban:      http://localhost:${PORT}/api/kanban`);
    console.log(`☁️  WebDAV:      http://localhost:${PORT}/api/webdav/status`);
    console.log(`✨ Quick create: http://localhost:${PORT}/api/nlp/status`);
    console.log(`⚙️  Config:      http://localhost:${PORT}/api/config`);
  });
}

start();
