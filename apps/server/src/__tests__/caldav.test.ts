import { describe, it, expect, beforeEach } from "vitest";
import { currentConfig, getCurrentConfig, currentAccount } from "../caldav.js";

describe("caldav config", () => {
  beforeEach(() => {
    // Reset config to defaults for each test
    currentConfig.url = "http://localhost:5232";
    currentConfig.username = "";
    currentConfig.password = "";
  });

  it("should have default config values", () => {
    expect(currentConfig.url).toBe("http://localhost:5232");
    expect(currentConfig.username).toBe("");
    expect(currentConfig.password).toBe("");
  });

  it("getCurrentConfig should return config without password", () => {
    currentConfig.username = "testuser";
    currentConfig.password = "secret123";

    const config = getCurrentConfig();

    expect(config.url).toBe("http://localhost:5232");
    expect(config.username).toBe("testuser");
    // Password should not be exposed
    expect(config).not.toHaveProperty("password");
  });

  it("should allow config values to be modified", () => {
    currentConfig.url = "https://custom-server.com:8443";
    currentConfig.username = "admin";

    expect(currentConfig.url).toBe("https://custom-server.com:8443");
    expect(currentConfig.username).toBe("admin");
  });

  it("currentAccount should be null initially", () => {
    expect(currentAccount).toBeNull();
  });
});
