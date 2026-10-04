import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { router, Tabs } from 'expo-router';
import { CalendarDays, Home, Images, Plus, Sparkles } from 'lucide-react-native';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, colors, radii, shadows } from '@/components/ui';
import { duodateApi, queryKeys } from '@/lib/api/duodate';
import { requestCalendarScrollToTop } from '@/lib/calendar-tab-reset';
import { newIdeaDraftSession } from '@/lib/idea-draft-session';
import { usePlanningContext } from '@/lib/planning-context';

const tabItems = {
  index: { label: 'Home', Icon: Home, slot: 0 },
  calendar: { label: 'Calendar', Icon: CalendarDays, slot: 1 },
  'lets-date': { label: "Let's Date", Icon: Sparkles, slot: 3 },
  memories: { label: 'Memories', Icon: Images, slot: 4 },
} as const;

function DuoDateTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const planningContext = usePlanningContext(bootstrap.data);

  return (
    <View
      testID="primary-navigation"
      className="absolute bottom-0 left-0 right-0 border-t"
      style={{
        height: 76 + insets.bottom,
        backgroundColor: 'rgba(255,253,248,0.98)',
        borderColor: colors.line,
      }}>
      {state.routes.map((route, index) => {
        const item = tabItems[route.name as keyof typeof tabItems];
        if (!item) return null;
        const focused = state.index === index;
        const color = focused ? colors.ink : colors.inkMuted;
        const Icon = item.Icon;
        const positionStyle: ViewStyle = {
          left: `${item.slot * 20}%`,
          width: '20%',
        };

        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (event.defaultPrevented) return;
              if (route.name === 'calendar') requestCalendarScrollToTop();
              if (!focused) navigation.navigate(route.name, route.params);
            }}
            className="absolute items-center justify-end active:opacity-70"
            style={[
              {
                minHeight: 58,
                bottom: Math.max(insets.bottom, 7),
              },
              positionStyle,
            ]}>
            <View
              className="items-center justify-center"
              style={{ width: 38, height: 32, borderRadius: radii.pill }}>
              <Icon color={color} size={21} strokeWidth={focused ? 2.4 : 2} />
            </View>
            <AppText
              variant="meta"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              className="mt-1 text-center"
              style={{ color, fontSize: 11, fontWeight: focused ? '700' : '500' }}>
              {item.label}
            </AppText>
          </Pressable>
        );
      })}

      <Pressable
        testID="primary-add-idea-button"
        accessibilityRole="button"
        accessibilityLabel={`Add an idea${planningContext.selectedOption ? ` to ${planningContext.selectedOption.label}` : ''}`}
        accessibilityState={{ disabled: !bootstrap.data }}
        disabled={!bootstrap.data}
        onPress={() => router.push({ pathname: '/add-idea', params: { ...planningContext.addIdeaParams, draftSession: newIdeaDraftSession() } })}
        className="absolute items-center active:opacity-80"
        style={{
          left: '40%',
          width: '20%',
          bottom: Math.max(insets.bottom, 7),
          minHeight: 67,
          opacity: bootstrap.data ? 1 : 0.55,
        }}>
        <View
          className="h-14 w-14 items-center justify-center border-4"
          style={[
            {
              backgroundColor: colors.ink,
              borderColor: colors.surface,
              borderRadius: radii.pill,
            },
            shadows.floating,
          ]}>
          <Plus color={colors.surface} size={25} strokeWidth={2.4} />
        </View>
        <AppText
          variant="meta"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          className="mt-1 text-center"
          style={{ color: colors.ink, fontSize: 11, fontWeight: '700' }}>
          Add idea
        </AppText>
      </Pressable>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <DuoDateTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.paper } }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="lets-date" options={{ title: "Let's Date" }} />
      <Tabs.Screen name="memories" options={{ title: 'Memories' }} />
    </Tabs>
  );
}
