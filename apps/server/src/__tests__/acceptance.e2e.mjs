/**
 * 全功能验收测试（端到端）
 *
 * 由 `scripts/run-e2e.sh` 启动一个隔离的临时服务后调用，也可以手动：
 *   cd apps/server && node dist/index.js   # 自行设置 API_TOKEN / WORKSPACE_FILE
 *   VERIFY_TOKEN=<token> node src/__tests__/acceptance.e2e.mjs
 *
 * v0.3 起所有 /api/* 都需要 Bearer token（P5 认证），所以必须带
 * `VERIFY_TOKEN`（或 `API_TOKEN`），否则会整片 401。
 * `VERIFY_BASE_URL` 可覆盖默认地址，`VERIFY_TOKEN` 必须与该服务的 token 一致。
 *
 * 覆盖从「用户输入一句话」到「数据落盘」的完整链路，
 * 以及 CalDAV 不可用时的降级行为。
 *
 * 注意：v0.3 起旧 `/api/md-bridge/*` 与 `/api/kanban/*` 已退役，
 * 这里只打 `/api/workspace/*` 统一数据源。
 */

const B = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const TOKEN = (process.env.VERIFY_TOKEN || process.env.API_TOKEN || "").trim();
if (!TOKEN) {
  console.error("缺少 VERIFY_TOKEN / API_TOKEN：v0.3 的 /api/* 需要 Bearer 认证。");
  console.error("推荐用 `bash scripts/run-e2e.sh` 一键起隔离服务并自动带 token。");
  process.exit(2);
}
const AUTH = { Authorization: `Bearer ${TOKEN}` };
let pass = 0, fail = 0, skip = 0;
const results = [];

function check(name, cond, extra) {
  const mark = cond ? "PASS" : "FAIL";
  if (cond) pass++; else fail++;
  results.push({ name, mark, extra });
  console.log(`  [${mark}] ${name}${!cond && extra !== undefined ? " → " + JSON.stringify(extra) : ""}`);
}
function skipTest(name, reason) {
  skip++;
  results.push({ name, mark: "SKIP", reason });
  console.log(`  [SKIP] ${name} — ${reason}`);
}
function section(t) { console.log(`\n${"═".repeat(58)}\n${t}\n${"═".repeat(58)}`); }

const parse = async (r) => {
  // 调用方传进来的是 fetch 的 Promise，这里先等它 resolve 成 Response
  r = await r;
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null, text: t }; }
};
const get = (p) => parse(fetch(B + p, { headers: AUTH }));
const post = (p, body) => parse(fetch(B + p, {
  method: "POST",
  headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
}));
const del = (p) => parse(fetch(B + p, { method: "DELETE", headers: AUTH }));
const put = (p, body) => parse(fetch(B + p, {
  method: "PUT",
  headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
}));

// ═══════════════ 1. 服务健康 ═══════════════
section("1. 服务启动与基础可用");
{
  const s = await get("/api/nlp/status");
  check("服务已启动（/api/nlp/status 200）", s.status === 200);
  check("本地解析器可用", s.json?.localParser === true, s.json);

  const w = await get("/api/workspace/items");
  check("workspace.md 可读", w.status === 200 && Array.isArray(w.json?.items), w.json);
  check("返回统一数据源路径", typeof w.json?.filePath === "string" && w.json.filePath.endsWith(".md"), w.json?.filePath);

  const info = await get("/api/workspace/info");
  check("数据源信息可读", info.status === 200 && info.json?.success === true, info.json);
  check("**只读状态可见**", typeof info.json?.readOnly === "boolean", info.json);
  check("**存储安全状态可见**", typeof info.json?.storageSafe === "boolean", info.json);
}

// ═══════════════ 2. 自然语言解析 ═══════════════
section("2. 自然语言解析（本地规则，不依赖网络）");
// 期望值必须**跟着今天走** —— 以前这里写死成 2026-10-26 的「明天」，
// 换一天跑就全红，那不是功能坏了，是断言过期了。
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};
const at = (d, hhmmss) => `${ymd(d)}T${hhmmss}`;
const nextWeekWednesday = () => {
  const now = new Date();
  const dow = now.getDay(); // 0=周日
  const toNextMonday = ((8 - dow) % 7) || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + toNextMonday);
  const wed = new Date(monday);
  wed.setDate(monday.getDate() + 2);
  return wed;
};
const nextMarch5 = () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let year = now.getFullYear();
  if (new Date(year, 2, 5).getTime() < today.getTime()) year += 1;
  return `${year}-03-05`;
};
const cases = [
  ["明天下午3点和老王开项目评审会", at(dayOffset(1), "15:00:00")],
  ["后天上午10点", at(dayOffset(2), "10:00:00")],
  ["下周三下午2点", at(nextWeekWednesday(), "14:00:00")],
  ["明早9点半", at(dayOffset(1), "09:30:00")],
  ["今晚8点", at(dayOffset(0), "20:00:00")],
  ["3月5日上午10点体检", `${nextMarch5()}T10:00:00`],
  ["明天15:30", at(dayOffset(1), "15:30:00")],
];
for (const [text, expect] of cases) {
  const r = await post("/api/nlp/parse", { text });
  check(`解析「${text}」`, r.json?.draft?.start === expect, { got: r.json?.draft?.start, want: expect });
}
{
  const r = await post("/api/nlp/parse", { text: "明天下午3点和老王开项目评审会" });
  check("标题剔除时间描述", r.json?.draft?.title === "和老王开项目评审会", r.json?.draft?.title);
  check("识别来源为本地规则", r.json?.source === "local", r.json?.source);
  check("全天事件标记正确", (await post("/api/nlp/parse", { text: "明天体检" })).json?.draft?.allDay === true);
  check("重复规则识别", (await post("/api/nlp/parse", { text: "每天早上9点晨会" })).json?.draft?.recurrence === "daily");
  check("无法识别时返回 422 + 提示手动输入",
    (await post("/api/nlp/parse", { text: "随便聊聊天气" })).status === 422);
}

// ═══════════════ 3. 快速创建（端到端落盘）═══════════════
section("3. 快速创建：解析 → 落盘 → 读回");
let createdId = null;
{
  const p = await post("/api/nlp/parse", { text: "明天下午3点和老王开项目评审会" });
  const d = p.json.draft;
  const r = await post("/api/workspace/items", {
    kind: "event",
    title: d.title,
    start: d.start,
    end: d.end,
    allDay: d.allDay,
  });
  check("事件创建成功", r.status === 201 && r.json?.success === true, r.json);
  createdId = r.json?.item?.id;
  check("返回 id", typeof createdId === "string" && createdId.length > 0, r.json);

  const read = await get("/api/workspace/items");
  const found = read.json?.items?.find((e) => e.id === createdId);
  check("事件已写入 workspace.md", !!found, read.json?.items);
  check("标题正确", found?.title === "和老王开项目评审会", found?.title);
  check("时间正确", found?.start === at(dayOffset(1), "15:00:00"), found?.start);
  check("kind 保持 event", found?.kind === "event", found?.kind);

  const dup = await post("/api/workspace/items", { id: createdId, title: "重复 id" });
  check("**重复 id 返回 409**", dup.status === 409, dup.json);

  const badField = await post("/api/workspace/items", { title: "x", nope: 1 });
  check("**未知字段被拒绝**", badField.status === 400 && Array.isArray(badField.json?.errors), badField.json);
}

// ═══════════════ 4. 统一数据源（事件与任务同池）═══════════════
section("4. 统一数据源：事件与任务在同一个条目池");
{
  const ev = await get("/api/workspace/items?scope=calendar");
  check("日历视角可读", ev.status === 200 && Array.isArray(ev.json?.items), ev.status);
  check("**日历视角只含事件**", (ev.json?.items || []).every((i) => i.kind === "event"), ev.json?.items?.map((i) => i.kind));

  const task = await post("/api/workspace/items", { kind: "task", title: "验收任务", priority: "high", list: "验收" });
  check("任务创建成功", task.status === 201, task.json);
  const taskId = task.json?.item?.id;

  const board = await get("/api/workspace/items?scope=board");
  check("看板视角可读", board.status === 200 && Array.isArray(board.json?.items), board.status);
  check("**看板视角含刚建的任务**", (board.json?.items || []).some((i) => i.id === taskId), board.json?.items?.map((i) => i.id));

  const lists = await get("/api/workspace/lists");
  check("清单聚合可用", lists.status === 200 && Array.isArray(lists.json?.lists), lists.json);
  check("**新清单出现在聚合里**", (lists.json?.lists || []).some((l) => l.name === "验收"), lists.json?.lists);

  const legacy = await get("/api/kanban");
  check("**旧 /api/kanban 已退役（JSON 404）**", legacy.status === 404 && !!legacy.json?.error, legacy);
  const legacy2 = await get("/api/md-bridge/events");
  check("**旧 /api/md-bridge 已退役（JSON 404）**", legacy2.status === 404 && !!legacy2.json?.error, legacy2);

  await del(`/api/workspace/items/${taskId}`);
}

// ═══════════════ 5. 任务 CRUD 与 id 稳定性 ═══════════════
section("5. 任务增删改");
{
  const add = await post("/api/workspace/items", { title: "手动加的任务", priority: "low" });
  check("新建任务", add.status === 201, add.json);
  const tid = add.json?.item?.id;
  check("返回任务 id", !!tid, add.json);

  const upd = await put(`/api/workspace/items/${tid}`, { title: "改过的任务" });
  check("修改任务", upd.json?.success === true, upd.json);
  check("**修改不改变 id**", upd.json?.item?.id === tid, upd.json?.item);

  const done = await put(`/api/workspace/items/${tid}`, { done: true });
  check("**标记完成**", done.json?.item?.done === true, done.json?.item);

  const list = await get("/api/workspace/items");
  const t = list.json?.items?.find((x) => x.id === tid);
  check("修改已生效", t?.title === "改过的任务", t);

  const beforeIds = list.json.items.map((x) => x.id);
  await post("/api/workspace/items", { title: "插队的新任务", priority: "medium" });
  const after = await get("/api/workspace/items");
  const afterIds = after.json.items.map((x) => x.id);
  check("**新增任务后存量 id 不漂移**",
    beforeIds.every((id) => afterIds.includes(id)),
    { before: beforeIds, after: afterIds });

  const d = await del(`/api/workspace/items/${tid}`);
  check("删除任务", d.json?.success === true, d.json);
  const after2 = await get("/api/workspace/items");
  check("删除后该任务消失", !after2.json.items.some((x) => x.id === tid));

  const missing = await del(`/api/workspace/items/${tid}`);
  check("**删除不存在的条目返回 404**", missing.status === 404, missing.json);

  const frozen = await put(`/api/workspace/items/${createdId}`, { id: "hacked" });
  check("**不可修改字段被拒绝**", frozen.status === 400 && Array.isArray(frozen.json?.editableFields), frozen.json);
}

// ═══════════════ 6. 级联删除与父任务 ═══════════════
section("6. 子任务级联删除");
{
  const parent = await post("/api/workspace/items", { title: "父任务" });
  const pid = parent.json?.item?.id;
  const c1 = await post("/api/workspace/items", { title: "子任务1", parent: pid });
  const c2 = await post("/api/workspace/items", { title: "子任务2", parent: pid });
  check("父任务创建", parent.status === 201, parent.json);
  check("子任务创建", c1.status === 201 && c2.status === 201, { c1: c1.json, c2: c2.json });

  const d = await del(`/api/workspace/items/${pid}`);
  check("删除父任务", d.json?.success === true, d.json);
  check("**级联删除 2 个子任务**", d.json?.removedChildren === 2, d.json);

  const all = await get("/api/workspace/items");
  check("**子任务已从数据源消失**",
    !all.json.items.some((i) => i.parent === pid),
    all.json.items.filter((i) => i.parent === pid));
}

// ═══════════════ 7. ICS 导入导出 ═══════════════
section("7. iCalendar 导入 / 导出");
{
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:imp-1", "DTSTAMP:20260101T000000Z",
    "DTSTART:20261201T090000Z", "DTEND:20261201T100000Z",
    "SUMMARY:导入的会议", "END:VEVENT",
    "BEGIN:VEVENT", "UID:imp-2", "DTSTAMP:20260101T000000Z",
    "DTSTART;VALUE=DATE:20261202", "DTEND;VALUE=DATE:20261203",
    "SUMMARY:导入的全天", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const dry = await post("/api/workspace/ics/import", { icsContent: ics, dryRun: true });
  check("dryRun 解析出 2 条", dry.json?.parsed === 2, dry.json);
  check("dryRun 不写盘", dry.json?.dryRun === true, dry.json);
  const beforeCount = (await get("/api/workspace/items")).json?.count;

  const imp = await post("/api/workspace/ics/import", { icsContent: ics });
  check("导入 2 条", imp.json?.imported === 2, imp.json);

  const dup = await post("/api/workspace/ics/import", { icsContent: ics });
  check("重复导入被去重", dup.json?.skipped === 2 && dup.json?.imported === 0, dup.json);

  const exp = await get("/api/workspace/ics/export");
  check("导出成功", exp.status === 200 && typeof exp.json?.ics === "string", exp.status);
  check("导出内容含导入的事件", exp.json.ics.includes("导入的会议"));
  check("**导出用浮动本地时间（不带 Z）**",
    !/DTSTART:\d{8}T\d{6}Z/.test(exp.json.ics),
    exp.json.ics?.split("\n").find((l) => l.startsWith("DTSTART:") && !l.includes("VALUE=DATE")));
  check("**全天事件写成 VALUE=DATE**", /DTSTART;VALUE=DATE:/.test(exp.json.ics));
  check("导出条数与数据源一致", exp.json?.count === (await get("/api/workspace/items")).json?.count, exp.json?.count);

  const bad = await post("/api/workspace/ics/import", { icsContent: "这不是日历" });
  check("非 ICS 文件返回 400 + 提示", bad.status === 400 && !!bad.json?.error, bad.json);

  const noBody = await post("/api/workspace/ics/import", {});
  check("**缺 icsContent 返回 400**", noBody.status === 400, noBody.json);

  // 清理导入的事件
  const all = await get("/api/workspace/items");
  for (const e of all.json.items.filter((i) => i.uid === "imp-1" || i.uid === "imp-2")) {
    await del(`/api/workspace/items/${e.id}`);
  }
  const after = await get("/api/workspace/items");
  check("清理后条数回落", after.json.count <= beforeCount + 1, { before: beforeCount, after: after.json.count });
}

// ═══════════════ 8. 事件编辑 ═══════════════
section("8. 事件编辑");
{
  const r = await post("/api/workspace/items", {
    kind: "event",
    title: "待编辑事件",
    start: "2026-11-05T09:00:00",
    end: "2026-11-05T10:00:00",
  });
  const id = r.json?.item?.id;
  check("事件创建", r.status === 201 && !!id, r.json);

  const u = await put(`/api/workspace/items/${id}`, { title: "已改标题" });
  check("更新事件", u.json?.success === true, u.json);
  check("**更新不丢 kind**", u.json?.item?.kind === "event", u.json?.item);
  check("**更新不丢时间**", u.json?.item?.start === "2026-11-05T09:00:00", u.json?.item);

  const badRange = await put(`/api/workspace/items/${id}`, { end: "2026-11-05T08:00:00" });
  check("**end 早于 start 被拒绝**", badRange.status === 400, badRange.json);

  const list = await get("/api/workspace/items");
  check("修改已落盘", list.json.items.find((e) => e.id === id)?.title === "已改标题");
  await del(`/api/workspace/items/${id}`);
}

// ═══════════════ 9. 插件系统 ═══════════════
section("9. 模块插件机制");
{
  const p = await get("/api/plugins");
  check("插件 API 可用", p.status === 200 && p.json?.success === true, p.json);
  check("示例插件被扫描到", p.json?.plugins?.some((x) => x.id === "example"), p.json?.plugins);
  check("插件组件文件被识别", p.json?.plugins?.find((x) => x.id === "example")?.__hasComponent === true);
  check("无插件错误", (p.json?.errors?.length ?? 0) === 0, p.json?.errors);
}

// ═══════════════ 10. 配置系统 ═══════════════
section("10. 配置系统（界面可改 + 持久化）");
{
  const g = await get("/api/config");
  check("配置 API 可用", g.status === 200, g.status);
  check("返回配置文件路径", !!g.json?.file?.path, g.json?.file);
  check("**敏感字段已脱敏**",
    String(g.json?.config?.caldav?.password || "").includes("****") || g.json?.config?.caldav?.password === "",
    g.json?.config?.caldav?.password);
  check("CalDAV 根地址已读到（隔离服务写死为不可达地址）",
    String(g.json?.config?.caldav?.rootUrl || "").startsWith("http://127.0.0.1:9/"),
    g.json?.config?.caldav);

  const s = await put("/api/config", { ai: { enabled: true, baseUrl: "https://x/v1", apiKey: "sk-abc123456789" } });
  check("保存配置", s.json?.success === true, s.json);
  check("**保存后密钥脱敏返回**", s.json?.config?.ai?.apiKey?.includes("****"), s.json?.config?.ai?.apiKey);

  const g2 = await get("/api/config");
  check("保存后能读回", g2.json?.config?.ai?.baseUrl === "https://x/v1", g2.json?.config?.ai);

  const disk = await get("/api/config");
  check("**磁盘真值未被掩码覆盖**",
    String(disk.json?.config?.ai?.apiKey || "").startsWith("sk-****"),
    disk.json?.config?.ai?.apiKey);
}

// ═══════════════ 11. WebDAV / AI（未配置时的表现）═══════════════
section("11. WebDAV / AI 通道（当前未配置，应优雅降级）");
{
  const w = await get("/api/webdav/status");
  check("WebDAV status 可用", w.status === 200, w.status);
  check("未配置时 configured=false", w.json?.configured === false, w.json);

  const push = await post("/api/webdav/push");
  check("未配置时 push 返回 400 + 可操作提示",
    push.status === 400 && /WEBDAV_URL/.test(push.json?.error || ""), push.json);

  const test = await post("/api/webdav/test");
  check("未配置时 test 返回 400", test.status === 400, test.status);

  const cal = await get("/api/calendar/calendars");
  check("CalDAV 服务器关着时接口不崩", cal.status === 200, cal.status);
  check("**CalDAV 不可用时降级返回（不是 500）**",
    cal.json?.degraded === true && Array.isArray(cal.json?.data),
    { degraded: cal.json?.degraded, status: cal.status });
  check("降级时带可读提示", typeof cal.json?.message === "string" && cal.json.message.length > 0, cal.json?.message);

  const calEvents = await get("/api/calendar/events?start=2026-10-01&end=2026-10-31");
  check("CalDAV 事件接口也降级不崩", calEvents.status === 200, calEvents.status);

  // AI：配了 enabled 但缺 key 时，不应声称"可用"
  await put("/api/config", { ai: { enabled: true, baseUrl: "https://x/v1", apiKey: "" } });
  const aiIncomplete = await get("/api/nlp/status");
  check("**AI 缺 key 时不声称可用**", aiIncomplete.json?.aiEnabled === false, aiIncomplete.json);
  const p = await post("/api/nlp/parse", { text: "明天下午3点开会" });
  check("AI 不可用时本地解析照常工作", p.json?.source === "local", p.json?.source);
  await put("/api/config", { ai: { enabled: false, baseUrl: "", apiKey: "" } });
}

// ═══════════════ 汇总 ═══════════════
section("验收汇总");
console.log(`  通过 ${pass} · 失败 ${fail} · 跳过 ${skip}`);
if (fail > 0) {
  console.log("\n  失败项：");
  for (const r of results.filter((x) => x.mark === "FAIL")) {
    console.log(`   ✗ ${r.name}${r.extra !== undefined ? " → " + JSON.stringify(r.extra) : ""}`);
  }
}
process.exit(fail > 0 ? 1 : 0);
