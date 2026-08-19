import React from 'react';

interface CalendarWorkspaceProps {
  selectedCalendarUrl: string | null;
  calendars: Array<{ url: string; displayName?: string }>;
  calendar: React.ReactNode;
}

export function CalendarWorkspace({
  selectedCalendarUrl,
  calendars,
  calendar,
}: CalendarWorkspaceProps) {
  if (selectedCalendarUrl) {
    return <>{calendar}</>;
  }

  if (calendars.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <p className="text-gray-500 mb-4">正在加载日历...</p>
        <p className="text-gray-400 text-sm">请稍候</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow p-8 text-center">
      <p className="text-gray-500 mb-4">请选择一个日历</p>
    </div>
  );
}
