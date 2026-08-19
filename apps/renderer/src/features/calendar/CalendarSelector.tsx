interface CalendarSelectorProps {
  calendars: Array<{ url: string; displayName?: string }>;
  selectedCalendarUrl: string | null;
  onSelect: (url: string | null) => void;
}

export function CalendarSelector({
  calendars,
  selectedCalendarUrl,
  onSelect,
}: CalendarSelectorProps) {
  return (
    <div className="mb-8">
      <label htmlFor="calendar-select" className="block text-sm font-medium text-gray-700 mb-2">
        选择日历
      </label>
      <select
        id="calendar-select"
        value={selectedCalendarUrl || ''}
        onChange={(e) => onSelect(e.target.value || null)}
        className="block w-full max-w-xs rounded-lg border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:text-white"
        disabled={!calendars.length}
      >
        {!calendars.length ? (
          <option>正在加载日历...</option>
        ) : (
          calendars.map((calendar) => (
            <option key={calendar.url} value={calendar.url}>
              {calendar.displayName || '默认日历'}
            </option>
          ))
        )}
      </select>
    </div>
  );
}
