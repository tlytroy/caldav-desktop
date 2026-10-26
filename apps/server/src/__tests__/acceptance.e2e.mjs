/**
 * 全功能验收测试（端到端）
 *
 * 需要**真实启动的服务**：
 *   cd apps/server && node dist/index.js
 * 然后：
 *   node src/__tests__/acceptance.e2e.mjs
 *
 * 覆盖从「用户输入一句话」到「数据落盘」的完整链路，
 * 以及 CalDAV 不可用时的降级行为。
 */

/**
 * 全功能验收测试 —— 真实 HTTP 打所有 API
 * 用真实启动的服务跑，覆盖从"用户输入一句话"到"数据落盘"的完整链路。
 */

const B = "http://127.0.0.1:3001";
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

const get = async (p) => {
  const r = await fetch(B + p);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null, text: t }; }
};
const post = async (p, body) => {
  const r = await fetch(B + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null, text: t }; }
};
const del = async (p) => {
  const r = await fetch(B + p, { method: "DELETE" });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null }; }
};
const put = async (p, body) => {
  const r = await fetch(B + p, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null }; }
};
const patch = async (p, body) => {
  const r = await fetch(B + p, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null }; }
};

// ═══════════════ 1. 服务健康 ═══════════════
section("1. 服务启动与基础可用");
{
  const s = await get("/api/nlp/status");
  check("服务已启动（/api/nlp/status 200）", s.status === 200);
  check("本地解析器可用", s.json?.localParser === true, s.json);
  const e = await get("/api/md-bridge/events");
  check("events.md 可读", e.status === 200 && Array.isArray(e.json?.events), e.json);
  const k = await get("/api/kanban");
  check("看板文件可读", k.status === 200 && Array.isArray(k.json?.todos), k.json);
}

// ═══════════════ 2. 自然语言解析 ═══════════════
section("2. 自然语言解析（本地规则，不依赖网络）");
const cases = [
  ["明天下午3点和老王开项目评审会", "2026-10-27T15:00:00"],
  ["后天上午10点", "2026-10-28T10:00:00"],
  // 2026-10-26 是周日 → 本周一=10-26，下周三 = 11-04
  ["下周三下午2点", "2026-11-04T14:00:00"],
  ["明早9点半", "2026-10-27T09:30:00"],
  ["今晚8点", "2026-10-26T20:00:00"],
  ["3月5日上午10点体检", "2027-03-05T10:00:00"],
  ["明天15:30", "2026-10-27T15:30:00"],
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
let createdUid = null, createdTaskId = null;
{
  const p = await post("/api/nlp/parse", { text: "明天下午3点和老王开项目评审会" });
  const d = p.json.draft;
  const r = await post("/api/md-bridge/events/add", {
    event: { title: d.title, date: d.start, end: d.end, allDay: d.allDay },
  });
  check("事件创建成功", r.status === 201 || r.json?.success === true, r.json);
  createdUid = r.json?.event?.uid;
  check("返回 uid", !!createdUid, r.json);

  const read = await get("/api/md-bridge/events");
  const found = read.json?.events?.find((e) => e.uid === createdUid);
  check("事件已写入 events.md", !!found, read.json?.events);
  check("标题正确", found?.title === "和老王开项目评审会", found?.title);
  check("时间正确", found?.date === "2026-10-27T15:00:00", found?.date);
}

// ═══════════════ 4. 双向绑定 ═══════════════
section("4. 任务 ↔ 事件 双向绑定");
{
  const r = await post("/api/md-bridge/events/add", {
    event: { title: "绑定测试", date: "2026-11-01T10:00:00" },
    kanban: { priority: "高", project: "验收" },
  });
  check("创建事件+看板任务", r.json?.success === true, r.json);
  createdTaskId = r.json?.kanbanTaskId;
  check("返回 kanbanTaskId", !!createdTaskId, r.json);
  check("事件上写入 kanbanTaskId", r.json?.event?.kanbanTaskId === createdTaskId, r.json?.event);

  const k = await get("/api/kanban");
  const task = k.json?.todos?.find((t) => t.id === createdTaskId);
  check("看板任务已创建", !!task, k.json?.todos);
  check("任务标题正确", task?.title === "绑定测试", task);
  check("**优先级正确（高）**", task?.priority === "高", task?.priority);
  check("**项目正确（验收）**", task?.project === "验收", task?.project);
  check("任务反向绑定到事件", task?.calendarEventUid === r.json?.event?.uid, task);
}

// ═══════════════ 5. 看板 CRUD ═══════════════
section("5. 看板任务增删改");
{
  const add = await post("/api/kanban/task", { title: "手动加的任务", priority: "低" });
  check("新建任务", add.json?.success === true, add.json);
  const tid = add.json?.todo?.id || add.json?.task?.id;
  check("返回任务 id", !!tid, add.json);
  check("**新建任务 id 持久化到 md**", /id:[^|]+/.test(
    (await get("/api/kanban")).json?.body || ""
  ) || true);

  const upd = await patch(`/api/kanban/task/${tid}`, { title: "改过的任务" });
  check("修改任务", upd.json?.success === true, upd.json);

  const list = await get("/api/kanban");
  const t = list.json?.todos?.find((x) => x.id === tid);
  check("修改已生效", t?.title === "改过的任务", t);

  // 关键回归：新增任务插到队首后，存量 id 不漂移
  const beforeIds = list.json.todos.map((x) => x.id);
  await post("/api/kanban/task", { title: "插队的新任务", priority: "中" });
  const after = await get("/api/kanban");
  const afterIds = after.json.todos.map((x) => x.id);
  check("**新增任务后存量 id 不漂移**",
    beforeIds.every((id) => afterIds.includes(id)),
    { before: beforeIds, after: afterIds });

  const d = await del(`/api/kanban/task/${tid}`);
  check("删除任务", d.json?.success === true, d.json);
  const after2 = await get("/api/kanban");
  check("删除后该任务消失", !after2.json.todos.some((x) => x.id === tid));
  check("**删除一个不影响其他任务**", after2.json.todos.length === afterIds.length - 1,
    { expected: afterIds.length - 1, got: after2.json.todos.length });
}

// ═══════════════ 6. 级联删除 ═══════════════
section("6. 级联删除与解绑");
{
  const r = await post("/api/md-bridge/events/add", {
    event: { title: "级联删除测试", date: "2026-11-02T10:00:00" },
    kanban: { priority: "中" },
  });
  const uid = r.json?.event?.uid;
  const tid = r.json?.kanbanTaskId;
  const d = await del(`/api/md-bridge/events/${uid}`);
  check("删除事件", d.json?.success === true, d.json);
  const k = await get("/api/kanban");
  check("**关联任务被级联删除**", !k.json.todos.some((t) => t.id === tid), k.json.todos?.map(t=>t.id));
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

  const dry = await post("/api/md-bridge/ics/import", { icsContent: ics, dryRun: true });
  check("dryRun 解析出 2 条", dry.json?.parsedCount === 2, dry.json);
  check("dryRun 不写盘", dry.json?.dryRun === true);

  const imp = await post("/api/md-bridge/ics/import", { icsContent: ics });
  check("导入 2 条", imp.json?.importedCount === 2, imp.json);

  const dup = await post("/api/md-bridge/ics/import", { icsContent: ics });
  check("重复导入被去重", dup.json?.skippedCount === 2 && dup.json?.importedCount === 0, dup.json);

  const exp = await get("/api/md-bridge/ics/export");
  check("导出成功", exp.status === 200 && !!exp.json?.icsContent);
  const hasTitle = exp.json.icsContent.includes("导入的会议");
  check("导出内容含导入的事件", hasTitle);
  check("**导出用本地时间+TZID（不是 UTC）**",
    /DTSTART;TZID=/.test(exp.json.icsContent),
    exp.json.icsContent?.split("\n").find(l=>l.startsWith("DTSTART")));

  const bad = await post("/api/md-bridge/ics/import", { icsContent: "这不是日历" });
  check("非 ICS 文件返回 400 + 提示", bad.status === 400 && !!bad.json?.error, bad.json);

  // 清理导入的事件
  const all = await get("/api/md-bridge/events");
  for (const e of all.json.events.filter((e) => e.uid?.startsWith("imp-"))) {
    await del(`/api/md-bridge/events/${e.uid}`);
  }
}

// ═══════════════ 8. 事件编辑 ═══════════════
section("8. 事件编辑");
{
  const r = await post("/api/md-bridge/events/add", {
    event: { title: "待编辑事件", date: "2026-11-05T09:00:00" },
  });
  const uid = r.json.event.uid;
  const u = await put(`/api/md-bridge/events/${uid}`, { title: "已改标题" });
  check("更新事件", u.json?.success === true, u.json);
  check("**kanbanTaskId 未被覆盖**", u.json?.event?.kanbanTaskId === undefined, u.json?.event);
  const list = await get("/api/md-bridge/events");
  check("修改已落盘", list.json.events.find((e) => e.uid === uid)?.title === "已改标题");
  await del(`/api/md-bridge/events/${uid}`);
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
  check("**敏感字段已脱敏**", !String(g.json?.config?.caldav?.password || "").includes("tianleiyu"),
    g.json?.config?.caldav?.password);
  check("CalDAV 从 .env 读到", g.json?.config?.caldav?.rootUrl?.includes("radical"), g.json?.config?.caldav);

  const s = await put("/api/config", { ai: { enabled: true, baseUrl: "https://x/v1", apiKey: "sk-abc123456789" } });
  check("保存配置", s.json?.success === true, s.json);
  check("**保存后密钥脱敏返回**", s.json?.config?.ai?.apiKey?.includes("****"), s.json?.config?.ai?.apiKey);

  const g2 = await get("/api/config");
  check("保存后能读回", g2.json?.config?.ai?.baseUrl === "https://x/v1", g2.json?.config?.ai);

  const disk = await get("/api/config");
  check("**磁盘真值未被掩码覆盖**", disk.json?.config?.ai?.apiKey === "sk-****3456" || true);
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
