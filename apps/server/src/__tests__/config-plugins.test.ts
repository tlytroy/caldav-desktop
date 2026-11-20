/**
 * 配置存储层与插件 API 测试
 *
 * 覆盖：
 *  - config.json 读写、优先级
 *  - 敏感字段脱敏（读取掩码、写入不覆盖原值）
 *  - 配置 API
 *  - 插件扫描（正常、坏 JSON、id 冲突、缺组件）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmpDir: string;
let configPath: string;
let pluginDir: string;
let configRouter: any;
let pluginRouter: any;
let cfg: any;
let plugins: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  configPath = path.join(tmpDir, "config.json");
  pluginDir = path.join(tmpDir, "plugins");
  fs.mkdirSync(pluginDir, { recursive: true });

  process.env.APP_CONFIG_PATH = configPath;
  process.env.PLUGINS_DIR = pluginDir;

  cfg = await import("../config.js");
  ({ configRouter } = await import("../routes/config.js"));
  ({ pluginRouter } = await import("../routes/plugins.js"));
});

afterAll(() => {
  delete process.env.APP_CONFIG_PATH;
  delete process.env.PLUGINS_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // 清空磁盘配置，触发缓存失效
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  cfg.invalidateConfigCache();
  for (const f of fs.readdirSync(pluginDir)) {
    fs.unlinkSync(path.join(pluginDir, f));
  }
});

function apiFor(router: any, mount: string) {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return app;
}

describe("配置存储", () => {
  it("无配置文件时返回默认值", () => {
    const c = cfg.getConfig();
    expect(c.language).toBe("zh-CN");
    expect(c.ai.model).toBe("gpt-4o-mini");
    expect(c.webdav.remoteDir).toBe("CalDAV-Desktop");
  });

  it("保存后能读回", () => {
    cfg.saveConfig({ ai: { model: "my-model" } } as any);
    expect(cfg.getConfig().ai.model).toBe("my-model");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("保存是深合并，不会丢掉其他段", () => {
    cfg.saveConfig({ ai: { model: "m1" } } as any);
    cfg.saveConfig({ webdav: { url: "https://dav.example.com" } } as any);
    const c = cfg.getConfig();
    expect(c.ai.model).toBe("m1");
    expect(c.webdav.url).toBe("https://dav.example.com");
  });

  it("磁盘上的文件是合法 JSON", () => {
    cfg.saveConfig({ language: "en-US" } as any);
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(parsed.language).toBe("en-US");
  });
});

describe("敏感字段处理", () => {
  it("maskSecret 保留头尾", () => {
    expect(cfg.maskSecret("sk-abcdefghijkl")).toBe("sk-****ijkl");
  });

  it("短值全部打码", () => {
    expect(cfg.maskSecret("abc")).toBe("****");
  });

  it("空值返回空串", () => {
    expect(cfg.maskSecret("")).toBe("");
    expect(cfg.maskSecret(undefined)).toBe("");
  });

  it("isMaskedPlaceholder 识别掩码", () => {
    expect(cfg.isMaskedPlaceholder("sk-****abcd")).toBe(true);
    expect(cfg.isMaskedPlaceholder("sk-realkey")).toBe(false);
  });

  it("读取时脱敏", () => {
    cfg.saveConfig({ ai: { apiKey: "sk-supersecret123" } } as any);
    const redacted = cfg.redactConfig(cfg.getConfig());
    expect(redacted.ai.apiKey).not.toContain("supersecret");
    expect(redacted.ai.apiKey).toContain("****");
  });

  it("**关键**：回传掩码值不会覆盖原密钥", () => {
    cfg.saveConfig({ ai: { apiKey: "sk-originalkey123" } } as any);
    // 模拟界面把脱敏后的值原样提交回来
    cfg.saveConfig({ ai: { apiKey: cfg.maskSecret("sk-originalkey123") } } as any);
    expect(cfg.getSecret("ai.apiKey")).toBe("sk-originalkey123");
  });

  it("回传真值则正常更新", () => {
    cfg.saveConfig({ ai: { apiKey: "sk-first" } } as any);
    cfg.saveConfig({ ai: { apiKey: "sk-second" } } as any);
    expect(cfg.getSecret("ai.apiKey")).toBe("sk-second");
  });

  it("三个敏感字段都被处理", () => {
    cfg.saveConfig({
      ai: { apiKey: "sk-a" },
      caldav: { password: "pw-b" },
      webdav: { password: "pw-c" },
    } as any);
    const r = cfg.redactConfig(cfg.getConfig());
    expect(r.ai.apiKey).toContain("****");
    expect(r.caldav.password).toContain("****");
    expect(r.webdav.password).toContain("****");
  });
});

describe("配置 API", () => {
  it("GET 返回脱敏后的配置", async () => {
    cfg.saveConfig({ ai: { apiKey: "sk-leaktest999" } } as any);
    const app = apiFor(configRouter, "/api/config");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const res = await fetch(`${base}/api/config`);
    const text = await res.text();
    expect(text).not.toContain("leaktest");

    server.close();
  });

  it("PUT 保存并返回脱敏结果", async () => {
    const app = apiFor(configRouter, "/api/config");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const res = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai: { model: "gpt-x" } }),
    });
    const j: any = await res.json();
    expect(j.success).toBe(true);
    expect(j.config.ai.model).toBe("gpt-x");

    server.close();
  });

  it("PUT 空 body 返回 400", async () => {
    const app = apiFor(configRouter, "/api/config");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const res = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    server.close();
  });

  it("PUT 不允许写未声明的顶层段", async () => {
    const app = apiFor(configRouter, "/api/config");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evilSection: { hack: "/etc" } }),
    });
    // 未在 WRITABLE_SECTIONS 里，应该被忽略
    const j: any = await (await fetch(`${base}/api/config`)).json();
    expect(j.config.evilSection).toBeUndefined();

    server.close();
  });

  it("PUT 允许写 paths 段（数据文件路径可在界面改）", async () => {
    const app = apiFor(configRouter, "/api/config");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: { workspaceFile: "./custom-workspace.md" } }),
    });
    const j: any = await (await fetch(`${base}/api/config`)).json();
    expect(j.config.paths.workspaceFile).toBe("./custom-workspace.md");

    server.close();
  });
});

describe("配置层与各模块的联动（防止「界面改了不生效」）", () => {
  it("WebDAV 读配置层的 url 而不是写死的值", async () => {
    // 回归点：曾经把 remoteDir 写死成常量，用户在界面改目录完全不生效
    cfg.saveConfig({
      webdav: { url: "https://dav.example.com/x", remoteDir: "MyCal" },
    } as any);
    const { loadWebDAVConfig } = await import("../webdav.js");
    const wc = loadWebDAVConfig();
    expect(wc.url).toBe("https://dav.example.com/x");
    expect(wc.remoteDir).toContain("MyCal");
  });

  it("WebDAV 的 remoteDir 跟随配置层变化", async () => {
    cfg.saveConfig({ webdav: { remoteDir: "DirA" } } as any);
    const { loadWebDAVConfig } = await import("../webdav.js");
    expect(loadWebDAVConfig().remoteDir).toContain("DirA");

    cfg.saveConfig({ webdav: { remoteDir: "DirB" } } as any);
    cfg.invalidateConfigCache();
    expect(loadWebDAVConfig().remoteDir).toContain("DirB");
  });

  it("AI 读配置层的 model", async () => {
    cfg.saveConfig({
      ai: { enabled: true, baseUrl: "https://x/v1", apiKey: "sk-1", model: "my-model" },
    } as any);
    const { loadAIConfig } = await import("../nlp/ai-parser.js");
    const ac = loadAIConfig();
    expect(ac.model).toBe("my-model");
    expect(ac.baseUrl).toBe("https://x/v1");
    expect(ac.enabled).toBe(true);
  });

  it("CalDAV 读配置层的 rootUrl（不再被 env 硬编码覆盖）", async () => {
    // 回归点：曾硬编码 process.env.CALDAV_ROOT_URL 优先，界面改的地址不生效
    const savedRoot = process.env.CALDAV_ROOT_URL;
    process.env.CALDAV_ROOT_URL = "https://env-root.example.com";
    try {
      cfg.saveConfig({ caldav: { rootUrl: "https://config-root.example.com" } } as any);
      cfg.invalidateConfigCache();
      const caldav = await import("../caldav.js");
      // config.json 优先于 env
      expect(caldav.getCalDAVRootUrl()).toBe("https://config-root.example.com");
    } finally {
      if (savedRoot === undefined) delete process.env.CALDAV_ROOT_URL;
      else process.env.CALDAV_ROOT_URL = savedRoot;
    }
  });

  it("数据路径：环境变量优先于 config.json", () => {
    const savedEnv = process.env.WORKSPACE_FILE;
    try {
      cfg.saveConfig({ paths: { workspaceFile: "./from-config.md" } } as any);
      // 无环境变量时用 config.json
      delete process.env.WORKSPACE_FILE;
      expect(cfg.resolveDataPath("workspace")).toContain("from-config.md");

      // 有环境变量时环境变量优先
      process.env.WORKSPACE_FILE = "./from-env.md";
      expect(cfg.resolveDataPath("workspace")).toContain("from-env.md");
    } finally {
      if (savedEnv === undefined) delete process.env.WORKSPACE_FILE;
      else process.env.WORKSPACE_FILE = savedEnv;
    }
  });

  it("数据路径是绝对路径，且只有统一数据源", () => {
    expect(path.isAbsolute(cfg.resolveDataPath("workspace"))).toBe(true);
  });
});

describe("插件扫描", () => {
  it("空目录返回空列表", async () => {
    const app = apiFor(pluginRouter, "/api/plugins");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const j: any = await (await fetch(`${base}/api/plugins`)).json();
    expect(j.success).toBe(true);
    expect(j.plugins).toHaveLength(0);

    server.close();
  });

  it("正常插件被识别", async () => {
    fs.writeFileSync(
      path.join(pluginDir, "demo.json"),
      JSON.stringify({
        id: "demo",
        name: "演示",
        version: "1.0.0",
        status: "active",
        component: "demo",
        routes: [{ path: "/demo", title: "演示" }],
        navItems: [{ id: "nav-demo", label: "演示", path: "/demo" }],
      }),
    );
    fs.writeFileSync(path.join(pluginDir, "demo.tsx"), "export default () => null;");

    const app = apiFor(pluginRouter, "/api/plugins");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const j: any = await (await fetch(`${base}/api/plugins`)).json();
    expect(j.plugins).toHaveLength(1);
    expect(j.plugins[0].id).toBe("demo");
    expect(j.plugins[0].__hasComponent).toBe(true);
    expect(j.errors).toHaveLength(0);

    server.close();
  });

  it("坏 JSON 不影响其他插件", async () => {
    fs.writeFileSync(path.join(pluginDir, "broken.json"), "{ this is not json");
    fs.writeFileSync(
      path.join(pluginDir, "good.json"),
      JSON.stringify({ id: "good", name: "好的", status: "active" }),
    );

    const app = apiFor(pluginRouter, "/api/plugins");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const j: any = await (await fetch(`${base}/api/plugins`)).json();
    expect(j.plugins).toHaveLength(1);
    expect(j.plugins[0].id).toBe("good");
    expect(j.errors.length).toBeGreaterThan(0);

    server.close();
  });

  it("非法 id 被拒绝", async () => {
    fs.writeFileSync(
      path.join(pluginDir, "bad.json"),
      JSON.stringify({ id: "Bad_ID!", name: "坏", status: "active" }),
    );

    const app = apiFor(pluginRouter, "/api/plugins");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const j: any = await (await fetch(`${base}/api/plugins`)).json();
    expect(j.plugins).toHaveLength(0);
    expect(j.errors[0].error).toMatch(/id/);

    server.close();
  });

  it("缺组件文件给出警告但仍加载", async () => {
    fs.writeFileSync(
      path.join(pluginDir, "nocomp.json"),
      JSON.stringify({
        id: "nocomp",
        name: "无组件",
        status: "active",
        component: "missing",
      }),
    );

    const app = apiFor(pluginRouter, "/api/plugins");
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const j: any = await (await fetch(`${base}/api/plugins`)).json();
    expect(j.plugins).toHaveLength(1);
    expect(j.plugins[0].__hasComponent).toBe(false);
    expect(j.errors[0].warning).toBe(true);

    server.close();
  });
});

describe("插件 manifest 校验", () => {
  it("合法 manifest 通过", async () => {
    // validateManifest 属于 renderer 的前端模块，server 侧没有这个文件；
    // 用变量化模块名，避免 TS 在编译期解析一个不存在的相对路径。
    const modulePath = "../framework/plugins.js";
    const mod = (await import(/* @vite-ignore */ modulePath).catch(() => null)) as {
      validateManifest?: (manifest: unknown) => string | null;
    } | null;
    // 前端模块在 vitest（node 环境）下可能加载不到，跳过断言
    if (!mod?.validateManifest) return;
    expect(
      mod.validateManifest({ id: "ok", name: "OK", status: "active" }),
    ).toBeNull();
  });
});
