/**
 * QuickCreate - 自然语言快速创建事件
 *
 * 设计要点：
 *  - **默认走本地规则解析**：毫秒级、断网可用、不产生 AI 费用。
 *    本地解析失败时才提示「可用 AI 深度解析」，由用户主动触发 ——
 *    这样既保证了「快速」，也不会在无谓的地方等待网络。
 *  - **草稿先预览再建**：解析端点不写文件，用户确认后才落盘到 events.md。
 *    自然语言解析必然有误差，让用户先看一眼比事后回滚好。
 *  - **语音双路径**：浏览器内置（免费、不出本机）优先，
 *    不可用时回退到 Whisper API。
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Mic,
  MicOff,
  Loader2,
  X,
  ListTodo,
  Check,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import {
  parseNaturalLanguageText,
  fetchNlpStatus,
  transcribeAudio,
  formatDraftWhen,
  recurrenceLabel,
  type ParsedDraft,
  type NlpStatus,
} from "../api/nlp";
import { useSpeech, useRecorder } from "../hooks/useSpeech";

interface QuickCreateProps {
  /** 确认创建时回调（已带上解析好的字段，可直接提交） */
  onCreate: (draft: {
    title: string;
    date: string;
    end?: string;
    allDay: boolean;
    recurrence?: string;
    description?: string;
    /** 是否同时加入任务看板 */
    addToKanban: boolean;
  }) => Promise<void>;
}

export default function QuickCreate({ onCreate }: QuickCreateProps) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<NlpStatus | null>(null);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [addToKanban, setAddToKanban] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 语音：浏览器内置
  const speech = useSpeech({
    onFinal: (t: string) => {
      setText((prev) => (prev ? `${prev} ${t}` : t));
      setParseError(null);
    },
  });

  // 语音：Whisper 回退
  const recorder = useRecorder();
  const [whisperBusy, setWhisperBusy] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);

  useEffect(() => {
    fetchNlpStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  /** 调用解析 */
  const runParse = useCallback(
    async (forceAI?: boolean) => {
      const t = text.trim();
      if (!t) return;
      setParsing(true);
      setParseError(null);
      try {
        const r = await parseNaturalLanguageText(t, { forceAI });
        setDraft(r.draft);
        if (r.fallbackReason) {
          // AI 失败已回退本地，提示但不影响使用
          flash("AI 不可用，已用本地规则解析");
        }
      } catch (e: any) {
        setDraft(null);
        if (e?.response?.data?.needManualInput) {
          setParseError(
            "没能识别出时间信息。试试「明天下午3点和老王开会」这类说法，或点「用 AI 深度解析」。",
          );
        } else {
          setParseError(
            "解析失败：" + (e?.response?.data?.error || e?.message || "未知错误"),
          );
        }
      } finally {
        setParsing(false);
      }
    },
    [text],
  );

  // Enter 直接解析；Shift+Enter 换行
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runParse(false);
    }
  };

  /** Whisper 录音流程 */
  const toggleWhisper = async () => {
    if (!recorder.recording) {
      await recorder.start();
      setWhisperMode(true);
      return;
    }
    const blob = await recorder.stop();
    setWhisperMode(false);
    if (!blob) {
      flash("录音失败");
      return;
    }
    setWhisperBusy(true);
    try {
      const t = await transcribeAudio(blob);
      if (t) {
        setText((prev) => (prev ? `${prev} ${t}` : t));
        setParseError(null);
        flash("识别完成");
      } else {
        flash("没有识别到内容");
      }
    } catch (e: any) {
      flash(
        "转写失败：" +
          (e?.response?.data?.error || e?.message || "未知错误"),
      );
    } finally {
      setWhisperBusy(false);
    }
  };

  /** 确认创建 */
  const confirmCreate = async () => {
    if (!draft?.start) return;
    setCreating(true);
    try {
      await onCreate({
        title: draft.title,
        date: draft.start,
        end: draft.end || undefined,
        allDay: draft.allDay,
        recurrence: draft.recurrence,
        addToKanban,
      });
      setDraft(null);
      setText("");
      setAddToKanban(false);
      flash("已创建");
      inputRef.current?.focus();
    } catch (e) {
      flash("创建失败：" + (e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const clearAll = () => {
    setDraft(null);
    setParseError(null);
    setText("");
  };

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
      {/* 输入行 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="说点什么… 如「明天下午3点和老王开项目评审会」"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        {/* 语音按钮：内置优先，失败可切 Whisper */}
        <button
          onClick={() => (whisperMode ? toggleWhisper() : speech.toggle())}
          disabled={whisperBusy}
          title={
            whisperMode
              ? "停止录音并转写"
              : speech.listening
                ? "停止录音"
                : speech.supported
                  ? "语音输入（浏览器内置）"
                  : "当前浏览器不支持语音输入"
          }
          className={`p-2.5 rounded-lg border transition-colors shrink-0 disabled:opacity-50 ${
            speech.listening || recorder.recording
              ? "bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-600"
              : speech.supported
                ? "border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-neutral-800"
                : "border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600"
          }`}
        >
          {whisperBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : speech.listening || recorder.recording ? (
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        <button
          onClick={() => runParse(false)}
          disabled={!text.trim() || parsing}
          className="px-4 py-2.5 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0 inline-flex items-center gap-1.5"
        >
          {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          解析
        </button>
      </div>

      {/* 录音中提示 */}
      {(speech.listening || recorder.recording) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          正在聆听…请说出事件内容
          {speech.interim && (
            <span className="text-gray-500 dark:text-gray-400 italic">
              「{speech.interim}」
            </span>
          )}
        </div>
      )}

      {/* Whisper 切换 */}
      {!speech.supported && status?.speechEnabled && !recorder.recording && (
        <button
          onClick={toggleWhisper}
          className="mt-2 text-xs text-brand hover:underline"
        >
          浏览器不支持内置语音？改用 AI 语音识别（录音后上传转写）
        </button>
      )}
      {whisperMode && recorder.recording && (
        <button
          onClick={toggleWhisper}
          className="mt-2 text-xs text-brand hover:underline"
        >
          改用浏览器内置语音识别
        </button>
      )}

      {/* 语音错误 */}
      {speech.error && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{speech.error}</span>
        </div>
      )}
      {recorder.error && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {recorder.error}
        </div>
      )}

      {/* 解析失败 */}
      {parseError && (
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <div className="text-amber-700 dark:text-amber-300">{parseError}</div>
            {status?.aiEnabled && (
              <button
                onClick={() => runParse(true)}
                disabled={parsing}
                className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-600 text-white hover:opacity-90 disabled:opacity-50"
              >
                <Wand2 className="w-3 h-3" />
                用 AI 深度解析
              </button>
            )}
          </div>
        </div>
      )}

      {/* 草稿预览 */}
      {draft && (
        <div className="mt-3 p-3 rounded-lg bg-gradient-to-br from-brand/5 to-brand-accent/5 border border-brand/30 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900 dark:text-white truncate">
                {draft.title}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                {formatDraftWhen(draft)}
                {draft.recurrence && ` · 重复：${recurrenceLabel(draft.recurrence)}`}
              </div>
            </div>
            <button
              onClick={clearAll}
              className="shrink-0 p-1 rounded hover:bg-white dark:hover:bg-neutral-800 text-gray-400"
              title="清除"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 解析来源与置信度 */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                draft.source === "ai"
                  ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                  : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
              }`}
            >
              {draft.source === "ai" ? "AI 解析" : "本地规则"}
            </span>
            {draft.matchedFields?.slice(0, 4).map((f: string) => (
              <span
                key={f}
                className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-gray-400"
              >
                {f}
              </span>
            ))}
            {draft.confidence < 0.6 && (
              <span className="text-amber-600 dark:text-amber-400">
                识别把握不大，建议确认
              </span>
            )}
          </div>

          {/* 同时加入看板 */}
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={addToKanban}
              onChange={(e) => setAddToKanban(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand"
            />
            <ListTodo className="w-3.5 h-3.5 text-brand" />
            同时加入任务看板
          </label>

          {/* 操作 */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={confirmCreate}
              disabled={!draft.start || creating}
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {creating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              确认创建
            </button>
            <button
              onClick={clearAll}
              className="px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200"
            >
              取消
            </button>
            <button
              onClick={() => runParse(true)}
              disabled={parsing || !status?.aiEnabled}
              title={status?.aiEnabled ? "让 AI 重新理解" : "未配置 AI"}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <Wand2 className="w-3.5 h-3.5" />
              AI 重新解析
            </button>
          </div>
        </div>
      )}

      {/* AI 不可用提示（不打扰，仅在首次） */}
      {!status?.aiEnabled && !draft && text.trim() && (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
          提示：配置 AI（.env 里 AI_BASE_URL / AI_API_KEY / AI_MODEL）后可启用 AI 深度解析与语音转写
        </p>
      )}

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
