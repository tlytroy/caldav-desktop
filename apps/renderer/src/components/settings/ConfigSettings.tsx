/**
 * 设置界面 —— 数据与语言 / AI 解析 / 同步 三个标签页
 *
 * 与原有的 SettingsModal（外观设置）配套使用：
 *   - SettingsModal 负责 外观（主题、配色、圆角）
 *   - 本组件负责 通用 / AI / 同步
 *
 * 配置写入项目根目录的 config.json（不进 git），敏感字段脱敏传输。
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import {
  Check,
  Loader2,
  AlertTriangle,
  Eye,
  EyeOff,
  Languages,
  Brain,
  RefreshCw,
  FolderCog,
  Info,
} from "lucide-react";
import { useI18n, AVAILABLE_LOCALES, type Locale } from "../../i18n";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

interface AppConfig {
  language: string;
  theme: string;
  colorScheme: string;
  borderRadius: string;
  ai: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    temperature: number;
    whisperModel: string;
    whisperLanguage: string;
  };
  caldav: {
    rootUrl: string;
    username: string;
    password: string;
    syncDirection: "push" | "pull" | "bidirectional";
    autoSyncMinutes: number;
  };
  webdav: {
    enabled: boolean;
    url: string;
    username: string;
    password: string;
    remoteDir: string;
    timeoutMs: number;
  };
  nlp: {
    preferAI: boolean;
    parserLocale: string;
  };
  paths: {
    eventsFile: string;
    kanbanFile: string;
  };
}

type Tab = "general" | "ai" | "sync" | "data";

export default function ConfigSettings() {
  const { t, locale, setLocale } = useI18n();
  const [tab, setTab] = useState<Tab>("general");
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [testBusy, setTestBusy] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  /** 加载配置 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/config");
      setCfg(data.config);
      setConfigPath(data.file?.path || "");
    } catch (e: any) {
      setMsg({
        type: "err",
        text: `读取配置失败：${e?.response?.data?.error || e?.message}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 更新某段配置的某个字段 */
  const patch = (
    section: "ai" | "caldav" | "webdav" | "nlp" | "paths",
    key: string,
    value: any,
  ) => {
    setCfg((prev) =>
      prev
        ? ({
            ...prev,
            [section]: { ...(prev as any)[section], [key]: value },
          } as AppConfig)
        : prev,
    );
  };

  /** 保存 */
  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      const { data } = await api.put("/api/config", {
        ai: cfg.ai,
        caldav: cfg.caldav,
        webdav: cfg.webdav,
        nlp: cfg.nlp,
        paths: cfg.paths,
        language: cfg.language,
      });
      setCfg(data.config);
      setMsg({ type: "ok", text: t("common.saved") });
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      setMsg({
        type: "err",
        text: `${t("errors.configSaveFailed")}：${e?.response?.data?.error || e?.message}`,
      });
    } finally {
      setSaving(false);
    }
  };

  /** 测试 AI 连接 */
  const testAI = async () => {
    if (!cfg) return;
    setTestBusy("ai");
    setMsg(null);
    try {
      // 先保存，再测试
      await api.put("/api/config", { ai: cfg.ai });
      const { data } = await api.post("/api/nlp/parse", {
        text: "明天上午十点测试连接",
        forceAI: true,
      });
      if (data?.success) {
        setMsg({ type: "ok", text: `${t("settings.ai.testSuccess")}：${data.draft?.title || ""}` });
      } else {
        setMsg({ type: "err", text: `${t("settings.ai.testFailed")}：${data?.error || ""}` });
      }
    } catch (e: any) {
      setMsg({
        type: "err",
        text: `${t("settings.ai.testFailed")}：${e?.response?.data?.error || e?.message}`,
      });
    } finally {
      setTestBusy(null);
    }
  };

  /** 测试 WebDAV 连接 */
  const testWebdav = async () => {
    if (!cfg) return;
    setTestBusy("webdav");
    setMsg(null);
    try {
      await api.put("/api/config", { webdav: cfg.webdav });
      const { data } = await api.post("/api/webdav/test");
      setMsg({ type: "ok", text: `${t("settings.ai.testSuccess")}：${data?.message || ""}` });
    } catch (e: any) {
      setMsg({
        type: "err",
        text: `${t("settings.ai.testFailed")}：${e?.response?.data?.error || e?.message}`,
      });
    } finally {
      setTestBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        {t("common.loading")}
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
        {t("errors.configSaveFailed")}
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Languages }> = [
    { id: "general", label: t("settings.tabs.general"), icon: Languages },
    { id: "ai", label: t("settings.tabs.ai"), icon: Brain },
    { id: "sync", label: t("settings.tabs.sync"), icon: RefreshCw },
    { id: "data", label: t("settings.tabs.data"), icon: FolderCog },
  ];

  return (
    <div className="space-y-4">
      {/* 标签页 */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-brand text-brand"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ============ 通用 ============ */}
      {tab === "general" && (
        <div className="space-y-4">
          <Field label={t("settings.general.language")} hint={t("settings.general.languageHint")}>
            <select
              value={locale}
              onChange={(e) => {
                const l = e.target.value as Locale;
                setLocale(l);
                patch("nlp", "parserLocale", l);
              }}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
            >
              {AVAILABLE_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>

          <Field>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.nlp.preferAI}
                onChange={(e) => patch("nlp", "preferAI", e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <span>
                <span className="text-sm text-gray-900 dark:text-white">
                  {t("settings.general.preferAI")}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("settings.general.preferAIHint")}
                </span>
              </span>
            </label>
          </Field>

          <Field label={t("settings.general.configFile")}>
            <code className="block px-3 py-2 rounded-lg bg-gray-100 dark:bg-neutral-800 text-xs text-gray-600 dark:text-gray-300 break-all">
              {configPath}
            </code>
          </Field>
        </div>
      )}

      {/* ============ AI ============ */}
      {tab === "ai" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {t("settings.ai.description")}
          </p>

          <Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.ai.enabled}
                onChange={(e) => patch("ai", "enabled", e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <span className="text-sm text-gray-900 dark:text-white">
                {t("settings.ai.enabled")}
              </span>
            </label>
          </Field>

          <Field label={t("settings.ai.baseUrl")} hint={t("settings.ai.baseUrlHint")}>
            <input
              value={cfg.ai.baseUrl}
              onChange={(e) => patch("ai", "baseUrl", e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
            />
          </Field>

          <Field label={t("settings.ai.apiKey")} hint={t("settings.ai.apiKeyHint")}>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={cfg.ai.apiKey}
                onChange={(e) => patch("ai", "apiKey", e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm font-mono"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                type="button"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <Field label={t("settings.ai.model")} hint={t("settings.ai.modelHint")}>
            <input
              value={cfg.ai.model}
              onChange={(e) => patch("ai", "model", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.ai.timeout")}>
              <input
                type="number"
                value={cfg.ai.timeoutMs}
                onChange={(e) => patch("ai", "timeoutMs", parseInt(e.target.value) || 30000)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
              />
            </Field>
            <Field label={t("settings.ai.temperature")} hint={t("settings.ai.temperatureHint")}>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={cfg.ai.temperature}
                onChange={(e) => patch("ai", "temperature", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.ai.whisperModel")}>
              <input
                value={cfg.ai.whisperModel}
                onChange={(e) => patch("ai", "whisperModel", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
              />
            </Field>
            <Field label={t("settings.ai.whisperLanguage")}>
              <input
                value={cfg.ai.whisperLanguage}
                onChange={(e) => patch("ai", "whisperLanguage", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
              />
            </Field>
          </div>

          <button
            onClick={testAI}
            disabled={testBusy !== null || !cfg.ai.baseUrl}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 disabled:opacity-50"
          >
            {testBusy === "ai" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {t("settings.ai.testConnection")}
          </button>
          <p className="text-xs text-gray-400">{t("settings.ai.testHint")}</p>
        </div>
      )}

      {/* ============ 同步 ============ */}
      {tab === "sync" && (
        <div className="space-y-5">
          {/* CalDAV */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white">
              {t("settings.sync.caldav")}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings.sync.caldavDesc")}
            </p>

            <Field label={t("settings.sync.rootUrl")}>
              <input
                value={cfg.caldav.rootUrl}
                onChange={(e) => patch("caldav", "rootUrl", e.target.value)}
                placeholder="https://radicale.example.com/"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("settings.sync.username")}>
                <input
                  value={cfg.caldav.username}
                  onChange={(e) => patch("caldav", "username", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
                />
              </Field>
              <Field label={t("settings.sync.password")}>
                <input
                  type="password"
                  value={cfg.caldav.password}
                  onChange={(e) => patch("caldav", "password", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("settings.sync.syncDirection")}>
                <select
                  value={cfg.caldav.syncDirection}
                  onChange={(e) => patch("caldav", "syncDirection", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
                >
                  <option value="push">{t("settings.sync.directionPush")}</option>
                  <option value="pull">{t("settings.sync.directionPull")}</option>
                  <option value="bidirectional">{t("settings.sync.directionBoth")}</option>
                </select>
              </Field>
              <Field
                label={t("settings.sync.autoSyncMinutes")}
                hint={t("settings.sync.autoSyncHint")}
              >
                <input
                  type="number"
                  min="0"
                  value={cfg.caldav.autoSyncMinutes}
                  onChange={(e) =>
                    patch("caldav", "autoSyncMinutes", parseInt(e.target.value) || 0)
                  }
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
                />
              </Field>
            </div>
          </section>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* WebDAV */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white">
              {t("settings.sync.webdav")}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings.sync.webdavDesc")}
            </p>

            <Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.webdav.enabled}
                  onChange={(e) => patch("webdav", "enabled", e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                />
                <span className="text-sm text-gray-900 dark:text-white">
                  {t("settings.ai.enabled")}
                </span>
              </label>
            </Field>

            <Field label={t("settings.sync.rootUrl")}>
              <input
                value={cfg.webdav.url}
                onChange={(e) => patch("webdav", "url", e.target.value)}
                placeholder="https://dav.example.com/remote.php/dav/files/user"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("settings.sync.username")}>
                <input
                  value={cfg.webdav.username}
                  onChange={(e) => patch("webdav", "username", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
                />
              </Field>
              <Field label={t("settings.sync.password")}>
                <input
                  type="password"
                  value={cfg.webdav.password}
                  onChange={(e) => patch("webdav", "password", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
                />
              </Field>
            </div>

            <Field label={t("settings.sync.remoteDir")}>
              <input
                value={cfg.webdav.remoteDir}
                onChange={(e) => patch("webdav", "remoteDir", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm"
              />
            </Field>

            <button
              onClick={testWebdav}
              disabled={testBusy !== null || !cfg.webdav.url}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 disabled:opacity-50"
            >
              {testBusy === "webdav" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {t("settings.sync.testWebdav")}
            </button>
          </section>
        </div>
      )}

      {/* ============ 数据文件 ============ */}
      {tab === "data" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {t("settings.data.description")}
          </p>

          <Field label={t("settings.data.eventsFile")} hint={t("settings.data.pathHint")}>
            <input
              value={cfg.paths?.eventsFile || ""}
              onChange={(e) => patch("paths", "eventsFile", e.target.value)}
              placeholder="./events.md"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm font-mono"
            />
          </Field>

          <Field label={t("settings.data.kanbanFile")} hint={t("settings.data.pathHint")}>
            <input
              value={cfg.paths?.kanbanFile || ""}
              onChange={(e) => patch("paths", "kanbanFile", e.target.value)}
              placeholder="./工作搭子看板.md"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white text-sm font-mono"
            />
          </Field>

          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{t("settings.data.restartHint")}</span>
          </div>

          <Field label={t("settings.general.configFile")}>
            <code className="block px-3 py-2 rounded-lg bg-gray-100 dark:bg-neutral-800 text-xs text-gray-600 dark:text-gray-300 break-all">
              {configPath}
            </code>
          </Field>
        </div>
      )}

      {/* 消息 */}
      {msg && (
        <div
          className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
            msg.type === "ok"
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          {msg.type === "ok" ? (
            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          )}
          <span className="flex-1">{msg.text}</span>
        </div>
      )}

      {/* 保存按钮 */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
        <span className="text-[11px] text-gray-400 flex items-center gap-1">
          <Info className="w-3 h-3" />
          {t("settings.about.dataSourceHint")}
        </span>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

/** 表单字段容器 */
function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
