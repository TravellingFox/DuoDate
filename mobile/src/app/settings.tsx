import { Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowLeft, BellRing, LogOut, UserRound } from 'lucide-react-native';
import { AppText, colors, PageScroll, PaperCard, PrimaryButton, Screen, SecondaryButton } from '@/components/ui';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession, useSession } from '@/lib/auth/use-session';
import {
  enableNotifications,
  getNotificationStatus,
  notificationStatusQueryKey,
  openNotificationSettings,
  type NotificationStatus,
} from '@/lib/notifications/notifications';

function notificationSummary(status: NotificationStatus | undefined, failed: boolean): string {
  if (failed) return 'Status unavailable';
  if (!status) return 'Checking status…';
  if (!status.runtimeSupported || !status.projectConfigured) {
    return 'Available in the configured Android app';
  }
  if (status.permission === 'granted') {
    return status.registration === 'registered' ? 'On' : 'On · waiting to sync';
  }
  if (status.permission === 'blocked') return 'Off · blocked in Android settings';
  return 'Off';
}

export default function SettingsScreen() {
  const session = useSession();
  const invalidateSession = useInvalidateSession();
  const queryClient = useQueryClient();
  const notificationStatus = useQuery({
    queryKey: notificationStatusQueryKey,
    queryFn: getNotificationStatus,
  });
  const notificationAction = useMutation({
    mutationFn: async () => {
      if (notificationStatus.data?.permission === 'blocked') {
        await openNotificationSettings();
        return getNotificationStatus();
      }
      return enableNotifications();
    },
    onSuccess: (status) => {
      queryClient.setQueryData(notificationStatusQueryKey, status);
    },
  });
  const signOut = useMutation({
    mutationFn: () => authClient.signOut(),
    onSettled: async () => {
      await invalidateSession();
    },
  });

  return (
    <Screen testID="settings-screen" edges={['top', 'bottom']}>
      <PageScroll
        refreshing={notificationStatus.isRefetching}
        onRefresh={() => void notificationStatus.refetch()}
        contentContainerClassName="flex-grow pb-5 pt-3">
        <Pressable
          testID="settings-back-button"
          accessibilityRole="button"
          accessibilityLabel="Close account settings"
          onPress={() => router.back()}
          className="mb-8 h-12 w-12 items-center justify-center rounded-full active:opacity-70"
          style={{ backgroundColor: colors.surface }}>
          <ArrowLeft color={colors.ink} size={22} />
        </Pressable>

        <AppText variant="display">Account</AppText>
        <AppText variant="body" tone="soft" className="mt-2">
          Your private DuoDate profile on this device.
        </AppText>

        <PaperCard className="mt-8">
          <View className="flex-row items-center">
            <View
              className="h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.sageSoft }}>
              <UserRound color={colors.sage} size={23} />
            </View>
            <View className="ml-4 flex-1">
              <AppText variant="heading">{session.data?.user.displayName ?? 'DuoDate member'}</AppText>
              <AppText variant="meta" tone="muted" className="mt-1">
                Private household account
              </AppText>
            </View>
          </View>
        </PaperCard>

        <PaperCard testID="notification-settings-card" className="mt-4">
          <View className="flex-row items-center">
            <View
              className="h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.roseSoft }}>
              <BellRing color={colors.rose} size={22} />
            </View>
            <View className="ml-4 flex-1">
              <AppText variant="heading">Notifications</AppText>
              <AppText testID="notification-settings-status" variant="meta" tone="muted" className="mt-1">
                {notificationSummary(notificationStatus.data, notificationStatus.isError)}
              </AppText>
            </View>
          </View>
          {notificationAction.isError ? (
            <AppText testID="notification-settings-error" variant="meta" tone="danger" className="mt-4">
              Notification settings could not be updated right now.
            </AppText>
          ) : null}
          {notificationStatus.isError ? (
            <View className="mt-5">
              <SecondaryButton
                testID="notification-status-retry"
                label="Check again"
                onPress={() => void notificationStatus.refetch()}
              />
            </View>
          ) : notificationStatus.data?.runtimeSupported &&
          notificationStatus.data.projectConfigured &&
          (notificationStatus.data.permission !== 'granted' ||
            notificationStatus.data.registration !== 'registered') ? (
            <View className="mt-5">
              <SecondaryButton
                testID="notification-settings-action"
                label={
                  notificationAction.isPending
                    ? 'Updating…'
                    : notificationStatus.data.permission === 'blocked'
                      ? 'Open Android settings'
                      : notificationStatus.data.permission === 'granted'
                        ? 'Try syncing again'
                        : 'Enable reminders'
                }
                disabled={notificationAction.isPending}
                onPress={() => notificationAction.mutate()}
              />
            </View>
          ) : null}
        </PaperCard>

        <View className="mt-auto pb-5">
          {signOut.isError ? (
            <AppText testID="logout-error" variant="meta" tone="danger" className="mb-3 text-center">
              Sign out did not complete. Please try again.
            </AppText>
          ) : null}
          <PrimaryButton
            testID="logout-button"
            label="Sign out"
            icon={<LogOut color={colors.surface} size={19} />}
            loading={signOut.isPending}
            onPress={() => signOut.mutate()}
          />
        </View>
      </PageScroll>
    </Screen>
  );
}
