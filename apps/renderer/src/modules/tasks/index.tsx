import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Check,
  Trash2,
  CalendarPlus,
  Calendar,
  AlertTriangle,
  Loader2,
  StickyNote,
  FolderKanban,
} from "lucide-react";
import {
  fetchKanban,
  addKanbanTask,
  updateKanbanTask,
  deleteKanbanTask,
  unlinkKanbanCalendar,
  type KanbanData,
  type KanbanTodo,
} from "../../api/kanban";
import { Modal } from "../../components/ui/Modal";

const PRIORITY_META: Record<
  KanbanTodo["priority"],
  { label: string; chip: string; dot: string }
> = {
  高: {
    label: "高",
    chip: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    dot: "bg-red-500",
  },
  中: {
    label: "中",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  低: {
    label: "低",
    chip: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
    dot: "bg-teal-500",
  },
};

/**
 * 逾期判定：截止日期当天不算逾期。
 * `new Date("2026-08-20")` 会解析成当天 00:00，与当天此刻比较必然小于，
 * 所以要跟「今天 24:00」比，而不是 Date.now()。
 */
function isOverdue(t: KanbanTodo): boolean {
  if (t.done || !t.due) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return new Date(t.due).getTime() < endOfToday.getTime();
}

export default function TasksPage() {
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 表单
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<KanbanTodo["priority"]>("中");
  const [due, setDue] = useState("");
  const [project, setProject] = useState("");
  const [estimate, setEstimate] = useState("");
  // 加入日历（双向绑定）相关
  const [addToCal, setAddToCal] = useState(false);
  const [calDate, setCalDate] = useState("");
  const [calTime, setCalTime] = useState("09:00");
  const [calEndDate, setCalEndDate] = useState("");
  const [calEndTime, setCalEndTime] = useState("10:00");
  const [calAllDay, setCalAllDay] = useState(false);
  // 编辑任务日历弹窗
  const [calLinkTask, setCalLinkTask] = useState<KanbanTodo | null>(null);
  // 删除确认
  const [pendingDelete, setPendingDelete] = useState<KanbanTodo | null>(null);
  const [deleteLinkedEvent, setDeleteLinkedEvent] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const d = await fetchKanban();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const submit = async () => {
    if (!title.trim()) return;
    try {
      setSaving(true);
      const payload: Parameters<typeof addKanbanTask>[0] = {
        title: title.trim(),
        priority,
        due: due || undefined,
        project: project || undefined,
        estimate: estimate ? Number(estimate) : undefined,
      };
      if (addToCal && calDate) {
        payload.calendar = {
          date: calDate,
          endDate: calEndDate || calDate,
          time: calAllDay ? undefined : calTime,
          endTime: calAllDay ? undefined : calEndTime,
          allDay: calAllDay,
        };
        // 全天且没填 due 时，把 due 同步过去（避免重复输入）
        if (calAllDay && !due) payload.due = calDate;
      }
      await addKanbanTask(payload);
      setTitle("");
      setDue("");
      setProject("");
      setEstimate("");
      setAddToCal(false);
      setCalDate("");
      setCalEndDate("");
      setCalTime("09:00");
      setCalEndTime("10:00");
      setCalAllDay(false);
      setShowForm(false);
      showToast(
        addToCal && calDate ? "已添加任务并加入日历" : "已添加任务",
      );
      await load();
    } catch (e) {
      showToast("添加失败：" + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: KanbanTodo) => {
    await updateKanbanTask(t.id, { done: !t.done });
    await load();
  };

  /**
   * 把已存在的任务加入日历（生成新的事件并绑定）。
   */
  const linkToCalendar = async (t: KanbanTodo) => {
    const dateStr =
      t.due || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await updateKanbanTask(t.id, {
      calendar: { date: dateStr, allDay: true },
    });
  };

  /** 用户点任务日历 chip 时——弹窗确认日期再绑定 */
  const openLinkDialog = (t: KanbanTodo) => {
    setCalLinkTask(t);
  };
  const saveLinkDialog = async (opts: {
    date: string;
    endDate?: string;
    time?: string;
    endTime?: string;
    allDay: boolean;
  }) => {
    if (!calLinkTask) return;
    await updateKanbanTask(calLinkTask.id, { calendar: opts });
    setCalLinkTask(null);
    showToast("已加入日历，与任务绑定");
    await load();
  };

  /** 解除任务与日历的绑定（保留事件独立存在）。 */
  const unlinkCalendar = async (t: KanbanTodo) => {
    await unlinkKanbanCalendar(t.id);
    showToast("已解除日历绑定，日历事件保留");
    await load();
  };

  /**
   * 删除任务时连带删除日历事件。
   * 通过 PATCH /task/:id 加 clearCalendar:true，让后端先把事件删了，
   * 再删任务本身（避免卸-删-卸过程留下孤儿事件）。
   */
  const remove = async (t: KanbanTodo, alsoDeleteEvent: boolean) => {
    try {
      if (alsoDeleteEvent && t.calendarEventUid) {
        await updateKanbanTask(t.id, { clearCalendar: true });
      } else if (t.calendarEventUid && !alsoDeleteEvent) {
        // 只想删任务，事件要保留 → 先解除绑定
        await unlinkKanbanCalendar(t.id);
      }
      await deleteKanbanTask(t.id);
      showToast("已删除");
      await load();
    } catch (e) {
      showToast("删除失败：" + (e as Error).message);
    }
  };

  const { open, done, overdue } = useMemo(() => {
    const todos = data?.todos || [];
    return {
      open: todos.filter((t) => !t.done),
      done: todos.filter((t) => t.done),
      // 与 isOverdue 保持同一判定，避免"红字但不在告警条"的不一致
      overdue: todos.filter(isOverdue),
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载看板中…
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
            工作搭子唯一事实源 · 直接读写 工作搭子看板.md
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" /> 添加任务
        </button>
      </div>

      {/* 逾期告警 */}
      {overdue.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
          {overdue.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white dark:bg-red-900/40 text-red-600 dark:text-red-300 text-xs font-medium cursor-pointer"
              onClick={() => openLinkDialog(t)}
              title={t.calendarEventUid ? "点击改绑日历" : "点击加入日历"}
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
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as KanbanTodo["priority"])}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            >
              <option value="高">高优先级</option>
              <option value="中">中优先级</option>
              <option value="低">低优先级</option>
            </select>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            />
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="项目"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            />
            <input
              value={estimate}
              onChange={(e) => setEstimate(e.target.value.replace(/\D/g, ""))}
              placeholder="预估工时(h)"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
            />
          </div>

          {/* 双向绑定：同时加入日历 */}
          <div className="border-t border-gray-100 dark:border-neutral-800 pt-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={addToCal}
                onChange={(e) => setAddToCal(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <CalendarPlus className="w-4 h-4 text-brand" />
              同时加入日历（与任务双向绑定）
            </label>
            {addToCal && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <input
                  type="date"
                  value={calDate}
                  onChange={(e) => setCalDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
                />
                <input
                  type="date"
                  value={calEndDate}
                  onChange={(e) => setCalEndDate(e.target.value)}
                  placeholder="结束日期"
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
                />
                <input
                  type="time"
                  value={calTime}
                  onChange={(e) => setCalTime(e.target.value)}
                  disabled={calAllDay}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white disabled:opacity-50"
                />
                <input
                  type="time"
                  value={calEndTime}
                  onChange={(e) => setCalEndTime(e.target.value)}
                  disabled={calAllDay}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white disabled:opacity-50"
                />
                <label className="col-span-2 sm:col-span-4 flex items-center gap-2 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={calAllDay}
                    onChange={(e) => setCalAllDay(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  全天事件
                </label>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
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
            {(["高", "中", "低"] as const)
              .flatMap((p) => open.filter((t) => t.priority === p))
              .map((t) => (
                <div
                  key={t.id}
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
                    className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${PRIORITY_META[t.priority].chip}`}
                  >
                    {PRIORITY_META[t.priority].label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-2">
                      {t.title}
                      {t.calendarEventUid && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 text-[10px] font-medium shrink-0"
                          title={`日历事件 UID: ${t.calendarEventUid}`}
                        >
                          <Calendar className="w-3 h-3" />
                          已加入日历
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                      {t.due && <span className={isOverdue(t) ? "text-red-500 font-medium" : ""}>截止 {t.due}</span>}
                      {t.project && <span>项目 {t.project}</span>}
                      {t.estimate != null && <span>预估 {t.estimate}h</span>}
                    </div>
                  </div>
                  {!t.calendarEventUid ? (
                    <button
                      onClick={() => linkToCalendar(t)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-brand hover:bg-white dark:hover:bg-neutral-900 transition-all"
                      title="加入日历（与任务双向绑定）"
                    >
                      <CalendarPlus className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => openLinkDialog(t)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-brand hover:bg-white dark:hover:bg-neutral-900 transition-all"
                      title="改绑日历日期"
                    >
                      <Calendar className="w-4 h-4" />
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
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-neutral-800 opacity-70">
                <button
                  onClick={() => toggle(t)}
                  className="w-5 h-5 rounded-md border-2 border-brand bg-brand flex items-center justify-center shrink-0"
                  title="撤销完成"
                >
                  <Check className="w-3.5 h-3.5 text-white" />
                </button>
                <span className="flex-1 text-sm text-gray-500 dark:text-gray-400 line-through truncate inline-flex items-center gap-2">
                  {t.title}
                  {t.calendarEventUid && (
                    <Calendar className="w-3 h-3 text-sky-500 shrink-0" />
                  )}
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

      {/* 项目 + 速记 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center">
            <FolderKanban className="w-5 h-5 mr-2 text-brand" /> 项目
          </h2>
          {data && data.projects.length > 0 ? (
            <div className="space-y-3">
              {data.projects.map((p) => (
                <div key={p.name} className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
                  <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                    {p.current && <div>当前：{p.current}</div>}
                    {p.next && <div>下一步：{p.next}</div>}
                    {p.blocker && <div>卡点：{p.blocker}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">暂无项目</p>
          )}
        </section>

        <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center">
            <StickyNote className="w-5 h-5 mr-2 text-brand" /> 速记
          </h2>
          {data && data.notes.length > 0 ? (
            <div className="space-y-2">
              {data.notes.map((n, i) => (
                <div key={i} className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800 text-sm text-gray-700 dark:text-gray-300">
                  {n.tags.map((t) => (
                    <span key={t} className="text-brand font-medium mr-1">#{t}</span>
                  ))}
                  {n.text}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">暂无速记</p>
          )}
        </section>
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* 改绑日历弹窗 */}
      {calLinkTask && (
        <LinkCalendarDialog
          task={calLinkTask}
          onClose={() => setCalLinkTask(null)}
          onSave={async (opts) => {
            try {
              await saveLinkDialog(opts);
            } catch (e) {
              showToast("改绑失败：" + (e as Error).message);
            }
          }}
          onUnlink={
            calLinkTask.calendarEventUid
              ? async () => {
                  try {
                    await unlinkCalendar(calLinkTask);
                  } catch (e) {
                    showToast("解绑失败：" + (e as Error).message);
                  }
                }
              : undefined
          }
        />
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
          {pendingDelete.calendarEventUid && (
            <label className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm mb-4">
              <input
                type="checkbox"
                checked={deleteLinkedEvent}
                onChange={(e) => setDeleteLinkedEvent(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                <span className="font-medium text-amber-700 dark:text-amber-300">
                  同时删除日历事件
                </span>
                <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                  任务已与日历事件绑定（uid: {pendingDelete.calendarEventUid}）。
                  取消勾选则仅解除绑定、保留日历事件。
                </span>
              </span>
            </label>
          )}
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
                await remove(t, deleteLinkedEvent);
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

/**
 * 改绑日历日期弹窗（也用于首次绑定）
 */
function LinkCalendarDialog({
  task,
  onClose,
  onSave,
  onUnlink,
}: {
  task: KanbanTodo;
  onClose: () => void;
  onSave: (opts: {
    date: string;
    endDate?: string;
    time?: string;
    endTime?: string;
    allDay: boolean;
  }) => Promise<void> | void;
  onUnlink?: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(
    task.due || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(true);
  const [saving, setSaving] = useState(false);

  return (
    <Modal isOpen={true} onClose={onClose} title="加入日历（双向绑定）" size="md">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        任务「{task.title}」将创建一个日历事件并互填链接字段。
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">开始日期 *</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">结束日期</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            placeholder="可选"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">开始时间</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={allDay}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">结束时间</label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            disabled={allDay}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white disabled:opacity-50"
          />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
        />
        全天事件
      </label>
      <div className="flex justify-between gap-2 mt-5 pt-4 border-t border-gray-100 dark:border-neutral-800">
        <div>
          {onUnlink && (
            <button
              onClick={async () => {
                if (!onUnlink) return;
                setSaving(true);
                await onUnlink();
                setSaving(false);
                onClose();
              }}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:underline"
            >
              解除日历绑定
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-neutral-800 rounded-lg hover:bg-gray-200 dark:hover:bg-neutral-700"
          >
            取消
          </button>
          <button
            disabled={!date || saving}
            onClick={async () => {
              setSaving(true);
              await onSave({
                date,
                endDate: endDate || undefined,
                time: allDay ? undefined : time,
                endTime: allDay ? undefined : endTime,
                allDay,
              });
              setSaving(false);
              onClose();
            }}
            className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
            保存绑定
          </button>
        </div>
      </div>
    </Modal>
  );
}
