import { useEffect, useState, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import Calendar from "../../components/Calendar";
import QuickCreate from "../../components/QuickCreate";
import {
  subscribeSyncDegraded,
  getSyncDegradedReason,
} from "../../api/calendar";

/**
 * CalendarPage —— 日历模块
 *
 * ## 架构
 *
 * 日历是**统一数据源（workspace.md）的一个视图**，不是独立的数据源。
 * 筛选条件由服务端完成：scope=calendar + expand=true
 * （后者把「每周一三五」这类重复条目展开成月视图里的多个格子）。
 *
 * 因此这里**不需要**再叠加看板任务 —— 有 start 的任务本来就在日历上。
 * 这正是统一数据源带来的好处：同一个「体检」在看板和日历里指向同一条记录，
 * 不存在"日历有、看板没有"的差异。
 */
export default function CalendarPage() {
  // 每次快速创建后自增，触发日历重读数据源
  const [refreshKey, setRefreshKey] = useState(0);
  // CalDAV 不可用时的降级提示（本地数据不受影响）
  const [syncDegraded, setSyncDegraded] = useState<string | null>(
    getSyncDegradedReason(),
  );

  useEffect(() => {
    const unsub = subscribeSyncDegraded(setSyncDegraded);
    return () => {
      unsub();
    };
  }, []);

  /** 自然语言快速创建：确认草稿后写入统一数据源 */
  const handleQuickCreate = useCallback(
    async (draft: {
      title: string;
      date: string;
      end?: string;
      allDay: boolean;
      recurrence?: string;
      description?: string;
      /** 勾选后写成任务类型（同时出现在看板） */
      addToKanban: boolean;
    }) => {
      // 延迟导入，避免把 API 客户端塞进首屏 bundle
      const { createItem } = await import("../../api/workspace");
      await createItem({
        title: draft.title,
        // 草稿的时间是本地时间串，直接用（不要转 ISO —— 会带 Z 导致偏移）
        start: draft.date,
        end: draft.end,
        allDay: draft.allDay,
        description: draft.description,
        recurrence: draft.recurrence || undefined,
        // 勾了「加入任务看板」就是 task 类型，否则是纯事件
        kind: draft.addToKanban ? "task" : "event",
        priority: draft.addToKanban ? "mid" : undefined,
        due: draft.addToKanban ? draft.date.slice(0, 10) : undefined,
      });
      setRefreshKey((k) => k + 1);
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">日历</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          快速说一句就建好 · 与任务看板共用同一个数据源，任务与事件只存一份
        </p>
      </div>

      <QuickCreate onCreate={handleQuickCreate} />

      {/* CalDAV 不可用提示 —— 本地数据不受影响 */}
      {syncDegraded && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <div className="text-amber-700 dark:text-amber-300">
            <span className="font-medium">CalDAV 同步暂不可用</span>
            <span className="block text-xs mt-0.5">
              {syncDegraded} —— 本地数据源与任务看板照常可用，
              事件会正常显示和保存；只是不会与日历服务器互相同步。
            </span>
          </div>
        </div>
      )}

      <Calendar refreshKey={refreshKey} />
    </div>
  );
}
