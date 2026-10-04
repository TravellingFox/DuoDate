import { useCallback } from 'react';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NotificationCoordinator } from '@/components/NotificationCoordinator';
import { AppText, colors, ErrorState } from '@/components/ui';
import { useSession } from '@/lib/auth/use-session';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

const warmTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.rose,
    background: colors.paper,
    card: colors.surface,
    text: colors.ink,
    border: colors.line,
    notification: colors.rose,
  },
};

function RootLayoutNav({ colorScheme: _colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  const session = useSession();
  const hideSplash = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  if (session.isLoading) return null;

  if (session.isError) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.paper }} onLayout={hideSplash}>
        <View className="px-6 pt-24">
          <AppText variant="display">DuoDate</AppText>
        </View>
        <ErrorState
          title="We couldn't open DuoDate"
          message="Check your connection and try restoring your session again."
          onRetry={() => void session.refetch()}
        />
      </View>
    );
  }

  return (
    <View className="flex-1" onLayout={hideSplash} style={{ backgroundColor: colors.paper }}>
      <ThemeProvider value={warmTheme}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: colors.paper },
          }}>
          <Stack.Screen name="index" />
          <Stack.Protected guard={Boolean(session.data?.user)}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="space/[id]" />
            <Stack.Screen name="travel" />
            <Stack.Screen name="trip/[id]" />
            <Stack.Screen name="idea/[id]" />
            <Stack.Screen name="memory/[id]" options={{ contentStyle: { backgroundColor: '#1C1916' } }} />
            <Stack.Screen name="memory/new" options={{ contentStyle: { backgroundColor: '#1C1916' }, presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="add-idea" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="trip-form" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack.Protected>
          <Stack.Protected guard={!session.data?.user}>
            <Stack.Screen name="login" />
          </Stack.Protected>
          <Stack.Protected guard={!session.data?.user && __DEV__}>
            <Stack.Screen
              name="input-diagnostic"
              options={{ headerShown: true, title: 'Input diagnostic' }}
            />
          </Stack.Protected>
        </Stack>
        <NotificationCoordinator />
      </ThemeProvider>
    </View>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" backgroundColor={colors.paper} />
        <RootLayoutNav colorScheme="light" />
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
