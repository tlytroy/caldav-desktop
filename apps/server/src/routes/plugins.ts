/**
 * 插件 API 路由
 *
 * 扫描项目目录下的 `plugins/*.json`，返回插件清单给前端注册。
 * 这样新增一个模块只需要：
 *   1. 放一个 plugins/xxx.json
 *   2.（可选）放一个 plugins/xxx.tsx
 * 不需要改任何核心代码。
 */

import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRouter = express.Router();

/** ESM 环境下没有 __dirname */
const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 插件目录：`apps/renderer/plugins/`
 *
 * 为什么在 renderer 目录内：插件是渲染进程的一部分，需要和主应用共享
 * node_modules（axios / react 等）。放在项目根会导致构建期
 * "Rollup failed to resolve import" 错误。
 */
/**
 * 插件目录：`apps/renderer/plugins/`
 *
 * 为什么在 renderer 目录内：插件是渲染进程的一部分，需要和主应用共享
 * node_modules（axios / react 等）。放在项目根会导致构建期
 * "Rollup failed to resolve import" 错误。
 *
 * 路径推导不能简单数层级 —— 运行时目录（cwd）可能是任意位置
 * （开发时是 apps/server，测试时可能是独立的 runtime/ 目录）。
 * 所以改成**向上查找 apps 目录**，找不到再退回相对推导。
 */
function pluginDir(): string {
  const custom = process.env.PLUGINS_DIR;
  if (custom) return path.resolve(custom);

  // 从当前目录向上找名为 "apps" 的目录
  let dir = currentDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "apps", "renderer", "plugins");
    if (fs.existsSync(path.join(dir, "apps"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 退化路径：apps/server/dist/routes → 上溯 3 级
  return path.resolve(currentDir, "..", "..", "..", "renderer", "plugins");
}

/** 读取并解析单个 manifest */
function readManifest(file: string): {
  id: string;
  manifest: any;
  error?: string;
} | null {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return { id: parsed?.id || path.basename(file, ".json"), manifest: parsed };
  } catch (e) {
    return {
      id: path.basename(file, ".json"),
      manifest: {},
      error: `解析失败：${(e as Error).message}`,
    };
  }
}

/**
 * GET /api/plugins
 * 返回所有插件清单。单个插件出错不影响其他插件。
 */
pluginRouter.get("/", (_req, res) => {
  const dir = pluginDir();
  const plugins: any[] = [];
  const errors: any[] = [];

  if (!fs.existsSync(dir)) {
    return res.json({
      success: true,
      plugins: [],
      errors: [],
      dir,
      message: "插件目录不存在（可选功能，不影响使用）",
    });
  }

  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  for (const f of files) {
    const file = path.join(dir, f);
    const result = readManifest(file);
    if (!result) continue;

    if (result.error) {
      errors.push({ file: f, error: result.error });
      continue;
    }

    // 基础校验
    const m = result.manifest;
    if (!m.id || !m.name) {
      errors.push({ file: f, error: "缺少 id 或 name" });
      continue;
    }
    if (!/^[a-z][a-z0-9-]*$/.test(m.id)) {
      errors.push({ file: f, error: `id "${m.id}" 格式不合法（只允许小写字母、数字、连字符）` });
      continue;
    }

    // 检查组件文件是否存在
    let hasComponent = false;
    if (m.component) {
      for (const ext of [".tsx", ".jsx", ".ts", ".js"]) {
        if (fs.existsSync(path.join(dir, `${m.component}${ext}`))) {
          hasComponent = true;
          break;
        }
      }
      if (!hasComponent) {
        errors.push({
          file: f,
          error: `组件 ${m.component}.tsx 不存在，将使用占位页面`,
          warning: true,
        });
      }
    }

    plugins.push({ ...m, __file: f, __hasComponent: hasComponent });
  }

  res.json({
    success: true,
    plugins,
    errors,
    dir,
  });
});
