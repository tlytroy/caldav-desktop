#!/usr/bin/env node
/**
 * CalDAV 同步联网自检（**只读**）
 *
 * 前提：后端已启动（默认 http://localhost:3001），并且已在设置里填好 CalDAV
 * 地址 / 账号 / 日历。
 *
 * 只发 4 个请求：
 *   GET  /health
 *   GET  /api/caldav/status
 *   GET  /api/caldav/calendars
 *   POST /api/caldav/test        （PROPFIND，不写数据）
 *
 * **不会** push / pull 任何条目，不会改 workspace.md，也不会在远端创建对象。
 *
 * 用法：
 *   node scripts/verify-caldav-live.mjs
 *   node scripts/verify-caldav-live.mjs --base http://127.0.0.1:3001
 *
 * 想看真实同步：先按脚本结尾的「手工步骤」做一次，再删掉测试条目。
 */

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const base = arg("--base", process.env.APP_BASE_URL || "http://localhost:3001")
  .replace(/\/+$/, "");

let failed = false;

function pretty(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return s.length > 3000 ? `${s.slice(0, 3000)}\n... (截断)` : s;
}

async function call(label, method, path, body) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    console.log(`\n[${label}] ${method} ${path} → ${res.status} (${Date.now() - started}ms)`);
    console.log(pretty(json));
    if (!res.ok) failed = true;
    if (json && typeof json === "object" && json.degraded) {
      console.log("  ⚠ 服务器降级：本地数据不受影响");
      failed = true;
    }
    return json;
  } catch (e) {
    failed = true;
    console.log(`\n[${label}] ${method} ${path} → 请求失败：${e.message}`);
    return null;
  }
}

(async () => {
  console.log(`CalDAV 联网自检（只读）→ ${base}`);

  await call("健康检查", "GET", "/health");

  const status = await call("同步状态", "GET", "/api/caldav/status");
  if (status) {
    console.log("\n解读：");
    console.log(
      `  configured=${status.configured}  calendarUrl=${
        status.calendarUrl || "(自动发现第一个)"
      }  direction=${status.direction}`,
    );
    console.log(
      `  本地参与同步 ${status.localCount} 条，其中 ${status.pendingCount} 条有改动待推送`,
    );
    console.log(`  上次同步：${status.lastSyncAt || "从未"}`);
    if (!status.configured) {
      console.log("  ⚠ 未配置：到「设置 → 同步 → CalDAV」填地址与账号");
    }
  }

  await call("日历列表", "GET", "/api/caldav/calendars");
  await call("连接测试", "POST", "/api/caldav/test", {});

  console.log("\n下一步（手工，确认真实写入）：");
  console.log("  1. 日历页新建一条标题为「同步自检」的事件（明后天，避免与真实日程混淆）");
  console.log("  2. 点「推送 CalDAV」→ 手机上确认能看到");
  console.log("  3. 在手机上改标题 / 时间 → 回到应用点「拉取」→ 本地应同步更新");
  console.log("  4. 删除这条测试事件（应用里删 + 手机里删），避免留垃圾数据");

  console.log(failed ? "\n❌ 只读自检未全部通过（见上）" : "\n✅ 只读自检通过");
  process.exit(failed ? 1 : 0);
})();
