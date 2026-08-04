import { app, BrowserWindow } from "electron";
import path from "path";
import { fork, ChildProcess } from "child_process";

let serverProcess: ChildProcess | null = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

function startBackendServer(): void {
  const serverPath = path.join(__dirname, "..", "server", "dist", "index.js");
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: "3001" },
    stdio: "pipe",
  });

  serverProcess.stdout?.on("data", (data: Buffer) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on("data", (data: Buffer) => {
    console.error(`[Backend] ${data.toString().trim()}`);
  });

  serverProcess.on("error", (err: Error) => {
    console.error("Failed to start backend server:", err.message);
  });

  serverProcess.on("exit", (code: number | null) => {
    console.log(`Backend server exited with code ${code}`);
    serverProcess = null;
  });
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: "CalDAV Desktop",
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // and load the index.html of the app.
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on("ready", () => {
  startBackendServer();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
