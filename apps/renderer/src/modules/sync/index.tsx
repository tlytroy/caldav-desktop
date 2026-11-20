import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Cloud,
  GitMerge,
  HardDrive,
  Loader2,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  Timer,
  X,
} from "lucide-react";
import {
  fetchSyncOverview,
  resumeSync,
  type SyncConflictItem,
  type SyncEventItem,
  type SyncOverview,
} from "../../api/sync";
import { fetchWebDAVStatus, testWebDAVConnection } from "../../api/webdav";
import { abortRestore } from "../../api/backups";
import { testCalDAVConnection } from "../../api/caldav-sync";
import { useI18n } from "../../i18n";

/**
 * 同步中心（只读概览）
 *
 * 设计原则（SDS §5）：
 *  - **不发网络请求**：进入页面只读本地快照，NAS 挂了也不卡；
 *  - 未配置同步时也正常显示「未配置」+ 指向设置页，不阻塞本地使用；
 *  - 冲突只给「重新合并」，不给「拉取覆盖」——本地优先，绝不静默丢数据；
 *  - 进页请求一次 + 手动刷新，不做轮询（用户明确不需要）。
 */
export default function SyncCenterPage() {
  const { t, formatDateTime } = useI18n();
  const [data, setData] = useState<SyncOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSyncOverview());
    } catch (e) {
      setError((e as Error).message || t("syncCenter.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    // 只在挂载时拉一次：进页面请求一次 + 手动刷新，不轮询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setNotice((e as Error).message || t("errors.unknown"));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const caldavConfigured = data?.caldav.configured ?? false;
  const webdavConfigured = data?.webdav.configured ?? false;
  const anyConfigured = caldavConfigured || webdavConfigured;
  const conflicts = data?.conflicts ?? [];
  const events = [...(data?.events ?? [])].reverse();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t("syncCenter.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("syncCenter.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("syncCenter.refresh")}
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {notice}
        </div>
      )}

      {data && (data.restorePending || data.autoSyncSuspended) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">
            {data.restorePending
              ? t("syncCenter.restorePendingTitle")
              : t("syncCenter.suspendedTitle")}
          </p>
          <p className="mt-1">
            {data.restorePending
              ? t("syncCenter.restorePendingBody")
              : t("syncCenter.suspendedBody")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("resume-pull", async () => {
                  await resumeSync("pull");
                  await load();
                  return t("syncCenter.resumedPull");
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1 text-xs hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              {t("syncCenter.resumePull")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("resume-push", async () => {
                  await resumeSync("push");
                  await load();
                  return t("syncCenter.resumedPush");
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1 text-xs hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900"
            >
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              {t("syncCenter.resumePush")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("resume-both", async () => {
                  await resumeSync("bidirectional");
                  await load();
                  return t("syncCenter.resumedBoth");
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1 text-xs hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900"
            >
              <GitMerge className="h-3.5 w-3.5" />
              {t("syncCenter.resumeBoth")}
            </button>
            {data.restorePending && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm(t("syncCenter.abortRestoreConfirm"))) return;
                  void run("abort-restore", async () => {
                    await abortRestore();
                    await load();
                    return t("syncCenter.abortRestoreDone");
                  });
                }}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1 text-xs hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900"
              >
                <X className="h-3.5 w-3.5" />
                {t("syncCenter.abortRestore")}
              </button>
            )}
          </div>
          {data.restorePending && (
            <p className="mt-1.5 text-xs opacity-75">
              {t("syncCenter.abortRestoreHint")}
            </p>
          )}
        </div>
      )}

      {!anyConfigured && !loading && (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center dark:border-slate-600">
          <HardDrive className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("syncCenter.notConfiguredTitle")}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("syncCenter.notConfiguredBody")}
          </p>
          <a
            href="#/settings"
            className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
          >
            {t("syncCenter.openSettings")}
          </a>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ChannelCard
          title={t("syncCenter.caldavTitle")}
          icon={<Cloud className="h-4 w-4" />}
          configured={caldavConfigured}
          configuredLabel={t("syncCenter.configured")}
          notConfiguredLabel={t("syncCenter.notConfigured")}
          notConfiguredHint={t("syncCenter.notConfiguredHint")}
          lines={
            caldavConfigured && data
              ? [
                  [t("syncCenter.calendar"), data.caldav.calendarUrl || t("syncCenter.autoDiscover")],
                  [t("syncCenter.lastSync"), formatTs(data.caldav.lastSyncAt)],
                  [t("syncCenter.localCount"), String(data.caldav.localCount)],
                  [t("syncCenter.pendingCount"), String(data.caldav.pendingCount)],
                  [t("syncCenter.syncedCount"), String(data.caldav.syncedCount)],
                  [
                    t("syncCenter.autoSync"),
                    t("syncCenter.everyMinutes", { n: String(data.caldav.autoSyncMinutes) }),
                  ],
                ]
              : []
          }
          lastError={data?.caldav.lastError ?? null}
          busy={busy !== null}
          actions={[
            {
              label: t("syncCenter.testConnection"),
              onClick: () =>
                void run("test-caldav", async () => {
                  const r = await testCalDAVConnection();
                  return r.success
                    ? t("syncCenter.testOk", { channel: t("syncCenter.channelCaldav") })
                    : t("syncCenter.testFailed", {
                        channel: t("syncCenter.channelCaldav"),
                        message: r.message ?? "",
                      });
                }),
            },
          ]}
        />

        <ChannelCard
          title={t("syncCenter.webdavTitle")}
          icon={<HardDrive className="h-4 w-4" />}
          configured={webdavConfigured}
          configuredLabel={t("syncCenter.configured")}
          notConfiguredLabel={t("syncCenter.notConfigured")}
          notConfiguredHint={t("syncCenter.notConfiguredHint")}
          lines={
            webdavConfigured && data
              ? [
                  [t("syncCenter.remoteDir"), data.webdav.remoteDir || "/"],
                  [t("syncCenter.lastSync"), formatTs(data.webdav.lastSyncedAt)],
                  [t("syncCenter.remoteEtag"), shortHash(data.webdav.lastKnownEtag)],
                ]
              : []
          }
          lastError={data?.webdav.lastError ?? null}
          busy={busy !== null}
          actions={[
            {
              label: t("syncCenter.testConnection"),
              onClick: () =>
                void run("test-webdav", async () => {
                  const r = await testWebDAVConnection();
                  return r.success
                    ? t("syncCenter.testOk", { channel: t("syncCenter.channelWebdav") })
                    : t("syncCenter.testFailed", {
                        channel: t("syncCenter.channelWebdav"),
                        message: r.message ?? "",
                      });
                }),
            },
            {
              label: t("syncCenter.refreshRemote"),
              onClick: () =>
                void run("status-webdav", async () => {
                  const r = await fetchWebDAVStatus();
                  const file = r.files?.[0];
                  if (!file) return t("syncCenter.noFiles");
                  if (file.remote.error) {
                    return t("syncCenter.remoteUnavailable", { message: file.remote.error });
                  }
                  return file.remote.exists
                    ? t("syncCenter.remoteExists")
                    : t("syncCenter.remoteMissing");
                }),
            },
          ]}
        />
      </div>

      <section className="rounded-lg border border-slate-200 dark:border-slate-700">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {t("syncCenter.conflictsTitle", { n: String(conflicts.length) })}
          </h2>
        </header>
        {conflicts.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            {t("syncCenter.conflictsEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {conflicts.map((c, i) => (
              <ConflictRow key={`${c.ts}-${i}`} conflict={c} />
            ))}
          </ul>
        )}
        {conflicts.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {t("syncCenter.conflictsHint")}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-700">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
          <Timer className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {t("syncCenter.eventsTitle", { n: String(events.length) })}
          </h2>
          <span className="ml-auto text-xs text-slate-400">
            {t("syncCenter.eventsHint")}
          </span>
        </header>
        {events.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            {t("syncCenter.eventsEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {events.map((e, i) => (
              <EventRow key={`${e.ts}-${i}`} event={e} />
            ))}
          </ul>
        )}
      </section>

      {data && data.maintenance && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("syncCenter.maintenanceHint")}
        </p>
      )}
    </div>
  );

  function formatTs(ts: string | null): string {
    if (!ts) return t("syncCenter.timestamp");
    const parsed = new Date(ts);
    if (Number.isNaN(parsed.getTime())) return ts;
    return formatDateTime(parsed);
  }
}

function ChannelCard({
  title,
  icon,
  configured,
  configuredLabel,
  notConfiguredLabel,
  notConfiguredHint,
  lines,
  lastError,
  busy,
  actions,
}: {
  title: string;
  icon: ReactNode;
  configured: boolean;
  configuredLabel: string;
  notConfiguredLabel: string;
  notConfiguredHint: string;
  lines: [string, string][];
  lastError: string | null;
  busy: boolean;
  actions: { label: string; onClick: () => void }[];
}) {
  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <header className="flex items-center gap-2">
        <span className="text-slate-500">{icon}</span>
        <h2 className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {title}
        </h2>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
            configured
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {configured ? configuredLabel : notConfiguredLabel}
        </span>
      </header>

      {configured ? (
        <dl className="mt-3 space-y-1.5 text-sm">
          {lines.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-20 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className="min-w-0 break-all text-slate-800 dark:text-slate-100">
                {v}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          {notConfiguredHint}
        </p>
      )}

      {lastError && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          <ServerCrash className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{lastError}</span>
        </div>
      )}

      {configured && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={a.onClick}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ConflictRow({ conflict }: { conflict: SyncConflictItem }) {
  const { t, formatDateTime } = useI18n();
  return (
    <li className="flex items-start gap-2 px-4 py-2.5 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <p className="text-slate-800 dark:text-slate-100">{conflict.summary}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {conflict.channel === "caldav"
            ? t("syncCenter.channelCaldav")
            : conflict.channel === "webdav"
              ? t("syncCenter.channelWebdav")
              : t("syncCenter.channelRestore")}{" "}
          · {formatDateTime(new Date(conflict.ts))}
          {conflict.localId
            ? ` · ${t("syncCenter.localItem", { id: conflict.localId })}`
            : ""}
        </p>
      </div>
    </li>
  );
}

function EventRow({ event }: { event: SyncEventItem }) {
  const { t, formatDateTime } = useI18n();
  const isError = event.kind === "error";
  return (
    <li className="flex items-start gap-2 px-4 py-2 text-sm">
      {isError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      )}
      <div className="min-w-0">
        <p className="break-all text-slate-800 dark:text-slate-100">{event.message}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {event.channel === "caldav"
            ? t("syncCenter.channelCaldav")
            : event.channel === "webdav"
              ? t("syncCenter.channelWebdav")
              : t("syncCenter.channelRestore")}{" "}
          · {formatDateTime(new Date(event.ts))}
        </p>
      </div>
    </li>
  );
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  const cleaned = hash.replace(/^W\//, "").replace(/^"|"$/g, "");
  return cleaned.length > 12 ? `${cleaned.slice(0, 12)}…` : cleaned;
}
