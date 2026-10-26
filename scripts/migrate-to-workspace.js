/**
 * 迁移脚本：events.md + 工作搭子看板.md → workspace.md
 * ====================================================
 *
 * ## 为什么需要
 *
 * 旧架构把「事件」和「任务」拆成两个文件，靠双向绑定字段缝合。
 * 新架构是单一条目池 —— 事件与任务都是同一种记录，模块只是视图。
 *
 * 迁移时**不再建立任何绑定关系**：旧的事件与任务各自变成独立条目。
 * 如果旧文件里两者本来就绑定过（事件有 kanbanTaskId / 任务有 日历:uid），
 * 迁移会把它们**合并成一条**（事件的时间信息保留，任务的完成状态保留），
 * 而不是变成两条重复记录。
 *
 * ## 用法
 *
 * ```bash
 * # 预览（不写文件）
 * node scripts/migrate-to-workspace.js --dry-run
 *
 * # 执行迁移
 * node scripts/migrate-to-workspace.js
 * ```
 *
 * 参数：
 *  - --dry-run        只输出将要迁移的内容
 *  - --from <dir>     源目录（默认项目根）
 *  - --out <file>     输出文件（默认 <dir>/workspace.md）
 */

const fs = require("node:fs");
const path = require("node:path");

// ===== 简易参数解析 =====
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fromIdx = args.indexOf("--from");
const outIdx = args.indexOf("--out");
const srcDir = path.resolve(
  fromIdx >= 0 && args[fromIdx + 1] ? args[fromIdx + 1] : process.cwd(),
);
const outFile = path.resolve(
  outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : path.join(srcDir, "workspace.md"),
);

const EVENTS_FILE = path.join(srcDir, "events.md");
const KANBAN_FILE = path.join(srcDir, "工作搭子看板.md");

// ===== 工具 =====
function newId() {
  return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
}

/** 本地时间 ISO（不带 Z） */
function localIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 从 events.md 的 frontmatter 里逐条抽取事件 */
function parseEvents(content) {
  const events = [];
  const lines = content.split(/\r?\n/);
  let inEvents = false;
  let cur = null;

  for (const raw of lines) {
    const t = raw.trim();
    if (t === "events:" || t.startsWith("events:")) {
      inEvents = true;
      continue;
    }
    if (!inEvents) continue;

    const m = t.match(/^-\s+(\w+):\s*(.*)$/);
    if (m) {
      if (cur && cur.title) events.push(cur);
      cur = {};
      cur[m[1]] = m[2].replace(/^["']|["']$/g, "");
      continue;
    }
    const kv = t.match(/^(\w+):\s*(.*)$/);
    if (kv && cur) {
      cur[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  if (cur && cur.title) events.push(cur);
  return events;
}

/** 从看板 md 抽取任务 */
function parseKanban(content) {
  const todos = [];
  const projects = [];
  const notes = [];
  const re = /^-\s*\[([ xX])\]\s*\[([高低中])\]\s*(.+)$/;
  let section = "none";
  let curProject = null;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      const name = line.slice(3).trim();
      section =
        name === "待办"
          ? "todo"
          : name === "项目"
            ? "project"
            : name === "速记"
              ? "note"
              : "none";
      curProject = null;
      continue;
    }
    if (section === "todo") {
      const m = line.match(re);
      if (!m) continue;
      const rest = m[3];
      const bar = rest.indexOf("|");
      const title = bar >= 0 ? rest.slice(0, bar).trim() : rest.trim();
      const fields = {};
      if (bar >= 0) {
        for (const p of rest.slice(bar).split("|").map((s) => s.trim())) {
          const i = p.indexOf(":");
          if (i > 0) fields[p.slice(0, i).trim()] = p.slice(i + 1).trim();
        }
      }
      todos.push({
        done: m[1].toLowerCase() === "x",
        priority: m[2],
        title,
        due: fields["截止"] || undefined,
        project: fields["项目"] || undefined,
        estimate: fields["预估"] ? Number(fields["预估"]) : undefined,
        doneDate: fields["完成"] || undefined,
        calendarUid: fields["日历"] || undefined,
        id: fields["id"] || undefined,
      });
      continue;
    }
    if (section === "project") {
      if (line.startsWith("### ")) {
        curProject = { name: line.slice(4).trim() };
        projects.push(curProject);
        continue;
      }
      if (curProject) {
        if (line.startsWith("当前：")) curProject.current = line.slice(3).trim();
        else if (line.startsWith("下一步：")) curProject.next = line.slice(4).trim();
        else if (line.startsWith("卡点：")) curProject.blocker = line.slice(3).trim();
      }
      continue;
    }
    if (section === "note" && line.startsWith("-")) {
      const body = line.slice(1).trim();
      if (!body || body.startsWith("<!--")) continue;
      const tags = [];
      const text = body.replace(/#([^\s#]+)/g, (_m, t) => {
        tags.push(t);
        return "";
      }).trim();
      notes.push({ tags, text });
    }
  }
  return { todos, projects, notes };
}

/** 旧 recurrence 枚举 → RRULE */
function toRRule(legacy) {
  if (!legacy) return undefined;
  const v = String(legacy).trim().toLowerCase();
  if (v === "daily") return "FREQ=DAILY";
  if (v === "weekly") return "FREQ=WEEKLY";
  if (v === "monthly") return "FREQ=MONTHLY";
  if (v === "yearly") return "FREQ=YEARLY";
  if (String(legacy).includes("FREQ=")) return legacy;
  return undefined;
}

/** 中文优先级 → 英文 */
function toPriority(p) {
  return { 高: "high", 中: "mid", 低: "low" }[p] || "mid";
}

// ===== 主流程 =====

function main() {
  const hasEvents = fs.existsSync(EVENTS_FILE);
  const hasKanban = fs.existsSync(KANBAN_FILE);

  if (!hasEvents && !hasKanban) {
    console.error("✗ 找不到 events.md 或 工作搭子看板.md，无可迁移内容");
    process.exit(1);
  }

  const items = [];
  const eventByUid = new Map();
  const taskById = new Map();
  const mergedPairs = new Set();

  // ---- 事件 ----
  if (hasEvents) {
    const events = parseEvents(fs.readFileSync(EVENTS_FILE, "utf-8"));
    for (const e of events) {
      const id = e.uid && /^[0-9a-f]{8}$/.test(e.uid) ? e.uid : newId();
      const start = e.date ? normalizeDt(e.date) : undefined;
      let end = e.end ? normalizeDt(e.end) : undefined;

      // 全天事件的 end 必须是**次日 00:00**。
      // 旧数据里常写成同日 00:00（零长度），ICS 客户端会忽略这种事件。
      const isAllDay = e.allDay === "true";
      if (isAllDay && start) {
        const s = new Date(start);
        const next = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
        end = localIso(next);
      }

      const item = {
        id,
        kind: "event",
        title: e.title,
        start,
        end,
        allDay: isAllDay,
        recurrence: toRRule(e.recurrence),
        project: e.category || undefined,
        description: e.description || undefined,
        tags: e.tags || undefined,
        location: e.location || undefined,
        status: e.status || undefined,
        kanbanTaskId: e.kanbanTaskId || undefined,
        // 保留事件自身 uid，供「任务侧 日历:<uid> → 事件」方向的匹配使用
        calendarUid: e.uid || undefined,
      };
      items.push(item);
      if (e.uid) eventByUid.set(e.uid, item);
    }
    console.log(`  事件：${events.length} 条`);
  }

  // ---- 任务 ----
  if (hasKanban) {
    const { todos, projects, notes } = parseKanban(
      fs.readFileSync(KANBAN_FILE, "utf-8"),
    );
    for (const t of todos) {
      const id = t.id && t.id.startsWith("k-") ? t.id.slice(2) : newId();
      const item = {
        id,
        kind: "task",
        title: t.title,
        done: t.done,
        priority: toPriority(t.priority),
        due: t.due,
        start: t.due ? `${t.due}T00:00:00` : undefined,
        end: t.due ? `${t.due}T23:59:00` : undefined,
        allDay: true,
        project: t.project || undefined,
        estimate: t.estimate,
        calendarUid: t.calendarUid || undefined,
      };
      taskById.set(t.id || id, item);
      items.push(item);
    }
    console.log(`  任务：${todos.length} 条`);

    // ---- 合并已绑定的对 ----
    // 旧架构里「事件 + 任务」是同一个东西的两面。
    // 新架构不需要绑定 —— 直接合成一条：保留事件的时间，保留任务的完成状态。
    //
    // ⚠️ 两个方向的绑定键**不一样**（旧架构的老毛病）：
    //   事件侧：kanbanTaskId → 任务 id
    //   任务侧：日历:<uid>    → 事件 uid
    // 所以必须**双向匹配**，只查一个方向会漏掉一半。
    const taskByCalendarUid = new Map();
    for (const [key, task] of taskById) {
      if (task.calendarUid) taskByCalendarUid.set(task.calendarUid, task);
    }
    const eventByUid = new Map();
    for (const ev of items) {
      if (ev.kind === "event") eventByUid.set(ev.calendarUid || ev.id, ev);
    }

    for (const ev of [...items.filter((i) => i.kind === "event")]) {
      // 方向一：事件侧 kanbanTaskId → 任务
      let task = ev.kanbanTaskId ? taskById.get(ev.kanbanTaskId) : undefined;
      // 方向二：任务侧 日历:<uid> → 事件
      if (!task && ev.calendarUid) {
        task = taskByCalendarUid.get(ev.calendarUid);
      }
      if (!task) continue;

      const key = `${ev.id}|${task.id}`;
      if (mergedPairs.has(key)) continue;
      mergedPairs.add(key);

      // 任务补上事件的时间信息
      task.start = ev.start || task.start;
      task.end = ev.end || task.end;
      task.allDay = ev.allDay ?? task.allDay;
      task.recurrence = ev.recurrence || task.recurrence;
      if (ev.description) task.description = ev.description;
      if (ev.location) task.location = ev.location;
      // 事件标记为已取消的状态 → 任务视为已完成
      if (ev.status === "cancelled") task.done = true;

      // 事件并入任务（移除事件条目）
      const idx = items.indexOf(ev);
      if (idx >= 0) items.splice(idx, 1);
      console.log(`  合并：事件「${ev.title}」+ 任务「${task.title}」→ 一条任务`);
    }

    // ---- 项目与速记 → 自由笔记区 ----
    var notesText = "";
    if (projects.length) {
      notesText += "## 项目\n";
      for (const p of projects) {
        notesText += `### ${p.name}\n`;
        if (p.current) notesText += `当前：${p.current}\n`;
        if (p.next) notesText += `下一步：${p.next}\n`;
        if (p.blocker) notesText += `卡点：${p.blocker}\n`;
        notesText += "\n";
      }
    }
    if (notes.length) {
      notesText += "## 速记\n";
      for (const n of notes) {
        notesText += `- ${n.tags.map((t) => `#${t}`).join(" ")} ${n.text}\n`;
      }
    }
    if (notesText) {
      console.log(`  项目/速记：转为自由笔记区`);
      global.__notes = notesText;
    }
  }

  // ---- 序列化 ----
  const out = serialize(items, global.__notes || "");

  console.log("");
  console.log(`  迁移结果：${items.length} 条记录`);
  console.log(`  输出：${outFile}`);
  if (dryRun) {
    console.log("");
    console.log("--- 预览（前 60 行）---");
    console.log(out.split("\n").slice(0, 60).join("\n"));
    console.log("--- 预览结束（未写文件）---");
    return;
  }

  if (fs.existsSync(outFile)) {
    const bak = `${outFile}.bak`;
    fs.copyFileSync(outFile, bak);
    console.log(`  已备份原文件 → ${bak}`);
  }
  fs.writeFileSync(outFile, out, "utf-8");
  console.log("  ✓ 迁移完成");
}

/** 归一化时间 */
function normalizeDt(v) {
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}:${m[4] || "00"}`;
  // 只有日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00`;
  return s;
}

/** 序列化（与 workspace.ts 的输出格式一致） */
function serialize(items, notes) {
  const out = [];
  out.push("---");
  out.push("schema: workbench/v1");
  out.push("---");
  out.push("");

  const sorted = [...items].sort((a, b) => {
    const ad = a.done ? 1 : 0;
    const bd = b.done ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const at = a.start ?? a.due ?? "9999";
    const bt = b.start ?? b.due ?? "9999";
    return at.localeCompare(bt);
  });

  for (const it of sorted) {
    out.push(`## ${it.title}`);
    out.push(`- id: ${it.id}`);
    out.push(`- kind: ${it.kind}`);
    if (it.start) out.push(`- start: ${it.start}`);
    if (it.end) out.push(`- end: ${it.end}`);
    if (it.due) out.push(`- due: ${it.due}`);
    if (it.allDay !== undefined) out.push(`- allDay: ${it.allDay}`);
    if (it.done !== undefined) out.push(`- done: ${it.done}`);
    if (it.priority) out.push(`- priority: ${it.priority}`);
    if (it.recurrence) out.push(`- recurrence: ${it.recurrence}`);
    if (it.project) out.push(`- project: ${it.project}`);
    if (it.estimate != null) out.push(`- estimate: ${it.estimate}`);
    if (it.tags && it.tags.length) out.push(`- tags: ${it.tags.join(", ")}`);
    if (it.location) out.push(`- location: ${it.location}`);
    if (it.description) out.push(`- description: ${it.description}`);
    if (it.status) out.push(`- status: ${it.status}`);
    out.push("");
  }

  if (notes && notes.trim()) {
    out.push("<!-- notes -->");
    out.push("");
    out.push(notes.trim());
    out.push("");
  }
  return out.join("\n");
}

main();
