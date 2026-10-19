import React, { useMemo, useEffect, useState } from "react";
import { useModuleRegistry } from "../../framework";
import { PlaceholderModuleCard } from "../../framework";
import {
  CalendarCheck,
  GitBranch,
  FileText,
  Bell,
  Clock,
  ListTodo,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { useCalendarStore } from "../../store/calendarStore";
import { useSyncStore } from "../../store/syncStore";
import { fetchKanban, type KanbanTodo } from "../../api/kanban";
import { fetchMdEvents, type MdEvent } from "../../api/md-bridge";

/**
 * DashboardPage - 工作台首页
 *
 * 展示所有注册模块的状态概览 + 真实日历数据：
 * - 活跃模块: 显示快捷入口
 * - 占位模块: 显示锁定卡片
 * - 今日事件: 从同步缓存中获取当天事件
 * - 同步状态: 显示实时同步信息
 * - 系统状态: 基于真实数据的概览卡片
 */
export default function DashboardPage() {
  const { getActiveModules, getPlaceholderModules } = useModuleRegistry();
  const activeModules = getActiveModules();
  const placeholderModules = getPlaceholderModules();

  // 从 store 获取真实数据
  const { calendars, selectedCalendarUrl } = useCalendarStore();
  const {
    syncStatus,
    isSyncing,
    lastSyncTime,
    syncError,
    syncInterval,
  } = useSyncStore();

  /**
   * 日历事件直接读 events.md（与日历模块同一数据源）。
   *
   * 历史 bug：这里原先读 syncStore.cachedEvents，但数据流重构后
   * useCalendarEvents 已改为直接读 events.md，不再写入该缓存，
   * 于是「今日事件」「N 个事件」恒为 0 —— 页面看着正常，全是空的。
   */
  const [mdEvents, setMdEvents] = useState<MdEvent[]>([]);
  useEffect(() => {
    fetchMdEvents()
      .then((r) => setMdEvents(r.events || []))
      .catch(() => setMdEvents([]));
  }, []);

  // 看板任务（工作搭子）——让工作台成为任务 hub
  const [kanbanTodos, setKanbanTodos] = useState<KanbanTodo[]>([]);
  useEffect(() => {
    fetchKanban()
      .then((d) => setKanbanTodos(d.todos || []))
      .catch(() => setKanbanTodos([]));
  }, []);

  const openTodos = kanbanTodos.filter((t) => !t.done);
  const overdueTodos = openTodos.filter(
    (t) => t.due && new Date(t.due).getTime() < Date.now(),
  );

  // 计算今日事件（来自 events.md）
  const todayEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return mdEvents
      .filter((e) => {
        const start = new Date(e.date);
        return start >= today && start < tomorrow;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((e) => ({
        uid: e.uid,
        title: e.title || "无标题事件",
        start: e.date,
        end: e.end,
        allDay: !!e.allDay,
      }));
  }, [mdEvents]);

  // 事件总数直接来自 events.md
  const totalEvents = mdEvents.length;

  // 格式化同步时间
  const formatSyncTime = (timestamp: number | null): string => {
    if (!timestamp) return "从未同步";
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  };

  // 获取选中日历名称
  const selectedCalendarName = useMemo(() => {
    if (!selectedCalendarUrl) return "未选择";
    const cal = calendars.find((c) => c.url === selectedCalendarUrl);
    return cal?.displayName || selectedCalendarUrl.split("/").pop() || "未知";
  }, [selectedCalendarUrl, calendars]);

  // 同步状态标签
  const syncStatusLabel =
    syncStatus === "syncing"
      ? "同步中..."
      : syncStatus === "success"
        ? "同步成功"
        : syncStatus === "error"
          ? "同步失败"
          : formatSyncTime(lastSyncTime);

  const syncStatusColor =
    syncStatus === "syncing"
      ? "text-blue-500"
      : syncStatus === "success"
        ? "text-green-500"
        : syncStatus === "error"
          ? "text-red-500"
          : "text-gray-400";

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* 欢迎横幅 */}
      <div className="bg-gradient-to-r from-brand to-brand-accent rounded-2xl p-6 sm:p-8 text-white">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">
          个人工作台
        </h1>
        <p className="text-indigo-100 text-sm sm:text-base">
          日历 · 任务 · 看板 ——以 events.md 与工作搭子看板.md 为唯一事实源
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-indigo-100 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <CalendarCheck className="w-4 h-4" />
            {totalEvents} 个事件
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ListTodo className="w-4 h-4" />
            {openTodos.length} 项待办
          </span>
          {calendars.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" />
              当前日历: {selectedCalendarName}
            </span>
          )}
        </div>
      </div>

      {/* 活跃模块网格 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          活跃模块
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeModules.map((mod) => (
            <ActiveModuleCard key={mod.id} module={mod} />
          ))}
        </div>
      </section>

      {/* 即将推出的模块 */}
      {placeholderModules.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            即将推出
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {placeholderModules.map((mod) => (
              <PlaceholderModuleCard key={mod.id} module={mod} />
            ))}
          </div>
        </section>
      )}

      {/* 今日事件面板 */}
      <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            今日事件
          </h2>
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {todayEvents.length} 个事件
          </span>
        </div>
        {todayEvents.length > 0 ? (
          <div className="space-y-3">
            {todayEvents.map((event) => (
              <div
                key={event.uid}
                className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-neutral-800 rounded-lg"
              >
                <div className="mt-0.5 w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {event.title}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {event.allDay
                      ? "全天"
                      : `${formatEventTime(event.start)}${
                          event.end ? ` - ${formatEventTime(event.end)}` : ""
                        }`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500">
            <CalendarCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">今日暂无事件</p>
            <p className="text-xs mt-1">
              {totalEvents === 0
                ? "events.md 里还没有事件，去日历页新建一个"
                : "享受平静的一天"}
            </p>
          </div>
        )}
      </section>

      {/* 今日待办（工作搭子看板） */}
      <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
            <ListTodo className="w-5 h-5 mr-2 text-brand" /> 今日待办
          </h2>
          <a
            href="#/tasks"
            className="text-sm text-brand hover:underline"
          >
            去任务看板 →
          </a>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {openTodos.length}
            </span>
            <span className="text-xs text-gray-400">待办</span>
          </div>
          {overdueTodos.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5" /> {overdueTodos.length} 项逾期
            </span>
          )}
        </div>

        {openTodos.length === 0 ? (
          <p className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">
            暂无待办，去任务看板添加吧
          </p>
        ) : (
          <div className="space-y-2">
            {openTodos.slice(0, 4).map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-neutral-800"
              >
                <span
                  className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                    t.priority === "高"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                      : t.priority === "中"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        : "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                  }`}
                >
                  {t.priority}
                </span>
                <span className="flex-1 text-sm text-gray-900 dark:text-white truncate">
                  {t.title}
                </span>
                {t.due && (
                  <span
                    className={`text-xs ${
                      new Date(t.due).getTime() < Date.now()
                        ? "text-red-500 font-medium"
                        : "text-gray-400"
                    }`}
                  >
                    {t.due}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 系统状态 */}
      <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          系统状态
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatusCard
            icon={
              isSyncing ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <CalendarCheck className="w-5 h-5" />
              )
            }
            label="今日事件"
            value={`${todayEvents.length} 个`}
            color={todayEvents.length > 0 ? "text-green-500" : "text-gray-400"}
          />
          <StatusCard
            icon={<GitBranch className="w-5 h-5" />}
            label="数据源"
            value={`${totalEvents} 个事件`}
            color={totalEvents > 0 ? "text-green-500" : "text-yellow-500"}
          />
          <StatusCard
            icon={<FileText className="w-5 h-5" />}
            label="知识库"
            value="即将到来"
            color="text-gray-400"
          />
          <StatusCard
            icon={<Bell className="w-5 h-5" />}
            label="通知"
            value="即将到来"
            color="text-gray-400"
          />
        </div>
      </section>

      {/* 同步状态详情 */}
      <section className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          同步状态
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SyncDetailCard
            icon={<RefreshCw className="w-5 h-5" />}
            label="同步状态"
            value={syncStatusLabel}
            valueColor={syncStatusColor}
          />
          <SyncDetailCard
            icon={<Clock className="w-5 h-5" />}
            label="上次同步"
            value={
              lastSyncTime
                ? new Date(lastSyncTime).toLocaleString("zh-CN")
                : "从未同步"
            }
            valueColor="text-gray-700 dark:text-gray-300"
          />
          <SyncDetailCard
            icon={<ListTodo className="w-5 h-5" />}
            label="自动同步"
            value={
              syncInterval
                ? `每 ${Math.round(syncInterval / 60000)} 分钟`
                : "已禁用"
            }
            valueColor={
              syncInterval
                ? "text-green-500"
                : "text-gray-400"
            }
          />
        </div>
        {syncError && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{syncError}</span>
          </div>
        )}
        {totalEvents === 0 && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-yellow-600 dark:text-yellow-400 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              events.md 里还没有任何事件。日历页新建事件后会写入该文件，它是本工具的唯一事实源。
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

// ===== Helper Components =====

function formatEventTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function ActiveModuleCard({ module }: { module: any }) {
  return (
    <a
      href={`#${module.navItems?.[0]?.path ?? "/"}`}
      className="block p-5 bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-600 transition-all"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
          {module.icon}
        </div>
        <div>
          <h3 className="font-medium text-gray-900 dark:text-white">
            {module.name}
          </h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            v{module.version}
          </p>
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
        {module.description}
      </p>
    </a>
  );
}

function StatusCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-neutral-800 rounded-lg">
      <div className={`${color}`}>{icon}</div>
      <div>
        <div className="text-xs text-gray-400 dark:text-gray-500">{label}</div>
        <div className={`text-sm font-medium ${color}`}>{value}</div>
      </div>
    </div>
  );
}

function SyncDetailCard({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-neutral-800 rounded-lg">
      <div className="text-gray-400 dark:text-gray-500">{icon}</div>
      <div>
        <div className="text-xs text-gray-400 dark:text-gray-500">{label}</div>
        <div className={`text-sm font-medium ${valueColor}`}>{value}</div>
      </div>
    </div>
  );
}