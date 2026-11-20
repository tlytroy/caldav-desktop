/**
 * 统一数据源验收脚本（端到端）
 *
 * 核心命题：**同一条记录在日历与看板里指向同一个 id**。
 *
 * 需要真实启动的服务：
 *   cd apps/server && node dist/index.js
 * 然后：
 *   node src/__tests__/workspace-acceptance.e2e.mjs
 */

const BASE = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const API = `${BASE}/api/workspace`;
const TOKEN = (process.env.VERIFY_TOKEN || process.env.API_TOKEN || "").trim();
if (!TOKEN) {
  console.error("缺少 VERIFY_TOKEN / API_TOKEN：v0.3 的 /api/* 需要 Bearer 认证。");
  console.error("推荐用 `bash scripts/run-e2e.sh` 一键起隔离服务并自动带 token。");
  process.exit(2);
}
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
    if (detail !== undefined) {
      console.log(`     ${JSON.stringify(detail).slice(0, 300)}`);
    }
  }
}

function section(title) {
  console.log("");
  console.log(`【${title}】`);
}

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const get = (p) => req("GET", p);
const post = (p, b) => req("POST", p, b);
const put = (p, b) => req("PUT", p, b);
const del = (p) => req("DELETE", p);

async function main() {
  console.log("════ 统一数据源验收 ════");
  console.log(`目标：${API}`);

  // ===== 1. 数据源可读 =====
  section("1. 数据源");
  {
    const info = await get("/info");
    check("数据源接口可用", info.status === 200, info.json);
    check(
      "数据源是 workspace.md（英文文件名）",
      typeof info.json.filePath === "string" &&
        info.json.filePath.endsWith("workspace.md"),
      info.json.filePath,
    );
  }

  // ===== 2. 创建条目 =====
  section("2. 创建条目");
  let taskId;
  let eventId;
  {
    const t = await post("/items", {
      title: "体检",
      kind: "task",
      start: "2026-10-28T09:00:00",
      end: "2026-10-28T10:00:00",
      priority: "mid",
    });
    check("创建任务成功", t.status === 201, t.json);
    taskId = t.json?.item?.id;
    check("自动生成 id", /^[0-9a-f]{8}$/.test(taskId || ""), taskId);

    const e = await post("/items", {
      title: "项目周会",
      kind: "event",
      start: "2026-10-26T10:00:00",
      end: "2026-10-26T11:00:00",
    });
    check("创建事件成功", e.status === 201, e.json);
    eventId = e.json?.item?.id;
  }

  // ===== 3. 核心命题：同一 id 出现在两个视图 =====
  section("3. 核心命题：日历与看板是同一份数据");
  {
    const cal = await get("/items?scope=calendar");
    const board = await get("/items?scope=board");

    const calIds = (cal.json.items || []).map((i) => i.id);
    const boardIds = (board.json.items || []).map((i) => i.id);

    check("日历视图包含任务条目", calIds.includes(taskId), {
      taskId,
      calIds,
    });
    check("看板视图包含任务条目", boardIds.includes(taskId), {
      taskId,
      boardIds,
    });
    check(
      "同一个 id 在两个视图里都出现（这正是旧架构的问题所在）",
      calIds.includes(taskId) && boardIds.includes(taskId),
      { calIds, boardIds },
    );

    // 事件只在日历
    check("事件出现在日历", calIds.includes(eventId));
    check("事件不出现在看板（kind=event）", !boardIds.includes(eventId));

    // 两边看到的标题一致
    const calTask = (cal.json.items || []).find((i) => i.id === taskId);
    const boardTask = (board.json.items || []).find((i) => i.id === taskId);
    check(
      "两个视图看到的是同一条记录（标题一致）",
      calTask?.title === boardTask?.title && calTask?.title === "体检",
      { calTitle: calTask?.title, boardTitle: boardTask?.title },
    );
  }

  // ===== 4. 没有绑定字段 =====
  section("4. 旧架构的绑定机制已移除");
  {
    const list = await get("/items");
    const items = list.json.items || [];
    const anyBinding = items.some(
      (i) => "kanbanTaskId" in i || "calendarEventUid" in i,
    );
    check("条目里没有任何绑定字段", !anyBinding, items[0]);
  }

  // ===== 5. 周期规则 =====
  section("5. 周期规则");
  {
    const r = await post("/items", {
      title: "晨会",
      kind: "event",
      start: "2026-10-05T09:00:00",
      end: "2026-10-05T10:00:00",
      recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    });
    check("创建带周期的条目", r.status === 201, r.json);
    const recId = r.json?.item?.id;

    // 展开
    const exp = await get(
      "/items?expand=true&start=2026-10-01&end=2026-10-31",
    );
    const instances = (exp.json.items || []).filter(
      (i) => (i.instanceId || i.id) === recId,
    );
    check("周期条目展开成多个实例", instances.length >= 8, {
      count: instances.length,
    });
    check(
      "展开的实例日期覆盖周一三五",
      instances.some((i) => i.instanceDate === "2026-10-05") &&
        instances.some((i) => i.instanceDate === "2026-10-07") &&
        instances.some((i) => i.instanceDate === "2026-10-09"),
      instances.map((i) => i.instanceDate),
    );

    // 预览
    const prev = await get(
      "/items/../recurrence/preview?rule=FREQ%3DMONTHLY%3BBYMONTHDAY%3D1&start=2026-10-01T09%3A00%3A00&weeks=8",
    );
    check("预览每月1号", prev.status === 200, prev.json);
    check(
      "每月1号预览含 11-01",
      (prev.json.dates || []).includes("2026-11-01"),
      prev.json.dates,
    );

    // 选项
    const opts = await get("/recurrence/options");
    check("周期选项可读", opts.status === 200 && opts.json.options.length > 5);
    check(
      "选项含「每周一、三、五」",
      opts.json.options.some((o) => o.label === "每周一、三、五"),
    );
    check(
      "选项含「每月1号」",
      opts.json.options.some((o) => o.label === "每月1号"),
    );
  }

  // ===== 6. Schema 防护 =====
  section("6. Schema 防护（AI 乱写）");
  {
    const bad = await post("/items", {
      title: "坏条目",
      kind: "不存在的类型",
    });
    check("非法 kind 被拒绝", bad.status === 400, bad.status);

    const unknown = await post("/items", {
      title: "带乱字段",
      随机字段: "值",
    });
    check("未知字段被拒绝", unknown.status === 400, unknown.status);
    check(
      "错误提示里列出了未知字段名",
      (unknown.json.errors || []).some((e) => e.includes("随机字段")),
      unknown.json.errors,
    );

    const badTime = await post("/items", {
      title: "坏时间",
      start: "2026/10/01",
    });
    check("非法时间格式被拒绝", badTime.status === 400);

    const badRrule = await post("/items", {
      title: "坏周期",
      recurrence: "每天",
    });
    check("非法 RRULE 被拒绝", badRrule.status === 400);
  }

  // ===== 7. 更新与删除 =====
  section("7. 更新与删除");
  {
    const upd = await put(`/items/${taskId}`, { title: "体检（改）" });
    check("更新标题", upd.status === 200 && upd.json.item.title === "体检（改）");

    const badUpd = await put(`/items/${taskId}`, { id: "aaaaaaaa" });
    check("不能改 id", badUpd.status === 400);

    const done = await put(`/items/${taskId}`, { done: true });
    check("标记完成", done.status === 200 && done.json.item.done === true);

    const rm = await del(`/items/${taskId}`);
    check("删除", rm.status === 200);

    const after = await get("/items");
    check(
      "删除后不再出现在任一视图",
      !(after.json.items || []).some((i) => i.id === taskId),
    );
  }

  // ===== 8. 校验报告 =====
  section("8. 校验报告（探测被改坏的数据）");
  {
    const v = await get("/validation");
    check("校验报告可读", v.status === 200, v.json);
    check(
      "报告统计总数",
      typeof v.json.total === "number",
      v.json,
    );
  }

  // ===== 汇总 =====
  console.log("");
  console.log("════════════════════════");
  console.log(`通过 ${pass} / 失败 ${fail}`);
  console.log("════════════════════════");
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("验收脚本异常：", e);
  process.exit(1);
});
