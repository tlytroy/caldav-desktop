import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Plus,
  Check,
  Trash2,
  CalendarPlus,
  Calendar,
  AlertTriangle,
  Loader2,
  StickyNote,
  Repeat,
  Inbox,
  FolderOpen,
  ListChecks,
} from "lucide-react";
import {
  fetchItems,
  createItem,
  updateItem,
  deleteItem,
  fetchRecurrenceOptions,
  fetchLists,
  type WorkbenchItem,
  type RecurrenceOption,
  type ListSummary,
} from "../../api/workspace";
import { Modal } from "../../components/ui/Modal";

const PRIORITY_META: Record<
  "high" | "mid" | "low",
  { label: string; chip: string; dot: string }
> = {
  high: {
    label: "高",
    chip: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    dot: "bg-red-500",
  },
  mid: {
    label: "中",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  low: {
    label: "低",
    chip: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
    dot: "bg-teal-500",
  },
};

/**
 * 逾期判定：截止日期当天不算逾期。
 */
function isOverdue(t: WorkbenchItem): boolean {
  if (t.done || !t.due) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return new Date(t.due).getTime() < endOfToday.getTime();
}

/**
 * TasksPage —— 任务看板
 *
 * ## 架构
 *
 * 看板是**统一数据源（workspace.md）的一个视图**，与日历读同一个文件。
 * 差别只在筛选条件：看板看 kind=task，日历看「有 start 的」。
 *
 * 所以「体检」这类条目在两边都出现，且指向**同一条记录** ——
 * 不存在旧的「日历里有、看板里找不到」的问题。
 *
 * 也因此这里**没有**「加入日历」按钮：任务已经有 start 就已经显示在日历上了。
 * 需要的是给它一个时间点。
 */
export default function TasksPage() {
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [lists, setLists] = useState<ListSummary[]>([]);
  /**
   * 当前选中的清单。
   *  - undefined → 全部
   *  - ""        → 收件箱（list 为空）
   *  - "工作"    → 该清单
   */
  const [activeList, setActiveList] = useState<string | undefined>(undefined);
  // 新建任务时归入的清单（默认跟随当前视图）
  const [newList, setNewList] = useState("");
  /** 哪些父任务展开了子任务 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 正在给哪个任务加子任务（inline 输入） */
  const [addingChildFor, setAddingChildFor] = useState<string | null>(null);
  const [childTitle, setChildTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recurrenceOptions, setRecurrenceOptions] = useState<RecurrenceOption[]>([
    { value: "", label: "不重复" },
  ]);

  // 表单
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"high" | "mid" | "low">("mid");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [project, setProject] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [allDay, setAllDay] = useState(true);
  // 删除确认
  const [pendingDelete, setPendingDelete] = useState<WorkbenchItem | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // 一次拉全部任务，清单切换在本地过滤 —— 避免每次切清单都请求
      const r = await fetchItems({ scope: "board" });
      setItems(r.items || []);
      setNotes(r.notes || "");
      setError(null);
      // 清单统计由服务端聚合（含逾期数）
      const ls = await fetchLists().catch(() => []);
      setLists(ls);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchRecurrenceOptions()
      .then((opts) =>
        setRecurrenceOptions(opts.length ? opts : [{ value: "", label: "不重复" }]),
      )
      .catch(() => setRecurrenceOptions([{ value: "", label: "不重复" }]));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const submit = async () => {
    if (!title.trim()) return;
    try {
      setSaving(true);
      // 任务需要时间点才能出现在日历上 —— 这是"一处数据，两处显示"的前提
      const hasTime = !!due;
      const start = hasTime
        ? allDay
          ? `${due}T00:00:00`
          : `${due}T${time}:00`
        : undefined;
      const end = hasTime
        ? allDay
          ? undefined
          : `${due}T${endTime}:00`
        : undefined;

      await createItem({
        title: title.trim(),
        kind: "task",
        // 清单：跟随表单里选的值；选了「收件箱」就不写 list
        list: newList || undefined,
        priority,
        due: due || undefined,
        start,
        end,
        allDay,
        project: project || undefined,
        recurrence: recurrence || undefined,
        done: false,
      });

      setTitle("");
      setDue("");
      setTime("09:00");
      setEndTime("10:00");
      setProject("");
      setRecurrence("");
      setNewList(activeList || "");
      setShowForm(false);
      showToast(hasTime ? "已添加任务" : "已添加任务（未设时间，不显示在日历）");
      await load();
    } catch (e) {
      showToast("添加失败：" + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: WorkbenchItem) => {
    await updateItem(t.id, { done: !t.done });
    await load();
  };

  /** 给任务补一个时间点 —— 补上后就出现在日历上了 */
  const setTaskTime = async (t: WorkbenchItem, date: string, timeStr: string) => {
    await updateItem(t.id, {
      start: `${date}T${timeStr}:00`,
      end: `${date}T${timeStr}:00`,
      allDay: false,
      due: t.due || date,
    });
    showToast("已设置时间，同步显示在日历");
    await load();
  };

  const remove = async (t: WorkbenchItem) => {
    try {
      await deleteItem(t.id);
      showToast("已删除");
      await load();
    } catch (e) {
      showToast("删除失败：" + (e as Error).message);
    }
  };

  /** 展开 / 收起子任务 */
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * 给父任务加子任务。
   *
   * 子任务继承父任务的清单 —— 否则它会落到收件箱，
   * 用户在当前清单里看不到刚加的子任务。
   */
  const addChild = async (parent: WorkbenchItem) => {
    const title = childTitle.trim();
    if (!title) return;
    try {
      await createItem({
        title,
        kind: "task",
        parent: parent.id,
        list: parent.list || undefined,
        done: false,
      });
      setChildTitle("");
      setAddingChildFor(null);
      setExpanded((prev) => new Set(prev).add(parent.id));
      showToast("已添加子任务");
      await load();
    } catch (e) {
      showToast("添加失败：" + (e as Error).message);
    }
  };

  /**
   * 当前清单下的条目。
   * undefined = 全部；"" = 收件箱（list 为空）；其他 = 该清单。
   */
  const visibleItems = useMemo(() => {
    if (activeList === undefined) return items;
    return items.filter((i) => (i.list || "") === activeList);
  }, [items, activeList]);

  /** 顶层条目（不含子任务）—— 主列表只渲染这些 */
  const topItems = useMemo(
    () => (visibleItems || []).filter((i) => !i.parent),
    [visibleItems],
  );

  /** 取某个父任务的直接子任务 */
  const kidsOf = useCallback(
    (parentId: string) => (visibleItems || []).filter((i) => i.parent === parentId),
    [visibleItems],
  );

  const { open, done, overdue } = useMemo(() => {
    const todos = topItems || [];
    return {
      open: todos.filter((t) => !t.done),
      done: todos.filter((t) => t.done),
      overdue: todos.filter(isOverdue),
    };
  }, [topItems]);

  if (loading && !items.length) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载中…
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">任务看板</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            与日历共用同一个数据源 · 任务和事件只存一份
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" /> 添加任务
        </button>
      </div>

      {/* 清单切换 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 全部 */}
        <button
          onClick={() => setActiveList(undefined)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            activeList === undefined
              ? "bg-brand text-white"
              : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
          }`}
        >
          全部
          <span className="text-xs opacity-70">{items.filter((i) => !i.done).length}</span>
        </button>

        {lists.map((l) => {
          const active = activeList === l.name;
          const isInbox = l.name === "";
          return (
            <button
              key={l.name || "__inbox__"}
              onClick={() => setActiveList(l.name)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-brand text-white"
                  : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
              }`}
              title={isInbox ? "还没归类的条目" : `清单：${l.name}`}
            >
              {isInbox ? (
                <Inbox className="w-3.5 h-3.5" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5" />
              )}
              {l.label}
              <span className="text-xs opacity-70">{l.open}</span>
              {l.overdue > 0 && (
                <span className="text-xs px-1 rounded bg-red-500 text-white">
                  {l.overdue}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 逾期告警 */}
      {overdue.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
          {overdue.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white dark:bg-red-900/40 text-red-600 dark:text-red-300 text-xs font-medium"
            >
              {t.title}（{t.due}）
            </span>
          ))}
        </div>
      )}

      {/* 添加表单 */}
      {showForm && (
        <div className="p-4 rounded-lg bg-white dark:bg-neutral-900 border border-gray-200 dark:border-gray-700 space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="任务标题…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <select
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as "high" | "mid" | "low")
              }
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            >
              <option value="high">高优先级</option>
              <option value="mid">中优先级</option>
              <option value="low">低优先级</option>
            </select>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={allDay}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white disabled:opacity-50"
            />
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={allDay}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="项目"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            />
            {/* 清单：可输入已有清单名，留空即收件箱 */}
            <input
              value={newList}
              onChange={(e) => setNewList(e.target.value)}
              placeholder="清单（留空=收件箱）"
              list="workspace-lists"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            />
            <datalist id="workspace-lists">
              {lists
                .filter((l) => l.name)
                .map((l) => (
                  <option key={l.name} value={l.name} />
                ))}
            </datalist>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            >
              {recurrenceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="col-span-2 flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand"
              />
              全天（不填具体时间）
            </label>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            {due
              ? "设了日期的任务会同时显示在日历上"
              : "不设日期则只出现在看板（设了日期才会同步到日历）"}
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={saving || !title.trim()}
              className="px-4 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} 保存
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* 待办列表（按优先级分组） */}
      <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
          待办 <span className="text-sm font-normal text-gray-400">({open.length})</span>
        </h2>
        {open.length === 0 ? (
          <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
            暂无待办，点右上角「添加任务」开始吧
          </p>
        ) : (
          <div className="space-y-2">
            {(["high", "mid", "low"] as const)
              .flatMap((p) => open.filter((t) => t.priority === p))
              .map((t) => (
                <React.Fragment key={t.id}>
                <div
                  className="group flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-neutral-800 hover:bg-gray-100 dark:hover:bg-neutral-700/60 transition-colors"
                >
                  <button
                    onClick={() => toggle(t)}
                    className="w-5 h-5 rounded-md border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center shrink-0 hover:border-brand"
                    title="标记完成"
                  >
                    {t.done && <Check className="w-3.5 h-3.5 text-brand" />}
                  </button>
                  <span
                    className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${PRIORITY_META[t.priority || "mid"].chip}`}
                  >
                    {PRIORITY_META[t.priority || "mid"].label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-2">
                      {t.title}
                      {t.start && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 text-[10px] font-medium shrink-0"
                          title={`已排期：${t.start}`}
                        >
                          <Calendar className="w-3 h-3" />
                          已排期
                        </span>
                      )}
                      {t.recurrence && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 text-[10px] font-medium shrink-0"
                          title={t.recurrence}
                        >
                          <Repeat className="w-3 h-3" />
                          重复
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                      {t.start && (
                        <span
                          className={
                            isOverdue(t) ? "text-red-500 font-medium" : ""
                          }
                        >
                          {t.start.replace("T", " ").slice(0, 16)}
                        </span>
                      )}
                      {t.due && !t.start && <span>截止 {t.due}</span>}
                      {t.project && <span>项目 {t.project}</span>}
                      {/* 在「全部」视图下才显示清单名，避免当前清单里重复 */}
                      {activeList === undefined && t.list && (
                        <span className="inline-flex items-center gap-0.5">
                          <FolderOpen className="w-3 h-3" />
                          {t.list}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 子任务按钮：有子任务时显示进度，无子任务时可添加 */}
                  <button
                    onClick={() => {
                      if (t.subtaskTotal) {
                        toggleExpand(t.id);
                      } else {
                        setAddingChildFor(t.id);
                        setExpanded((prev) => new Set(prev).add(t.id));
                      }
                    }}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] shrink-0 transition-colors ${
                      t.subtaskTotal
                        ? "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
                        : "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand hover:bg-white dark:hover:bg-neutral-900"
                    }`}
                    title={t.subtaskTotal ? "展开/收起子任务" : "添加子任务"}
                  >
                    <ListChecks className="w-3.5 h-3.5" />
                    {t.subtaskTotal ? `${t.subtaskDone}/${t.subtaskTotal}` : ""}
                  </button>

                  {!t.start && (
                    <button
                      onClick={() => {
                        const d =
                          t.due || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
                        setTaskTime(t, d, "09:00");
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-brand hover:bg-white dark:hover:bg-neutral-900 transition-all"
                      title="排期（排期后同时显示在日历）"
                    >
                      <CalendarPlus className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setPendingDelete(t)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-white dark:hover:bg-neutral-900 transition-all"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* 进度条：有子任务时显示 */}
                {!!t.subtaskTotal && (
                  <div className="ml-8 mr-3 -mt-1 mb-1">
                    <div className="h-1 rounded-full bg-gray-200 dark:bg-neutral-700 overflow-hidden">
                      <div
                        className={`h-full transition-all ${t.progress === 100 ? "bg-green-500" : "bg-brand"}`}
                        style={{ width: `${t.progress ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* 展开的子任务区 */}
                {expanded.has(t.id) && (
                  <div className="ml-8 mr-3 mt-1 space-y-1">
                    {kidsOf(t.id).map((k) => (
                      <div
                        key={k.id}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-neutral-700/60"
                      >
                        <button
                          onClick={() => toggle(k)}
                          className="w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center shrink-0 hover:border-brand"
                          title="标记完成"
                        >
                          {k.done && <Check className="w-2.5 h-2.5 text-brand" />}
                        </button>
                        <span
                          className={`flex-1 text-sm truncate ${
                            k.done
                              ? "line-through text-gray-400 dark:text-gray-500"
                              : "text-gray-700 dark:text-gray-200"
                          }`}
                        >
                          {k.title}
                        </span>
                        <button
                          onClick={() => setPendingDelete(k)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500"
                          title="删除子任务"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}

                    {/* 加子任务 */}
                    {addingChildFor === t.id ? (
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <input
                          autoFocus
                          value={childTitle}
                          onChange={(e) => setChildTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addChild(t);
                            if (e.key === "Escape") {
                              setAddingChildFor(null);
                              setChildTitle("");
                            }
                          }}
                          placeholder="子任务标题，回车添加"
                          className="flex-1 px-2 py-1 text-sm rounded border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand"
                        />
                        <button
                          onClick={() => addChild(t)}
                          className="px-2 py-1 text-xs rounded bg-brand text-white"
                        >
                          添加
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setAddingChildFor(t.id);
                          setChildTitle("");
                        }}
                        className="ml-6 text-xs text-gray-400 hover:text-brand py-1"
                      >
                        + 加子任务
                      </button>
                    )}
                  </div>
                )}
                </React.Fragment>
              ))}
          </div>
        )}
      </section>

      {/* 已完成 */}
      {done.length > 0 && (
        <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            已完成 <span className="text-sm font-normal text-gray-400">({done.length})</span>
          </h2>
          <div className="space-y-2">
            {done.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-neutral-800 opacity-70"
              >
                <button
                  onClick={() => toggle(t)}
                  className="w-5 h-5 rounded-md border-2 border-brand bg-brand flex items-center justify-center shrink-0"
                  title="撤销完成"
                >
                  <Check className="w-3.5 h-3.5 text-white" />
                </button>
                <span className="flex-1 text-sm text-gray-500 dark:text-gray-400 line-through truncate inline-flex items-center gap-2">
                  {t.title}
                  {t.start && <Calendar className="w-3 h-3 text-sky-500 shrink-0" />}
                </span>
                <button
                  onClick={() => setPendingDelete(t)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-red-500"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 自由笔记区（项目 / 速记） */}
      {notes.trim() && (
        <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center">
            <StickyNote className="w-5 h-5 mr-2 text-brand" /> 笔记
          </h2>
          <pre className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans">
            {notes}
          </pre>
        </section>
      )}

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* 删除确认弹窗 */}
      {pendingDelete && (
        <Modal
          isOpen={true}
          onClose={() => setPendingDelete(null)}
          title="确认删除"
          size="sm"
        >
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            确定删除任务「{pendingDelete.title}」吗？
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            该条目只存一份，删除后日历上也不会再显示。
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPendingDelete(null)}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-neutral-800 rounded-lg hover:bg-gray-200 dark:hover:bg-neutral-700"
            >
              取消
            </button>
            <button
              onClick={async () => {
                const t = pendingDelete;
                setPendingDelete(null);
                await remove(t);
              }}
              className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
            >
              删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
