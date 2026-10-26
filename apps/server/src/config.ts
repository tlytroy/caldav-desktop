/**
 * 统一配置存储层
 *
 * 设计目标：让配置**不只存在于 .env**。用户在设置界面里改完立即生效，
 * 不需要去翻文件、不需要重启（部分配置除外，见下）。
 *
 * 优先级（从高到低）：
 *   1. config.json 里的用户设置（界面写入）
 *   2. 环境变量（部署时注入，容器/K8s 场景）
 *   3. 项目根目录 .env
 *   4. 代码默认值
 *
 * 为什么 config.json 优先级高于环境变量：
 *   界面是用户的显式操作，应当覆盖部署时给的默认值。
 *   但环境变量可以覆盖 config.json 里的**部署级**配置（如数据目录）——
 *   为避免歧义，部署级配置（paths）只认环境变量，不写进 config.json。
 *
 * 敏感字段（apiKey / password）单独处理：
 *   - 读取时用掩码返回（`sk-****abcd`）
 *   - 写入时若收到掩码值则视为「未修改」，保留原值
 *   - config.json 默认加入 .gitignore
 *
 * @see REF/CONFIGURATION.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ESM 环境下没有 __dirname，用 import.meta.url 推导。
 * （`import.meta.dirname` 需要 Node 20.11+，这里用更通用的写法）
 */
const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** 配置结构（config.json 的形状） */
export interface AppConfig {
  /** 界面语言：zh-CN | en-US */
  language: string;
  /** 界面主题：light | dark | system */
  theme: "light" | "dark" | "system";
  /** 配色方案 key（对应 themeStore 的 morandiSchemes） */
  colorScheme: string;
  /** 自定义圆角 */
  borderRadius: string;

  /** AI 解析配置 */
  ai: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    temperature: number;
    whisperModel: string;
    whisperLanguage: string;
  };

  /** CalDAV 同步 */
  caldav: {
    rootUrl: string;
    username: string;
    password: string;
    /** 同步方向 */
    syncDirection: "push" | "pull" | "bidirectional";
    /** 自动同步间隔（分钟），0 = 仅手动 */
    autoSyncMinutes: number;
  };

  /** WebDAV 同步 */
  webdav: {
    enabled: boolean;
    url: string;
    username: string;
    password: string;
    remoteDir: string;
    timeoutMs: number;
  };

  /** 自然语言解析 */
  nlp: {
    /** 是否优先用 AI 解析（false = 本地规则优先） */
    preferAI: boolean;
    /** 解析语言，用于选择解析器 */
    parserLocale: string;
  };

  /**
   * 数据文件路径。
   *
   * 这些是「部署级」配置：可以放 config.json，但**环境变量优先**，
   * 因为容器部署时通常用环境变量指定挂载位置。
   */
  paths: {
    /**
     * 统一数据源文件（workspace.md）。
     *
     * 事件与任务在同一个条目池里，日历 / 看板 / 快速创建都只是它的视图。
     */
    workspaceFile: string;
    /** @deprecated 旧的事件文件，迁移用 */
    eventsFile: string;
    /** @deprecated 旧的工作搭子看板文件，迁移用 */
    kanbanFile: string;
  };
}

/** 默认配置 */
export const DEFAULT_CONFIG: AppConfig = {
  language: "zh-CN",
  theme: "system",
  colorScheme: "classic",
  borderRadius: "rounded-lg",
  ai: {
    enabled: false,
    baseUrl: "",
    apiKey: "",
    model: "gpt-4o-mini",
    timeoutMs: 30000,
    temperature: 0.1,
    whisperModel: "whisper-1",
    whisperLanguage: "zh",
  },
  caldav: {
    rootUrl: "",
    username: "",
    password: "",
    syncDirection: "bidirectional",
    autoSyncMinutes: 0,
  },
  webdav: {
    enabled: false,
    url: "",
    username: "",
    password: "",
    remoteDir: "CalDAV-Desktop",
    timeoutMs: 20000,
  },
  nlp: {
    preferAI: false,
    parserLocale: "zh-CN",
  },
  paths: {
    workspaceFile: "./workspace.md",
    eventsFile: "./events.md",
    kanbanFile: "./工作搭子看板.md",
  },
};

/** 敏感字段清单：读取时掩码，写入时识别"未修改" */
const SECRET_FIELDS = ["ai.apiKey", "caldav.password", "webdav.password"] as const;

export type SecretField = (typeof SECRET_FIELDS)[number];

/**
 * 项目根目录（包含 apps/ 与 plugins/ 的那一层）。
 *
 * 不能简单数层级 —— 运行时目录（cwd）可能是任意位置。
 * 改成**向上查找 apps 目录**，找不到再退回相对推导。
 */
function projectRoot(): string {
  let dir = currentDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "apps"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 退化路径：apps/server/src → 上溯 2 级
  return path.resolve(currentDir, "..", "..");
}

/** config.json 完整路径 */
export function configFilePath(): string {
  return (
    process.env.APP_CONFIG_PATH ||
    path.join(projectRoot(), "config.json")
  );
}

/** 深合并：用户配置覆盖默认值 */
function deepMerge<T>(base: T, override: any): T {
  if (!override || typeof override !== "object") return base;
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    const bv = (base as any)[key];
    const ov = override[key];
    if (
      ov &&
      typeof ov === "object" &&
      !Array.isArray(ov) &&
      bv &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out as T;
}

/** 从 .env 解析（不依赖 dotenv 已在别处加载，这里做兜底） */
function readDotEnv(): Record<string, string> {
  const envPath = path.join(projectRoot(), ".env");
  const out: Record<string, string> = {};
  try {
    if (!fs.existsSync(envPath)) return out;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // 去掉可能的引号
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * 从 .env + 环境变量构造基础配置。
 * 这是"配置文件之外的来源"，优先级低于 config.json。
 */
function configFromEnv(): Partial<AppConfig> {
  const dotenv = readDotEnv();
  // 环境变量优先于 .env
  const get = (key: string): string | undefined =>
    process.env[key] ?? dotenv[key];

  const aiEnabled = get("AI_ENABLED") === "true" || !!get("AI_API_KEY");
  const webdavUrl = get("WEBDAV_URL") || "";

  return {
    language: get("APP_LANGUAGE") || DEFAULT_CONFIG.language,
    ai: {
      enabled: aiEnabled,
      baseUrl: get("AI_BASE_URL") || "",
      apiKey: get("AI_API_KEY") || "",
      model: get("AI_MODEL") || DEFAULT_CONFIG.ai.model,
      timeoutMs: parseInt(get("AI_TIMEOUT_MS") || "30000", 10) || 30000,
      temperature: parseFloat(get("AI_TEMPERATURE") || "0.1") || 0.1,
      whisperModel: get("AI_WHISPER_MODEL") || DEFAULT_CONFIG.ai.whisperModel,
      whisperLanguage: get("AI_WHISPER_LANGUAGE") || DEFAULT_CONFIG.ai.whisperLanguage,
    },
    caldav: {
      rootUrl: get("CALDAV_ROOT_URL") || get("CALDAV_URL") || "",
      username: get("CALDAV_USER") || "",
      password: get("CALDAV_PASS") || "",
      syncDirection:
        (get("MD_ICS_SYNC_DIRECTION") as any) || DEFAULT_CONFIG.caldav.syncDirection,
      autoSyncMinutes:
        parseInt(get("MD_ICS_AUTO_SYNC_MINUTES") || "0", 10) || 0,
    },
    webdav: {
      enabled: !!webdavUrl,
      url: webdavUrl,
      username: get("WEBDAV_USER") || "",
      password: get("WEBDAV_PASS") || "",
      remoteDir:
        get("WEBDAV_EVENTS_PATH")?.split("/")[0] ||
        DEFAULT_CONFIG.webdav.remoteDir,
      timeoutMs: parseInt(get("WEBDAV_TIMEOUT_MS") || "20000", 10) || 20000,
    },
  };
}

/** 读取磁盘上的 config.json（不含合并） */
function readRawConfig(): Partial<AppConfig> {
  try {
    const p = configFilePath();
    if (!fs.existsSync(p)) return {};
    const text = fs.readFileSync(p, "utf-8").trim();
    if (!text) return {};
    return JSON.parse(text);
  } catch (e) {
    console.warn(
      "[config] 读取 config.json 失败，使用默认配置：",
      (e as Error).message,
    );
    return {};
  }
}

/** 缓存的完整配置 */
let cached: AppConfig | null = null;
let cachedAt = 0;
const CACHE_TTL = 1000; // 1 秒，够用且能感知外部改动

/**
 * 获取完整配置（已合并所有来源）。
 */
export function getConfig(): AppConfig {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL) return cached;

  const merged = deepMerge(
    deepMerge(DEFAULT_CONFIG, configFromEnv()),
    readRawConfig(),
  );
  cached = merged;
  cachedAt = now;
  return merged;
}

/** 使缓存失效（保存配置后调用） */
export function invalidateConfigCache(): void {
  cached = null;
  cachedAt = 0;
}

/** 按路径读取字段，如 getField("ai.baseUrl") */
export function getField<T = any>(fieldPath: string): T | undefined {
  const parts = fieldPath.split(".");
  let cur: any = getConfig();
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur as T;
}

/** 掩码敏感值：sk-abcdefghijk → sk-****hijk */
export function maskSecret(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  const head = value.slice(0, 3);
  const tail = value.slice(-4);
  return `${head}****${tail}`;
}

/** 判断一个值是否是"掩码占位"（即用户没改） */
export function isMaskedPlaceholder(value: string): boolean {
  return value.includes("****");
}

/** 对配置做脱敏处理，供返回给前端 */
export function redactConfig(cfg: AppConfig): AppConfig {
  const out = JSON.parse(JSON.stringify(cfg)) as AppConfig;
  for (const f of SECRET_FIELDS) {
    const parts = f.split(".");
    let obj: any = out;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    const last = parts[parts.length - 1];
    if (obj[last]) obj[last] = maskSecret(obj[last]);
  }
  return out;
}

/**
 * 保存配置到 config.json。
 *
 * 敏感字段的特殊处理：若提交的值是掩码形式（含 `****`），
 * 则视为「用户没有修改这一项」，保留磁盘上的原值。
 */
export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const current = getConfig();
  const merged = deepMerge(current, patch);

  // 处理掩码占位：还原为原值
  for (const f of SECRET_FIELDS) {
    const parts = f.split(".");
    const incoming = (patch as any)?.[parts[0]]?.[parts[1]];
    if (typeof incoming === "string" && isMaskedPlaceholder(incoming)) {
      // 保留 current 里的原值
      const orig = (current as any)[parts[0]]?.[parts[1]];
      let obj: any = merged as any;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = orig;
    }
  }

  const p = configFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), "utf-8");
  invalidateConfigCache();
  return merged;
}

/** 读取单个敏感字段的明文（仅服务端内部使用） */
export function getSecret(field: SecretField): string {
  const parts = field.split(".");
  let cur: any = getConfig();
  for (const p of parts) {
    if (cur == null) return "";
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : "";
}

/**
 * 解析数据文件路径。
 *
 * 优先级：**环境变量 > config.json > 默认值**。
 * 与其他配置相反 —— 路径是「部署级」配置，容器部署时通常用环境变量
 * 指定挂载位置，环境变量应当优先。
 *
 * 相对路径基于**进程 cwd** 解析（与 .env 里的写法一致）。
 */
export function resolveDataPath(
  kind: "workspace" | "events" | "kanban",
): string {
  const envKey =
    kind === "workspace"
      ? "WORKSPACE_FILE"
      : kind === "events"
        ? "MD_EVENTS_FILE"
        : "KANBAN_FILE_PATH";
  const envVal = process.env[envKey];
  if (envVal && envVal.trim()) {
    const p = envVal.trim();
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  }

  const cfg = getConfig();
  const raw =
    (kind === "workspace"
      ? cfg.paths?.workspaceFile
      : kind === "events"
        ? cfg.paths?.eventsFile
        : cfg.paths?.kanbanFile) || "";
  if (raw.trim()) {
    const p = raw.trim();
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  }

  return path.resolve(
    process.cwd(),
    kind === "workspace"
      ? "workspace.md"
      : kind === "events"
        ? "events.md"
        : "工作搭子看板.md",
  );
}

/** 配置是否存在于磁盘 */
export function hasConfigFile(): boolean {
  return fs.existsSync(configFilePath());
}
