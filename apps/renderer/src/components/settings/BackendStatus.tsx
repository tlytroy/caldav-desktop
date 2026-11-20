import React from "react";
import { AlertTriangle, CheckCircle2, Database } from "lucide-react";
import { useI18n } from "../../i18n";
import { createApiClient } from "../../api/client";
import { API_BASE_URL } from "../../api/base";

const api = createApiClient(5000);

interface WorkspaceInfo {
  filePath?: string;
  storageSafe?: boolean;
  readOnly?: boolean;
  total?: number;
}

/**
 * 后端/存储状态（P4 收尾）
 *
 * 只读展示，不写任何东西。目的：出问题时用户能在设置页直接看到
 * “后端版本 / 存储是否可写 / 数据文件在哪”，而不是只能翻日志。
 */
export function BackendStatus() {
  const { t } = useI18n();
  const [version, setVersion] = React.useState<string>("");
  const [info, setInfo] = React.useState<WorkspaceInfo | null>(null);
  const [down, setDown] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [h, w] = await Promise.all([
          api.get("/health"),
          api.get("/api/workspace/info"),
        ]);
        if (!alive) return;
        setVersion(String(h.data?.version ?? "dev"));
        setInfo(w.data ?? null);
        setDown(false);
      } catch {
        if (alive) setDown(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const readOnly = Boolean(info?.readOnly);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800/50 p-3 text-xs space-y-1.5">
      <div className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-200">
        <Database className="w-3.5 h-3.5" />
        {t("settings.status.title")}
      </div>

      {down ? (
        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          {t("settings.status.unreachable")}
        </div>
      ) : (
        <>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500 dark:text-gray-400">
              {t("settings.status.version")}
            </span>
            <span className="font-mono text-gray-800 dark:text-gray-200">
              {version || "…"}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500 dark:text-gray-400">
              {t("settings.status.storage")}
            </span>
            <span
              className={`inline-flex items-center gap-1 ${
                readOnly
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              {readOnly ? (
                <AlertTriangle className="w-3 h-3" />
              ) : (
                <CheckCircle2 className="w-3 h-3" />
              )}
              {readOnly ? t("settings.status.readOnly") : t("settings.status.writable")}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500 dark:text-gray-400">
              {t("settings.status.endpoint")}
            </span>
            <span className="font-mono text-gray-800 dark:text-gray-200 break-all text-right">
              {API_BASE_URL || "same-origin"}
            </span>
          </div>
          {info?.filePath && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">
                {t("settings.status.filePath")}
              </span>
              <span className="font-mono text-gray-800 dark:text-gray-200 break-all text-right">
                {info.filePath}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BackendStatus;
