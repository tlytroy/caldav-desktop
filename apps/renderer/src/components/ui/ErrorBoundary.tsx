import React from "react";
import { ErrorBoundary, FallbackProps } from "react-error-boundary";
import { useI18n } from "../../i18n";

/**
 * 全局错误页（P4）
 * ================
 *
 * 目标不是“好看”，是出事时用户能自己救回来：
 *  - 明确说清发生了什么（不暴露绝对路径）
 *  - 给出 3 步手工恢复（下载备份 → 覆盖 workspace.md → 重启）
 *  - 只在按钮点击时刷新，不自动 reload（避免掩盖问题）
 */
export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-gray-50 dark:bg-neutral-950">
      <div className="w-full max-w-xl rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-neutral-900 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">
          {t("errorPage.title")}
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("errorPage.subtitle")}
        </p>

        <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-gray-100 dark:bg-neutral-800 p-3 text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
          {error.message}
        </pre>

        <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-800 dark:text-blue-200">
          <p className="font-medium">{t("errorPage.recoveryTitle")}</p>
          <ol className="mt-1 list-decimal list-inside space-y-1">
            <li>{t("errorPage.step1")}</li>
            <li>{t("errorPage.step2")}</li>
            <li>{t("errorPage.step3")}</li>
          </ol>
          <p className="mt-2 opacity-80">{t("errorPage.backupHint")}</p>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={resetErrorBoundary}
            className="px-4 py-2 text-sm rounded-lg bg-brand text-white hover:opacity-90"
          >
            {t("errorPage.retry")}
          </button>
          <button
            onClick={() => {
              window.location.hash = "#/settings";
              window.location.reload();
            }}
            className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
          >
            {t("errorPage.openBackupSettings")}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
          >
            {t("errorPage.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(err, info) => {
        // 只记到控制台，不上报（本地优先，不偷偷发数据）
        console.error("[ui] 渲染失败：", err, info.componentStack);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

export default GlobalErrorBoundary;
