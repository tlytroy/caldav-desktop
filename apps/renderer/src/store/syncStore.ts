import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SyncState {
  // 同步设置
  syncInterval: number | null; // 同步间隔（毫秒），null表示不自动同步
  lastSyncTime: number | null; // 上次同步时间戳
  isSyncing: boolean; // 是否正在同步
  syncStatus: "idle" | "syncing" | "success" | "error"; // 同步状态
  syncError: string | null; // 同步错误信息

  // 本地缓存
  cachedEvents: Record<string, any[]>; // 按日历URL缓存事件
  cacheTimestamps: Record<string, number>; // 按日历URL记录缓存时间

  // Actions
  setSyncInterval: (interval: number | null) => void;
  setLastSyncTime: (time: number | null) => void;
  setIsSyncing: (syncing: boolean) => void;
  setSyncStatus: (status: SyncState["syncStatus"]) => void;
  setSyncError: (error: string | null) => void;
  setCachedEvents: (calendarUrl: string, events: any[]) => void;
  clearCache: (calendarUrl?: string) => void;
  removeEventFromCache: (calendarUrl: string, eventId: string) => void;
  forceSync: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      // 默认状态
      syncInterval: 300000, // 5分钟
      lastSyncTime: null,
      isSyncing: false,
      syncStatus: "idle",
      syncError: null,
      cachedEvents: {},
      cacheTimestamps: {},

      // Actions
      setSyncInterval: (interval) => set({ syncInterval: interval }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      setIsSyncing: (syncing) => set({ isSyncing: syncing }),
      setSyncStatus: (status) => set({ syncStatus: status }),
      setSyncError: (error) => set({ syncError: error }),
      setCachedEvents: (calendarUrl, events) => set((state) => ({
        cachedEvents: { ...state.cachedEvents, [calendarUrl]: events },
        cacheTimestamps: { ...state.cacheTimestamps, [calendarUrl]: Date.now() }
      })),
      clearCache: (calendarUrl) => {
        if (calendarUrl) {
          set((state) => {
            const newCachedEvents = { ...state.cachedEvents };
            const newCacheTimestamps = { ...state.cacheTimestamps };
            delete newCachedEvents[calendarUrl];
            delete newCacheTimestamps[calendarUrl];
            return {
              cachedEvents: newCachedEvents,
              cacheTimestamps: newCacheTimestamps
            };
          });
        } else {
          set({ cachedEvents: {}, cacheTimestamps: {} });
        }
      },

      // 部分更新缓存（例如删除单个事件）
      removeEventFromCache: (calendarUrl: string, eventId: string) => {
        set((state) => {
          if (!state.cachedEvents[calendarUrl]) return state;

          const updatedEvents = state.cachedEvents[calendarUrl].filter(
            (event: any) => event.uid !== eventId
          );

          return {
            cachedEvents: {
              ...state.cachedEvents,
              [calendarUrl]: updatedEvents
            }
          };
        });
      },
      forceSync: () => {
        // 触发强制同步的标志
        set({ lastSyncTime: 0 });
      }
    }),
    {
      name: "sync-storage", // 存储在localStorage中的key
      partialize: (state) => ({
        syncInterval: state.syncInterval,
        cachedEvents: state.cachedEvents,
        cacheTimestamps: state.cacheTimestamps
      })
    }
  )
);