import { SyncStatusBar } from '../../components/ui/SyncStatusBar';

interface SyncWorkspaceProps {
  onManualSync: () => void;
  isSyncing: boolean;
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncTime: number;
}

export function SyncWorkspace({
  onManualSync,
  isSyncing,
  syncStatus,
  lastSyncTime,
}: SyncWorkspaceProps) {
  return (
    <SyncStatusBar
      onManualSync={onManualSync}
      isSyncing={isSyncing}
      syncStatus={syncStatus}
      lastSyncTime={lastSyncTime}
    />
  );
}
