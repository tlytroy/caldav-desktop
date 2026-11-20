import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseWorkspace,
  readWorkspace,
  serializeWorkspace,
  isParseableItem,
  type WorkbenchItem,
} from "../workspace.js";
import {
  mutateWorkspace,
  mutateWorkspaceText,
  validateWorkspaceGraph,
} from "../workspace-store.js";
import { __resetWorkspaceLockForTests } from "../workspace-lock.js";

/** 直接用序列化结果铺底：绕开 store，模拟「用户手工编辑过的文件」 */
function seedFile(items: WorkbenchItem[], notes = ""): void {
  fs.writeFileSync(file, serializeWorkspace(items as any, notes), "utf-8");
}
import { LockReentryError, LockTimeoutError, WorkspaceReadError, WorkspaceValidationError } from "../errors.js";
import { invalidateSyncEpoch, setStorageReadOnly, setSyncMaintenance } from "../sync-control.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-store-"));
  file = path.join(dir, "workspace.md");
  __resetWorkspaceLockForTests();
  setStorageReadOnly(false);
  setSyncMaintenance(false);
});

afterEach(() => {
  setStorageReadOnly(false);
  setSyncMaintenance(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

function item(over: Partial<WorkbenchItem> = {}): WorkbenchItem {
  return {
    id: over.id ?? "aaaa1111",
    kind: "task",
    title: over.title ?? "任务",
    ...over,
  } as WorkbenchItem;
}

describe("读取容错（S1）", () => {
  it("文件不存在 → 空集合，不抛错", () => {
    const ws = readWorkspace(file);
    expect(ws.items).toEqual([]);
    expect(ws.notes).toBe("");
    expect(ws.raw).toBe("");
    expect(ws.frontmatterRaw).toContain("workbench/v1");
  });

  it("目录当文件读 → WorkspaceReadError，不返回空", () => {
    fs.mkdirSync(file);
    expect(() => readWorkspace(file)).toThrow(WorkspaceReadError);
  });

  it("全部条目无法解析 → WorkspaceReadError（绝不静默当空）", () => {
    fs.writeFileSync(file, "## 只有标题\n\n## 另一个\n", "utf-8");
    expect(() => readWorkspace(file)).toThrow(/所有条目都无法解析/);
  });

  it("部分坏块保留，好条目照常可读", () => {
    fs.writeFileSync(
      file,
      "## 好任务\n- id: aaaa1111\n- kind: task\n\n## 坏的\n- 随便写\n",
      "utf-8",
    );
    const ws = readWorkspace(file);
    expect(ws.items).toHaveLength(2);
    expect(ws.items[0].title).toBe("好任务");
    expect(ws.items[1].errors?.length).toBeGreaterThan(0);
    expect(ws.items[1].rawBlock).toContain("随便写");
  });
});

describe("round-trip 保真（S5）", () => {
  const text = [
    "---",
    "schema: workbench/v2",
    "title: My Vault",
    "tags:",
    "  - a",
    "  - b",
    "# 注释",
    "---",
    "",
    "## 会议 \"Q4\"",
    "- id: aaaa1111",
    "- kind: event",
    "- start: 2026-11-02T10:00:00",
    "- end: 2026-11-02T11:00:00",
    "- description: 第一行\\n第二行",
    "- custom: 保留我",
    "- 另一个: 值",
    "",
    "<!-- notes -->",
    "笔记内容",
    "",
    "<!-- workbench:unknown:start -->",
    "| 表 | 格 |",
    "<!-- workbench:unknown:end -->",
    "",
  ].join("\n");

  it("frontmatter 原样保留，不把 v2 降级成 v1", () => {
    const ws = parseWorkspace(text);
    const out = serializeWorkspace(ws.items, ws.notes, {
      frontmatterRaw: ws.frontmatterRaw,
      unknownBlocks: ws.unknownBlocks,
    });
    expect(out).toContain("schema: workbench/v2");
    expect(out).toContain("title: My Vault");
    expect(out).toContain("  - a");
    expect(out).not.toContain("schema: workbench/v1");
  });

  it("未知字段、未知块、笔记都不丢", () => {
    const ws = parseWorkspace(text);
    const out = serializeWorkspace(ws.items, ws.notes, {
      frontmatterRaw: ws.frontmatterRaw,
      unknownBlocks: ws.unknownBlocks,
    });
    expect(out).toContain("- custom: 保留我");
    expect(out).toContain("- 另一个: 值");
    expect(out).toContain("笔记内容");
    expect(out).toContain("| 表 | 格 |");
    expect(out).toContain("<!-- workbench:unknown:start -->");
  });

  it("序列化 → 解析 → 序列化 幂等", () => {
    const ws = parseWorkspace(text);
    const once = serializeWorkspace(ws.items, ws.notes, {
      frontmatterRaw: ws.frontmatterRaw,
      unknownBlocks: ws.unknownBlocks,
    });
    const ws2 = parseWorkspace(once);
    const twice = serializeWorkspace(ws2.items, ws2.notes, {
      frontmatterRaw: ws2.frontmatterRaw,
      unknownBlocks: ws2.unknownBlocks,
    });
    expect(twice).toBe(once);
  });

  it("标题里的引号/反斜杠/换行不会破坏格式", () => {
    const ws = parseWorkspace("## 标题\n- id: bbbb2222\n- kind: task\n");
    ws.items[0].title = 'a "b" \\ c';
    ws.items[0].description = "第一行\n第二行";
    const out = serializeWorkspace(ws.items, ws.notes);
    const again = parseWorkspace(out);
    expect(again.items[0].title).toBe('a "b" \\ c');
    expect(again.items[0].description).toBe("第一行\n第二行");
  });
});

describe("写入口 mutateWorkspace（S2）", () => {
  it("并发 50 次创建：一条不丢", async () => {
    fs.writeFileSync(file, serializeWorkspace([], ""), "utf-8");

    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        mutateWorkspace(
          (ws) => {
            ws.items.push(item({ id: `id${i.toString().padStart(6, "0")}`, title: `任务 ${i}` }));
          },
          { filePath: file },
        ),
      ),
    );

    const ws = readWorkspace(file);
    expect(ws.items).toHaveLength(50);
    expect(new Set(ws.items.map((i) => i.id)).size).toBe(50);
  });

  it("同一条目的两个字段并发修改都保留", async () => {
    seedFile([item({ id: "aaaa1111" })]);

    await Promise.all([
      mutateWorkspace((ws) => { ws.items[0].title = "新标题"; }, { filePath: file }),
      mutateWorkspace((ws) => { ws.items[0].priority = "high"; }, { filePath: file }),
    ]);

    const ws = readWorkspace(file);
    expect(ws.items[0].title).toBe("新标题");
    expect(ws.items[0].priority).toBe("high");
  });

  it("删除最后一条是合法操作（不因「至少一条」被拒）", async () => {
    seedFile([item({ id: "aaaa1111" })]);
    await mutateWorkspace((ws) => { ws.items.length = 0; }, { filePath: file });
    expect(readWorkspace(file).items).toEqual([]);
  });

  it("排队超时后任务不会再执行（S2 关键）", async () => {
    seedFile([item({ id: "aaaa1111" })]);
    let slowDone = false;
    let lateRan = false;

    const slow = mutateWorkspace(
      async (ws) => {
        await new Promise((r) => setTimeout(r, 300));
        ws.items[0].title = "慢任务写完";
        slowDone = true;
      },
      { filePath: file },
    );

    await expect(
      mutateWorkspace(
        (ws) => {
          lateRan = true;
          ws.items[0].title = "不该出现";
        },
        { filePath: file, timeoutMs: 30 },
      ),
    ).rejects.toBeInstanceOf(LockTimeoutError);

    await slow;
    await new Promise((r) => setTimeout(r, 350));

    expect(slowDone).toBe(true);
    expect(lateRan).toBe(false);
    expect(readWorkspace(file).items[0].title).toBe("慢任务写完");
  });

  it("锁内再次调用 mutateWorkspace → LockReentryError", async () => {
    seedFile([item()]);
    await expect(
      mutateWorkspace(async () => {
        await mutateWorkspace(() => {}, { filePath: file });
      }, { filePath: file }),
    ).rejects.toBeInstanceOf(LockReentryError);
  });

  it("写出来的文本自己读不回来时拒绝落盘", async () => {
    seedFile([item({ id: "aaaa1111" })]);
    const before = fs.readFileSync(file, "utf-8");

    await expect(
      mutateWorkspaceText(() => ({
        result: null,
        text: "## 没有任何字段\n\n## 也没有\n",
      }), { filePath: file }),
    ).rejects.toBeInstanceOf(WorkspaceReadError);

    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });

  it("只读模式拒绝写入", async () => {
    seedFile([item()]);
    setStorageReadOnly(true);
    await expect(
      mutateWorkspace((ws) => { ws.items[0].title = "x"; }, { filePath: file }),
    ).rejects.toThrow(/只读/);
  });

  it("恢复维护期间拒绝写入", async () => {
    seedFile([item()]);
    setSyncMaintenance(true);
    await expect(
      mutateWorkspace((ws) => { ws.items[0].title = "x"; }, { filePath: file }),
    ).rejects.toThrow(/恢复/);
  });

  it("fn 挂起期间进入恢复维护态 → 提交前被拦住，不写盘", async () => {
    seedFile([item({ title: "原文" })]);
    const before = fs.readFileSync(file, "utf-8");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const writing = mutateWorkspace(async (ws) => {
      ws.items[0].title = "被中断的编辑";
      await gate; // 让出事件循环，模拟异步写入
    }, { filePath: file });

    // 写入已持有锁并过了入口检查，此时恢复开始
    setSyncMaintenance(true);
    release();

    await expect(writing).rejects.toThrow(/恢复/);
    expect(fs.readFileSync(file, "utf-8")).toBe(before); // 旧快照没有落盘
  });

  it("fn 挂起期间 epoch 变化 → 提交前被拦住，不写盘", async () => {
    seedFile([item({ title: "原文" })]);
    const before = fs.readFileSync(file, "utf-8");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const writing = mutateWorkspace(async (ws) => {
      ws.items[0].title = "过期纪元的编辑";
      await gate;
      invalidateSyncEpoch(); // 模拟恢复在 await 期间让纪元失效
    }, { filePath: file });

    release();

    await expect(writing).rejects.toThrow(/纪元|同步/);
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });
});

describe("图校验（S6）", () => {
  it("历史脏数据不阻塞无关条目写入", async () => {
    const dirty = [
      item({ id: "aaaa1111", title: "历史坏数据", start: "2026-01-02T10:00:00", end: "2026-01-01T10:00:00" }),
      item({ id: "bbbb2222", title: "正常" }),
    ];
    seedFile(dirty);

    await expect(
      mutateWorkspace((ws) => {
        const normal = ws.items.find((i) => i.id === "bbbb2222")!;
        normal.title = "正常（已改）";
      }, { filePath: file }),
    ).resolves.toBeTruthy();

    expect(readWorkspace(file).items.find((i) => i.id === "bbbb2222")!.title).toBe("正常（已改）");
  });

  it("改到坏条目本身时拒绝，并说明原因", async () => {
    seedFile([
      item({ id: "aaaa1111", start: "2026-01-02T10:00:00", end: "2026-01-01T10:00:00" }),
    ]);

    await expect(
      mutateWorkspace((ws) => { ws.items[0].title = "改标题"; }, { filePath: file }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("删除父条目留下孤儿 → 拒绝", async () => {
    seedFile([
      item({ id: "parent01", title: "父" }),
      item({ id: "child001", title: "子", parent: "parent01" }),
    ]);

    await expect(
      mutateWorkspace((ws) => {
        ws.items = ws.items.filter((i) => i.id !== "parent01");
      }, { filePath: file }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("自环 / 环 / end<=start / remind 非法都能报出来", () => {
    const issues = validateWorkspaceGraph(
      [
        item({ id: "a", parent: "a" }),
        item({ id: "b", parent: "c" }),
        item({ id: "c", parent: "b" }),
        item({ id: "d", start: "2026-01-02T10:00:00", end: "2026-01-01T10:00:00" }),
        item({ id: "e", remind: "明天早上" }),
      ],
      { includeHistorical: true },
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("SELF_PARENT");
    expect(codes).toContain("PARENT_CYCLE");
    expect(codes).toContain("INVALID_RANGE");
    expect(codes).toContain("INVALID_REMIND");
  });

  it("validate=all 时历史脏数据也会拦下", async () => {
    seedFile([
      item({ id: "aaaa1111", start: "2026-01-02T10:00:00", end: "2026-01-01T10:00:00" }),
    ]);
    await expect(
      mutateWorkspace((ws) => { ws.notes = "x"; }, { filePath: file, validate: "all" }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });
});

describe("mutateWorkspaceText（merge 用）", () => {
  it("写入调用方文本，并把基线快照传给回调", async () => {
    seedFile([item({ id: "aaaa1111", title: "旧" })], "旧笔记");

    const res = await mutateWorkspaceText(
      (ws) => {
        expect(ws.raw ?? "").toContain("旧笔记");
        const next = parseWorkspace((ws.raw ?? "").replace("旧", "新"));
        return {
          result: "merged",
          text: serializeWorkspace(next.items, next.notes, {
            frontmatterRaw: next.frontmatterRaw,
            unknownBlocks: next.unknownBlocks,
          }),
        };
      },
      { filePath: file },
    );

    expect(res.result).toBe("merged");
    expect(readWorkspace(file).items[0].title).toBe("新");
  });
});

describe("原子写", () => {
  it("写完不会留下 tmp 文件，且内容是完整文本", async () => {
    await mutateWorkspace((ws) => {
      ws.items.push(item({ id: "aaaa1111", title: "标题" }));
    }, { filePath: file });

    const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(leftovers).toEqual([]);
    expect(fs.readFileSync(file, "utf-8")).toContain("## 标题");
  });

  it("解析坏块会原样写回", async () => {
    const content = "## 好的\n- id: aaaa1111\n- kind: task\n\n## 坏的\n- 乱写\n";
    fs.writeFileSync(file, content, "utf-8");
    await mutateWorkspace((ws) => { ws.items[0].title = "改好了"; }, { filePath: file });
    const text = fs.readFileSync(file, "utf-8");
    expect(text).toContain("改好了");
    expect(text).toContain("- 乱写");
  });
});

describe("isParseableItem", () => {
  it("有 id 或已知字段即可识别", () => {
    expect(isParseableItem(parseWorkspace("## t\n- id: aaaa1111\n").items[0])).toBe(true);
    expect(isParseableItem(parseWorkspace("## t\n- kind: task\n").items[0])).toBe(true);
    expect(isParseableItem(parseWorkspace("## t\n").items[0])).toBe(false);
  });
});
