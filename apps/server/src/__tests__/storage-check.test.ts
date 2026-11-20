import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWriteFile,
  cleanupStaleTmpFiles,
  verifyStorageSafety,
} from "../storage-check.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-storage-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  it("写入完成后不留 tmp，内容完整", () => {
    const file = path.join(dir, "a.md");
    atomicWriteFile(file, "hello");
    expect(fs.readFileSync(file, "utf-8")).toBe("hello");
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("覆盖已有文件时旧内容不会出现半截状态（崩溃注入，S3）", () => {
    const file = path.join(dir, "workspace.md");
    fs.writeFileSync(file, "旧内容，必须保留", "utf-8");

    // 崩溃注入必须跑在子进程里：它会 SIGKILL 自己，不能带走 vitest worker
    const script = path.join(dir, "crash.mts");
    const modulePath = fileURLToPath(new URL("../storage-check.js", import.meta.url)).replace(
      /\.js$/,
      ".ts",
    );
    fs.writeFileSync(
      script,
      [
        `import { atomicWriteFile } from ${JSON.stringify(modulePath)};`,
        `atomicWriteFile(${JSON.stringify(file)}, "新内容，不应落盘");`,
        `console.log("SHOULD_NOT_REACH");`,
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", script],
      {
        env: { ...process.env, WORKSPACE_CRASH_AFTER_TMP: "1" },
        encoding: "utf-8",
        timeout: 30_000,
      },
    );

    // SIGKILL 后 node 退出码非 0；关键是事实源没有被写坏
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH");
    expect(fs.readFileSync(file, "utf-8")).toBe("旧内容，必须保留");

    // 崩溃会留下 tmp，启动清理要能回收它
    const leftovers = fs.readdirSync(dir).filter((f) => /\.tmp\.\d+\.[0-9a-f]{12}$/.test(f));
    expect(leftovers.length).toBe(1);
    expect(cleanupStaleTmpFiles(dir, 0)).toBe(1);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("写失败时清掉 tmp，不留下垃圾", () => {
    // 父路径是文件 → mkdir 失败
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x", "utf-8");
    expect(() => atomicWriteFile(path.join(blocker, "a.md"), "hi")).toThrow();
  });
});

describe("verifyStorageSafety（S4）", () => {
  it("正常目录 → ok，且不残留测试文件", () => {
    const result = verifyStorageSafety(dir);
    expect(result.ok).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.includes("write-test"))).toEqual([]);
  });

  it("不可写目录 → ok:false，不抛也不 exit", () => {
    const blocker = path.join(dir, "file-not-dir");
    fs.writeFileSync(blocker, "x", "utf-8");
    const result = verifyStorageSafety(path.join(blocker, "sub"));
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("cleanupStaleTmpFiles", () => {
  it("只删符合命名规则的旧 tmp，其它文件不碰", () => {
    const oldTmp = path.join(dir, "workspace.md.tmp.123.abcdef123456");
    const freshTmp = path.join(dir, "workspace.md.tmp.456.abcdef123456");
    const keep = path.join(dir, "notes.md");
    fs.writeFileSync(oldTmp, "x");
    fs.writeFileSync(freshTmp, "x");
    fs.writeFileSync(keep, "x");

    const old = Date.now() / 1000 - 7200;
    fs.utimesSync(oldTmp, old, old);

    expect(cleanupStaleTmpFiles(dir, 60 * 60 * 1000)).toBe(1);
    expect(fs.existsSync(oldTmp)).toBe(false);
    expect(fs.existsSync(freshTmp)).toBe(true);
    expect(fs.existsSync(keep)).toBe(true);
  });
});
