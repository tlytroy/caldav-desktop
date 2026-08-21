import { Settings } from 'lucide-react';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { FilterBar } from '../components/ui/FilterBar';
import { Modal } from '../components/ui/Modal';
import { SettingsModal } from '../components/settings/SettingsModal';
import { GlobalErrorBoundary } from '../components/ui/ErrorBoundary';
import Calendar from '../components/Calendar';
import { CalendarSelector } from '../features/calendar/CalendarSelector';
import { CalendarWorkspace } from '../features/calendar/CalendarWorkspace';
import { SyncWorkspace } from '../features/sync/SyncWorkspace';
import type { CalDAVConfig, EventFilter, TestConnectionResult } from '../types';

interface AppShellProps {
  calendars: any[];
  selectedCalendarUrl: string | null;
  config: CalDAVConfig;
  isConfigModalOpen: boolean;
  isSettingsModalOpen: boolean;
  setSelectedCalendarUrl: (url: string | null) => void;
  setIsConfigModalOpen: (open: boolean) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onFilterChange: (filter: EventFilter) => void;
  onTestConnection: () => Promise<void>;
  onSaveConfig: () => Promise<void>;
  onSetConfig: (partial: Partial<CalDAVConfig>) => void;
  onManualSync: () => void;
  configLoading: boolean;
  testResult: TestConnectionResult | null;
  refreshCalendars: () => Promise<void>;
}

export function AppShell({
  calendars,
  selectedCalendarUrl,
  config,
  isConfigModalOpen,
  isSettingsModalOpen,
  setSelectedCalendarUrl,
  setIsConfigModalOpen,
  onOpenSettings,
  onCloseSettings,
  onFilterChange,
  onTestConnection,
  onSaveConfig,
  onSetConfig,
  onManualSync,
  configLoading,
  testResult,
}: AppShellProps) {
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
              onClick={onOpenSettings}
              className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors flex items-center space-x-2"
              aria-label="打开设置"
            >
              <Settings className="w-5 h-5" />
              <span>设置</span>
            </button>
          </div>
        </div>

        <CalendarSelector
          calendars={calendars}
          selectedCalendarUrl={selectedCalendarUrl}
          onSelect={setSelectedCalendarUrl}
        />

        {selectedCalendarUrl && <FilterBar onFilterChange={onFilterChange} />}

        <div className="mt-8 max-w-7xl mx-auto">
          <CalendarWorkspace
            selectedCalendarUrl={selectedCalendarUrl}
            calendars={calendars}
            calendar={selectedCalendarUrl ? <Calendar calendarUrl={selectedCalendarUrl} /> : null}
          />
        </div>

        {selectedCalendarUrl && (
          <SyncWorkspace
            onManualSync={onManualSync}
          />
        )}

        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={onCloseSettings}
        />

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
                onChange={(e) => onSetConfig({ url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
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
                onChange={(e) => onSetConfig({ username: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
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
                onChange={(e) => onSetConfig({ password: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
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
              onClick={onTestConnection}
              disabled={!config.url || !config.username || !config.password || configLoading}
              className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {configLoading ? '测试中...' : '测试连接'}
            </button>
            <button
              onClick={onSaveConfig}
              disabled={!config.url || !config.username || !config.password || configLoading}
              className="px-4 py-2 text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {configLoading ? '保存中...' : '保存配置'}
            </button>
          </div>
        </Modal>
      </div>
    </GlobalErrorBoundary>
  );
}
