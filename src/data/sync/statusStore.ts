import { create } from 'zustand';

export type SyncStatusKind = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncStatusState {
  status: SyncStatusKind;
  isOnline: boolean;
  lastSyncedAt: string | null;
  pendingCount: number;
  quarantinedCount: number;
  lastError: string | null;
  isInitialPulling: boolean;
  initialPullDoneTables: number;
  initialPullTotalTables: number;
  drawerOpen: boolean;

  setOnline: (online: boolean) => void;
  setSyncing: () => void;
  setSynced: (serverTime: string) => void;
  setError: (message: string) => void;
  setCounts: (pendingCount: number, quarantinedCount: number) => void;
  setInitialPullProgress: (active: boolean, done: number, total: number) => void;
  setDrawerOpen: (open: boolean) => void;
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  status: 'idle',
  isOnline: true,
  lastSyncedAt: null,
  pendingCount: 0,
  quarantinedCount: 0,
  lastError: null,
  isInitialPulling: false,
  initialPullDoneTables: 0,
  initialPullTotalTables: 0,
  drawerOpen: false,

  setOnline: (isOnline) =>
    set((prev) => ({
      isOnline,
      status: !isOnline ? 'offline' : prev.status === 'offline' ? 'idle' : prev.status,
    })),

  setSyncing: () =>
    set({
      status: 'syncing',
      lastError: null,
    }),

  setSynced: (serverTime) =>
    set((prev) => ({
      status: prev.isOnline ? 'idle' : 'offline',
      lastSyncedAt: serverTime,
      lastError: null,
    })),

  setError: (message) =>
    set((prev) => ({
      status: prev.isOnline ? 'error' : 'offline',
      lastError: message,
    })),

  setCounts: (pendingCount, quarantinedCount) =>
    set({ pendingCount, quarantinedCount }),

  setInitialPullProgress: (isInitialPulling, initialPullDoneTables, initialPullTotalTables) =>
    set({ isInitialPulling, initialPullDoneTables, initialPullTotalTables }),

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));
