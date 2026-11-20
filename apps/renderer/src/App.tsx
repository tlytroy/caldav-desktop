import React from "react";
import { ModuleProvider, AppRouter, AppLayout } from "./framework";
import { useRegisterModules } from "./modules/useRegisterModules";
import { AppShell } from "./app/AppShell";
import { ThemeApplier } from "./theme/ThemeApplier";
import { useCalendars } from "./hooks/useCalendars";
import { useCalendarStore } from "./store/calendarStore";
import ReminderHost from "./components/reminders/ReminderHost";
import { GlobalErrorBoundary } from "./components/ui/ErrorBoundary";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { AuthGate } from "./components/auth/AuthGate";

import { testConnection, saveConfig } from "./api/calendar";
import { useSyncStore } from "./store/syncStore";
import type { CalDAVConfig, TestConnectionResult } from "./types";

/**
 * ModuleRegistration - 注册所有模块
 *
 * 在 ModuleProvider 内注册所有模块。
 */
function ModuleRegistration({ children }: { children: React.ReactNode }) {
  useRegisterModules();
  return <>{children}</>;
}

/**
 * App - 主应用入口
 *
 * 使用模块化架构，同时保持与现有 AppShell 的兼容性。
 * 通过 useModularUI 状态控制是否启用模块化界面。
 */
export default function App() {
  const [useModularUI] = React.useState(true);

  // 现有逻辑
  const {
    calendars,
    selectedCalendarUrl,
    config,
    setSelectedCalendarUrl,
    setIsConfigModalOpen,
    refreshCalendars,
  } = useCalendars();

  const { setConfig, setEventFilter, isConfigModalOpen } = useCalendarStore();
  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestConnectionResult | null>(null);
  const [configLoading, setConfigLoading] = React.useState(false);
  const handleTestConnection = async () => {
    setConfigLoading(true);
    setTestResult(null);

    try {
      const result = await testConnection(config as CalDAVConfig);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "测试连接失败",
      });
    } finally {
      setConfigLoading(false);
    }
  };

  // 处理手动同步，通过 syncStore 触发 useCalendarEvents 中的同步
  const handleManualSync = () => {
    // 通过 syncStore 触发强制同步
    // useCalendarEvents 中的 effect 会监听到 lastSyncTime 变化并执行 performSync
    useSyncStore.getState().forceSync();
  };

  const handleSaveConfig = async () => {
    setConfigLoading(true);
    setTestResult(null);

    try {
      const result = await saveConfig(config as CalDAVConfig);
      setTestResult({ success: true, message: result.message });
      setIsConfigModalOpen(false);
      await refreshCalendars();
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "保存配置失败",
      });
    } finally {
      setConfigLoading(false);
    }
  };

  // 如果启用模块化 UI
  if (useModularUI) {
    return (
      <GlobalErrorBoundary>
        <ThemeApplier />
        {/* 后端不可达时的明确提示：不假装保存 */}
        <ConnectionBanner />
        <AuthGate>
          <ModuleProvider>
          <ModuleRegistration>
            <AppLayout>
              <AppRouter />
            </AppLayout>
          </ModuleRegistration>
          {/* 全局提醒：不管在哪个页面，到点都在右下角弹卡片 */}
            <ReminderHost />
          </ModuleProvider>
        </AuthGate>
      </GlobalErrorBoundary>
    );
  }

  // 默认使用现有 UI（逐步迁移）
  return (
    <>
      <ThemeApplier />
      <AppShell
        calendars={calendars}
        selectedCalendarUrl={selectedCalendarUrl}
        config={config}
        isConfigModalOpen={isConfigModalOpen}
        isSettingsModalOpen={isSettingsModalOpen}
        setSelectedCalendarUrl={setSelectedCalendarUrl}
        setIsConfigModalOpen={setIsConfigModalOpen}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onCloseSettings={() => setIsSettingsModalOpen(false)}
        onFilterChange={setEventFilter}
        onTestConnection={handleTestConnection}
        onSaveConfig={handleSaveConfig}
        onSetConfig={(partial) => setConfig(partial)}
        onManualSync={handleManualSync}
        configLoading={configLoading}
        testResult={testResult}
        refreshCalendars={refreshCalendars}
      />
    </>
  );
}