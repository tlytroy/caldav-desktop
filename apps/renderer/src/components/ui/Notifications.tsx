import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorDisplayProps {
  error: string;
  onRetry?: () => void;
  title?: string;
}

export function ErrorDisplay({ error, onRetry, title = "发生错误" }: ErrorDisplayProps) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
      <div className="flex items-start">
        <AlertCircle className="h-5 w-5 text-red-400 dark:text-red-500 mt-0.5 flex-shrink-0" />
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
            {title}
          </h3>
          <div className="mt-2 text-sm text-red-700 dark:text-red-300">
            <p>{error}</p>
          </div>
          {onRetry && (
            <div className="mt-4">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center px-3 py-2 text-sm font-medium text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-md transition-colors"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SuccessDisplayProps {
  message: string;
  title?: string;
}

export function SuccessDisplay({ message, title = "成功" }: SuccessDisplayProps) {
  return (
    <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
      <div className="flex items-start">
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-green-800 dark:text-green-200">
            {title}
          </h3>
          <div className="mt-2 text-sm text-green-700 dark:text-green-300">
            <p>{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface InfoDisplayProps {
  message: string;
  title?: string;
}

export function InfoDisplay({ message, title = "提示" }: InfoDisplayProps) {
  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
      <div className="flex items-start">
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
            {title}
          </h3>
          <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
            <p>{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}