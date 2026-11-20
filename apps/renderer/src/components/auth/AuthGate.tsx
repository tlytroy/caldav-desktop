import React from "react";
import axios from "axios";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { API_BASE_URL } from "../../api/base";
import {
  AUTH_REQUIRED_EVENT,
  clearApiToken,
  getApiToken,
  isElectron,
  setApiToken,
} from "../../api/token";
import { useI18n } from "../../i18n";

/**
 * 认证门（P5 / SDS §3.4）
 * ======================
 *
 * 启动时先探一次 `/api/workspace/info`：
 *  - 200  → 后端没开认证（v0.2.5 / 本地开发）或 token 已有效，直接放行
 *  - 401  → 显示令牌输入页
 *
 * 令牌只存 localStorage；Electron 由主进程注入，不显示输入页。
 * 任何 401（token 被换掉、后端重启生成了新 token）都会重新弹出。
 */

type Phase = "checking" | "ok" | "need-token" | "validating";

async function probe(token?: string): Promise<number> {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/workspace/info`, {
      timeout: 8000,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return res.status;
  } catch (err) {
    // 不用 axios.isAxiosError：这个判断在 mock / 非 axios 环境里不可靠
    const status = (err as { response?: { status?: number } } | null)?.response
      ?.status;
    if (status) return status;
    throw err;
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [phase, setPhase] = React.useState<Phase>("checking");
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [unreachable, setUnreachable] = React.useState(false);

  const check = React.useCallback(async () => {
    if (isElectron()) {
      setPhase("ok");
      return;
    }
    setUnreachable(false);
    try {
      const status = await probe(getApiToken() || undefined);
      setPhase(status === 401 ? "need-token" : "ok");
    } catch {
      // 后端连不上：交给 ConnectionBanner 提示，不拦着用户看离线页面
      setUnreachable(true);
      setPhase("ok");
    }
  }, []);

  React.useEffect(() => {
    void check();
    const onAuthRequired = () => {
      if (!isElectron()) setPhase("need-token");
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [check]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setPhase("validating");
    setError(null);
    try {
      const status = await probe(token);
      if (status === 401) {
        setError(t("auth.invalid"));
        setPhase("need-token");
        return;
      }
      setApiToken(token);
      // 让所有模块用新 token 重新拉数据
      window.location.reload();
    } catch {
      setError(t("auth.unreachable"));
      setPhase("need-token");
    }
  };

  if (phase === "checking" || phase === "validating") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-neutral-950 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (phase === "need-token") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-neutral-950 p-6">
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-brand" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t("auth.title")}
            </h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("auth.description")}
          </p>

          <div className="rounded-lg bg-gray-50 dark:bg-neutral-800 p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
            <p className="font-medium">{t("auth.whereTitle")}</p>
            <p className="font-mono break-all">
              docker compose exec -u root caldav-desktop cat /data/api-token.txt
            </p>
            <p>{t("auth.whereHint")}</p>
          </div>

          <label className="block">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {t("auth.tokenLabel")}
            </span>
            <div className="mt-1 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-gray-400" />
              <input
                autoFocus
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="64 位十六进制令牌"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm font-mono text-gray-900 dark:text-white"
              />
            </div>
          </label>

          {(error || unreachable) && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {error ?? t("auth.unreachable")}
            </p>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                clearApiToken();
                setValue("");
              }}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
            >
              {t("auth.clear")}
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50"
            >
              {t("auth.connect")}
            </button>
          </div>

          <p className="text-[11px] text-gray-400">{t("auth.backupHint")}</p>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export default AuthGate;
