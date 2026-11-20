/**
 * 把 apps/server 打成单个 CommonJS 文件，供 Electron 打包进 resources/server/index.cjs。
 *
 * 为什么不直接拷 dist + node_modules：
 * - pnpm 的 node_modules 是符号链接 + 提升混合，electron-builder 复制过去经常缺依赖；
 * - 单文件没有路径解析问题，asar 里也能跑；
 * - 只打生产依赖，体积可控。
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const entry = path.join(repoRoot, "apps", "server", "src", "index.ts");
const outdir = path.join(here, "dist-server");
const outfile = path.join(outdir, "index.cjs");

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: false,
  minify: false,
  // electron 只在桌面侧存在；服务器不 import 它，显式外部化更安全
  external: ["electron"],
  define: { "process.env.NODE_ENV": '"production"' },
  banner: {
    js: "/* bundled by apps/desktop/build-bundle.mjs — do not edit */",
  },
  logLevel: "info",
});

const size = fs.statSync(outfile).size;
console.log(`[build-bundle] ${outfile} (${(size / 1024 / 1024).toFixed(2)} MB)`);
