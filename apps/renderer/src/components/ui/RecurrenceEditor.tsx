import React, { useState } from 'react';
import type { RecurrenceRule } from '../../types';
import { useThemeStore } from '../../store/themeStore';

interface RecurrenceEditorProps {
  value?: RecurrenceRule;
  onChange: (recurrence: RecurrenceRule | undefined) => void;
}

export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps) {
  const { borderRadius } = useThemeStore();
  const [frequency, setFrequency] = useState<RecurrenceRule['frequency']>(value?.frequency || 'weekly');
  const [interval, setInterval] = useState<number>(value?.interval || 1);
  const [endDate, setEndDate] = useState<string>(value?.endDate || '');
  const [count, setCount] = useState<number | undefined>(value?.count);

  const handleFrequencyChange = (freq: RecurrenceRule['frequency']) => {
    setFrequency(freq);
    updateRecurrence(freq, interval, endDate, count);
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value) || 1;
    setInterval(val);
    updateRecurrence(frequency, val, endDate, count);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEndDate(val);
    updateRecurrence(frequency, interval, val, count);
  };

  const handleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value ? parseInt(e.target.value) : undefined;
    setCount(val);
    updateRecurrence(frequency, interval, endDate, val);
  };

  const updateRecurrence = (
    freq: RecurrenceRule['frequency'],
    int: number,
    end: string,
    cnt: number | undefined
  ) => {
    const recurrence: RecurrenceRule = {
      frequency: freq,
      interval: int,
      ...(end && { endDate: end }),
      ...(cnt && { count: cnt })
    };
    onChange(recurrence);
  };

  const handleClear = () => {
    setFrequency('weekly');
    setInterval(1);
    setEndDate('');
    setCount(undefined);
    onChange(undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          重复设置
        </label>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="text-sm text-red-600 hover:text-red-800"
          >
            清除重复
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
            频率
          </label>
          <select
            value={frequency}
            onChange={(e) => handleFrequencyChange(e.target.value as RecurrenceRule['frequency'])}
            className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white`}
          >
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="yearly">每年</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
            间隔
          </label>
          <input
            type="number"
            min="1"
            value={interval}
            onChange={handleIntervalChange}
            className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
            结束日期
          </label>
          <input
            type="date"
            value={endDate}
            onChange={handleEndDateChange}
            className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white`}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
            重复次数
          </label>
          <input
            type="number"
            min="1"
            value={count || ''}
            onChange={handleCountChange}
            placeholder="无限"
            className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white`}
          />
        </div>
      </div>
    </div>
  );
}