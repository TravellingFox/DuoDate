import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SESSION_TOKEN_KEY = 'duodate.session-token.v1';

function webStorage() {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

export const sessionStore = {
  async getToken(): Promise<string | null> {
    if (Platform.OS === 'web') return webStorage()?.getItem(SESSION_TOKEN_KEY) ?? null;
    return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  },

  async setToken(token: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(SESSION_TOKEN_KEY, token);
      return;
    }
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async clearToken(): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.removeItem(SESSION_TOKEN_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  },
};
