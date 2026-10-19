import "dotenv/config";
import express from "express";
import cors from "cors";
import { initializeClient } from "./caldav.js";
import { calendarRouter } from "./routes/calendar.js";
import { mdBridgeRouter } from "./routes/md-bridge.js";
import { kanbanRouter } from "./routes/kanban.js";
import { webdavRouter } from "./routes/webdav.js";
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
  });
}

start();
