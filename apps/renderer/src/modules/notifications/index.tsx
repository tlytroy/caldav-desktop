import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellRing,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { fetchItems, type WorkbenchItem } from "../../api/workspace";
import {
  describeItemTime,
  describeRemind,
  upcomingReminders,
} from "../../utils/reminders";
import {
  desktopNotificationsEnabled,
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
  setDesktopNotificationsEnabled,
} from "../../components/reminders/ReminderHost";
import {
  fetchPushChannels,
  fetchPushStatus,
  fetchServerConfig,
  runPushCheck,
  saveServerConfig,
  sendTestPush,
  type PushChannelId,
  type PushChannelMeta,
  type PushStatus,
  type ServerConfig,
} from "../../api/notifications";

/** 渠道字段的中文名 */
const FIELD_LABEL: Record<string, string> = {
  webhookUrl: "Webhook 地址",
  sendKey: "SendKey",
  token: "Token",
  serverUrl: "服务器地址",
  deviceKey: "设备 Key",
  url: "地址",
  topic: "Topic",
};

/** 这些字段是密钥，输入框用 password */
const SECRET_FIELDS = new Set([
  "webhookUrl",
  "sendKey",
  "token",
  "deviceKey",
  "url",
]);

/**
 * 通知推送模块（本地提醒）
 *
 * 这里不做任何「服务端推送」：提醒由渲染进程内的 ReminderHost 定时检查
 * workspace.md 里的 `remind` 字段触发。因此：
 *  - 不需要配置任何服务器
 *  - 应用没运行时不会提醒（要后台推送得常驻进程 / 服务端能力，后续再说）
 */
export default function NotificationsPage() {
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(
    notificationPermission(),
  );
  const [desktop, setDesktop] = useState(desktopNotificationsEnabled());
  const [msg, setMsg] = useState<string | null>(null);

  // ===== 服务端推送渠道 =====
  const [channels, setChannels] = useState<PushChannelMeta[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [serverCfg, setServerCfg] = useState<ServerConfig | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [channelBusy, setChannelBusy] = useState<string | null>(null);
  const [channelMsg, setChannelMsg] = useState<string | null>(null);
  const [savingChannels, setSavingChannels] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchItems({ includeDone: false });
      setItems(r.items || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "读取 workspace.md 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadPush = useCallback(async () => {
    try {
      const [c, s, cfg] = await Promise.all([
        fetchPushChannels(),
        fetchPushStatus(),
        fetchServerConfig(),
      ]);
      setChannels(c.channels);
      setPushEnabled(c.pushEnabled);
      setPushStatus(s);
      setServerCfg(cfg);
    } catch (e) {
      setChannelMsg("读取推送配置失败：" + (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadPush();
  }, [loadPush]);

  /** 修改某个渠道的字段 */
  const setChannelField = (
    id: PushChannelId,
    key: string,
    value: unknown,
  ) => {
    setServerCfg((prev) =>
      prev
        ? {
            ...prev,
            notifications: {
              ...prev.notifications,
              channels: {
                ...prev.notifications.channels,
                [id]: {
                  ...prev.notifications.channels[id],
                  [key]: value,
                },
              },
            },
          }
        : prev,
    );
  };

  const setMasterEnabled = (on: boolean) => {
    setServerCfg((prev) =>
      prev
        ? {
            ...prev,
            notifications: { ...prev.notifications, enabled: on },
          }
        : prev,
    );
  };

  /** 保存渠道配置（敏感字段是掩码，服务端会保留原值） */
  const saveChannels = async () => {
    if (!serverCfg) return;
    setSavingChannels(true);
    setChannelMsg(null);
    try {
      const saved = await saveServerConfig({
        notifications: serverCfg.notifications,
      });
      setServerCfg(saved);
      const [c, s] = await Promise.all([
        fetchPushChannels(),
        fetchPushStatus(),
      ]);
      setChannels(c.channels);
      setPushEnabled(c.pushEnabled);
      setPushStatus(s);
      setChannelMsg("推送配置已保存");
    } catch (e: any) {
      setChannelMsg(
        "保存失败：" + (e?.response?.data?.error || (e as Error).message),
      );
    } finally {
      setSavingChannels(false);
    }
  };

  /** 单渠道测试：先保存，再让服务端发一条 */
  const testChannel = async (id: PushChannelId) => {
    if (!serverCfg) return;
    setChannelBusy(id);
    setChannelMsg(null);
    try {
      await saveServerConfig({ notifications: serverCfg.notifications });
      const r = await sendTestPush(id);
      const bad = r.results.filter((x) => !x.ok);
      setChannelMsg(
        bad.length
          ? `测试失败：${bad.map((b) => b.error).join("；")}`
          : "测试消息已发送，去手机上看看",
      );
    } catch (e: any) {
      setChannelMsg(
        "测试失败：" + (e?.response?.data?.error || (e as Error).message),
      );
    } finally {
      setChannelBusy(null);
    }
  };

  /** 立即检查一次（会给到点的提醒发推送） */
  const checkNow = async () => {
    setCheckBusy(true);
    setChannelMsg(null);
    try {
      const r = await runPushCheck();
      setChannelMsg(
        `检查完成：到点 ${r.due} 条，成功 ${r.sent} 条，失败 ${r.failed} 条`,
      );
      setPushStatus(await fetchPushStatus());
    } catch (e: any) {
      setChannelMsg(
        "检查失败：" + (e?.response?.data?.error || (e as Error).message),
      );
    } finally {
      setCheckBusy(false);
    }
  };

  const upcoming = useMemo(
    () => upcomingReminders(items, Date.now(), 30),
    [items],
  );
  const remindCount = useMemo(
    () => items.filter((i) => i.remind && !i.done).length,
    [items],
  );

  const enableDesktop = async () => {
    if (!notificationsSupported()) {
      setMsg("当前环境不支持桌面通知（浏览器 / Electron 均可，但被系统或权限策略禁用）");
      return;
    }
    const p = await requestNotificationPermission();
    setPermission(p);
    if (p === "granted") {
      setDesktop(true);
      setDesktopNotificationsEnabled(true);
      setMsg("桌面通知已开启");
    } else {
      setDesktop(false);
      setDesktopNotificationsEnabled(false);
      setMsg(
        p === "denied"
          ? "桌面通知被拒绝：可以在浏览器地址栏的站点设置里重新允许"
          : "未授权，仍会显示应用内提醒",
      );
    }
  };

  const toggleDesktop = async (on: boolean) => {
    if (on && permission !== "granted") {
      await enableDesktop();
      return;
    }
    setDesktop(on);
    setDesktopNotificationsEnabled(on);
  };

  const sendTest = () => {
    if (!notificationsSupported() || Notification.permission !== "granted") {
      setMsg("先开启桌面通知，才能发送系统通知；应用内提醒不需要授权");
      return;
    }
    try {
      new Notification("测试提醒", {
        body: "如果你看到这条系统通知，说明桌面提醒可用。",
        tag: "dsh-reminder-test",
      });
      setMsg("已发送一条测试通知");
    } catch (e) {
      setMsg("发送失败：" + (e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            通知推送
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            本地提醒 · 到点弹卡片 · 可选桌面通知，不依赖任何服务器
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-gray-300 dark:hover:bg-neutral-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          刷新
        </button>
      </div>

      {/* 开关区 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-neutral-900">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <BellRing className="h-5 w-5 text-brand" /> 提醒方式
        </h2>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 dark:bg-neutral-800">
            <div>
              <div className="font-medium text-gray-900 dark:text-white">
                应用内提醒
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                应用打开时，到点会在右下角弹出提醒卡片（可稍后 10 分钟）
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" /> 始终开启
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 dark:bg-neutral-800">
            <div>
              <div className="font-medium text-gray-900 dark:text-white">
                桌面通知
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {notificationsSupported()
                  ? `系统权限：${
                      permission === "granted"
                        ? "已允许"
                        : permission === "denied"
                          ? "已拒绝"
                          : "未授权"
                    }`
                  : "当前环境不支持桌面通知"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {permission !== "granted" && notificationsSupported() && (
                <button
                  onClick={() => void enableDesktop()}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs text-white hover:opacity-90"
                >
                  授权并开启
                </button>
              )}
              {permission === "granted" && (
                <>
                  <button
                    onClick={() => void toggleDesktop(!desktop)}
                    className={`rounded-lg px-3 py-1.5 text-xs ${
                      desktop
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-gray-200 text-gray-600 dark:bg-neutral-700 dark:text-gray-300"
                    }`}
                  >
                    {desktop ? "已开启" : "已关闭"}
                  </button>
                  <button
                    onClick={sendTest}
                    className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 dark:bg-neutral-700 dark:text-gray-300"
                  >
                    测试
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {msg && (
          <p className="mt-3 rounded-lg bg-blue-50 p-2.5 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            {msg}
          </p>
        )}
      </section>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 服务端推送渠道 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-neutral-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <BellRing className="h-5 w-5 text-brand" /> 推送到手机（服务端）
          </h2>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={pushEnabled}
              onChange={(e) => setMasterEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
            />
            启用服务端推送
          </label>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          后端每 30 秒检查一次 workspace.md 里的 `remind`，到点推到下面的渠道。
          Docker / NAS 部署时后端常驻，即使应用没打开也能收到；桌面版只在应用运行时推送。
          与上面的「应用内提醒」互不影响。
        </p>

        {!serverCfg ? (
          <div className="flex items-center justify-center py-6 text-sm text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 读取配置…
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => {
              const values = serverCfg.notifications.channels[ch.id] || {};
              const enabled = !!values.enabled;
              return (
                <div
                  key={ch.id}
                  className="rounded-lg border border-gray-200 p-3 dark:border-neutral-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                          setChannelField(ch.id, "enabled", e.target.checked)
                        }
                        className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {ch.label}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          ch.configured
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                            : "bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-gray-400"
                        }`}
                      >
                        {ch.configured ? "已配置" : "未配置"}
                      </span>
                    </label>
                    <button
                      onClick={() => void testChannel(ch.id)}
                      disabled={channelBusy !== null}
                      className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-gray-300"
                    >
                      {channelBusy === ch.id ? "发送中…" : "发送测试"}
                    </button>
                  </div>

                  <p className="mt-1 text-[11px] text-gray-400">{ch.hint}</p>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {ch.fields.map((f) => (
                      <label key={f} className="text-xs text-gray-500 dark:text-gray-400">
                        {FIELD_LABEL[f] || f}
                        <input
                          type={SECRET_FIELDS.has(f) ? "password" : "text"}
                          value={String((values as any)[f] ?? "")}
                          onChange={(e) =>
                            setChannelField(ch.id, f, e.target.value)
                          }
                          placeholder={FIELD_LABEL[f] || f}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-neutral-800">
              <button
                onClick={() => void saveChannels()}
                disabled={savingChannels}
                className="rounded-lg bg-brand px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingChannels ? "保存中…" : "保存推送配置"}
              </button>
              <button
                onClick={() => void checkNow()}
                disabled={checkBusy || !pushStatus?.channels.length}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-gray-300"
                title="立即检查一次，并给到点的提醒发推送"
              >
                {checkBusy ? "检查中…" : "立即检查并推送"}
              </button>
              <span className="text-xs text-gray-400">
                {pushStatus?.channels.length
                  ? `已启用 ${pushStatus.channels.length} 个渠道 · 待推送 ${pushStatus.dueCount} 条`
                  : "还没有启用任何渠道"}
                {pushStatus?.lastSentAt
                  ? ` · 上次推送 ${new Date(
                      pushStatus.lastSentAt,
                    ).toLocaleString("zh-CN")}`
                  : ""}
              </span>
            </div>

            {channelMsg && (
              <p className="rounded-lg bg-blue-50 p-2.5 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                {channelMsg}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 即将到来 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-neutral-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <Clock className="h-5 w-5 text-brand" /> 即将提醒
          </h2>
          <span className="text-sm text-gray-400">
            {remindCount > 0 ? `共 ${remindCount} 条设置了提醒` : "还没有设置提醒"}
          </span>
        </div>

        {upcoming.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            <Bell className="mx-auto mb-2 h-8 w-8 opacity-40" />
            暂无即将到来的提醒。
            <div className="mt-1 text-xs">
              在日历事件或任务的编辑框里设置「提醒」即可。
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
            {upcoming.map((hit) => (
              <li key={hit.key} className="flex items-center gap-3 py-2.5">
                <Bell className="h-4 w-4 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {hit.item.title}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {describeItemTime(hit.item) || "—"}
                    {hit.item.list ? ` · ${hit.item.list}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {describeRemind(hit.item.remind)}
                  </div>
                  <div className="text-[10px] text-gray-400">提醒时间</div>
                </div>
                <button
                  onClick={() => {
                    window.location.hash =
                      hit.item.kind === "task" ? "#/tasks" : "#/calendar";
                  }}
                  className="shrink-0 rounded p-1.5 text-gray-400 hover:text-brand"
                  title="打开"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:bg-neutral-900 dark:text-gray-400">
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          规则与限制
        </h2>
        <ul className="list-disc space-y-1 pl-4">
          <li>提醒时间存在 `workspace.md` 的 `remind` 字段里，属于本地数据。</li>
          <li>应用每 30 秒检查一次；同一个提醒只弹一次，可「稍后 10 分钟」。</li>
          <li>超过 24 小时才打开的提醒不会补弹，避免一次涌出一堆过期提醒。</li>
          <li>已完成 / 已取消的条目不再提醒。</li>
          <li>
            应用内提醒只在应用打开时有效；想 7×24 收到，请开启上面的「服务端推送」
            （Docker / NAS 上的后端常驻即可，手机只负责收消息）。
          </li>
        </ul>
      </section>
    </div>
  );
}
