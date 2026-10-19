import { useEffect, useMemo, useState } from "react";
import Calendar from "../../components/Calendar";
import { fetchKanban, type KanbanTodo } from "../../api/kanban";

const PRIORITY_COLOR: Record<KanbanTodo["priority"], string> = {
  高: "#ef4444",
  中: "#f59e0b",
  低: "#14b8a6",
};

/**
 * CalendarPage - 日历模块页面
 *
 * 包装现有 Calendar 组件，叠加「工作搭子看板」中**未绑定日历**的任务。
 * 已绑定日历的任务（calendarEventUid 有值）会作为独立事件出现在日历上，
 * 这里只展示剩余的、仅有截止日的待办，避免重复。
 */
export default function CalendarPage() {
  const [todos, setTodos] = useState<KanbanTodo[]>([]);

  useEffect(() => {
    fetchKanban()
      .then((d) => setTodos(d.todos || []))
      .catch(() => setTodos([]));
  }, []);

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">日历</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          管理日历事件 · 看板任务（带截止日 & 未绑定日历）也会叠加显示 ·
          已与日历绑定的任务直接以事件形式呈现
        </p>
      </div>
      <Calendar externalEvents={externalEvents} />
    </div>
  );
}
