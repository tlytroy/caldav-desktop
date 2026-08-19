import { DAVClient, DAVAccount, DAVCalendar } from "tsdav";
import { createProxyFetch } from "./proxy-fetch";

interface CalDAVConfig {
  url: string;
  username: string;
  password: string;
}

// Create a proxy-aware fetch if HTTPS_PROXY is set
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const HTTP_PROXY = process.env.HTTP_PROXY || process.env.http_proxy || "";
const HAS_PROXY = !!(HTTPS_PROXY || HTTP_PROXY);
const proxyFetch = HAS_PROXY ? createProxyFetch() : undefined;

// Store current config
export let currentConfig: CalDAVConfig = {
  url: process.env.CALDAV_URL || "http://localhost:5232",
  username: process.env.CALDAV_USER || "",
  password: process.env.CALDAV_PASS || "",
};

// Lazy-initialized DAVClient - created on first use
let _davClient: DAVClient | null = null;

function getDavClient(): DAVClient {
  if (!_davClient) {
    _davClient = new DAVClient({
      serverUrl: currentConfig.url,
      credentials: {
        username: currentConfig.username,
        password: currentConfig.password,
      },
      authMethod: "Basic",
      ...(HAS_PROXY ? { fetch: proxyFetch } : {}),
    } as any);
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
  // Recreate client with new config
  _davClient = new DAVClient({
    serverUrl: config.url,
    credentials: {
      username: config.username,
      password: config.password,
    },
    authMethod: "Basic",
    ...(HAS_PROXY ? { fetch: proxyFetch } : {}),
  } as any);
  // Reset account to force re-authentication
  currentAccount = null;
}

// Test connection with given config
export async function testConnection(config: CalDAVConfig): Promise<{
  success: boolean;
  message: string;
  calendars?: DAVCalendar[];
}> {
  const testClient = new DAVClient({
    serverUrl: config.url,
    credentials: {
      username: config.username,
      password: config.password,
    },
    authMethod: "Basic",
    ...(HAS_PROXY ? { fetch: proxyFetch } : {}),
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
        serverUrl: currentConfig.url,
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
        serverUrl: currentConfig.url,
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

  const fetchFn = proxyFetch || globalThis.fetch;
  const authHeader =
    "Basic " +
    Buffer.from(`${currentConfig.username}:${currentConfig.password}`).toString(
      "base64",
    );

  const propResp = await fetchFn(baseUrl, {
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
      const icsResp = await fetchFn(fullUrl, {
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
