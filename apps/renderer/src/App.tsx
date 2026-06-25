import React from 'react';
import { useCalendars } from './hooks/useCalendars';
import { useCalendarStore } from './store/calendarStore';
import Calendar from './components/Calendar';
import { GlobalErrorBoundary } from './components/ui/ErrorBoundary';
import { Modal } from './components/ui/Modal';
import { ThemeToggle } from './components/ui/ThemeToggle';
import { SettingsModal } from './components/settings/SettingsModal';
import { FilterBar } from './components/ui/FilterBar';
import { SyncStatusBar } from './components/ui/SyncStatusBar';
import { Settings, Loader2 } from 'lucide-react';
import { testConnection, saveConfig } from './api/calendar';
import type { CalDAVConfig, TestConnectionResult } from './types';

export default function App() {
  const {
    calendars,
    selectedCalendarUrl,
    setSelectedCalendarUrl,
    config,
    setIsConfigModalOpen,
    refreshCalendars
  } = useCalendars();

  const { setConfig, setEventFilter } = useCalendarStore();

  const { isConfigModalOpen } = useCalendarStore();
  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestConnectionResult | null>(null);
  const [configLoading, setConfigLoading] = React.useState(false);
  const [manualSync, setManualSync] = React.useState(false);

  const handleTestConnection = async () => {
    setConfigLoading(true);
    setTestResult(null);

    try {
      const result = await testConnection(config as CalDAVConfig);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : '测试连接失败'
      });
    } finally {
      setConfigLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setConfigLoading(true);
    setTestResult(null);

    try {
      const result = await saveConfig(config as CalDAVConfig);
      setTestResult({ success: true, message: result.message });

      // 关闭模态框并刷新日历
      setIsConfigModalOpen(false);
      await refreshCalendars();
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : '保存配置失败'
      });
    } finally {
      setConfigLoading(false);
    }
  };

  // 过滤事件的逻辑在 Calendar 组件中实现

  return (
    <GlobalErrorBoundary>
      <div className="min-h-screen bg-gray-50 dark:bg-neutral-800 p-4 sm:p-8 pb-16">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 sm:mb-8 gap-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
            CalDAV Desktop
          </h1>
          <div className="flex items-center space-x-2">
            <ThemeToggle />
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors flex items-center space-x-2"
              aria-label="打开设置"
            >
              <Settings className="w-5 h-5" />
              <span>设置</span>
            </button>
          </div>
        </div>

        {!calendars.length && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-600">正在加载日历...</p>
          </div>
        )}

        {calendars.length > 0 && (
          <div className="mb-8">
            <label htmlFor="calendar-select" className="block text-sm font-medium text-gray-700 mb-2">
              选择日历
            </label>
            <select
              id="calendar-select"
              value={selectedCalendarUrl || ''}
              onChange={(e) => setSelectedCalendarUrl(e.target.value)}
              className="block w-full max-w-xs rounded-lg border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:text-white"
            >
              {calendars.map((cal: any) => (
                <option key={cal.url} value={cal.url}>
                  {cal.displayName || '默认日历'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 搜索和过滤栏 */}
        {calendars.length > 0 && selectedCalendarUrl && (
          <FilterBar onFilterChange={setEventFilter} />
        )}

        {/* 日历视图 */}
        <div className="mt-8">
          {calendars.length > 0 && selectedCalendarUrl && (
            <Calendar calendarUrl={selectedCalendarUrl} />
          )}
          {calendars.length === 0 && (
            <div className="bg-white rounded-xl shadow p-8 text-center">
              <p className="text-gray-500 mb-4">未找到日历</p>
              <p className="text-gray-400 text-sm">请检查CalDAV配置是否正确</p>
            </div>
          )}
        </div>

        {/* 同步状态栏 */}
        {selectedCalendarUrl && (
          <SyncStatusBar
            onManualSync={() => setManualSync(true)}
            isSyncing={manualSync}
            syncStatus={manualSync ? "syncing" : "idle"}
            lastSyncTime={Date.now()}
          />
        )}

        {/* 设置模态框 */}
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
        />

        {/* 配置模态框 */}
        <Modal
          isOpen={isConfigModalOpen}
          onClose={() => setIsConfigModalOpen(false)}
          title="CalDAV 配置"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CalDAV 服务器地址 *
              </label>
              <input
                type="text"
                value={config.url}
                onChange={(e) => setConfig({ url: e.target.value })}
                className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white`}
                placeholder="例如: https://radicale.example.com/your/calendar/"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                用户名 *
              </label>
              <input
                type="text"
                value={config.username}
                onChange={(e) => setConfig({ username: e.target.value })}
                className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white`}
                placeholder="输入用户名"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                密码 *
              </label>
              <input
                type="password"
                value={config.password}
                onChange={(e) => setConfig({ password: e.target.value })}
                className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white`}
                placeholder="输入密码"
              />
            </div>

            {testResult && (
              <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <p className={testResult.success ? 'text-green-600' : 'text-red-600'}>
                  {testResult.message}
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button
              onClick={() => setIsConfigModalOpen(false)}
              className="px-4 py-2 text-gray-700 bg-gray-100 dark:text-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              disabled={configLoading}
            >
              取消
            </button>
            <button
              onClick={handleTestConnection}
              disabled={!config.url || !config.username || !config.password || configLoading}
              className="px-4 py-2 text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-900/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-800 transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center"
            >
              {configLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {configLoading ? '测试中...' : '测试连接'}
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={!config.url || !config.username || !config.password || configLoading}
              className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center"
            >
              {configLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {configLoading ? '保存中...' : '保存配置'}
            </button>
          </div>
        </Modal>
      </div>
    </GlobalErrorBoundary>
  );
}