import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/data/api/supabaseClient';
import { secureStorageAdapter } from '@/data/api/secureStorageAdapter';
import { UserRole } from '@/core/permissions';

export interface AuthProfile {
  id: string;
  member_no: number;
  full_name: string;
  full_name_ur: string | null;
  phone: string | null;
  designation: string | null;
  tag: string | null;
  status: 'active' | 'non_earning' | 'inactive';
  role: UserRole;
  personal_pledge: number | null;
  joined_on: string;
}

const CACHED_PROFILE_KEY = 'anjuman_khata_cached_profile';

interface AuthState {
  isHydrating: boolean;
  isSigningIn: boolean;
  session: Session | null;
  profile: AuthProfile | null;
  isOfflineSession: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; errorCode?: 'invalid' | 'offline' | 'generic' }>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

async function saveCachedProfile(profile: AuthProfile | null): Promise<void> {
  if (!profile) {
    await secureStorageAdapter.removeItem(CACHED_PROFILE_KEY);
    return;
  }
  await secureStorageAdapter.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
}

async function loadCachedProfile(): Promise<AuthProfile | null> {
  const raw = await secureStorageAdapter.getItem(CACHED_PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthProfile;
  } catch {
    return null;
  }
}

async function fetchRemoteProfile(userId: string): Promise<AuthProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, member_no, full_name, full_name_ur, phone, designation, tag, status, role, personal_pledge, joined_on',
    )
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) return null;
  return data as AuthProfile;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isHydrating: true,
  isSigningIn: false,
  session: null,
  profile: null,
  isOfflineSession: false,
  error: null,

  hydrate: async () => {
    set({ isHydrating: true, error: null });
    try {
      // 1. Read persisted session + cached profile immediately (works 100% offline!)
      const [{ data }, cachedProfile, netState] = await Promise.all([
        supabase.auth.getSession(),
        loadCachedProfile(),
        NetInfo.fetch().catch(() => ({ isConnected: false })),
      ]);

      const session = data.session;
      if (!session) {
        await saveCachedProfile(null);
        set({
          isHydrating: false,
          session: null,
          profile: null,
          isOfflineSession: false,
        });
        return;
      }

      const online = Boolean(netState.isConnected);

      // Immediately enter app using cached profile when available (instant offline startup)
      if (cachedProfile && cachedProfile.id === session.user.id) {
        set({
          isHydrating: false,
          session,
          profile: cachedProfile,
          isOfflineSession: !online,
        });

        // Silently refresh profile in background if online
        if (online) {
          fetchRemoteProfile(session.user.id)
            .then(async (fresh) => {
              if (fresh) {
                await saveCachedProfile(fresh);
                set({ profile: fresh, isOfflineSession: false });
              }
            })
            .catch(() => {});
        }
        return;
      }

      // First-time hydration without cached profile
      if (online) {
        const remote = await fetchRemoteProfile(session.user.id);
        if (remote) {
          await saveCachedProfile(remote);
          set({
            isHydrating: false,
            session,
            profile: remote,
            isOfflineSession: false,
          });
          return;
        }
      }

      set({
        isHydrating: false,
        session: null,
        profile: null,
        isOfflineSession: false,
      });
    } catch {
      set({
        isHydrating: false,
        session: null,
        profile: null,
        isOfflineSession: false,
      });
    }
  },

  signIn: async (email: string, password: string) => {
    set({ isSigningIn: true, error: null });
    try {
      const netState = await NetInfo.fetch().catch(() => ({ isConnected: true }));
      if (netState.isConnected === false) {
        set({ isSigningIn: false, error: 'offline' });
        return { ok: false, errorCode: 'offline' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error || !data.session) {
        set({ isSigningIn: false, error: 'invalid' });
        return { ok: false, errorCode: 'invalid' };
      }

      const profile = await fetchRemoteProfile(data.session.user.id);
      if (!profile) {
        await supabase.auth.signOut();
        set({ isSigningIn: false, error: 'invalid' });
        return { ok: false, errorCode: 'invalid' };
      }

      await saveCachedProfile(profile);
      set({
        isSigningIn: false,
        session: data.session,
        profile,
        isOfflineSession: false,
        error: null,
      });
      return { ok: true };
    } catch {
      set({ isSigningIn: false, error: 'generic' });
      return { ok: false, errorCode: 'generic' };
    }
  },

  refreshProfile: async () => {
    const session = get().session;
    if (!session) return;
    try {
      const fresh = await fetchRemoteProfile(session.user.id);
      if (fresh) {
        await saveCachedProfile(fresh);
        set({ profile: fresh, isOfflineSession: false });
      }
    } catch {
      // Keep cached profile offline
    }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Always clear local session even offline
    }
    await saveCachedProfile(null);
    set({
      session: null,
      profile: null,
      isOfflineSession: false,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
