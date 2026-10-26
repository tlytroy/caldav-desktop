import { DAVClient, DAVAccount, DAVCalendar } from "tsdav";
import { getConfig } from "./config.js";

interface CalDAVConfig {
  url: string;
  username: string;
  password: string;
}

/**
 * 从统一配置层读取 CalDAV 配置。
 *
 * ⚠️ 之前这里直接读 `process.env.CALDAV_ROOT_URL`，导致**界面里改的地址不生效**
 *    （env 的 rootUrl 永远优先）。现在改为：
 *      rootUrl = config.json > env CALDAV_ROOT_URL > env CALDAV_URL
 *    并把 calendar URL 与 root URL 分开存：
 *      - url      指向具体日历（含 /root/<principal>/<calendar>/）
 *      - rootUrl  用于 tsdav 的 PROPFIND 发现（不含日历路径）
 */
function readCalDAVSettings(): CalDAVConfig & { rootUrl: string } {
  const cfg = getConfig();
  const envRoot = process.env.CALDAV_ROOT_URL || "";
  const envUrl = process.env.CALDAV_URL || "";

  const url = cfg.caldav.rootUrl || envUrl || "http://localhost:5232";
  const rootUrl = cfg.caldav.rootUrl || envRoot || url;

  return {
    url,
    rootUrl,
    username: cfg.caldav.username || process.env.CALDAV_USER || "",
    password: cfg.caldav.password || process.env.CALDAV_PASS || "",
  };
}

const initial = readCalDAVSettings();

// Store current config
export let currentConfig: CalDAVConfig = {
  url: initial.url,
  username: initial.username,
  password: initial.password,
};

/**
 * Separate root URL for tsdav PROPFIND discovery.
 *
 * ⚠️ 用函数而非常量 —— 界面改了 CalDAV 配置后要立即生效，
 *    常量版本会导致「改了不生效」（实测踩过）。
 *    内部用 `_caldavRootUrl` 缓存手动设置过的值（setServerConfig）。
 */
let _caldavRootUrl: string = initial.rootUrl;

/**
 * 读取当前的 root URL。
 *
 * 优先级：config.json（界面写入）> setServerConfig 手动值 > env > 默认。
 * 这样界面改完立即生效，而 setServerConfig 仍能作为程序化设置的入口。
 */
export function getCalDAVRootUrl(): string {
  const settings = readCalDAVSettings();
  // 配置层有值就用它（界面改的优先）
  if (settings.rootUrl) return settings.rootUrl;
  if (_caldavRootUrl) return _caldavRootUrl;
  return initial.rootUrl;
}

// Lazy-initialized DAVClient - created on first use
let _davClient: DAVClient | null = null;
/** 客户端创建时用的配置快照 —— 用于检测配置变化并重建 */
let _clientSignature = "";

/** 当前配置的指纹（变了就要重建客户端） */
function configSignature(): string {
  const s = readCalDAVSettings();
  return `${s.rootUrl}|${s.username}|${s.password}`;
}

function getDavClient(): DAVClient {
  const sig = configSignature();
  if (!_davClient || sig !== _clientSignature) {
    const s = readCalDAVSettings();
    _davClient = new DAVClient({
      serverUrl: s.rootUrl,
      credentials: {
        username: s.username,
        password: s.password,
      },
      authMethod: "Basic",
    } as any);
    _clientSignature = sig;
    // 地址或凭据变了，之前的登录态失效
    currentAccount = null;
  }
  return _davClient;
}

// Export a proxy that delegates to the lazy client
export const davClient = new Proxy({} as DAVClient, {
  get(_target, prop: keyof DAVClient) {
    const client = getDavClient();
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Store the account after login
export let currentAccount: DAVAccount | null = null;

// Update the client configuration
export function setServerConfig(config: CalDAVConfig) {
  currentConfig = config;
  // root URL 优先用配置层；界面填的 url 若含 /root/<principal>/ 则回退到它的上级
  const settings = readCalDAVSettings();
  _caldavRootUrl =
    settings.rootUrl ||
    config.url.replace(/\/root\/.*$/, "") ||
    config.url;
  // Recreate client with new config
  _davClient = new DAVClient({
    serverUrl: _caldavRootUrl,
    credentials: {
      username: config.username,
      password: config.password,
    },
    authMethod: "Basic",
  } as any);
  _clientSignature = configSignature();
  // Reset account to force re-authentication
  currentAccount = null;
}

// Test connection with given config
export async function testConnection(config: CalDAVConfig): Promise<{
  success: boolean;
  message: string;
  calendars?: DAVCalendar[];
}> {
  const settings = readCalDAVSettings();
  const testRootUrl =
    settings.rootUrl ||
    config.url.replace(/\/root\/.*$/, "") ||
    config.url;

  const testClient = new DAVClient({
    serverUrl: testRootUrl,
    credentials: {
      username: config.username,
      password: config.password,
    },
    authMethod: "Basic",
  } as any);

  try {
    await testClient.login();
    const calendars = await testClient.fetchCalendars();
    return {
      success: true,
      message: `成功连接！发现 ${calendars.length} 个日历`,
      calendars,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "连接失败",
    };
  }
}

export async function initializeClient() {
  try {
    // Try to authenticate first
    console.log("Attempting to connect to CalDAV server...");

    // First, we need to login
    await davClient.login();

    // Then create an account
    currentAccount = await davClient.createAccount({
      account: {
        serverUrl: getCalDAVRootUrl(),
        credentials: {
          username: currentConfig.username,
          password: currentConfig.password,
        },
        accountType: "caldav",
      },
      loadCollections: false,
      loadObjects: false,
    });

    const calendars = await davClient.fetchCalendars();
    console.log(
      `✓ Connected to CalDAV server. Found ${calendars.length} calendar(s)`,
    );
    calendars.forEach((cal: any) => {
      console.log(`  - ${cal.displayName || cal.url}`);
    });
    return calendars;
  } catch (error) {
    console.warn("⚠ Warning: Could not connect to CalDAV server");
    console.warn(`  URL: ${currentConfig.url}`);
    console.warn(`  User: ${currentConfig.username}`);
    console.warn(
      "  Ensure .env has correct CALDAV_URL, CALDAV_USER, CALDAV_PASS",
    );
    console.warn("  Server will continue running for development purposes");
    console.warn(
      `  Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

// Helper function to ensure we're logged in before making requests
export async function ensureAuthenticated(): Promise<DAVAccount> {
  if (!currentAccount) {
    await davClient.login();
    // Create account after login
    currentAccount = await davClient.createAccount({
      account: {
        serverUrl: getCalDAVRootUrl(),
        credentials: {
          username: currentConfig.username,
          password: currentConfig.password,
        },
        accountType: "caldav",
      },
      loadCollections: false,
      loadObjects: false,
    });
  }
  return currentAccount!;
}

/**
 * 直接通过 HTTP PROPFIND/GET 获取日历中的所有事件对象
 * 替代 tsdav 的 fetchCalendarObjects（在某些 Radicale 版本上返回日历集合自身而非事件对象）
 *
 * @param calendarUrl 日历 URL
 * @returns 事件对象数组（包含 url 和 data 属性）
 */
export async function fetchCalendarObjectsDirect(
  calendarUrl: string,
): Promise<Array<{ url: string; data: string }>> {
  const baseUrl = calendarUrl.endsWith("/") ? calendarUrl : calendarUrl + "/";

  // Step 1: PROPFIND to list all .ics files
  const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

  const authHeader =
    "Basic " +
    Buffer.from(`${currentConfig.username}:${currentConfig.password}`).toString(
      "base64",
    );

  const propResp = await fetch(baseUrl, {
    method: "PROPFIND",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
      Authorization: authHeader,
    },
    body: propfindBody,
  });

  const propXmlText = await propResp.text();

  // Extract all .ics file hrefs
  // Radicale uses default namespace (xmlns="DAV:") so href is <href>, not <d:href>
  // Other servers may use <d:href> or <D:href> etc.
  const hrefRegex = /<(?:[a-zA-Z]*:)?href>([^<]+\.ics)<\/(?:[a-zA-Z]*:)?href>/g;
  const results: Array<{ url: string; data: string }> = [];
  let hrefMatch;
  let matchCount = 0;

  while ((hrefMatch = hrefRegex.exec(propXmlText)) !== null) {
    matchCount++;
    if (matchCount > 100) {
      console.warn(
        `[fetchCalendarObjectsDirect] Too many matches (>100), stopping`,
      );
      break;
    }
    const icsUrl = hrefMatch[1];
    const fullUrl = icsUrl.startsWith("http")
      ? icsUrl
      : new URL(icsUrl, baseUrl).href;

    try {
      console.log(`[fetchCalendarObjectsDirect] Fetching ${fullUrl}`);
      const icsResp = await fetch(fullUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
        signal: AbortSignal.timeout(10000),
      });
      const icsData = await icsResp.text();
      console.log(
        `[fetchCalendarObjectsDirect] Got ${icsData.length} bytes from ${fullUrl}`,
      );
      results.push({ url: fullUrl, data: icsData });
    } catch (err) {
      console.warn(
        `[fetchCalendarObjectsDirect] Failed to fetch ${icsUrl}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return results;
}

// Get current config (without password)
export function getCurrentConfig(): Omit<CalDAVConfig, "password"> {
  return {
    url: currentConfig.url,
    username: currentConfig.username,
  };
}
