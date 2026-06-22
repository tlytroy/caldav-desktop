import "dotenv/config";
import express from "express";
import cors from "cors";
import { initializeClient } from "./caldav.js";
import { calendarRouter } from "./routes/calendar.js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

// Calendar routes
app.use("/api/calendar", calendarRouter);

async function start() {
  try {
    // Test connection to Radicale
    await initializeClient();

    app.listen(PORT, () => {
      console.log(`\n🚀 Server running at http://localhost:${PORT}`);
      console.log(
        `📅 Calendar API: http://localhost:${PORT}/api/calendar/calendars`
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
