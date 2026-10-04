import { useEffect, useState } from 'react';
import { AppState, Modal, Platform, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { BellRing } from 'lucide-react-native';
import { AppText, colors, PaperCard, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useSession } from '@/lib/auth/use-session';
import { getNotificationOnboardingDecision, getOrCreateInstallationId } from '@/lib/notifications/installation-store';
import {
  deferNotificationOnboarding,
  enableNotifications,
  notificationStatusQueryKey,
  registerAuthenticatedDevice,
  syncAuthenticatedNotifications,
} from '@/lib/notifications/notifications';
import {
  parseNotificationTarget,
  setPendingNotificationTarget,
  takePendingNotificationTarget,
} from '@/lib/notifications/notification-target';

if (Platform.OS === 'android') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export function NotificationCoordinator() {
  const session = useSession();
  const navigationState = useRootNavigationState();
  const queryClient = useQueryClient();
  const [showExplanation, setShowExplanation] = useState<boolean>(false);
  const [pendingTargetVersion, setPendingTargetVersion] = useState<number>(0);

  const enable = useMutation({
    mutationFn: enableNotifications,
    onSuccess: (status) => {
      queryClient.setQueryData(notificationStatusQueryKey, status);
      setShowExplanation(false);
    },
  });
  const defer = useMutation({
    mutationFn: deferNotificationOnboarding,
    onSettled: () => setShowExplanation(false),
  });

  useEffect(() => {
    if (!session.data?.user || Platform.OS !== 'android') return;
    let active = true;
    void (async () => {
      await getOrCreateInstallationId();
      const status = await syncAuthenticatedNotifications();
      if (!active) return;
      queryClient.setQueryData(notificationStatusQueryKey, status);
      const decision = await getNotificationOnboardingDecision();
      if (active && status.permission === 'undetermined' && decision === null) {
        setShowExplanation(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [queryClient, session.data?.user]);

  useEffect(() => {
    if (!session.data?.user || Platform.OS !== 'android') return;
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void syncAuthenticatedNotifications().then((status) => {
        queryClient.setQueryData(notificationStatusQueryKey, status);
      });
    });
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      void registerAuthenticatedDevice();
    });
    return () => {
      appStateSubscription.remove();
      tokenSubscription.remove();
    };
  }, [queryClient, session.data?.user]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const receiveTarget = (data: unknown) => {
      const target = parseNotificationTarget(data);
      if (!target) return;
      setPendingNotificationTarget(target);
      setPendingTargetVersion((version) => version + 1);
    };
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) {
      receiveTarget(lastResponse.notification.request.content.data);
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      receiveTarget(response.notification.request.content.data);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!navigationState?.key || session.isLoading || !session.data?.user) return;
    const target = takePendingNotificationTarget();
    if (!target) return;
    router.push({ pathname: '/memory/[id]', params: { id: target.memoryId } });
  }, [navigationState?.key, pendingTargetVersion, session.data?.user, session.isLoading]);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={showExplanation}
      onRequestClose={() => defer.mutate()}>
      <View className="flex-1 justify-end bg-black/25 px-5 pb-8">
        <PaperCard testID="notification-onboarding-card" className="py-6">
          <View
            className="mb-5 h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.roseSoft }}>
            <BellRing color={colors.rose} size={22} />
          </View>
          <AppText variant="heading">Gentle memory reminders</AppText>
          <AppText variant="body" tone="soft" className="mt-2">
            DuoDate can send a few gentle reminders about shared memories.
          </AppText>
          {enable.isError ? (
            <AppText testID="notification-onboarding-error" variant="meta" tone="danger" className="mt-3">
              Notifications could not be enabled right now. You can try again later in Account.
            </AppText>
          ) : null}
          <View className="mt-6 gap-3">
            <PrimaryButton
              testID="enable-notifications-button"
              label="Enable reminders"
              loading={enable.isPending}
              onPress={() => enable.mutate()}
            />
            <SecondaryButton
              testID="defer-notifications-button"
              label="Not now"
              disabled={defer.isPending}
              onPress={() => defer.mutate()}
            />
          </View>
        </PaperCard>
      </View>
    </Modal>
  );
}
