import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseWorkspace,
  serializeWorkspace,
  readWorkspace,
  writeWorkspace,
  validateItem,
  buildValidationReport,
  filterItems,
  newItemId,
  collectLists,
  attachSubtaskProgress,
  topLevelWithProgress,
  childrenOf,
  type WorkbenchItem,
} from "../workspace.js";

const SAMPLE = `---
schema: workbench/v1
---

## 2026-10-28 体检
- id: a1b2c3d4
- kind: task
- start: 2026-10-28T09:00:00
- end: 2026-10-28T10:00:00
- priority: mid
- done: false

## 每周一三五 晨会
- id: b2c3d4e5
- kind: event
- start: 2026-10-05T09:00:00
- end: 2026-10-05T10:00:00
- recurrence: FREQ=WEEKLY;BYDAY=MO,WE,FR
- status: confirmed
`;

describe("workspace.md 解析", () => {
  it("解析多条条目", () => {
    const ws = parseWorkspace(SAMPLE);
    expect(ws.items).toHaveLength(2);
    expect(ws.items[0].title).toBe("2026-10-28 体检");
    expect(ws.items[0].kind).toBe("task");
    expect(ws.items[0].start).toBe("2026-10-28T09:00:00");
    expect(ws.items[1].recurrence).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("标题取自 H2（无需显式 title 字段）", () => {
    const ws = parseWorkspace(SAMPLE);
    expect(ws.items[0].title).toContain("体检");
    expect(ws.items[0].title).not.toBe("");
  });

  it("容错：一条坏数据不影响其他条目", () => {
    const broken = `---
schema: workbench/v1
---

## 正常条目
- id: 11111111
- kind: task
- start: 2026-10-01T09:00:00

## 坏条目
- id: 22222222
- kind: 不存在的类型
- start: 不是时间
- priority: 瞎写的

## 另一条正常
- id: 33333333
- kind: event
- start: 2026-10-02T09:00:00
`;
    const ws = parseWorkspace(broken);
    expect(ws.items).toHaveLength(3);

    // 坏条目被标记，但仍在结果里
    const bad = ws.items.find((i) => i.id === "22222222")!;
    expect(bad.errors).toBeDefined();
    expect(bad.errors!.length).toBeGreaterThan(0);

    // 其它条目完全正常
    const good1 = ws.items.find((i) => i.id === "11111111")!;
    const good2 = ws.items.find((i) => i.id === "33333333")!;
    expect(good1.errors).toBeUndefined();
    expect(good2.errors).toBeUndefined();
    expect(good1.start).toBe("2026-10-01T09:00:00");
  });

  it("容错：缺少 id 只标记该条", () => {
    const ws = parseWorkspace(`## 无 id

- kind: task
`);
    expect(ws.items).toHaveLength(1);
    expect(ws.items[0].errors).toBeDefined();
    expect(ws.items[0].errors!.some((e) => e.includes("id"))).toBe(true);
  });

  it("非法 kind / priority / 时间都被标出", () => {
    const ws = parseWorkspace(`## 坏数据
- id: 44444444
- kind: xxx
- priority: yyy
- start: zzz
`);
    const errs = ws.items[0].errors ?? [];
    expect(errs.some((e) => e.includes("kind"))).toBe(true);
    expect(errs.some((e) => e.includes("priority"))).toBe(true);
    expect(errs.some((e) => e.includes("start"))).toBe(true);
  });

  it("兼容中文优先级", () => {
    const ws = parseWorkspace(`## 中文优先级
- id: 55555555
- kind: task
- priority: 高
`);
    expect(ws.items[0].priority).toBe("high");
  });

  it("归一化时间：缺秒补秒，容忍空格分隔", () => {
    const ws = parseWorkspace(`## 时间格式
- id: 66666666
- kind: task
- start: 2026-10-01 09:30
`);
    expect(ws.items[0].start).toBe("2026-10-01T09:30:00");
  });

  it("end 不晚于 start 被标记", () => {
    const ws = parseWorkspace(`## 时间倒置
- id: 77777777
- kind: task
- start: 2026-10-01T10:00:00
- end: 2026-10-01T09:00:00
`);
    expect(ws.items[0].errors!.some((e) => e.includes("end"))).toBe(true);
  });

  it("解析 frontmatter 与正文", () => {
    const ws = parseWorkspace(`---
schema: workbench/v1
---

## 条目
- id: 88888888
- kind: task

<!-- notes -->
这里是自由笔记
`);
    expect(ws.items).toHaveLength(1);
    expect(ws.notes).toContain("这里是自由笔记");
  });

  it("notes 标记之后的内容不再被当作条目", () => {
    const ws = parseWorkspace(`## 条目一
- id: 11111111
- kind: task

<!-- notes -->
## 这不是条目
随便写
`);
    expect(ws.items).toHaveLength(1);
    expect(ws.notes).toContain("这不是条目");
  });

  it("空文件返回空集合", () => {
    const ws = parseWorkspace("");
    expect(ws.items).toHaveLength(0);
  });

  it("空行不会截断条目", () => {
    const ws = parseWorkspace(`## 多字段

- id: 99999999
- kind: task

- start: 2026-10-01T09:00:00
`);
    expect(ws.items).toHaveLength(1);
    expect(ws.items[0].start).toBe("2026-10-01T09:00:00");
  });
});

describe("序列化与往返", () => {
  it("序列化后再解析，字段不丢", () => {
    const item: WorkbenchItem = {
      id: "abc12345",
      kind: "task",
      title: "竞聘 PPT 终稿",
      start: "2026-10-28T09:00:00",
      end: "2026-10-28T11:00:00",
      due: "2026-10-28",
      priority: "high",
      done: false,
      recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      project: "竞聘",
      tags: ["重要", "对外"],
      description: "先过一遍逻辑",
      location: "张江",
      status: "confirmed",
    };
    const text = serializeWorkspace([item]);
    const ws = parseWorkspace(text);
    expect(ws.items).toHaveLength(1);
    const back = ws.items[0];
    expect(back.id).toBe(item.id);
    expect(back.kind).toBe(item.kind);
    expect(back.title).toBe(item.title);
    expect(back.start).toBe(item.start);
    expect(back.end).toBe(item.end);
    expect(back.due).toBe(item.due);
    expect(back.priority).toBe(item.priority);
    expect(back.recurrence).toBe(item.recurrence);
    expect(back.project).toBe(item.project);
    expect(back.tags).toEqual(item.tags);
    expect(back.description).toBe(item.description);
    expect(back.location).toBe(item.location);
  });

  it("未完成的排在已完成前面", () => {
    const text = serializeWorkspace([
      { id: "aaaaaaaa", kind: "task", title: "已完成", done: true },
      { id: "bbbbbbbb", kind: "task", title: "未完成", done: false },
    ]);
    const ws = parseWorkspace(text);
    expect(ws.items[0].title).toBe("未完成");
    expect(ws.items[1].title).toBe("已完成");
  });

  it("输出包含 schema 声明", () => {
    const text = serializeWorkspace([]);
    expect(text).toContain("schema: workbench/v1");
  });

  it("保留自由备注", () => {
    const text = serializeWorkspace([], "## 我的笔记\n随便写");
    const ws = parseWorkspace(text);
    expect(ws.notes).toContain("我的笔记");
  });});

describe("文件读写与备份", () => {
  let tmp: string;
  let wsFile: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
    wsFile = path.join(tmp, "workspace.md");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("写入后能读回", () => {
    writeWorkspace(
      [{ id: "cccccccc", kind: "task", title: "测试", start: "2026-10-01T09:00:00" }],
      undefined,
      wsFile,
    );
    const ws = readWorkspace(wsFile);
    expect(ws.items).toHaveLength(1);
    expect(ws.items[0].title).toBe("测试");
  });

  it("文件不存在时返回空集合而不是抛错", () => {
    const ws = readWorkspace(path.join(tmp, "不存在.md"));
    expect(ws.items).toHaveLength(0);
  });

  it("第二次写入会生成备份", () => {
    writeWorkspace([{ id: "dddddddd", kind: "task", title: "第一版" }], undefined, wsFile);
    writeWorkspace([{ id: "eeeeeeee", kind: "task", title: "第二版" }], undefined, wsFile);

    const backupFiles = fs.readdirSync(path.join(tmp, ".workspace-backups"));
    expect(backupFiles.length).toBeGreaterThanOrEqual(1);
    const backupContent = fs.readFileSync(
      path.join(tmp, ".workspace-backups", backupFiles[0]),
      "utf-8",
    );
    expect(backupContent).toContain("第一版");
  });

  it("备份保留有限份数", () => {
    for (let i = 0; i < 15; i++) {
      writeWorkspace(
        [{ id: "ffffffff", kind: "task", title: `第${i}版` }],
        undefined,
        wsFile,
      );
    }
    const backupFiles = fs.readdirSync(path.join(tmp, ".workspace-backups"));
    expect(backupFiles.length).toBeLessThanOrEqual(10);
  });
});

describe("校验", () => {
  it("合法条目通过", () => {
    expect(
      validateItem({
        id: "12345678",
        kind: "task",
        title: "合法",
        start: "2026-10-01T09:00:00",
      }),
    ).toEqual([]);
  });

  it("拒绝非法 id", () => {
    expect(validateItem({ id: "X", kind: "task", title: "x" }).length).toBeGreaterThan(0);
    expect(validateItem({ id: "123", kind: "task", title: "x" }).length).toBeGreaterThan(0);
  });

  it("拒绝非法 kind / priority", () => {
    expect(
      validateItem({ id: "12345678", kind: "x" as any, title: "x" }).some((e) =>
        e.includes("kind"),
      ),
    ).toBe(true);
    expect(
      validateItem({
        id: "12345678",
        kind: "task",
        title: "x",
        priority: "urgent" as any,
      }).some((e) => e.includes("priority")),
    ).toBe(true);
  });

  it("拒绝未知字段（防 AI 乱写）", () => {
    const errs = validateItem({
      id: "12345678",
      kind: "task",
      title: "x",
      恶意字段: "y",
    } as any);
    expect(errs.some((e) => e.includes("未知字段"))).toBe(true);
  });

  it("拒绝非法时间与 RRULE", () => {
    expect(
      validateItem({
        id: "12345678",
        kind: "task",
        title: "x",
        start: "2026/10/01",
      }).some((e) => e.includes("start")),
    ).toBe(true);
    expect(
      validateItem({
        id: "12345678",
        kind: "task",
        title: "x",
        recurrence: "FREQ=HOURLY",
      }).some((e) => e.includes("recurrence")),
    ).toBe(true);
  });

  it("校验报告统计有效/无效条目", () => {
    const ws = parseWorkspace(`## 好的
- id: 11111111
- kind: task

## 坏的
- id: 22222222
- kind: 瞎写
`);
    const report = buildValidationReport(ws);
    expect(report.total).toBe(2);
    expect(report.valid).toBe(1);
    expect(report.invalid).toBe(1);
    expect(report.issues).toHaveLength(1);
  });

  it("检测 id 重复", () => {
    const ws = parseWorkspace(`## 甲
- id: 11111111
- kind: task

## 乙
- id: 11111111
- kind: task
`);
    const report = buildValidationReport(ws);
    expect(report.invalid).toBe(2);
    expect(report.issues.some((i) => i.errors.some((e) => e.includes("重复")))).toBe(
      true,
    );
  });
});

describe("模块视图筛选", () => {
  const items: WorkbenchItem[] = [
    {
      id: "11111111",
      kind: "task",
      title: "任务有开始时间",
      start: "2026-10-01T09:00:00",
      done: false,
    },
    {
      id: "22222222",
      kind: "event",
      title: "纯事件",
      start: "2026-10-02T09:00:00",
    },
    {
      id: "33333333",
      kind: "task",
      title: "任务无时间",
      done: false,
    },
    {
      id: "44444444",
      kind: "task",
      title: "已完成",
      start: "2026-10-03T09:00:00",
      done: true,
    },
  ];

  it("日历视图 = 有 start 的条目（任务与事件都算）", () => {
    const cal = filterItems(items, { scope: "calendar" });
    expect(cal).toHaveLength(3);
    expect(cal.map((i) => i.id)).toContain("11111111");
    expect(cal.map((i) => i.id)).toContain("22222222");
    expect(cal.map((i) => i.id)).not.toContain("33333333");
  });

  it("看板视图 = kind=task", () => {
    const board = filterItems(items, { scope: "board" });
    expect(board).toHaveLength(3);
    expect(board.every((i) => i.kind === "task")).toBe(true);
  });

  it("这正是用户遇到的问题的解法：任务出现在两个视图里", () => {
    const cal = filterItems(items, { scope: "calendar" });
    const board = filterItems(items, { scope: "board" });
    const calIds = cal.map((i) => i.id);
    const boardIds = board.map((i) => i.id);
    // 有时间的任务同时出现在两边
    expect(calIds).toContain("11111111");
    expect(boardIds).toContain("11111111");
  });

  it("按日期范围过滤", () => {
    const r = filterItems(items, {
      scope: "calendar",
      start: "2026-10-02",
      end: "2026-10-02",
    });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("22222222");
  });

  it("排除已完成", () => {
    const r = filterItems(items, { scope: "calendar", includeDone: false });
    expect(r.map((i) => i.id)).not.toContain("44444444");
  });

  it("坏条目不会出现在任何视图里", () => {
    const broken = parseWorkspace(`## 坏的
- id: 99999999
- kind: 瞎写
`);
    expect(filterItems(broken.items, { scope: "calendar" })).toHaveLength(0);
    expect(filterItems(broken.items, { scope: "board" })).toHaveLength(0);
  });
});

describe("id 生成", () => {
  it("生成 8 位十六进制 id", () => {
    for (let i = 0; i < 50; i++) {
      expect(newItemId()).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("不重复", () => {
    const set = new Set(Array.from({ length: 200 }, () => newItemId()));
    expect(set.size).toBe(200);
  });
});

describe("清单（List）", () => {
  it("list 字段能往返", () => {
    const text = serializeWorkspace([
      { id: "aaa11111", kind: "task", title: "写周报", list: "工作" },
    ]);
    const ws = parseWorkspace(text);
    expect(ws.items[0].list).toBe("工作");
  });

  it("按清单筛选；空串表示收件箱", () => {
    const items: WorkbenchItem[] = [
      { id: "aaa11111", kind: "task", title: "在收件箱" },
      { id: "bbb22222", kind: "task", title: "在工作清单", list: "工作" },
      { id: "ccc33333", kind: "task", title: "也在工作", list: "工作" },
    ];
    expect(filterItems(items, { list: "" })).toHaveLength(1);
    expect(filterItems(items, { list: "" })[0].title).toBe("在收件箱");
    expect(filterItems(items, { list: "工作" })).toHaveLength(2);
    // 不传 list = 不筛选
    expect(filterItems(items, {})).toHaveLength(3);
  });

  it("聚合出清单列表，收件箱排第一", () => {
    const ws = parseWorkspace(`## 收件箱的东西
- id: aaa11111
- kind: task

## 工作的事
- id: bbb22222
- kind: task
- list: 工作

## 工作另一件
- id: ccc33333
- kind: task
- list: 工作

## 个人
- id: ddd44444
- kind: task
- list: 个人
`);
    const lists = collectLists(ws.items);
    expect(lists).toHaveLength(3);
    // 收件箱第一
    expect(lists[0].name).toBe("");
    expect(lists[0].label).toBe("收件箱");
    expect(lists[0].open).toBe(1);
    // 工作有 2 条
    const work = lists.find((l) => l.name === "工作")!;
    expect(work.open).toBe(2);
  });

  it("统计未完成数与逾期数", () => {
    const ws = parseWorkspace(`## 逾期任务
- id: aaa11111
- kind: task
- list: 工作
- due: 2020-01-01

## 已完成
- id: bbb22222
- kind: task
- list: 工作
- done: true
- due: 2020-01-01
`);
    const lists = collectLists(ws.items);
    const work = lists.find((l) => l.name === "工作")!;
    expect(work.total).toBe(2);
    expect(work.open).toBe(1);
    expect(work.overdue).toBe(1); // 已完成的不算逾期
  });

  it("坏条目不计入清单统计", () => {
    const ws = parseWorkspace(`## 好的
- id: aaa11111
- kind: task
- list: 工作

## 坏的
- id: bbb22222
- kind: 瞎写
- list: 工作
`);
    const lists = collectLists(ws.items);
    const work = lists.find((l) => l.name === "工作")!;
    expect(work.total).toBe(1);
  });

  it("清单只统计任务，不把事件算进来", () => {
    const ws = parseWorkspace(`## 一个任务
- id: aaa11111
- kind: task
- list: 工作

## 一个事件
- id: bbb22222
- kind: event
- start: 2026-11-03T10:00:00
- list: 工作
`);
    const lists = collectLists(ws.items);
    const work = lists.find((l) => l.name === "工作")!;
    // 事件属于日历，不参与清单统计
    expect(work.total).toBe(1);
  });

  it("validateItem 接受 list 字段", () => {
    expect(
      validateItem({
        id: "aaa11111",
        kind: "task",
        title: "x",
        list: "工作",
      }),
    ).toEqual([]);
  });
});

describe("子任务", () => {
  const withSubs = () => parseWorkspace(`## 准备竞聘材料
- id: aaa11111
- kind: task
- list: 竞聘

## 第一部分
- id: bbb22222
- kind: task
- parent: aaa11111
- done: true

## 第二部分
- id: ccc33333
- kind: task
- parent: aaa11111

## 第三部分
- id: ddd44444
- kind: task
- parent: aaa11111
`);

  it("parent 字段能往返", () => {
    const text = serializeWorkspace([
      { id: "bbb22222", kind: "task", title: "子任务", parent: "aaa11111" },
    ]);
    const ws = parseWorkspace(text);
    expect(ws.items[0].parent).toBe("aaa11111");
  });

  it("父任务带出子任务进度", () => {
    const items = attachSubtaskProgress(withSubs().items);
    const parent = items.find((i) => i.id === "aaa11111")!;
    expect(parent.subtaskTotal).toBe(3);
    expect(parent.subtaskDone).toBe(1);
    // 1/3 ≈ 33%
    expect(parent.progress).toBe(33);
  });

  it("子任务自己不携带子任务统计", () => {
    const items = attachSubtaskProgress(withSubs().items);
    const kid = items.find((i) => i.id === "bbb22222")!;
    expect(kid.subtaskTotal).toBeUndefined();
    expect(kid.progress).toBeUndefined();
  });

  it("topLevelWithProgress 只返回顶层条目", () => {
    const top = topLevelWithProgress(withSubs().items);
    expect(top).toHaveLength(1);
    expect(top[0].id).toBe("aaa11111");
    expect(top[0].subtaskTotal).toBe(3);
  });

  it("childrenOf 取直接子任务", () => {
    const kids = childrenOf(withSubs().items, "aaa11111");
    expect(kids).toHaveLength(3);
    expect(kids.map((k) => k.id).sort()).toEqual([
      "bbb22222",
      "ccc33333",
      "ddd44444",
    ]);
  });

  it("子任务不计入清单统计（避免数量虚高）", () => {
    const lists = collectLists(withSubs().items);
    const jp = lists.find((l) => l.name === "竞聘")!;
    // 只有父任务算 1 条，3 个子任务不计
    expect(jp.total).toBe(1);
  });

  it("没有子任务时进度字段缺省", () => {
    const ws = parseWorkspace(`## 独立任务
- id: eee55555
- kind: task
`);
    const items = attachSubtaskProgress(ws.items);
    expect(items[0].subtaskTotal).toBeUndefined();
    expect(items[0].progress).toBeUndefined();
  });

  it("子任务全部完成时进度为 100", () => {
    const ws = parseWorkspace(`## 父
- id: aaa11111
- kind: task

## 子1
- id: bbb22222
- kind: task
- parent: aaa11111
- done: true

## 子2
- id: ccc33333
- kind: task
- parent: aaa11111
- done: true
`);
    const items = attachSubtaskProgress(ws.items);
    const parent = items.find((i) => i.id === "aaa11111")!;
    expect(parent.progress).toBe(100);
  });
});
