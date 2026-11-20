import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveApiToken, tokenMatches } from "../auth.js";

let dir = "";
let tokenFile = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-auth-"));
  tokenFile = path.join(dir, "api-token.txt");
  delete process.env.API_TOKEN;
  process.env.API_TOKEN_FILE = tokenFile;
});

afterEach(() => {
  delete process.env.API_TOKEN;
  delete process.env.API_TOKEN_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveApiToken（S8）", () => {
  it("环境变量优先，且不落盘", () => {
    const token = "a".repeat(40);
    process.env.API_TOKEN = token;
    const got = resolveApiToken();
    expect(got.token).toBe(token);
    expect(got.source).toBe("env");
    expect(fs.existsSync(tokenFile)).toBe(false);
  });

  it("环境变量太短 / 含空白 → 明确报错", () => {
    process.env.API_TOKEN = "short";
    expect(() => resolveApiToken()).toThrow(/至少 32 个字符/);
    process.env.API_TOKEN = "a".repeat(20) + " " + "b".repeat(20);
    expect(() => resolveApiToken()).toThrow(/不含空白/);
  });

  it("首次生成 64 位 hex，落盘 0600", () => {
    const got = resolveApiToken();
    expect(got.token).toMatch(/^[0-9a-f]{64}$/);
    expect(got.source).toBe("generated");
    expect(got.persisted).toBe(true);
    expect(fs.readFileSync(tokenFile, "utf-8").trim()).toBe(got.token);
    if (process.platform !== "win32") {
      expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
    }
  });

  it("已有合法文件 → 复用，不重新生成", () => {
    const first = resolveApiToken();
    const second = resolveApiToken();
    expect(second.token).toBe(first.token);
    expect(second.source).toBe("file");
  });

  it("文件被改成 0644 → 仍然可用，并尝试收紧", () => {
    const first = resolveApiToken();
    fs.chmodSync(tokenFile, 0o644);
    const second = resolveApiToken();
    expect(second.token).toBe(first.token);
  });

  it("文件内容损坏 → 改名保留现场并重新生成", () => {
    fs.writeFileSync(tokenFile, "not-a-token\n", "utf-8");
    const got = resolveApiToken();
    expect(got.token).toMatch(/^[0-9a-f]{64}$/);
    const invalid = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("api-token.txt.invalid-"));
    expect(invalid.length).toBe(1);
    expect(fs.readFileSync(path.join(dir, invalid[0]!), "utf-8")).toContain(
      "not-a-token",
    );
  });

  it("目录不可写（父路径是文件）→ 内存 token，不阻塞启动", () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    process.env.API_TOKEN_FILE = path.join(blocker, "api-token.txt");
    const got = resolveApiToken();
    expect(got.token).toMatch(/^[0-9a-f]{64}$/);
    expect(got.persisted).toBe(false);
  });
});

describe("tokenMatches", () => {
  it("正确 token 通过", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
  });
  it("错误 / 空 candidate 一律拒绝（空串不能靠 sha256 相等蒙混）", () => {
    expect(tokenMatches("abc123", "abc124")).toBe(false);
    expect(tokenMatches("abc123", "")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});
