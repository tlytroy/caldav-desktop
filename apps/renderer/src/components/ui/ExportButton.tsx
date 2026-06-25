import { useState } from 'react';
import { Download } from 'lucide-react';

interface ExportButtonProps {
  calendarUrl: string | null;
}

export function ExportButton({ calendarUrl }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat] = useState<'ics' | 'json'>('ics');

  const handleExport = async () => {
    if (!calendarUrl) return;

    setIsExporting(true);
    try {
      // 这里应该调用后端API获取导出数据
      // 为了演示，我们创建一个模拟的导出功能

      // 获取当前月份的事件
      const startDate = new Date();
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);

      // 创建文件内容
      let content = '';
      let filename = '';
      let mimeType = '';

      if (exportFormat === 'ics') {
        // 简化的ICS格式导出
        content = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CalDAV Desktop//EN
METHOD:PUBLISH
END:VCALENDAR`;
        filename = `calendar-export-${new Date().toISOString().split('T')[0]}.ics`;
        mimeType = 'text/calendar';
      } else {
        // JSON格式导出
        content = JSON.stringify({
          exportedAt: new Date().toISOString(),
          calendarUrl,
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          events: [] // 在实际实现中这里应该是真实的事件数据
        }, null, 2);
        filename = `calendar-export-${new Date().toISOString().split('T')[0]}.json`;
        mimeType = 'application/json';
      }

      // 创建并下载文件
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(`日历已成功导出为 ${exportFormat.toUpperCase()} 格式`);
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败，请稍后重试');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={handleExport}
        disabled={isExporting || !calendarUrl}
        className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Download className="h-4 w-4 mr-2" />
        {isExporting ? '导出中...' : '导出'}
      </button>

      {/*
      <div className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black ring-opacity-5 hidden">
        <div className="py-1">
          <button
            onClick={() => setExportFormat('ics')}
            className={`flex items-center w-full px-4 py-2 text-sm ${
              exportFormat === 'ics'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Calendar className="h-4 w-4 mr-2" />
            ICS格式
          </button>
          <button
            onClick={() => setExportFormat('json')}
            className={`flex items-center w-full px-4 py-2 text-sm ${
              exportFormat === 'json'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <FileText className="h-4 w-4 mr-2" />
            JSON格式
          </button>
        </div>
      </div>
      */}
    </div>
  );
}