import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const INSTALLATION_ID_KEY = 'duodate.installation-id.v1';
const ONBOARDING_DECISION_KEY = 'duodate.notification-onboarding.v1';
let installationPromise: Promise<string> | null = null;

function webStorage() {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webStorage()?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStorage()?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export type NotificationOnboardingDecision = 'enabled' | 'not-now';

export async function getInstallationId(): Promise<string | null> {
  return getItem(INSTALLATION_ID_KEY);
}

export async function getOrCreateInstallationId(): Promise<string> {
  installationPromise ??= (async () => {
    const existing = await getInstallationId();
    if (existing) return existing;
    const generated = Crypto.randomUUID();
    await setItem(INSTALLATION_ID_KEY, generated);
    return generated;
  })();
  return installationPromise;
}

export async function getNotificationOnboardingDecision(): Promise<NotificationOnboardingDecision | null> {
  const value = await getItem(ONBOARDING_DECISION_KEY);
  return value === 'enabled' || value === 'not-now' ? value : null;
}

export async function setNotificationOnboardingDecision(
  decision: NotificationOnboardingDecision,
): Promise<void> {
  await setItem(ONBOARDING_DECISION_KEY, decision);
}
