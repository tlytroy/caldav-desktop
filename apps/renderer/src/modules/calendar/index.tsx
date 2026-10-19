import { useEffect, useMemo, useState, useCallback } from "react";
import Calendar from "../../components/Calendar";
import QuickCreate from "../../components/QuickCreate";
import { fetchKanban, type KanbanTodo } from "../../api/kanban";
import { addMdEvent } from "../../api/md-bridge";
import type { MdEvent } from "../../api/md-bridge";

const PRIORITY_COLOR: Record<KanbanTodo["priority"], string> = {
  高: "#ef4444",
  中: "#f59e0b",
  低: "#14b8a6",
};

/**
 * CalendarPage - 日历模块页面
 *
 * 顶部是自然语言快速创建条（类 Fantastical 交互），下方是月/周/日视图。
 * 快速创建与日历共用 events.md 作为事实源 —— 解析确认后直接调
 * POST /api/md-bridge/events/add 落盘，与手动创建走同一条写入路径。
 *
 * 同时叠加「工作搭子看板」中**未绑定日历**的任务。
 * 已绑定日历的任务（calendarEventUid 有值）会作为独立事件出现在日历上，
 * 这里只展示剩余的、仅有截止日的待办，避免重复。
 */
export default function CalendarPage() {
  const [todos, setTodos] = useState<KanbanTodo[]>([]);
  // 每次快速创建后自增，触发 Calendar 重读 events.md
  const [refreshKey, setRefreshKey] = useState(0);

  const loadTodos = useCallback(() => {
    fetchKanban()
      .then((d) => setTodos(d.todos || []))
      .catch(() => setTodos([]));
  }, []);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  // 快速创建写盘后刷新看板叠加层
  useEffect(() => {
    if (refreshKey > 0) loadTodos();
  }, [refreshKey, loadTodos]);

  /** 自然语言快速创建：确认草稿后写入 events.md */
  const handleQuickCreate = async (draft: {
    title: string;
    date: string;
    end?: string;
    allDay: boolean;
    recurrence?: string;
    description?: string;
    addToKanban: boolean;
  }) => {
    const payload: MdEvent = {
      title: draft.title,
      date: draft.date,
      end: draft.end,
      allDay: draft.allDay,
      recurrence: draft.recurrence as MdEvent["recurrence"],
      description: draft.description,
      source: "md",
    };
    // 可选：同时在工作搭子看板建一条任务（后端会互填链接字段）
    const kanban = draft.addToKanban
      ? {
          priority: ("中" as const),
          due: draft.date.slice(0, 10),
        }
      : undefined;

    await addMdEvent(payload, kanban);
    setRefreshKey((k) => k + 1);
  };

  const externalEvents = useMemo(
    () =>
      todos
        .filter((t) => !t.done && t.due && !t.calendarEventUid)
        .map((t) => ({
          id: `kanban-${t.id}`,
          title: `[任务] ${t.title}`,
          start: t.due,
          allDay: true,
          backgroundColor: PRIORITY_COLOR[t.priority],
          borderColor: PRIORITY_COLOR[t.priority],
          extendedProps: { kanban: true, priority: t.priority, taskId: t.id },
        })),
    [todos],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">日历</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          快速说一句就建好 · 看板任务（带截止日 & 未绑定日历）也会叠加显示
        </p>
      </div>

      <QuickCreate onCreate={handleQuickCreate} />

      <Calendar externalEvents={externalEvents} refreshKey={refreshKey} />
    </div>
  );
}
