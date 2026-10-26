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
import { fetchRecurrenceOptions, type RecurrenceOption } from '../api/workspace';
import {
  importIcsFile,
  exportIcsDownloadUrl,
  type IcsImportPreview,
} from '../api/md-bridge';
import {
  fetchWebDAVStatus,
  pushToWebDAV,
  pullFromWebDAV,
  testWebDAVConnection,
  type WebDAVStatus,
  type WebDAVSyncResult,
} from '../api/webdav';

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
  }>({
    title: '',
    start: new Date(),
    end: new Date(Date.now() + 3600000),
    allDay: false,
    description: '',
    tags: [],
  });
  // 重复规则选项（从服务端取，保证 RRULE 表述一致）
  const [recurrenceOptions, setRecurrenceOptions] = useState<RecurrenceOption[]>([
    { value: '', label: '不重复' },
  ]);
  // 删除确认
  const [pendingDelete, setPendingDelete] = useState<{ uid: string; title: string } | null>(null);

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
  const [webdavBusy, setWebdavBusy] = useState<'push' | 'pull' | 'test' | null>(null);
  const [webdavResults, setWebdavResults] = useState<WebDAVSyncResult[] | null>(null);
  const [webdavMsg, setWebdavMsg] = useState<string | null>(null);

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
      // 拉取会覆盖 events.md，必须重读本地数据
      if (r.results.some((x) => x.key === 'events' && x.ok)) {
        await loadEvents();
      }
    } catch (e) {
      setWebdavMsg('拉取失败：' + (e as Error).message);
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
    });
    setShowModal(true);
  };

  const handleEventClick = (info: any) => {
    const id = info.event.id;
    // 展开重复规则后，实例 id 形如 "abc@2026-10-05"；原始 id 在 instanceId 里
    const originalId = info.event.extendedProps?.item?.instanceId || id.split('@')[0];
    const e = events.find((ev) => (ev.instanceId || ev.id) === originalId);
    if (e) {
      setFormData({
        uid: originalId,
        title: e.title || '',
        start: e.start ? new Date(e.start) : new Date(),
        end: e.end ? new Date(e.end) : e.start ? new Date(e.start) : new Date(),
        allDay: !!e.allDay,
        description: e.description || '',
        category: e.project,
        tags: e.tags || [],
        recurrence: e.recurrence,
      });
      setShowModal(true);
    }
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) return;
    try {
      setShowModal(false);
      // 本地时间字符串（不带 Z）—— 统一数据源用本地时间，避免时区偏移
      const toLocalIso = (d: Date) => {
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
          d.getHours(),
        )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      };
      const itemPayload: any = {
        title: formData.title,
        start: toLocalIso(formData.start),
        end: toLocalIso(formData.end),
        allDay: formData.allDay,
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

  const handleSync = async (kind: 'push' | 'pull' | 'bidir') => {
    setSyncing(kind);
    try {
      if (kind === 'push') await pushToCaldav();
      else if (kind === 'pull') await pullFromCaldav();
      else await bidirectionalSync();
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
      const preview = (await importIcsFile(text, { dryRun: true })) as IcsImportPreview;
      setPendingIcsText(text);
      setImportPreview(preview);
      if (preview.importedCount === 0) {
        setIoMsg(
          `解析到 ${preview.parsedCount} 条事件，但都已存在（跳过 ${preview.skippedCount} 条），无需导入`,
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
      const r = await importIcsFile(pendingIcsText, {
        mode: replaceOnImport ? 'replace' : 'append',
      });
      const n = (r as any).importedCount ?? 0;
      const skipped = (r as any).skippedCount ?? 0;
      setIoMsg(
        `已导入 ${n} 条事件${skipped ? `，跳过 ${skipped} 条重复` : ''}，events.md 现有 ${(r as any).totalCount} 条`,
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

  const handleExport = () => {
    window.open(exportIcsDownloadUrl(), '_blank');
    setIoMsg('已导出 .ics 文件，可用其他日历软件导入');
  };

  const formatTime = (date: Date) => date.toTimeString().slice(0, 5);
  const formatDate = (date: Date) => date.toISOString().split('T')[0];

  // ---- Loading skeleton ----
  if (loadingState === 'loading') {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 relative">
        <LoadingSpinner message="加载 events.md 中..." />
      </div>
    );
  }

  // ---- Error fallback ----
  if (loadingState === 'error') {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-red-200 dark:border-red-900/40 shadow-sm p-6">
        <div className="text-red-600 dark:text-red-400 text-sm">
          读取 events.md 失败：{error}
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
          数据源：本地 <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800">events.md</code>
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
            title="把 events.md 推送到 CalDAV"
          >
            <Cloud className="w-3.5 h-3.5" />
            推送 CalDAV
          </button>
          <button
            onClick={() => handleSync('pull')}
            disabled={syncing !== null}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700 disabled:opacity-50"
            title="从 CalDAV 拉取并合并到 events.md"
          >
            <CloudOff className="w-3.5 h-3.5" />
            拉取
          </button>
          <button
            onClick={() => handleSync('bidir')}
            disabled={syncing !== null}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-brand text-white hover:opacity-90 disabled:opacity-50"
            title="双向同步 events.md ↔ CalDAV"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing === 'bidir' ? 'animate-spin' : ''}`} />
            双向同步
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700 disabled:opacity-50"
            title="导入 .ics 文件到 events.md"
          >
            <Upload className="w-3.5 h-3.5" />
            导入 ICS
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
            title="导出 events.md 为 .ics 文件"
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
                  {importPreview.parsedCount}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                <div className="text-xs text-green-600 dark:text-green-400">将导入</div>
                <div className="text-lg font-semibold text-green-700 dark:text-green-300">
                  {importPreview.importedCount}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
                <div className="text-xs text-gray-500 dark:text-gray-400">跳过重复</div>
                <div className="text-lg font-semibold text-gray-500 dark:text-gray-400">
                  {importPreview.skippedCount}
                </div>
              </div>
            </div>

            {importPreview.events.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1.5">
                  前 5 条预览
                </div>
                <ul className="text-sm divide-y divide-gray-100 dark:divide-neutral-800">
                  {importPreview.events.slice(0, 5).map((e, i) => (
                    <li key={i} className="py-1.5 flex items-center gap-2">
                      <span className="flex-1 text-gray-900 dark:text-white truncate">
                        {e.title}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {e.allDay ? '全天' : String(e.date).slice(0, 16).replace('T', ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
                {importPreview.events.length > 5 && (
                  <div className="text-xs text-gray-400 mt-1">
                    还有 {importPreview.events.length - 5} 条…
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
                  默认追加到现有事件之后；勾选后会先清空 events.md 里的全部事件，
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
                disabled={importing || importPreview.importedCount === 0}
                className={`px-4 py-2 text-sm text-white bg-brand ${borderRadius} hover:opacity-90 disabled:opacity-50`}
              >
                {importing ? '导入中…' : `确认导入 ${importPreview.importedCount} 条`}
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
            直接把 <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800">events.md</code>
            与 <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800">工作搭子看板.md</code>
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
WEBDAV_EVENTS_PATH=CalDAV-Desktop/events.md`}
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
                        远端有更新。建议先「拉取」查看远端内容，再决定是否覆盖。
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleWebdavPush(true)}
                          disabled={webdavBusy !== null}
                          className="px-2.5 py-1 rounded bg-amber-600 text-white hover:opacity-90 disabled:opacity-50"
                        >
                          仍然用本地覆盖远端
                        </button>
                        <button
                          onClick={() => handleWebdavPull(false)}
                          disabled={webdavBusy !== null}
                          className="px-2.5 py-1 rounded bg-white dark:bg-neutral-800 text-amber-700 dark:text-amber-300 hover:opacity-80 disabled:opacity-50"
                        >
                          改用远端内容
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
              onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
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
                  setFormData({ ...formData, start: ns });
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
                    setFormData({ ...formData, start: ns });
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
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                该条目会在日历上按此规则重复出现
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