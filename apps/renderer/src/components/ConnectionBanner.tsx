import React from "react";
import { useI18n } from "../i18n";

import { createApiClient } from "../api/client";
const probe = createApiClient(5000);

type Status = "unknown" | "ok" | "down";

/**
 * 连接状态横幅（P4 / SDS §4.4）
 * =============================
 *
 * 只做一件事：后端连不上时明确告诉用户“现在不会保存”，而不是让界面
 * 看起来一切正常、点击后静默失败（D15：直连 NAS 属于在线模式）。
 *
 * 探测 /api/workspace/info：它是只读、无网络、不需认证的轻接口，
 * 失败即视为后端不可达。30 秒一次，页面隐藏时不打扰。
 */
export function ConnectionBanner() {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<Status>("unknown");
  const [offline, setOffline] = React.useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [checking, setChecking] = React.useState(false);

  const check = React.useCallback(async () => {
    setChecking(true);
    try {
      await probe.get("/api/workspace/info");
      setStatus("ok");
    } catch (err) {
      // 401 = 后端活着，只是要令牌（由 AuthGate 处理），不是断线
      const code = (err as { response?: { status?: number } } | null)?.response?.status;
      setStatus(code === 401 ? "ok" : "down");
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 30_000);
    const onOnline = () => {
      setOffline(false);
      void check();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [check]);

  if (status === "ok" && !offline) return null;

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-3 px-3 py-1.5 text-xs bg-amber-500 text-amber-950 shadow"
    >
      <span className="font-medium">
        {offline ? t("connection.offline") : t("connection.down")}
      </span>
      <span className="opacity-80 hidden sm:inline">{t("connection.noFakeSave")}</span>
      <button
        onClick={() => void check()}
        disabled={checking}
        className="px-2 py-0.5 rounded bg-amber-950/15 hover:bg-amber-950/25 disabled:opacity-50"
      >
        {checking ? t("connection.checking") : t("connection.retry")}
      </button>
    </div>
  );
}

export default ConnectionBanner;
