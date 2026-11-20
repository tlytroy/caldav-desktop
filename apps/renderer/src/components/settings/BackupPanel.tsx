import React from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  Loader2,
  Pin,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { useI18n } from "../../i18n";
import {
  BackupEntry,
  BackupPreview,
  abortRestore,
  downloadBackup,
  getRestoreStatus,
  listBackups,
  previewBackup,
  restoreBackup,
  resumeSync,
} from "../../api/backups";

/**
 * 备份面板（P4 / v0.2.5）
 * =====================
 *
 * 列出备份、预览差异、下载原文；P7 起提供「恢复」按钮：
 *   恢复 = 整份替换 workspace.md，所以先做 sha 校验、再要求用户输入确认。
 * 恢复完成后同步会被暂停，面板顶部出现「拉取 / 推送 / 双向」三选一，
 * 由用户明确决定这次以哪边为准，绝不自动覆盖。
 */
export function BackupPanel() {
  const { t, formatDateTime } = useI18n();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [backups, setBackups] = React.useState<BackupEntry[]>([]);
  const [filePath, setFilePath] = React.useState("");
  const [preview, setPreview] = React.useState<BackupPreview | null>(null);
  const [busyFile, setBusyFile] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [suspended, setSuspended] = React.useState(false);
  const [restored, setRestored] = React.useState<{ file: string; items: number } | null>(null);
  const [resuming, setResuming] = React.useState<string | null>(null);
  const [aborting, setAborting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listBackups();
      setBackups(res.backups);
      setFilePath(res.filePath ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    void getRestoreStatus()
      .then((st) => setSuspended(Boolean(st.suspended)))
      .catch(() => {
        /* 状态探测失败不影响列表 */
      });
  }, [load]);

  const onRestore = async (file: string) => {
    const ok = window.confirm(t("backup.restoreConfirm", { file }));
    if (!ok) return;
    setBusyFile(file);
    setMsg(null);
    setError(null);
    try {
      // 重新取一次 sha：预览可能已经过期，服务端会用 sha 再校验一次
      const pv = await previewBackup(file);
      const r = await restoreBackup(file, pv.sha256);
      setRestored({ file: r.file, items: r.items });
      setSuspended(true);
      setPreview(null);
      setMsg(t("backup.restoreDone", { n: String(r.items) }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFile(null);
    }
  };

  const onResume = async (action: "pull" | "push" | "bidirectional") => {
    setResuming(action);
    setError(null);
    setMsg(null);
    try {
      const r = await resumeSync(action);
      setSuspended(false);
      setRestored(null);
      setMsg(r.syncError ? t("backup.resumePartial", { error: r.syncError }) : t("backup.resumeDone"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResuming(null);
    }
  };

  /**
   * 放弃这次恢复（D31 逃生口）。
   * 场景：恢复后同步被暂停，但用户既不想拉取也不想推送（比如恢复错了版本、
   * 或暂时不想让任何一端覆盖）。这里只清掉「恢复挂起」标记，不动数据。
   */
  const onAbortRestore = async () => {
    const ok = window.confirm(t("backup.abortRestoreConfirm"));
    if (!ok) return;
    setAborting(true);
    setError(null);
    setMsg(null);
    try {
      await abortRestore();
      setSuspended(false);
      setRestored(null);
      setMsg(t("backup.abortRestoreDone"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAborting(false);
    }
  };

  const onPreview = async (file: string) => {
    setBusyFile(file);
    setMsg(null);
    try {
      setPreview(await previewBackup(file));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFile(null);
    }
  };

  const onDownload = async (file: string) => {
    setBusyFile(file);
    setMsg(null);
    try {
      await downloadBackup(file);
      setMsg(t("backup.downloadStarted"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFile(null);
    }
  };

  const fmtSize = (n: number) =>
    n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("backup.title")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t("backup.description")}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {t("backup.refresh")}
        </button>
      </div>

      {filePath && (
        <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500 break-all">
          {filePath}
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">
            {t("backup.loadFailed")}：{error}
          </span>
        </div>
      )}

      {!loading && !error && backups.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 py-3">
          {t("backup.empty")}
        </p>
      )}

      {backups.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-700">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-neutral-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left font-medium px-3 py-2">
                  {t("backup.time")}
                </th>
                <th className="text-right font-medium px-3 py-2">
                  {t("backup.items")}
                </th>
                <th className="text-right font-medium px-3 py-2">
                  {t("backup.size")}
                </th>
                <th className="text-right font-medium px-3 py-2">
                  {t("backup.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
              {backups.map((b) => (
                <tr key={b.file} className="text-gray-700 dark:text-gray-300">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px]">
                        {formatDateTime(b.createdAt)}
                      </span>
                      {b.pinned && (
                        <span
                          title={t("backup.pinnedHint")}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        >
                          <Pin className="w-3 h-3" />
                          {t("backup.pinned")}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-gray-400 truncate max-w-[16rem]">
                      {b.file}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {b.itemCount === null ? t("backup.unparseable") : b.itemCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtSize(b.size)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => void onPreview(b.file)}
                        disabled={busyFile !== null}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {busyFile === b.file ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                        {t("backup.preview")}
                      </button>
                      <button
                        onClick={() => void onDownload(b.file)}
                        disabled={busyFile !== null}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 disabled:opacity-50"
                      >
                        <Download className="w-3 h-3" />
                        {t("backup.download")}
                      </button>
                      <button
                        onClick={() => void onRestore(b.file)}
                        disabled={busyFile !== null}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                      >
                        {busyFile === b.file ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        {t("backup.restore")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {suspended && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <p className="font-medium">{t("backup.syncSuspendedTitle")}</p>
              <p>{t("backup.syncSuspendedHint")}</p>
              {restored && (
                <p className="font-mono text-[10px] opacity-80">
                  {restored.file} · {t("backup.restoredItems", { n: String(restored.items) })}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["pull", "push", "bidirectional"] as const).map((a) => (
              <button
                key={a}
                onClick={() => void onResume(a)}
                disabled={resuming !== null}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-400 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
              >
                {resuming === a ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {t(`backup.resume_${a}`)}
              </button>
            ))}
            <button
              onClick={() => void onAbortRestore()}
              disabled={resuming !== null || aborting}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-400 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 ml-auto"
            >
              {aborting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <X className="w-3 h-3" />
              )}
              {t("backup.abortRestore")}
            </button>
          </div>
          <p className="text-[10px] opacity-75">{t("backup.abortRestoreHint")}</p>
        </div>
      )}

      {msg && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{msg}</span>
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                {t("backup.previewTitle")}：{preview.file}
              </p>
              <p className="text-[10px] font-mono text-gray-400">
                sha256 {preview.sha256.slice(0, 16)}…
                {preview.pinned ? ` · ${t("backup.pinned")}` : ""}
              </p>
            </div>
            <button
              onClick={() => setPreview(null)}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
            >
              {t("common.close")}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              +{preview.diff.added} {t("backup.added")}
            </span>
            <span className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
              −{preview.diff.removed} {t("backup.removed")}
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              ~{preview.diff.changed} {t("backup.changed")}
            </span>
          </div>

          {preview.diff.items.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("backup.noChanges")}
            </p>
          ) : (
            <ul className="space-y-1 max-h-56 overflow-auto">
              {preview.diff.items.map((it) => (
                <li
                  key={`${it.change}-${it.id}`}
                  className="flex items-start gap-2 text-[11px] text-gray-600 dark:text-gray-300"
                >
                  <span
                    className={
                      it.change === "added"
                        ? "text-green-600 dark:text-green-400"
                        : it.change === "removed"
                          ? "text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400"
                    }
                  >
                    {it.change === "added" ? "+" : it.change === "removed" ? "−" : "~"}
                  </span>
                  <span className="flex-1 truncate">{it.title || it.id}</span>
                  {it.fields?.length ? (
                    <span className="text-[10px] text-gray-400">
                      {it.fields.join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("backup.itemsPreviewNote", { n: preview.diff.items.length })}
          </p>
        </div>
      )}

      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
        <p className="font-medium">{t("backup.restoreTitle")}</p>
        <p>{t("backup.restoreHint")}</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>{t("backup.step1")}</li>
          <li>{t("backup.step2")}</li>
          <li>{t("backup.step3")}</li>
        </ol>
      </div>
    </section>
  );
}

export default BackupPanel;
