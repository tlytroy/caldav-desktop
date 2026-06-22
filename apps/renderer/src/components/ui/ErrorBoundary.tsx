import React from 'react';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
      <h2 className="text-xl font-bold text-red-800 dark:text-red-200 mb-2">出错了</h2>
      <p className="text-red-600 dark:text-red-300 mb-4">{error.message}</p>
      <button
        onClick={resetErrorBoundary}
        className="px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
      >
        重试
      </button>
    </div>
  );
}

export function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}
