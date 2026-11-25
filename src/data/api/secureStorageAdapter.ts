import * as SecureStore from 'expo-secure-store';

/**
 * Chunked Expo SecureStore adapter for Supabase Auth sessions.
 * Android SecureStore caps values at 2048 bytes, while Supabase JWT sessions
 * often exceed 2.5KB — splitting into 1800-byte chunks prevents silent logout
 * and guarantees reliable offline session persistence across app restarts.
 */
const CHUNK_SIZE = 1800;

function chunkKey(key: string, index: number): string {
  return `${key}__chunk_${index}`;
}

function countKey(key: string): string {
  return `${key}__count`;
}

export const secureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const countRaw = await SecureStore.getItemAsync(countKey(key));
      if (!countRaw) {
        return await SecureStore.getItemAsync(key);
      }
      const count = Number.parseInt(countRaw, 10);
      if (!Number.isFinite(count) || count <= 0) {
        return null;
      }
      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
        if (chunk == null) return null;
        parts.push(chunk);
      }
      return parts.join('');
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i += 1) {
      const slice = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await SecureStore.setItemAsync(chunkKey(key, i), slice);
    }
    await SecureStore.setItemAsync(countKey(key), String(count));
  },

  async removeItem(key: string): Promise<void> {
    try {
      const countRaw = await SecureStore.getItemAsync(countKey(key));
      if (countRaw) {
        const count = Number.parseInt(countRaw, 10);
        if (Number.isFinite(count) && count > 0) {
          for (let i = 0; i < count; i += 1) {
            await SecureStore.deleteItemAsync(chunkKey(key, i));
          }
        }
        await SecureStore.deleteItemAsync(countKey(key));
      }
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Ignore cleanup errors
    }
  },
};
