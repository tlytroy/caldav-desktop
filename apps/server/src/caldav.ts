import { DAVClient, DAVAccount, DAVCalendar } from "tsdav";

interface CalDAVConfig {
  url: string;
  username: string;
  password: string;
}

// Store current config
export let currentConfig: CalDAVConfig = {
  url: process.env.CALDAV_URL || "http://localhost:5232",
  username: process.env.CALDAV_USER || "",
  password: process.env.CALDAV_PASS || "",
};

export const davClient = new DAVClient({
  serverUrl: currentConfig.url,
  credentials: {
    username: currentConfig.username,
    password: currentConfig.password,
  },
  authMethod: "Basic",
});

// Store the account after login
export let currentAccount: DAVAccount | null = null;

// Update the client configuration
export function setServerConfig(config: CalDAVConfig) {
  currentConfig = config;
  davClient.serverUrl = config.url;
  davClient.credentials = {
    username: config.username,
    password: config.password,
  };
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
  });

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
      `✓ Connected to Radicale. Found ${calendars.length} calendar(s)`
    );
    calendars.forEach((cal: any) => {
      console.log(`  - ${cal.displayName || cal.url}`);
    });
    return calendars;
  } catch (error) {
    console.warn("⚠ Warning: Could not connect to Radicale");
    console.warn(`  URL: ${currentConfig.url}`);
    console.warn(`  User: ${currentConfig.username}`);
    console.warn(
      "  Ensure .env has correct CALDAV_URL, CALDAV_USER, CALDAV_PASS"
    );
    console.warn("  Server will continue running for development purposes");
    console.warn(
      `  Error: ${error instanceof Error ? error.message : String(error)}`
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

// Get current config (without password)
export function getCurrentConfig(): Omit<CalDAVConfig, "password"> {
  return {
    url: currentConfig.url,
    username: currentConfig.username,
  };
}
