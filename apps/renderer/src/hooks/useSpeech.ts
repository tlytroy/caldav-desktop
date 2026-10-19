/**
 * 语音输入 hook
 *
 * 双路径设计（按优先级）：
 *   1. **浏览器内置 Web Speech API** —— 免费、音频不出本机、实时。
 *      ⚠️ 中文支持因浏览器而异：Chrome / Edge 可用；Firefox 基本不可用；
 *      Safari 支持差。Electron 里依赖 Chromium，通常可用。
 *   2. **Whisper API**（需后端配 AI）—— 录完上传转写，准确率更高、跨浏览器一致。
 *
 * 前者不可用或识别失败时，调用方可回退到后者。
 */

import { useState, useRef, useCallback, useEffect } from "react";

/** 浏览器 Web Speech API 的最小类型声明（避免依赖 @types/dom-speech） */
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResult;
  };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** 常见的不支持错误码 → 可读提示 */
const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "麦克风权限被拒绝，请在浏览器地址栏允许麦克风访问",
  "service-not-allowed": "浏览器语音服务不可用，请改用 Chrome/Edge，或配置 AI Whisper",
  "no-speech": "没有听到声音，请再试一次",
  "audio-capture": "找不到麦克风设备",
  network: "语音识别需要联网（浏览器内置识别的限制），或改用 AI Whisper",
  aborted: "语音识别已取消",
};

export interface SpeechState {
  /** 是否正在录音 */
  listening: boolean;
  /** 浏览器是否支持内置识别 */
  supported: boolean;
  /** 实时中间结果 */
  interim: string;
  /** 最终结果 */
  transcript: string;
  error: string | null;
}

export interface UseSpeechOptions {
  lang?: string;
  onFinal?: (text: string) => void;
  onError?: (msg: string) => void;
}

export function useSpeech(opts: UseSpeechOptions = {}) {
  const { lang = "zh-CN", onFinal, onError } = opts;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  // 用惰性初始化的 useState 而非 useMemo：
  // 这个值在组件生命周期内不会变，且服务端渲染时也能安全求值
  const [supported] = useState(() => !!getSpeechRecognitionCtor());

  const reportError = useCallback(
    (msg: string) => {
      setError(msg);
      onError?.(msg);
    },
    [onError],
  );

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      reportError("当前浏览器不支持内置语音识别，请使用 Chrome/Edge，或配置 AI Whisper");
      return;
    }
    if (recRef.current) return;

    setError(null);
    setTranscript("");
    setInterim("");
    finalRef.current = "";

    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch (e) {
      reportError("语音识别初始化失败：" + (e as Error).message);
      return;
    }

    rec.lang = lang;
    rec.continuous = false; // 单次说完即停，避免误触发
    rec.interimResults = true;

    rec.onstart = () => setListening(true);

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alt = r[0];
        if (!alt) continue;
        if (r.isFinal) {
          finalRef.current += alt.transcript;
        } else {
          interimText += alt.transcript;
        }
      }
      setInterim(interimText);
      if (finalRef.current) {
        setTranscript(finalRef.current);
      }
    };

    rec.onerror = (e) => {
      const msg =
        ERROR_MESSAGES[e.error] || `语音识别出错：${e.error}${e.message ? " - " + e.message : ""}`;
      reportError(msg);
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
      recRef.current = null;
      // 最终结果回调（即使为空也交给上层决定）
      const finalText = finalRef.current.trim();
      if (finalText) {
        onFinal?.(finalText);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      recRef.current = null;
      setListening(false);
      reportError("无法启动录音：" + (e as Error).message);
    }
  }, [lang, onFinal, reportError]);

  const stop = useCallback(() => {
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        recRef.current?.abort();
      }
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  const reset = useCallback(() => {
    setTranscript("");
    setInterim("");
    setError(null);
    finalRef.current = "";
  }, []);

  // 组件卸载时中止录音，避免麦克风一直亮着
  useEffect(() => {
    return () => {
      if (recRef.current) {
        try {
          recRef.current.abort();
        } catch {
          /* ignore */
        }
        recRef.current = null;
      }
    };
  }, []);

  return { listening, supported, interim, transcript, error, start, stop, toggle, reset };
}

/**
 * MediaRecorder 录音，用于把音频提交给 Whisper API。
 * 与 useSpeech 互斥（不能同时开麦克风）。
 */

export interface UseRecorderResult {
  recording: boolean;
  /** 开始录音 */
  start: () => Promise<void>;
  /** 停止并返回音频 Blob */
  stop: () => Promise<Blob | null>;
  error: string | null;
}

/**
 * MediaRecorder 录音，用于把音频提交给 Whisper API。
 * 与 useSpeech 互斥（不能同时开麦克风）。
 */
export function useRecorder(): UseRecorderResult {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前环境不支持录音（需要 HTTPS 或 Electron 环境）");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 选一个浏览器支持的容器格式
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((m) => MediaRecorder.isTypeSupported?.(m));

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };

      mr.start();
      mrRef.current = mr;
      setRecording(true);
    } catch (e) {
      setError("无法访问麦克风：" + (e as Error).message);
    }
  }, []);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const mr = mrRef.current;
    if (!mr) return null;
    return new Promise((resolve) => {
      mr.onstop = () => {
        mrRef.current = null;
        setRecording(false);
        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        resolve(blob.size > 0 ? blob : null);
      };
      try {
        mr.stop();
      } catch {
        setRecording(false);
        resolve(null);
      }
    });
  }, []);

  return { recording, start, stop, error };
}
