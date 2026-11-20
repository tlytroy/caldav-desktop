import React, { useCallback, useMemo, useEffect, useState } from "react";
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
import { fetchItems, type WorkbenchItem } from "../../api/workspace";
import {
  fetchCalDAVSyncStatus,
  type CalDAVSyncStatus,
} from "../../api/caldav-sync";
import { isOverdue, localDate } from "../../utils/date";
import { describeRemind, upcomingReminders } from "../../utils/reminders";

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

  /**
   * 工作台只读**本地数据源**，不依赖任何服务器。
   *
   * 同步状态来自 `/api/caldav/status` —— 那是服务端本地摘要（不发网络请求），
   * 所以服务器关着也只是显示「从未同步」，不会让工作台报错或变空白。
   */
  const [sync, setSync] = useState<CalDAVSyncStatus | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState("");

  /**
   * 工作台读**统一数据源**（workspace.md）——与日历、看板完全同源。
   *
   * 历史 bug：这里原先读 syncStore.cachedEvents，但数据流重构后
   * 该缓存已无人写入，于是「今日事件」「N 个事件」恒为 0 ——
   * 页面看着正常，全是空的。
   *
   * 现在一次拿到全部条目，本地按 scope 分拣：
   *  - 有 start 的 → 日历事件
   *  - kind=task 的 → 看板任务
   */
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  /** 今日日程（已展开重复事件） */
  const [todayExpanded, setTodayExpanded] = useState<WorkbenchItem[]>([]);

  const load = useCallback(() => {
    const today = localDate();

    // 全量：算待办与总数（工作台是总览，不做日期筛选）
    fetchItems()
      .then((r) => {
        setItems(r.items || []);
        setFilePath(r.filePath || "");
      })
      .catch(() => setItems([]));

    // 今日：**必须 expand**，否则「每周一三五」的重复事件今天不会出现
    fetchItems({ scope: "calendar", expand: true, start: today, end: today })
      .then((r) => setTodayExpanded(r.items || []))
      .catch(() => setTodayExpanded([]));

    // 同步状态：服务端本地摘要，不联网
    fetchCalDAVSyncStatus()
      .then((s) => {
        setSync(s);
        setSyncError(null);
      })
      .catch(() => setSyncError("读取同步状态失败（不影响本地数据）"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 从别的窗口 / 标签页回来时刷新（快速创建可能刚写过文件）
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // 日历事件：有开始时间的（任务与事件都算）
  const calEvents = useMemo(() => items.filter((i) => !!i.start), [items]);

  // 看板任务：kind=task
  const allTodos = useMemo(() => items.filter((i) => i.kind === "task"), [items]);
  const openTodos = allTodos.filter((t) => !t.done);
  // 逾期判定走工具函数：截止日当天不算逾期（纯日期串不能按 UTC 解释）
  const overdueTodos = openTodos.filter((t) => isOverdue(t.due, t.done));

  /**
   * 今日日程：请求时已按「本地今天」筛选并展开重复事件，
   * 这里只排序 + 取展示字段。
   */
  const todayEvents = useMemo(() => {
    return [...todayExpanded]
      .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
      .map((e) => ({
        uid: e.instanceId || e.id,
        title: e.title || "无标题条目",
        start: e.start!,
        end: e.end,
        allDay: !!e.allDay,
        kind: e.kind,
      }));
  }, [todayExpanded]);

  // 事件总数
  const totalEvents = calEvents.length;

  // 下一条提醒（工作台的「通知」状态卡用它，不联网）
  const nextReminder = useMemo(
    () => upcomingReminders(items, Date.now(), 1)[0],
    [items],
  );

  /** ISO 时间 → 「刚刚 / N 分钟前」 */
  const formatSyncTime = (iso?: string): string => {
    if (!iso) return "从未同步";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "从未同步";
    const diff = Date.now() - t;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  };

  const syncStatusLabel = !sync
    ? "读取中…"
    : !sync.configured
      ? "未配置（本地照常可用）"
      : sync.lastSyncAt
        ? `已同步 · ${formatSyncTime(sync.lastSyncAt)}`
        : "已配置，尚未同步";

  const syncStatusColor = !sync
    ? "text-gray-400"
    : !sync.configured
      ? "text-gray-400"
      : sync.pendingCount > 0
        ? "text-amber-500"
        : "text-green-500";

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* 欢迎横幅 */}
      <div className="bg-gradient-to-r from-brand to-brand-accent rounded-2xl p-6 sm:p-8 text-white">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">
          个人工作台
        </h1>
        <p className="text-indigo-100 text-sm sm:text-base">
          日历 · 任务 · 看板 ——以 workspace.md 为唯一事实源
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
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            {syncStatusLabel}
          </span>
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
                ? "workspace.md 里还没有事件，去日历页新建一个"
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
                    t.priority === "high"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                      : t.priority === "low"
                        ? "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  }`}
                >
                  {t.priority === "high" ? "高" : t.priority === "low" ? "低" : "中"}
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
            icon={<CalendarCheck className="w-5 h-5" />}
            label="今日事件"
            value={`${todayEvents.length} 个`}
            color={todayEvents.length > 0 ? "text-green-500" : "text-gray-400"}
          />
          <StatusCard
            icon={<GitBranch className="w-5 h-5" />}
            label="数据源"
            value={`${items.length} 条记录`}
            color={items.length > 0 ? "text-green-500" : "text-yellow-500"}
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
            value={
              nextReminder
                ? describeRemind(nextReminder.item.remind)
                : "未设置提醒"
            }
            color={nextReminder ? "text-green-500" : "text-gray-400"}
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
            label="CalDAV 同步"
            value={syncStatusLabel}
            valueColor={syncStatusColor}
          />
          <SyncDetailCard
            icon={<Clock className="w-5 h-5" />}
            label="待推送"
            value={`${sync?.pendingCount ?? 0} 条`}
            valueColor={
              sync && sync.pendingCount > 0
                ? "text-amber-500"
                : "text-gray-700 dark:text-gray-300"
            }
          />
          <SyncDetailCard
            icon={<ListTodo className="w-5 h-5" />}
            label="自动同步"
            value={
              sync && sync.autoSyncMinutes > 0
                ? `每 ${sync.autoSyncMinutes} 分钟`
                : "仅手动"
            }
            valueColor="text-gray-700 dark:text-gray-300"
          />
        </div>
        {syncError && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{syncError}</span>
          </div>
        )}
        {filePath && (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 break-all">
            唯一事实源：<code className="px-1 rounded bg-gray-100 dark:bg-neutral-800">{filePath}</code>
            <span className="block mt-1">
              服务器连不上时，上面的日程 / 待办照常读写这个文件；同步只是可选的附加通道。
            </span>
          </p>
        )}
        {totalEvents === 0 && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-yellow-600 dark:text-yellow-400 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              workspace.md 里还没有任何事件。日历页新建事件后会写入该文件，它是本工具的唯一事实源。
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