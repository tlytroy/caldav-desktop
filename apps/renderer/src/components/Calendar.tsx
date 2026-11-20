import { useState, useMemo, useRef, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useCalendarStore } from '../store/calendarStore';
import { CategorySelector } from './ui/CategorySelector';
import { TagSelector } from './ui/TagSelector';
import { RecurrenceEditor } from './ui/RecurrenceEditor';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Modal } from './ui/Modal';
import { useThemeStore } from '../store/themeStore';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  Upload,
  Download,
  HardDrive,
  HardDriveDownload,
  HardDriveUpload,
  AlertTriangle,
  Check,
} from 'lucide-react';
import type { WorkbenchItem } from '../api/workspace';
import { addDays, addHours, localDate, toLocalIso } from '../utils/date';
import {
  computeRemindAt,
  describeRemind,
  presetValueOf,
  reminderBase,
  REMIND_PRESETS,
} from '../utils/reminders';
import {
  fetchRecurrenceOptions,
  importIcs,
  downloadIcs,
  type RecurrenceOption,
  type IcsImportPreview,
} from '../api/workspace';
import {
  fetchWebDAVStatus,
  pushToWebDAV,
  pullFromWebDAV,
  mergeWebDAV,
  testWebDAVConnection,
  type WebDAVStatus,
  type WebDAVSyncResult,
} from '../api/webdav';
import {
  caldavErrorMessage,
  type CalDAVSyncResult,
} from '../api/caldav-sync';

/** 优先级 → 日历色块 */
const MD_PRIORITY_COLOR: Record<'high' | 'mid' | 'low', string> = {
  high: '#ef4444',
  mid: '#f59e0b',
  low: '#14b8a6',
};

interface CalendarProps {
  calendarUrl?: string;
  /** 外部数据变更时自增，触发重读数据源（用于快速创建后刷新） */
  refreshKey?: number;
}

/**
 * WorkbenchItem → FullCalendar 事件对象
 *
 * 数据源是统一的 workspace.md，事件与任务在同一个条目池里。
 * 任务的 id 在展开重复规则后会变成 "abc@2026-10-05" 的形式
 * （同一条目在不同日期的多个实例），这里保留原始 id 供更新/删除使用。
 */
function toFullCalendarEvent(e: WorkbenchItem) {
  const color = e.priority ? MD_PRIORITY_COLOR[e.priority] : '#3b82f6';
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    // 全天事件若 end 与 start 同日，FullCalendar 需要至少一天的跨度才显示
    end: e.end && e.end !== e.start ? e.end : undefined,
    allDay: !!e.allDay,
    backgroundColor: color,
    borderColor: color,
    extendedProps: { item: e },
  };
}

export default function Calendar({ calendarUrl, refreshKey }: CalendarProps) {
  const {
    events,
    loadingState,
    error,
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    pushToCaldav,
    pullFromCaldav,
    bidirectionalSync,
    lastSyncTime,
  } = useCalendarEvents(calendarUrl || null, refreshKey);
  const { eventFilter, categories, tags } = useCalendarStore();
  const { borderRadius } = useThemeStore();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [syncing, setSyncing] = useState<'push' | 'pull' | 'bidir' | null>(null);
  const [formData, setFormData] = useState<{
    uid?: string;
    title: string;
    start: Date;
    end: Date;
    allDay: boolean;
    description: string;
    category?: any;
    tags: any[];
    recurrence?: any;
    kind?: 'task' | 'event';
    /** 提醒绝对时间（本地串） */
    remind?: string;
    /** 提醒选择器：none / 数字（提前分钟）/ custom */
    remindPreset?: string;
  }>({
    title: '',
    start: new Date(),
    end: new Date(Date.now() + 3600000),
    allDay: false,
    description: '',
    tags: [],
    remindPreset: 'none',
  });
  // 重复规则选项（从服务端取，保证 RRULE 表述一致）
  const [recurrenceOptions, setRecurrenceOptions] = useState<RecurrenceOption[]>([
    { value: '', label: '不重复' },
  ]);
  // 删除确认
  const [pendingDelete, setPendingDelete] = useState<{
    uid: string;
    title: string;
    recurring?: boolean;
  } | null>(null);

  // ===== iCalendar 导入 / 导出 =====
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<IcsImportPreview | null>(null);
  const [pendingIcsText, setPendingIcsText] = useState<string | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [ioMsg, setIoMsg] = useState<string | null>(null);

  // ===== WebDAV 同步 =====
  const [webdavOpen, setWebdavOpen] = useState(false);
  const [webdavStatus, setWebdavStatus] = useState<WebDAVStatus | null>(null);
  const [webdavBusy, setWebdavBusy] = useState<
    'push' | 'pull' | 'merge' | 'test' | null
  >(null);
  const [webdavResults, setWebdavResults] = useState<WebDAVSyncResult[] | null>(null);
  const [webdavMsg, setWebdavMsg] = useState<string | null>(null);

  // ===== CalDAV 同步结果（推送 / 拉取 / 双向） =====
  const [syncResult, setSyncResult] = useState<CalDAVSyncResult | null>(null);

  const loadWebdavStatus = async () => {
    try {
      const s = await fetchWebDAVStatus();
      setWebdavStatus(s);
    } catch (e) {
      setWebdavMsg('查询 WebDAV 状态失败：' + (e as Error).message);
    }
  };

  useEffect(() => {
    if (webdavOpen) loadWebdavStatus();
  }, [webdavOpen]);

  /** WebDAV 同步结果 → 可读文案 */
  const describeSyncResults = (rs: WebDAVSyncResult[]): string => {
    const ok = rs.filter((r) => r.ok);
    const conflicts = rs.filter((r) => r.conflict);
    const skipped = rs.filter((r) => r.skipped);
    const failed = rs.filter((r) => !r.ok && !r.conflict);
    const parts: string[] = [];
    if (ok.length && !skipped.length) parts.push(`${ok.length} 个文件已同步`);
    if (skipped.length) parts.push(`${skipped.length} 个无变化已跳过`);
    if (conflicts.length) parts.push(`${conflicts.length} 个存在冲突`);
    if (failed.length) parts.push(`${failed.length} 个失败`);
    return parts.join('，') || '无变化';
  };

  const handleWebdavTest = async () => {
    setWebdavBusy('test');
    setWebdavMsg(null);
    try {
      const r = await testWebDAVConnection();
      setWebdavMsg((r.message || (r.success ? '连接成功' : '连接失败')) + (r.remoteDir ? `（远端目录：${r.remoteDir}）` : ''));
      await loadWebdavStatus();
    } catch (e) {
      setWebdavMsg('测试失败：' + (e as Error).message);
    } finally {
      setWebdavBusy(null);
    }
  };

  const handleWebdavPush = async (force = false) => {
    setWebdavBusy('push');
    setWebdavMsg(null);
    setWebdavResults(null);
    try {
      const r = await pushToWebDAV({ force });
      setWebdavResults(r.results);
      setWebdavMsg(describeSyncResults(r.results));
      await loadWebdavStatus();
    } catch (e) {
      setWebdavMsg('推送失败：' + (e as Error).message);
    } finally {
      setWebdavBusy(null);
    }
  };

  const handleWebdavPull = async (force = false) => {
    setWebdavBusy('pull');
    setWebdavMsg(null);
    setWebdavResults(null);
    try {
      const r = await pullFromWebDAV({ force });
      setWebdavResults(r.results);
      setWebdavMsg(describeSyncResults(r.results));
      await loadWebdavStatus();
      // 拉取会覆盖 workspace.md，必须重读本地数据
      // 同步的文件现在只有 workspace.md（旧 key 是 events / kanban）
      if (r.results.some((x) => (x.key === 'workspace' || x.key === 'events') && x.ok)) {
        await loadEvents();
      }
    } catch (e) {
      setWebdavMsg('拉取失败：' + (e as Error).message);
    } finally {
      setWebdavBusy(null);
    }
  };

  /** 冲突时的第三个选项：按条目并集合并，两端写同一份 */
  const handleWebdavMerge = async () => {
    setWebdavBusy('merge');
    setWebdavMsg(null);
    setWebdavResults(null);
    try {
      const r = await mergeWebDAV();
      const m = r.merged;
      setWebdavMsg(
        `合并完成：共 ${m.total} 条（只在本地 ${m.localOnly} / 只在远端 ${m.remoteOnly}）；` +
          `采用远端新版 ${m.fromRemote} 条，保留本地新版 ${m.fromLocal} 条` +
          (m.conflicts.length
            ? `；${m.conflicts.length} 条时间相同但内容不同，已保留本地`
            : ''),
      );
      await loadWebdavStatus();
      await loadEvents();
    } catch (e: any) {
      setWebdavMsg(
        '合并失败：' + (e?.response?.data?.error || (e as Error).message),
      );
    } finally {
      setWebdavBusy(null);
    }
  };

  /** 有冲突时先提示，避免用户盲目 force 覆盖 */
  const hasConflict = webdavResults?.some((r) => r.conflict) ?? false;

  // 加载重复规则选项
  useEffect(() => {
    fetchRecurrenceOptions()
      .then((opts) => setRecurrenceOptions(opts.length ? opts : [{ value: '', label: '不重复' }]))
      .catch(() => setRecurrenceOptions([{ value: '', label: '不重复' }]));
  }, []);

  // 过滤（事件来自统一数据源，字段是 start/end）
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (eventFilter.searchText) {
        const s = eventFilter.searchText.toLowerCase();
        if (
          !event.title?.toLowerCase().includes(s) &&
          !event.description?.toLowerCase().includes(s)
        ) return false;
      }
      if (eventFilter.categoryId) {
        if (event.project !== eventFilter.categoryId) return false;
      }
      return true;
    });
  }, [events, eventFilter]);

  // 映射成 FullCalendar 事件对象。
  // 注意：任务与事件在同一个条目池里，所以这里**不需要**再叠加看板任务 ——
  // 有 start 的任务本来就出现在日历上了。
  const displayEvents = useMemo(
    () => filteredEvents.map(toFullCalendarEvent),
    [filteredEvents],
  );

  const handleSelect = (info: any) => {
    // 用户在日历上框选时间段 → 打开新建事件 modal
    setFormData({
      title: '',
      start: info.start,
      end: info.end || info.start,
      allDay: !!info.allDay,
      description: '',
      tags: [],
      remindPreset: 'none',
    });
    setShowModal(true);
  };

  const handleEventClick = (info: any) => {
    const id = info.event.id;
    // 展开重复规则后，实例 id 形如 "abc@2026-10-05"；原始 id 在 instanceId 里
    const originalId = info.event.extendedProps?.item?.instanceId || id.split('@')[0];
    const e = events.find((ev) => (ev.instanceId || ev.id) === originalId);
    if (!e) return;

    // ⚠️ 重复事件必须用**系列原始起点**（seriesStart），不能用「被点的那一次」——
    // 否则保存时会把整个系列的锚点挪到那一天。
    const start = new Date(e.seriesStart || e.start || Date.now());
    let end = e.seriesEnd
      ? new Date(e.seriesEnd)
      : e.end
        ? new Date(e.end)
        : new Date(start.getTime() + (e.allDay ? 86400000 : 3600000));
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + (e.allDay ? 86400000 : 3600000));
    }

    setFormData({
      uid: originalId,
      title: e.title || '',
      start,
      end,
      allDay: !!e.allDay,
      description: e.description || '',
      category: e.project,
      tags: e.tags || [],
      recurrence: e.recurrence,
      // 不保留 kind 的话，编辑一个「任务」会被静默改成「事件」→ 从看板消失
      kind: e.kind,
      remind: e.remind,
      remindPreset: presetValueOf(
        e.remind,
        reminderBase({ start: toLocalIso(start), allDay: !!e.allDay }),
      ),
    });
    setShowModal(true);
  };

  /**
   * 开始时间 / 全天变化时，如果提醒选的是预设（提前 N 分钟），
   * 跟着重算提醒时间；自定义时间不自动改，避免覆盖用户手填的值。
   */
  const withRemind = (next: typeof formData): typeof formData => {
    const p = next.remindPreset;
    if (!p || p === 'none' || p === 'custom') return next;
    const base = reminderBase({
      start: toLocalIso(next.start),
      allDay: next.allDay,
    });
    if (!base) return next;
    return { ...next, remind: computeRemindAt(base, parseInt(p, 10)) };
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) return;
    try {
      setShowModal(false);

      // 结束时间必须晚于开始：全天按次日算（与 ICS 的排他边界一致），
      // 定时事件至少 +1 小时。否则服务端校验直接拒绝，用户只看到「保存失败」。
      let endDate = formData.end;
      if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        endDate = addHours(formData.start, 1);
      }
      if (endDate.getTime() <= formData.start.getTime()) {
        endDate = formData.allDay
          ? addDays(formData.start, 1)
          : addHours(formData.start, 1);
      }

      // 提醒：预设值以「开始时间」为基准重新算一次，保证与最终保存的时间一致
      let remindValue: string | undefined = formData.remind;
      const remindPreset = formData.remindPreset;
      if (remindPreset && remindPreset !== 'none' && remindPreset !== 'custom') {
        const base = reminderBase({
          start: toLocalIso(formData.start),
          allDay: formData.allDay,
        });
        if (base) remindValue = computeRemindAt(base, parseInt(remindPreset, 10));
      }

      const itemPayload: any = {
        title: formData.title,
        start: toLocalIso(formData.start),
        end: toLocalIso(endDate),
        allDay: formData.allDay,
        remind: remindValue || null,
        description: formData.description,
        // CategorySelector 给的是 {name,color}，这里取名字
        project: formData.category?.name || formData.category || undefined,
        tags: (formData.tags || []).map((t: any) =>
          typeof t === 'object' ? t.name : t,
        ),
        recurrence: formData.recurrence || undefined,
        kind: formData.kind || 'event',
      };
      if (formData.uid) {
        await updateEvent(formData.uid, itemPayload);
        console.log('[Calendar] 条目已更新到统一数据源');
      } else {
        await createEvent(itemPayload);
        console.log('[Calendar] 条目已保存到统一数据源');
      }
    } catch (err) {
      console.error('[Calendar] 保存失败:', err);
      alert('保存失败：' + (err instanceof Error ? err.message : String(err)));
      setShowModal(true);
    }
  };

  const handleDeleteClick = () => {
    if (formData.uid) {
      setPendingDelete({
        uid: formData.uid,
        title: formData.title,
        recurring: !!formData.recurrence,
      });
      setShowDeleteConfirm(true);
    }
  };

  /** 删除条目 —— 删一条就是删一条，没有级联 */
  const confirmDeleteCascade = async () => {
    if (!pendingDelete) return;
    try {
      setShowModal(false);
      setShowDeleteConfirm(false);
      await deleteEvent(pendingDelete.uid);
      setPendingDelete(null);
    } catch (err) {
      alert(
        '删除失败：' + (err instanceof Error ? err.message : String(err)),
      );
      setShowDeleteConfirm(true);
    }
  };

  /**
   * CalDAV 同步（workspace.md ↔ CalDAV）。
   *
   * 失败必须显示原因 —— 以前这里把错误吞掉，用户以为同步成功了，
   * 实际上推的是废弃的 events.md。
   */
  const handleSync = async (
    kind: 'push' | 'pull' | 'bidir',
    force = false,
    uids?: string[],
    merge = false,
  ) => {
    setSyncing(kind);
    setSyncResult(null);
    setIoMsg(null);
    try {
      const r =
        kind === 'push'
          ? await pushToCaldav(force, uids)
          : kind === 'pull'
            ? await pullFromCaldav(force, uids)
            : await bidirectionalSync(force, uids, merge);
      setSyncResult(r);
    } catch (e) {
      setIoMsg('CalDAV 同步失败：' + caldavErrorMessage(e));
    } finally {
      setSyncing(null);
    }
  };

  // ===== iCalendar 导入 =====

  /** 选中 .ics 文件 → 先 dryRun 预览，确认后再落盘 */
  const onPickIcsFile = async (file: File) => {
    setImporting(true);
    setIoMsg(null);
    try {
      const text = await file.text();
      const preview = await importIcs(text, { dryRun: true });
      setPendingIcsText(text);
      setImportPreview(preview);
      if (preview.toImport === 0) {
        setIoMsg(
          `解析到 ${preview.parsed} 条，但都已存在（跳过 ${preview.skipped} 条），无需导入`,
        );
      }
    } catch (err) {
      setIoMsg('导入失败：' + (err instanceof Error ? err.message : String(err)));
      setPendingIcsText(null);
      setImportPreview(null);
    } finally {
      setImporting(false);
    }
  };

  /** 确认写入 */
  const confirmImport = async () => {
    if (!pendingIcsText) return;
    setImporting(true);
    try {
      const r = await importIcs(pendingIcsText, {
        mode: replaceOnImport ? 'replace' : 'append',
      });
      const n = r.imported ?? 0;
      const skipped = r.skipped ?? 0;
      setIoMsg(
        `已导入 ${n} 条${skipped ? `，跳过 ${skipped} 条重复` : ''}，数据源现有 ${r.total ?? 0} 条`,
      );
      setImportPreview(null);
      setPendingIcsText(null);
      await loadEvents();
    } catch (err) {
      setIoMsg('导入失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImporting(false);
    }
  };

  const cancelImport = () => {
    setImportPreview(null);
    setPendingIcsText(null);
  };

  const handleExport = async () => {
    try {
      await downloadIcs();
      setIoMsg('已导出 .ics 文件，可用其他日历软件导入');
    } catch (err) {
      setIoMsg(err instanceof Error ? `导出失败：${err.message}` : '导出失败');
    }
  };

  const formatTime = (date: Date) => date.toTimeString().slice(0, 5);
  // 不能用 toISOString：它是 UTC，东八区 00:00-08:00 会把日期显示成前一天
  const formatDate = (date: Date) => localDate(date);

  // ---- Loading skeleton ----
  if (loadingState === 'loading') {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 relative">
        <LoadingSpinner message="加载 workspace.md 中..." />
      </div>
    );
  }

  // ---- Error fallback ----
  if (loadingState === 'error') {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-red-200 dark:border-red-900/40 shadow-sm p-6">
        <div className="text-red-600 dark:text-red-400 text-sm">
          读取 workspace.md 失败：{error}
        </div>
        <button
          onClick={loadEvents}
          className="mt-3 px-3 py-1.5 text-xs text-white bg-brand rounded-md hover:opacity-90"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 relative">
      {/* 工具栏：同步按钮 + 上次同步时间 */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-gray-100 dark:border-neutral-800">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          数据源：本地 <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800">workspace.md</code>
          {lastSyncTime && (
            <span className="ml-2">
              · 上次同步 {new Date(lastSyncTime).toLocaleString('zh-CN')}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleSync('push')}
            disabled={syncing !== null}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700 disabled:opacity-50"
            title="把 workspace.md 转成 ICS 推送到 CalDAV"
          >
            <Cloud className="w-3.5 h-3.5" />
            推送 CalDAV
          </button>
          <button
            onClick={() => handleSync('pull')}
            disabled={syncing !== null}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700 disabled:opacity-50"
            title="从 CalDAV 拉取并合并到 workspace.md"
          >
            <CloudOff className="w-3.5 h-3.5" />
            拉取
          </button>
          <button
            onClick={() => handleSync('bidir')}
            disabled={syncing !== null}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-brand text-white hover:opacity-90 disabled:opacity-50"
            title="双向同步 workspace.md ↔ CalDAV"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing === 'bidir' ? 'animate-spin' : ''}`} />
            双向同步
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700 disabled:opacity-50"
            title="导入 .ics 文件到 workspace.md"
          >
            <Upload className="w-3.5 h-3.5" />
            导入 ICS
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
            title="导出 workspace.md 为 .ics 文件"
          >
            <Download className="w-3.5 h-3.5" />
            导出 ICS
          </button>
          <button
            onClick={() => setWebdavOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
            title="通过 WebDAV 直接同步 md 文件（无需 ICS 转换）"
          >
            <HardDrive className="w-3.5 h-3.5" />
            WebDAV
          </button>
        </div>
      </div>

      {/* CalDAV 同步结果（冲突不静默吞掉，给用户两个明确选择） */}
      {syncResult && (
        <div
          className={`mb-3 p-2.5 rounded-lg border text-xs ${
            syncResult.conflicts.length || syncResult.errors.length
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">
              CalDAV 同步完成：推送 {syncResult.pushed.length} 条，拉取{' '}
              {syncResult.pulled.length} 条，合并 {syncResult.merged?.length ?? 0} 条，
              跳过 {syncResult.skipped} 条
              {syncResult.conflicts.length > 0 &&
                `，冲突 ${syncResult.conflicts.length} 条`}
              {syncResult.errors.length > 0 &&
                `，失败 ${syncResult.errors.length} 条`}
            </span>
            <button
              onClick={() => setSyncResult(null)}
              className="shrink-0 hover:underline"
            >
              关闭
            </button>
          </div>
          {syncResult.conflicts.length > 0 && (
            <>
              <ul className="mt-2 space-y-1 list-disc pl-4">
                {syncResult.conflicts.map((c) => (
                  <li key={c.uid}>
                    <span className="font-medium">{c.title}</span> — {c.reason}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() =>
                    handleSync(
                      'pull',
                      true,
                      syncResult.conflicts.map((c) => c.uid),
                    )
                  }
                  disabled={syncing !== null}
                  className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 hover:opacity-80 disabled:opacity-50"
                >
                  冲突项以远端为准
                </button>
                <button
                  onClick={() =>
                    handleSync(
                      'push',
                      true,
                      syncResult.conflicts.map((c) => c.uid),
                    )
                  }
                  disabled={syncing !== null}
                  className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 hover:opacity-80 disabled:opacity-50"
                >
                  冲突项以本地为准
                </button>
                <button
                  onClick={() =>
                    handleSync(
                      'bidir',
                      false,
                      syncResult.conflicts.map((c) => c.uid),
                      true,
                    )
                  }
                  disabled={syncing !== null}
                  className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 hover:opacity-80 disabled:opacity-50"
                  title="本地改过的字段保留，只有远端改的字段采纳；两边都改的字段保留本地并在结果里标出"
                >
                  合并双方改动
                </button>
              </div>
            </>
          )}
          {syncResult.errors.length > 0 && (
            <ul className="mt-2 space-y-1 list-disc pl-4">
              {syncResult.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 隐藏的文件选择 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickIcsFile(f);
          e.target.value = ''; // 允许重复选同一个文件
        }}
      />

      {/* 导入结果提示 */}
      {ioMsg && (
        <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <span className="flex-1">{ioMsg}</span>
          <button onClick={() => setIoMsg(null)} className="shrink-0 hover:underline">
            关闭
          </button>
        </div>
      )}

      {/* 导入预览确认弹窗 */}
      <Modal
        isOpen={!!importPreview}
        onClose={cancelImport}
        title="导入 iCalendar 文件"
        size="md"
      >
        {importPreview && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
                <div className="text-xs text-gray-500 dark:text-gray-400">解析到</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {importPreview.parsed}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                <div className="text-xs text-green-600 dark:text-green-400">将导入</div>
                <div className="text-lg font-semibold text-green-700 dark:text-green-300">
                  {importPreview.toImport}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
                <div className="text-xs text-gray-500 dark:text-gray-400">跳过重复</div>
                <div className="text-lg font-semibold text-gray-500 dark:text-gray-400">
                  {importPreview.skipped}
                </div>
              </div>
            </div>

            {importPreview.preview.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1.5">
                  前 5 条预览
                </div>
                <ul className="text-sm divide-y divide-gray-100 dark:divide-neutral-800">
                  {importPreview.preview.slice(0, 5).map((e, i) => (
                    <li key={i} className="py-1.5 flex items-center gap-2">
                      <span className="flex-1 text-gray-900 dark:text-white truncate">
                        {e.title}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {e.allDay
                          ? '全天'
                          : String(e.start || '').slice(0, 16).replace('T', ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
                {importPreview.preview.length > 5 && (
                  <div className="text-xs text-gray-400 mt-1">
                    还有 {importPreview.preview.length - 5} 条…
                  </div>
                )}
              </div>
            )}

            <label className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
              <input
                type="checkbox"
                checked={replaceOnImport}
                onChange={(e) => setReplaceOnImport(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                <span className="font-medium text-amber-700 dark:text-amber-300">
                  替换而非追加
                </span>
                <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                  默认追加到现有条目之后；勾选后会先清空 workspace.md 里的全部条目，
                  仅保留本次导入的内容。此操作不可撤销。
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-neutral-800">
              <button
                onClick={cancelImport}
                className={`px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-neutral-800 ${borderRadius}`}
              >
                取消
              </button>
              <button
                onClick={confirmImport}
                disabled={importing || importPreview.toImport === 0}
                className={`px-4 py-2 text-sm text-white bg-brand ${borderRadius} hover:opacity-90 disabled:opacity-50`}
              >
                {importing ? '导入中…' : `确认导入 ${importPreview.toImport} 条`}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* WebDAV 同步面板 */}
      <Modal
        isOpen={webdavOpen}
        onClose={() => setWebdavOpen(false)}
        title="WebDAV 同步"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            直接把 <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800">workspace.md</code>
            同步到 WebDAV 服务器（Nextcloud / 坚果云 / ownCloud 等）。
            <span className="block mt-1">
              与 CalDAV 通道不同，这里<strong>不经过 ICS 转换</strong>，md 格式原样上传。
            </span>
          </p>

          {!webdavStatus ? (
            <div className="flex items-center justify-center py-6 text-gray-400">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 查询中…
            </div>
          ) : !webdavStatus.configured ? (
            <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-yellow-500" />
                <div>
                  <div className="font-medium text-yellow-700 dark:text-yellow-300">
                    WebDAV 未配置
                  </div>
                  <div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                    在项目根目录 <code>.env</code> 中设置：
                    <pre className="mt-1.5 p-2 rounded bg-white dark:bg-neutral-800 overflow-x-auto">
{`WEBDAV_URL=https://dav.example.com/remote.php/dav/files/user
WEBDAV_USER=your_username
WEBDAV_PASS=your_password
WEBDAV_EVENTS_PATH=CalDAV-Desktop`}
                    </pre>
                    配置后重启后端服务。
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* 连接信息 */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-neutral-800 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-gray-700 dark:text-gray-300 truncate">
                    {webdavStatus.url}
                  </div>
                  <div className="text-gray-400 mt-0.5">
                    远端目录：{webdavStatus.remoteDir || '(根目录)'}
                    {webdavStatus.hasCredentials ? '' : ' · 未配置账号密码'}
                  </div>
                </div>
                <button
                  onClick={handleWebdavTest}
                  disabled={webdavBusy !== null}
                  className="shrink-0 ml-2 px-2.5 py-1 rounded bg-white dark:bg-neutral-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 disabled:opacity-50"
                >
                  {webdavBusy === 'test' ? '测试中…' : '测试连接'}
                </button>
              </div>

              {/* 文件状态 */}
              <ul className="divide-y divide-gray-100 dark:divide-neutral-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                {webdavStatus.files.map((f) => (
                  <li key={f.key} className="px-3 py-2 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {f.filename}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {f.lastSyncedAt
                          ? `上次同步 ${new Date(f.lastSyncedAt).toLocaleString('zh-CN')}`
                          : '尚未同步过'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                      <span
                        className={`inline-flex items-center gap-1 ${
                          !f.remote.exists
                            ? 'text-gray-400'
                            : f.remoteChangedSinceLastSync
                              ? 'text-amber-500'
                              : 'text-green-500'
                        }`}
                        title={
                          !f.remote.exists
                            ? '远端还没有这个文件'
                            : f.remoteChangedSinceLastSync
                              ? '远端已被其他设备修改'
                              : '与远端一致'
                        }
                      >
                        {f.remote.exists ? <Check className="w-3.5 h-3.5" /> : '—'}
                        {!f.remote.exists
                          ? '远端缺失'
                          : f.remoteChangedSinceLastSync
                            ? '远端已变更'
                            : '已同步'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              {/* 操作 */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleWebdavPush(false)}
                  disabled={webdavBusy !== null}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-brand rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  <HardDriveUpload className="w-4 h-4" />
                  {webdavBusy === 'push' ? '推送中…' : '推送到 WebDAV'}
                </button>
                <button
                  onClick={() => handleWebdavPull(false)}
                  disabled={webdavBusy !== null}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-neutral-800 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  <HardDriveDownload className="w-4 h-4" />
                  {webdavBusy === 'pull' ? '拉取中…' : '从 WebDAV 拉取'}
                </button>
                <button
                  onClick={handleWebdavMerge}
                  disabled={webdavBusy !== null}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg hover:opacity-90 disabled:opacity-50"
                  title="按条目 id 合并：两边独有都保留，同一条目用较新的一版"
                >
                  <HardDrive className="w-4 h-4" />
                  {webdavBusy === 'merge' ? '合并中…' : '合并双方条目'}
                </button>
              </div>

              <p className="text-xs text-gray-400">
                推送用 ETag 做乐观锁：检测到远端被其他设备改过时不会覆盖，需手动确认。
                拉取只覆盖「远端确实变化」的文件，覆盖前自动备份为 <code>.bak</code>。
              </p>

              {/* 结果 */}
              {webdavMsg && (
                <div
                  className={`p-2.5 rounded-lg border text-xs ${
                    hasConflict
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                      : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                  }`}
                >
                  <div>{webdavMsg}</div>
                  {hasConflict && (
                    <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                      <div className="mb-1.5">
                        远端有更新。三选一：以本地为准 / 以远端为准 / 合并双方条目。
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleWebdavPush(true)}
                          disabled={webdavBusy !== null}
                          className="px-2.5 py-1 rounded bg-amber-600 text-white hover:opacity-90 disabled:opacity-50"
                        >
                          以本地为准
                        </button>
                        <button
                          onClick={() => handleWebdavPull(true)}
                          disabled={webdavBusy !== null}
                          className="px-2.5 py-1 rounded bg-white dark:bg-neutral-800 text-amber-700 dark:text-amber-300 hover:opacity-80 disabled:opacity-50"
                        >
                          以远端为准
                        </button>
                        <button
                          onClick={handleWebdavMerge}
                          disabled={webdavBusy !== null}
                          className="px-2.5 py-1 rounded bg-white dark:bg-neutral-800 text-amber-700 dark:text-amber-300 hover:opacity-80 disabled:opacity-50"
                        >
                          合并双方条目
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 逐文件结果 */}
              {webdavResults && webdavResults.length > 0 && (
                <ul className="text-xs space-y-1">
                  {webdavResults.map((r) => (
                    <li key={r.key} className="flex items-start gap-2">
                      <span
                        className={
                          r.ok && !r.conflict
                            ? 'text-green-500'
                            : r.conflict
                              ? 'text-amber-500'
                              : 'text-red-500'
                        }
                      >
                        {r.ok && !r.conflict ? <Check className="w-3.5 h-3.5" /> : '!'}
                      </span>
                      <span className="text-gray-600 dark:text-gray-300">
                        {r.filename}
                        {r.conflict
                          ? `：${r.error}`
                          : r.skipped
                            ? '：远端无变化，已跳过'
                            : r.ok
                              ? `：成功${r.bytes ? `（${r.bytes} 字节）` : ''}${r.backupPath ? '，原文件已备份' : ''}`
                              : `：${r.error}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Modal>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
        }}
        events={displayEvents}
        weekends={true}
        editable={false}
        selectable={true}
        selectMirror={false}
        dayMaxEvents={true}
        select={handleSelect}
        eventClick={handleEventClick}
        eventContent={(arg) => (
          <div className="w-full px-1 truncate">
            <span className="text-xs">{arg.event.title}</span>
          </div>
        )}
        height="auto"
        contentHeight="auto"
        expandRows={true}
      />

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={formData.uid ? '编辑事件' : '创建新事件'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              事件标题 *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
              placeholder="输入事件标题"
              autoFocus
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={formData.allDay}
              onChange={(e) => {
                const checked = e.target.checked;
                const next = { ...formData, allDay: checked };
                // 勾上全天后，结束时间至少是次日（排他边界）
                if (
                  checked &&
                  formData.end.getTime() <= formData.start.getTime()
                ) {
                  next.end = addDays(formData.start, 1);
                }
                setFormData(withRemind(next));
              }}
              className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
            />
            全天事件
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">开始日期 *</label>
              <input
                type="date"
                value={formatDate(formData.start)}
                onChange={(e) => {
                  const ns = new Date(e.target.value);
                  ns.setHours(formData.start.getHours(), formData.start.getMinutes());
                  setFormData(withRemind({ ...formData, start: ns }));
                }}
                className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">结束日期 *</label>
              <input
                type="date"
                value={formatDate(formData.end)}
                onChange={(e) => {
                  const ne = new Date(e.target.value);
                  ne.setHours(formData.end.getHours(), formData.end.getMinutes());
                  setFormData({ ...formData, end: ne });
                }}
                className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
              />
            </div>
          </div>

          {!formData.allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">开始时间</label>
                <input
                  type="time"
                  value={formatTime(formData.start)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    const ns = new Date(formData.start);
                    ns.setHours(h, m);
                    setFormData(withRemind({ ...formData, start: ns }));
                  }}
                  className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">结束时间</label>
                <input
                  type="time"
                  value={formatTime(formData.end)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    const ne = new Date(formData.end);
                    ne.setHours(h, m);
                    setFormData({ ...formData, end: ne });
                  }}
                  className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
              rows={3}
              placeholder="输入事件描述（可选）"
            />
          </div>

          {/* 提醒 */}
          <div className="border-t border-gray-100 dark:border-neutral-800 pt-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              提醒
            </label>
            <select
              value={formData.remindPreset || 'none'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'none') {
                  setFormData({ ...formData, remindPreset: 'none', remind: undefined });
                  return;
                }
                const base = reminderBase({
                  start: toLocalIso(formData.start),
                  allDay: formData.allDay,
                });
                if (v === 'custom') {
                  setFormData({
                    ...formData,
                    remindPreset: 'custom',
                    remind:
                      formData.remind ||
                      (base ? computeRemindAt(base, 30) : undefined),
                  });
                  return;
                }
                setFormData({
                  ...formData,
                  remindPreset: v,
                  remind: base ? computeRemindAt(base, parseInt(v, 10)) : undefined,
                });
              }}
              className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
            >
              {REMIND_PRESETS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="custom">自定义时间…</option>
            </select>

            {formData.remindPreset === 'custom' && (
              <input
                type="datetime-local"
                value={(formData.remind || '').slice(0, 16)}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    remind: e.target.value ? `${e.target.value}:00` : undefined,
                  })
                }
                className={`mt-2 w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
              />
            )}

            {formData.remind ? (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                将于 {describeRemind(formData.remind)} 提醒（应用内；配了推送渠道也会发到手机）
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                提醒时间存在本地 workspace.md 里，不依赖服务器
              </p>
            )}
          </div>

          {/* 重复规则 */}
          <div className="border-t border-gray-100 dark:border-neutral-800 pt-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              重复
            </label>
            <select
              value={formData.recurrence || ''}
              onChange={(e) =>
                setFormData({ ...formData, recurrence: e.target.value || undefined })
              }
              className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
            >
              {recurrenceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {formData.recurrence && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                重复事件：修改或删除会作用于整个系列（暂不支持「只改这一次」）
              </p>
            )}
          </div>

          {/* 类型：任务同时出现在看板与日历 */}
          <div className="border-t border-gray-100 dark:border-neutral-800 pt-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              类型
            </label>
            <select
              value={formData.kind || 'event'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  kind: e.target.value === 'task' ? 'task' : 'event',
                })
              }
              className={`w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand`}
            >
              <option value="event">事件（只出现在日历）</option>
              <option value="task">任务（同时出现在看板与日历）</option>
            </select>
          </div>

          <CategorySelector
            categories={categories}
            selectedCategory={formData.category}
            onSelect={(category) => setFormData({ ...formData, category })}
          />
          <TagSelector
            tags={tags}
            selectedTags={formData.tags || []}
            onToggle={(tag) => {
              // formData.tags 存的是字符串数组（events.md 格式），
              // 而 TagSelector 的 selectedTags 期望 {id,name,color} 对象。
              // 以名字匹配来转换，避免两边结构不一致导致选中态永远不亮。
              const cur = formData.tags || [];
              const name = typeof tag === 'object' ? (tag as any).name : String(tag);
              const has = cur.some((t: any) => (typeof t === 'object' ? t.name : t) === name);
              const next = has
                ? cur.filter((t: any) => (typeof t === 'object' ? t.name : t) !== name)
                : [...cur, name];
              setFormData({ ...formData, tags: next });
            }}
          />
          <RecurrenceEditor
            value={formData.recurrence}
            onChange={(recurrence) => setFormData({ ...formData, recurrence })}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 mt-6 pt-4 border-t border-gray-100 dark:border-neutral-800">
          <button
            onClick={() => setShowModal(false)}
            className={`px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-neutral-800 ${borderRadius} hover:bg-gray-200 dark:hover:bg-neutral-700 transition-colors`}
          >
            取消
          </button>
          {formData.uid && (
            <button
              onClick={handleDeleteClick}
              className={`px-4 py-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 ${borderRadius} hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors`}
            >
              删除
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!formData.title.trim()}
            className={`px-4 py-2 text-sm text-white bg-brand ${borderRadius} hover:opacity-90 disabled:opacity-50 transition-opacity`}
          >
            {formData.uid ? '保存修改' : '创建事件'}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="确认删除"
        size="sm"
      >
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          确定删除「{pendingDelete?.title}」吗？此操作会从统一数据源中移除该条目。
          {pendingDelete?.recurring && (
            <span className="block mt-1 text-amber-600 dark:text-amber-400">
              这是一个重复事件，删除会移除整个系列。
            </span>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className={`px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-neutral-800 ${borderRadius}`}
          >
            取消
          </button>
          <button
            onClick={confirmDeleteCascade}
            className={`px-4 py-2 text-sm text-white bg-red-600 ${borderRadius} hover:bg-red-700`}
          >
            删除
          </button>
        </div>
      </Modal>
    </div>
  );
}