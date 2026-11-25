import React from 'react';
import { Text } from 'react-native';
import { Stack, Tabs, router } from 'expo-router';
import { act, renderRouter, waitFor } from 'expo-router/testing-library';
import { create } from 'zustand';

const useMockAdminStore = create<{ isAdmin: boolean }>((set) => ({
  isAdmin: false,
}));

function MockRootLayout() {
  const isAdmin = useMockAdminStore((s) => s.isAdmin);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isAdmin} redirectTo="/(admin)/(tabs)">
        <Stack.Screen name="(user)" />
        <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={isAdmin} redirectTo="/(user)">
        <Stack.Screen name="(admin)" />
      </Stack.Protected>
    </Stack>
  );
}

function MockUserTabs() {
  return (
    <Tabs>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

function MockAdminStack() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="reports" />
    </Stack>
  );
}

function MockAdminTabs() {
  return (
    <Tabs>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}

function MockAuthStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
    </Stack>
  );
}

function buildRoutes() {
  return {
    _layout: {
      default: MockRootLayout,
      unstable_settings: { anchor: '(user)' },
    },
    '(admin)/_layout': {
      default: MockAdminStack,
      unstable_settings: { anchor: '(tabs)' },
    },
    '(admin)/(tabs)/_layout': MockAdminTabs,
    '(admin)/(tabs)/index': () => <Text>Admin Ledger Screen</Text>,
    '(admin)/(tabs)/more': () => <Text>Admin More Screen</Text>,
    '(admin)/reports': () => <Text>Admin Reports Screen</Text>,
    '(auth)/_layout': {
      default: MockAuthStack,
      unstable_settings: { anchor: 'login' },
    },
    '(auth)/login': () => <Text>Admin Login Screen</Text>,
    '(user)/_layout': MockUserTabs,
    '(user)/index': () => <Text>Community Home Screen</Text>,
    '(user)/profile': () => <Text>Community More Screen</Text>,
  };
}

describe('Root route protection and initial launch', () => {
  beforeEach(() => {
    useMockAdminStore.setState({ isAdmin: false });
  });

  it('opens Community Home directly on fresh launch (never Unmatched Route or Login)', async () => {
    const result = await renderRouter(buildRoutes(), { initialUrl: '/' });
    expect(result.getByText('Community Home Screen')).toBeTruthy();
    expect(result.queryByText('Unmatched Route')).toBeNull();
    expect(result.queryByText('Admin Login Screen')).toBeNull();
  });

  it('opens Admin Login from More, transitions to Admin on login, and returns to Home on sign out', async () => {
    const result = await renderRouter(buildRoutes(), { initialUrl: '/' });
    expect(result.getByText('Community Home Screen')).toBeTruthy();

    await act(async () => {
      router.push('/(auth)/login');
    });
    expect(result.getPathname()).toBe('/login');
    expect(result.getByText('Admin Login Screen')).toBeTruthy();

    await act(async () => {
      useMockAdminStore.setState({ isAdmin: true });
    });
    await waitFor(() => {
      expect(result.getByText('Admin Ledger Screen')).toBeTruthy();
    });

    await act(async () => {
      router.push('/(admin)/reports');
    });
    await waitFor(() => {
      expect(result.getByText('Admin Reports Screen')).toBeTruthy();
    });

    await act(async () => {
      useMockAdminStore.setState({ isAdmin: false });
    });
    await waitFor(() => {
      expect(result.getByText('Community Home Screen')).toBeTruthy();
    });
  });

  it('redirects guarded /(admin) deep link back to Community Home when not admin', async () => {
    const result = await renderRouter(buildRoutes(), { initialUrl: '/(admin)' });
    await waitFor(() => {
      expect(result.getByText('Community Home Screen')).toBeTruthy();
    });
    expect(result.queryByText('Unmatched Route')).toBeNull();
  });
});
