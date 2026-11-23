import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { resetSyncBackoff, runInitialPullIfNeeded, runSync } from './syncEngine';
import { useSyncStatusStore } from './statusStore';

/**
 * Wires automatic offline-first sync triggers whenever the user is authenticated:
 * - First-login full pull with progress
 * - NetInfo offline -> online reconnect
 * - AppState returning to foreground
 */
export function useSyncScheduler(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let wasOffline = false;
    runInitialPullIfNeeded().catch(() => {});

    const unsubNet = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false;
      useSyncStatusStore.getState().setOnline(online);
      if (online && wasOffline) {
        resetSyncBackoff();
        runSync().catch(() => {});
      }
      wasOffline = !online;
    });

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        runSync().catch(() => {});
      }
    };
    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      unsubNet();
      appStateSub.remove();
    };
  }, [enabled]);
}
