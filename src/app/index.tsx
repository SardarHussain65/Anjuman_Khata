import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/features/auth/store/authStore';
import { LoadingState } from '@/core/ui/ScreenState';

export default function EntryRedirect() {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);

  if (isHydrating) {
    return <LoadingState />;
  }

  if (!session || !profile) {
    return <Redirect href="/(auth)/login" />;
  }

  if (profile.role === 'admin') {
    return <Redirect href="/(admin)" />;
  }

  return <Redirect href="/(user)" />;
}
