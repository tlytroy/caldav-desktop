import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ApiTokenError } from "./errors.js";
import { atomicWriteFile } from "./storage-check.js";
import { workspaceFilePath } from "./workspace.js";

/**
 * 单用户 Bearer 令牌（D1 / SDS §3.1）
 * ==================================
 *
 * 解析顺序：环境变量 → 文件 → 生成。
 *  - 环境变量：任意 ≥32 字符、无空白（Docker/编排常用）
 *  - 文件：必须是 64 位小写 hex（`openssl rand -hex 32` 的产物）
 *  - 生成：crypto.randomBytes(32)
 *
 * 文件损坏且可写 → 改名保留现场后重新生成；不可写 → 内存 token，
 * 只在启动时打印一次，不阻塞启动（NAS 只读挂载也要能用）。
 * 任何情况下都不把 token 写进日志（除这一处一次性提示）。
 */

export interface ResolvedApiToken {
  token: string;
  source: "env" | "file" | "generated";
  tokenFile: string;
  /** 是否落盘。false = 内存 token，重启会变 */
  persisted: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ENV_TOKEN = /^\S{32,}$/;

export function apiTokenPath(): string {
  const explicit = process.env.API_TOKEN_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(path.dirname(workspaceFilePath()), "api-token.txt");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function writeTokenFile(file: string, token: string): boolean {
  try {
    atomicWriteFile(file, token + "\n");
    fs.chmodSync(file, 0o600);
    return true;
  } catch (err) {
    console.warn(
      `⚠ 无法写入 API token 文件（${file}）：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

function readTokenFile(file: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    console.warn(
      `⚠ 读取 API token 文件失败（${file}，${code ?? "UNKNOWN"}），将使用内存 token`,
    );
    return null;
  }

  const value = raw.trim();
  if (HEX64.test(value)) {
    // 兼容历史 0644：能改就收紧，改不了只警告（不因为权限位拒绝启动）
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      console.warn(`⚠ API token 文件权限不是 0600，且无法自动修复：${file}`);
    }
    return value;
  }

  // 文件存在但内容不合法：保留现场，稍后生成新 token
  const backup = `${file}.invalid-${Date.now()}`;
  try {
    fs.renameSync(file, backup);
    console.warn(`⚠ API token 文件内容不合法，已改名保留：${backup}`);
  } catch {
    console.warn(`⚠ API token 文件内容不合法，且无法改名：${file}`);
  }
  return null;
}

export function resolveApiToken(): ResolvedApiToken {
  const env = process.env.API_TOKEN?.trim();
  if (env) {
    if (!ENV_TOKEN.test(env)) {
      throw new ApiTokenError("API_TOKEN 必须至少 32 个字符且不含空白");
    }
    return { token: env, source: "env", tokenFile: "", persisted: false };
  }

  const tokenFile = apiTokenPath();
  const existing = readTokenFile(tokenFile);
  if (existing) {
    return { token: existing, source: "file", tokenFile, persisted: true };
  }

  const token = generateToken();
  const persisted = writeTokenFile(tokenFile, token);
  if (!persisted) {
    console.warn(
      "⚠ 本次使用内存访问令牌（重启后会变化）。请设置 API_TOKEN，或修复 data 目录写权限。",
    );
    console.warn(`   本次令牌：${token}`);
  }
  return {
    token,
    source: "generated",
    tokenFile,
    persisted,
  };
}

/** 常量时间比较；空值一律不通过（避免 sha256("") === sha256("")） */
export function tokenMatches(expected: string, candidate: string): boolean {
  if (!expected || !candidate) return false;
  const a = crypto.createHash("sha256").update(expected, "utf8").digest();
  const b = crypto.createHash("sha256").update(candidate, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}
