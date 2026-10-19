import "dotenv/config";
import express from "express";
import cors from "cors";
import { initializeClient } from "./caldav.js";
import { calendarRouter } from "./routes/calendar.js";
import { mdBridgeRouter } from "./routes/md-bridge.js";
import { kanbanRouter } from "./routes/kanban.js";
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

async function start() {
  try {
    // Test connection to CalDAV server
    await initializeClient();

    app.listen(PORT, () => {
      console.log(`\n🚀 Server running at http://localhost:${PORT}`);
      console.log(
        `📅 Calendar API: http://localhost:${PORT}/api/calendar/calendars`,
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
