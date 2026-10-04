import { Linking, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from '@/lib/api/api';
import {
  getInstallationId,
  getOrCreateInstallationId,
  setNotificationOnboardingDecision,
} from './installation-store';

export const NOTIFICATION_CHANNEL_ID = 'memory-prompts';
export const notificationStatusQueryKey = ['notification-status'] as const;

type PermissionState = 'granted' | 'undetermined' | 'denied' | 'blocked' | 'unsupported';

export interface NotificationStatus {
  permission: PermissionState;
  canAskAgain: boolean;
  projectConfigured: boolean;
  runtimeSupported: boolean;
  registration: 'registered' | 'not-registered' | 'unavailable' | 'error';
}

interface DeviceRegistration {
  id: string;
  installationId: string;
  platform: 'ANDROID';
  label: string | null;
  hasPushToken: boolean;
  lastSeenAt: string;
  disabledAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const configured = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof configured === 'string' && configured.trim() ? configured.trim() : null;
}

function supportsRemotePush(): boolean {
  return (
    Platform.OS === 'android' &&
    Device.isDevice &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  );
}

export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
    name: 'Memory reminders',
    description: 'Gentle prompts for shared DuoDate memories',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 180],
    enableVibrate: true,
    showBadge: false,
  });
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  if (Platform.OS !== 'android') {
    return {
      permission: 'unsupported',
      canAskAgain: false,
      projectConfigured: Boolean(easProjectId()),
      runtimeSupported: false,
      registration: 'unavailable',
    };
  }

  const permission = await Notifications.getPermissionsAsync();
  const permissionState: PermissionState = permission.granted
    ? 'granted'
    : permission.status === 'undetermined'
      ? 'undetermined'
      : permission.canAskAgain
        ? 'denied'
        : 'blocked';
  const projectConfigured = Boolean(easProjectId());
  const runtimeSupported = supportsRemotePush();
  return {
    permission: permissionState,
    canAskAgain: permission.canAskAgain,
    projectConfigured,
    runtimeSupported,
    registration:
      permissionState === 'granted' && projectConfigured && runtimeSupported
        ? 'not-registered'
        : 'unavailable',
  };
}

export async function registerAuthenticatedDevice(): Promise<DeviceRegistration | null> {
  const projectId = easProjectId();
  if (!supportsRemotePush() || !projectId) return null;
  await ensureNotificationChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;

  const installationId = await getOrCreateInstallationId();
  const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return api.post<DeviceRegistration>('/api/devices', {
    installationId,
    pushToken,
    platform: 'ANDROID',
    label: Device.modelName ? `DuoDate on ${Device.modelName}` : 'DuoDate Android',
  });
}

export async function syncAuthenticatedNotifications(): Promise<NotificationStatus> {
  const status = await getNotificationStatus();
  if (status.permission !== 'granted') return status;
  if (!status.projectConfigured || !status.runtimeSupported) return status;
  try {
    await registerAuthenticatedDevice();
    return { ...status, registration: 'registered' };
  } catch {
    return { ...status, registration: 'error' };
  }
}

export async function enableNotifications(): Promise<NotificationStatus> {
  await setNotificationOnboardingDecision('enabled');
  await ensureNotificationChannel();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return getNotificationStatus();
  return syncAuthenticatedNotifications();
}

export async function deferNotificationOnboarding(): Promise<void> {
  await setNotificationOnboardingDecision('not-now');
}

export async function openNotificationSettings(): Promise<void> {
  await Linking.openSettings();
}

export async function revokeCurrentInstallation(): Promise<void> {
  const installationId = await getInstallationId();
  if (!installationId) return;
  await api.post<void>('/api/devices/revoke', { installationId });
}
