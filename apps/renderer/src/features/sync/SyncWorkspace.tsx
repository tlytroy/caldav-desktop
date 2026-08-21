import { SyncStatusBar } from '../../components/ui/SyncStatusBar';
import { useSyncStore } from '../../store/syncStore';

interface SyncWorkspaceProps {
  onManualSync: () => void;
}

export function SyncWorkspace({
  onManualSync,
}: SyncWorkspaceProps) {
  const { isSyncing, syncStatus, lastSyncTime } = useSyncStore();

  return (
    <SyncStatusBar
      onManualSync={onManualSync}
      isSyncing={isSyncing}
      syncStatus={syncStatus as 'idle' | 'syncing' | 'error'}
      lastSyncTime={lastSyncTime ?? undefined}
    />
  );
}
