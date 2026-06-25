import { RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { useSyncStore } from '../../store/syncStore';

interface SyncStatusBarProps {
  onManualSync?: () => void;
  isSyncing?: boolean;
  syncStatus?: 'idle' | 'syncing' | 'success' | 'error';
  syncError?: string | null;
  lastSyncTime?: number | null;
}

export function SyncStatusBar({
  onManualSync,
  isSyncing,
  syncStatus,
  syncError,
  lastSyncTime
}: SyncStatusBarProps) {
  const { syncInterval, setSyncInterval } = useSyncStore();

  // 格式化时间显示
  const formatTimeAgo = (timestamp: number | null) => {
    if (!timestamp) return '从未';

    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    return `${days}天前`;
  };

  // 获取同步状态图标和文本
  const getStatusInfo = () => {
    if (isSyncing || syncStatus === 'syncing') {
      return {
        icon: <RefreshCw className="w-4 h-4 animate-spin" />,
        text: '正在同步...',
        color: 'text-blue-600 dark:text-blue-400'
      };
    }

    switch (syncStatus) {
      case 'success':
        return {
          icon: <CheckCircle className="w-4 h-4" />,
          text: '同步成功',
          color: 'text-green-600 dark:text-green-400'
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          text: syncError || '同步失败',
          color: 'text-red-600 dark:text-red-400'
        };
      default:
        return {
          icon: <Clock className="w-4 h-4" />,
          text: '等待同步',
          color: 'text-gray-600 dark:text-gray-400'
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-50">
      <div className="px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`flex items-center space-x-2 ${statusInfo.color}`}>
              {statusInfo.icon}
              <span className="text-sm font-medium">{statusInfo.text}</span>
            </div>

            {lastSyncTime && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                上次同步: {formatTimeAgo(lastSyncTime)}
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <select
              value={syncInterval || 0}
              onChange={(e) => setSyncInterval(e.target.value === '0' ? null : Number(e.target.value))}
              className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={0}>手动同步</option>
              <option value={300000}>每5分钟</option>
              <option value={600000}>每10分钟</option>
              <option value={1800000}>每30分钟</option>
            </select>

            <button
              onClick={onManualSync}
              disabled={isSyncing}
              className="flex items-center space-x-1 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>同步</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}