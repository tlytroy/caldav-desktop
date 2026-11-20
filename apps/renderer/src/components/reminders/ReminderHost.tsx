import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, Clock, ExternalLink } from "lucide-react";
import { fetchItems } from "../../api/workspace";
import {
  collectDueReminders,
  describeItemTime,
  SNOOZE_MS,
  type ReminderHit,
} from "../../utils/reminders";

/**
 * 全局提醒宿主（本地能力，不依赖服务器）
 *
 * 挂在模块化 UI 最外层，所以不管用户在哪个页面都会弹提醒。
 *
 * ## 数据从哪来
 *
 * 定时拉 `/api/workspace/items`（本地文件，不走同步通道）。CalDAV / WebDAV
 * 关着也完全不影响提醒 —— 这是「本地优先」的一部分。
 *
 * ## 去重与稍后提醒
 *
 * - `dsh-reminders-fired`：记录「条目 id + 提醒时间」，同一提醒只弹一次
 * - `dsh-reminders-snoozed`：记录稍后提醒的到期时间
 *
 * 两者都在 localStorage；换设备不会同步（本地提醒，不是推送服务）。
 * 已知限制：应用没运行时不会提醒 —— 真正的后台推送需要常驻进程/服务端，
 * 留到以后做成可选能力。
 */

const FIRED_KEY = "dsh-reminders-fired";
const SNOOZED_KEY = "dsh-reminders-snoozed";
const DESKTOP_KEY = "dsh-reminders-desktop";

/** 已提醒记录保留 30 天，避免 localStorage 无限增长 */
const FIRED_TTL_MS = 30 * 24 * 3600_000;

type StampMap = Record<string, number>;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function loadMap(key: string): StampMap {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: StampMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(key: string, map: StampMap): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* 隐私模式 / 配额满：提醒照常工作，只是重启后可能重复一次 */
  }
}

function pruneFired(map: StampMap, now: number): StampMap {
  const out: StampMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (now - v <= FIRED_TTL_MS) out[k] = v;
  }
  return out;
}

/** 桌面通知偏好是否开启 */
export function desktopNotificationsEnabled(): boolean {
  if (!canUseStorage()) return false;
  return localStorage.getItem(DESKTOP_KEY) === "1";
}

export function setDesktopNotificationsEnabled(on: boolean): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(DESKTOP_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** 浏览器 / Electron 是否支持桌面通知 */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission {
  if (!notificationsSupported()) return "denied";
  return Notification.permission;
}

/** 请求通知权限（必须由用户点击触发） */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  try {
    const p = await Notification.requestPermission();
    if (p === "granted") setDesktopNotificationsEnabled(true);
    return p;
  } catch {
    return "denied";
  }
}

function showDesktopNotification(hit: ReminderHit, onOpen: () => void): void {
  if (!desktopNotificationsEnabled()) return;
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(hit.item.title, {
      body: [
        describeItemTime(hit.item),
        hit.lateMinutes > 0 ? `已到点 ${hit.lateMinutes} 分钟` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      tag: hit.key,
    });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  } catch {
    /* 部分环境不支持桌面通知；应用内提醒仍然有效 */
  }
}

export default function ReminderHost() {
  const [cards, setCards] = useState<ReminderHit[]>([]);
  const firedRef = useRef<StampMap>({});
  const snoozedRef = useRef<StampMap>({});
  const loadedRef = useRef(false);

  // 首次渲染时从 localStorage 恢复（不是副作用，不需要 useEffect）
  if (!loadedRef.current) {
    firedRef.current = pruneFired(loadMap(FIRED_KEY), Date.now());
    snoozedRef.current = loadMap(SNOOZED_KEY);
    loadedRef.current = true;
  }

  const dismiss = useCallback((key: string) => {
    setCards((prev) => prev.filter((c) => c.key !== key));
  }, []);

  const openItem = useCallback(
    (hit: ReminderHit) => {
      window.location.hash = hit.item.kind === "task" ? "#/tasks" : "#/calendar";
      dismiss(hit.key);
    },
    [dismiss],
  );

  const snooze = useCallback(
    (hit: ReminderHit) => {
      snoozedRef.current[hit.key] = Date.now() + SNOOZE_MS;
      // 从 fired 移除：10 分钟后还能再弹一次
      delete firedRef.current[hit.key];
      saveMap(SNOOZED_KEY, snoozedRef.current);
      saveMap(FIRED_KEY, firedRef.current);
      dismiss(hit.key);
    },
    [dismiss],
  );

  const check = useCallback(async () => {
    const now = Date.now();
    try {
      const r = await fetchItems({ includeDone: true });
      const hits = collectDueReminders(r.items || [], {
        now,
        fired: new Set(Object.keys(firedRef.current)),
        snoozed: snoozedRef.current,
      });
      if (!hits.length) return;

      // 先标记已提醒，避免下一轮重复
      for (const h of hits) firedRef.current[h.key] = now;
      saveMap(FIRED_KEY, firedRef.current);

      setCards((prev) => {
        const seen = new Set(prev.map((c) => c.key));
        const next = [...prev, ...hits.filter((h) => !seen.has(h.key))];
        return next.slice(-5);
      });

      for (const h of hits) {
        showDesktopNotification(h, () => openItem(h));
      }
    } catch {
      /* 本地文件读不到：下次轮询再试，不打扰用户 */
    }
  }, [openItem]);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    const onFocus = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  if (!cards.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {cards.map((hit) => (
        <div
          key={hit.key}
          className="rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                {hit.item.title}
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {describeItemTime(hit.item) || "提醒时间到"}
                {hit.lateMinutes > 0 ? ` · 已过 ${hit.lateMinutes} 分钟` : ""}
              </div>
            </div>
            <button
              onClick={() => dismiss(hit.key)}
              className="shrink-0 rounded px-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="关闭"
            >
              ×
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <button
              onClick={() => snooze(hit)}
              className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-gray-600 hover:bg-gray-200 dark:bg-neutral-800 dark:text-gray-300 dark:hover:bg-neutral-700"
            >
              <Clock className="h-3 w-3" /> 稍后 10 分钟
            </button>
            <button
              onClick={() => openItem(hit)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-brand hover:bg-gray-50 dark:hover:bg-neutral-800"
            >
              <ExternalLink className="h-3 w-3" /> 打开
            </button>
            <button
              onClick={() => dismiss(hit.key)}
              className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-neutral-800"
            >
              <Check className="h-3 w-3" /> 知道了
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
