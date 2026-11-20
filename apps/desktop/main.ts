/**
 * Electron 主进程
 *
 * 设计要点（SDS §3.6 / D16）：
 * - 生产包不再 `loadFile`（file:// 是 null origin，CORS/鉴权都会坏），
 *   而是拉起**打包进 resources 的**本机后端，再用 http://127.0.0.1:<随机端口> 打开。
 * - 端口随机：先 listen(0) 拿一个空闲端口再关掉，重试 3 次。
 * - token 由主进程生成/读取，渲染进程永远拿不到；请求头由 `webRequest` 注入。
 * - 渲染进程只通过 preload 拿到 `__DSH_ELECTRON__` 和 `__API_BASE_URL__`。
 * - 后端挂在 `app.getPath("userData")` 下，升级/重装不丢数据。
 */
import { app, BrowserWindow, dialog, session } from "electron";
import path from "node:path";
import net from "node:net";
import fs from "node:fs";
import crypto from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";

const isDev = !app.isPackaged;
const DEV_RENDERER_URL = "http://localhost:5173";

let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let apiToken = "";
let quitting = false;

if (require("electron-squirrel-startup")) {
  app.quit();
}

function dataDir(): string {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tokenPath(): string {
  return path.join(dataDir(), "api-token.txt");
}

/** 读取或生成 64 hex token；Electron 自己持有，不给渲染进程。 */
function ensureToken(): string {
  const fromEnv = (process.env.API_TOKEN ?? "").trim();
  if (/^\S{32,}$/.test(fromEnv)) return fromEnv;

  const file = tokenPath();
  try {
    const existing = fs.readFileSync(file, "utf-8").trim();
    if (/^[0-9a-f]{64}$/.test(existing)) {
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* Windows 上无意义，忽略 */
      }
      return existing;
    }
  } catch {
    /* 不存在或读不了，走生成 */
  }

  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, token + "\n", { encoding: "utf-8", mode: 0o600 });
  return token;
}

/** 让系统分配一个空闲端口，再释放给子进程用。 */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("未能分配端口"))));
    });
  });
}

async function pickFreePortWithRetry(): Promise<number> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await pickFreePort();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("未能分配端口");
}

function serverEntry(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "server", "index.cjs");
  }
  return path.join(__dirname, "..", "server", "dist", "index.js");
}

function staticDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "renderer");
  return path.join(__dirname, "renderer");
}

async function waitForHealth(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(`后端进程已退出（code ${serverProcess.exitCode}）`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
      lastErr = new Error(`/health ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastErr instanceof Error ? lastErr : new Error("后端启动超时");
}

async function startBackend(): Promise<number> {
  const port = await pickFreePortWithRetry();
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到后端入口：${entry}`);
  }

  const workspaceFile = path.join(dataDir(), "workspace.md");
  apiToken = ensureToken();

  serverProcess = fork(entry, [], {
    // Electron 的 exe 加这个环境变量就当 Node 用，不装独立 Node 也能 fork
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOST: "127.0.0.1",
      API_TOKEN: apiToken,
      WORKSPACE_FILE: workspaceFile,
      STATIC_DIR: staticDir(),
      APP_VERSION: app.getVersion(),
      PLUGINS_DIR: path.join(process.resourcesPath, "plugins"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (d: Buffer) => {
    console.log(`[backend] ${d.toString().trimEnd()}`);
  });
  serverProcess.stderr?.on("data", (d: Buffer) => {
    console.error(`[backend] ${d.toString().trimEnd()}`);
  });
  serverProcess.on("error", (err: Error) => {
    console.error("后端启动失败：", err.message);
  });
  serverProcess.on("exit", (code) => {
    console.log(`后端退出，code=${code}`);
    serverProcess = null;
    if (!quitting && code !== 0) {
      dialog.showErrorBox("本地服务已停止", `后端进程退出（code ${code}）。请重启应用。`);
    }
  });

  await waitForHealth(port);
  return port;
}

/** 只给 127.0.0.1:<port> 注入 Authorization，别的请求一律不碰。 */
function installTokenInjection(port: number): void {
  const filter = { urls: [`http://127.0.0.1:${port}/*`] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({
      requestHeaders: { ...details.requestHeaders, Authorization: `Bearer ${apiToken}` },
    });
  });
}

function createWindow(baseUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    title: "CalDAV Desktop",
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--dsh-api-base=${baseUrl}`],
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    dialog.showErrorBox("页面加载失败", `${desc}（${code}）\n${baseUrl}`);
  });
  void win.loadURL(baseUrl);
  return win;
}

app.on("ready", async () => {
  try {
    if (isDev) {
      // 开发时后端/前端各自跑，主进程只负责窗口
      createWindow(DEV_RENDERER_URL);
      if (process.env.DSH_DEVTOOLS === "1") {
        BrowserWindow.getAllWindows()[0]?.webContents.openDevTools();
      }
      return;
    }

    serverPort = await startBackend();
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    installTokenInjection(serverPort);
    createWindow(baseUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox("启动失败", `本地服务没能起来：\n${msg}`);
    console.error(err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const baseUrl = serverPort ? `http://127.0.0.1:${serverPort}` : DEV_RENDERER_URL;
    createWindow(baseUrl);
  }
});

app.on("before-quit", () => {
  quitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

process.on("exit", () => {
  if (serverProcess) serverProcess.kill();
});
