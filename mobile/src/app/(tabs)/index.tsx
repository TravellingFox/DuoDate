import { ActivityIndicator, Pressable, View } from 'react-native';
import { useQueries, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { differenceInCalendarDays, differenceInCalendarYears, getDate, getMonth } from 'date-fns';
import { ArrowRight, CalendarDays, MapPinned, Settings } from 'lucide-react-native';
import { AuthenticatedMediaImage } from '@/components/AuthenticatedMediaImage';
import {
  AppText,
  colors,
  EmptyState,
  ErrorState,
  LoadingState,
  PageScroll,
  PaperCard,
  radii,
  Screen,
  SectionHeader,
} from '@/components/ui';
import { SpaceSelector } from '@/components/SpaceSelector';
import { duodateApi, type Memory, queryKeys } from '@/lib/api/duodate';
import { nextScheduledDate } from '@/lib/home-state';
import { memoryExcerpt, resolveMemoryCover } from '@/lib/memory-album';
import { usePlanningContext } from '@/lib/planning-context';
import {
  calendarDateInTimeZone,
  formatCalendarDate,
  formatTime,
  parseCalendarDate,
  todayCalendarDate,
} from '@/lib/format';

function selectResurfacedMemory(memories: Memory[], today: Date) {
  const older = memories.filter((memory) => memory.status === 'CONTENT_VALID' && memory.startDate < todayCalendarDate(today));
  if (older.length === 0) return null;

  const anniversaries = older
    .filter((memory) => {
      const date = parseCalendarDate(memory.startDate);
      return (
        getMonth(date) === getMonth(today) &&
        getDate(date) === getDate(today) &&
        differenceInCalendarYears(today, date) >= 1
      );
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (anniversaries[0]) return { memory: anniversaries[0], label: 'On this day' };

  const aroundThisTime = older
    .map((memory) => {
      const original = parseCalendarDate(memory.startDate);
      const thisYear = new Date(today.getFullYear(), original.getMonth(), original.getDate(), 12);
      return {
        memory,
        ageInYears: differenceInCalendarYears(today, original),
        distance: Math.abs(differenceInCalendarDays(thisYear, today)),
      };
    })
    .filter(({ ageInYears, distance }) => ageInYears >= 1 && distance <= 10)
    .sort((a, b) => a.distance - b.distance || b.memory.startDate.localeCompare(a.memory.startDate));
  if (aroundThisTime[0]) return { memory: aroundThisTime[0].memory, label: 'Around this time' };

  const genuinelyOlder = older.filter(
    (memory) => differenceInCalendarDays(today, parseCalendarDate(memory.startDate)) >= 30,
  );
  if (genuinelyOlder.length === 0) return null;
  const dateSeed = todayCalendarDate(today)
    .split('')
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  return { memory: genuinelyOlder[dateSeed % genuinelyOlder.length], label: 'Remember this?' };
}

export default function HomeScreen() {
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const planningContext = usePlanningContext(bootstrap.data);

  const [schedules, memories, ideas] = useQueries({
    queries: [
      {
        queryKey: queryKeys.schedules,
        queryFn: duodateApi.schedules,
        enabled: Boolean(bootstrap.data),
        refetchInterval: 60_000,
      },
      {
        queryKey: queryKeys.memories,
        queryFn: duodateApi.memories,
        enabled: Boolean(bootstrap.data),
        refetchInterval: 60_000,
      },
      {
        queryKey: [
          ...queryKeys.ideas(planningContext.effectiveKey ?? 'pending'),
          planningContext.apiContext,
        ],
        queryFn: () => duodateApi.ideas(planningContext.apiContext),
        enabled: Boolean(bootstrap.data && planningContext.effectiveKey),
        refetchInterval: 60_000,
      },
    ],
  });

  if (bootstrap.isLoading) return <Screen testID="home-screen"><LoadingState /></Screen>;
  if (bootstrap.isError || !bootstrap.data) {
    return (
      <Screen testID="home-screen">
        <ErrorState
          message="We couldn't load your shared space."
          onRetry={() => void bootstrap.refetch()}
        />
      </Screen>
    );
  }

  const selectedSpace = planningContext.selectedSpace;
  const selectedTrip = planningContext.selectedTrip;
  const selectedContextLabel = planningContext.selectedOption?.label ?? 'All spaces';
  const browseTarget = selectedSpace
    ? {
        id: selectedSpace.id,
        kind: 'SPACE',
        label: selectedSpace.name,
        timeZone: planningContext.timeZone ?? bootstrap.data.household.defaultTimeZone,
      }
    : selectedTrip
      ? {
          id: selectedTrip.id,
          kind: 'TRIP',
          label: selectedContextLabel,
          timeZone: planningContext.timeZone ?? bootstrap.data.household.defaultTimeZone,
          destinationId: selectedTrip.destination.id,
        }
      : planningContext.effectiveKey === 'ALL'
        ? {
            id: 'all',
            kind: 'ALL',
            label: 'All ideas',
            timeZone: planningContext.timeZone ?? bootstrap.data.household.defaultTimeZone,
          }
        : null;
  const now = new Date();
  const today = calendarDateInTimeZone(now, bootstrap.data.household.defaultTimeZone);
  const nextDate = nextScheduledDate(schedules.data ?? [], now);
  const resurfaced = selectResurfacedMemory(memories.data ?? [], parseCalendarDate(today));
  const resurfacedCover = resurfaced ? resolveMemoryCover(resurfaced.memory) : null;
  const resurfacedExcerpt = resurfaced ? memoryExcerpt(resurfaced.memory) : null;
  const ideaCount = ideas.data?.length;
  const contextualLine = typeof ideaCount === 'number'
    ? planningContext.effectiveKey === 'ALL'
      ? `${ideaCount} ${ideaCount === 1 ? 'idea' : 'ideas'} across all your spaces`
      : `${ideaCount} ${ideaCount === 1 ? 'idea' : 'ideas'} waiting in ${selectedContextLabel}`
    : `Gathering ideas for ${selectedContextLabel}`;

  const refresh = async () => {
    await Promise.all([bootstrap.refetch(), schedules.refetch(), memories.refetch(), ideas.refetch()]);
  };

  return (
    <Screen testID="home-screen" edges={['top']}>
      <PageScroll
        refreshing={bootstrap.isRefetching || schedules.isRefetching || memories.isRefetching || ideas.isRefetching}
        onRefresh={() => void refresh()}
        contentContainerClassName="pt-4">
        <View className="flex-row items-start justify-between">
          <View className="min-w-0 flex-1 pr-4">
            {planningContext.options.length > 0 ? (
              <SpaceSelector
                options={planningContext.options}
                selectedKey={planningContext.effectiveKey}
                onSelect={planningContext.selectContext}
              />
            ) : (
              <AppText variant="label" tone="muted" className="uppercase">
                Your shared space
              </AppText>
            )}
          </View>
          <View className="flex-row">
            <Pressable
              testID="travel-button"
              accessibilityRole="button"
              accessibilityLabel="Open Travel"
              onPress={() => router.push('/travel')}
              className="mr-2 h-11 w-11 items-center justify-center border active:opacity-70"
              style={{ backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.pill }}>
              <MapPinned color={colors.sage} size={20} />
            </Pressable>
            <Pressable
              testID="settings-button"
              accessibilityRole="button"
              accessibilityLabel="Open account settings"
              onPress={() => router.push('/settings')}
              className="h-11 w-11 items-center justify-center border active:opacity-70"
              style={{ backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.pill }}>
              <Settings color={colors.inkSoft} size={20} />
            </Pressable>
          </View>
        </View>

        <View className="mt-8">
          <AppText testID="home-user-name" variant="display" className="leading-[44px]">
            {bootstrap.data.user.displayName}
          </AppText>
          <AppText variant="body" tone="soft" className="mt-2">
            {contextualLine}
          </AppText>
        </View>

        {schedules.isError || memories.isError || ideas.isError ? (
          <View
            testID="home-partial-error"
            className="mt-6 border px-4 py-3"
            style={{ backgroundColor: colors.dangerSoft, borderColor: colors.roseSoft, borderRadius: radii.medium }}>
            <AppText variant="meta" tone="danger">
              Some shared updates could not load. Pull down to try again.
            </AppText>
          </View>
        ) : null}

        <View className="mt-7 flex-row">
          {browseTarget ? (
            <Pressable
              testID="home-open-space-button"
              accessibilityRole="button"
              accessibilityLabel={`Open ${selectedContextLabel} ideas`}
              onPress={() => {
                if (selectedTrip) {
                  router.push({ pathname: '/trip/[id]', params: { id: selectedTrip.id } });
                  return;
                }
                router.push({
                  pathname: '/space/[id]',
                  params: {
                    id: browseTarget.id,
                    contextKind: browseTarget.kind,
                    contextLabel: browseTarget.label,
                    contextTimeZone: browseTarget.timeZone,
                  },
                });
              }}
              className="min-h-12 flex-row items-center px-3 active:opacity-70">
              <AppText variant="label">View ideas</AppText>
              <ArrowRight color={colors.ink} size={17} className="ml-2" />
            </Pressable>
          ) : null}
        </View>

        <View className="mt-11">
          <SectionHeader eyebrow="Coming up" title="Our next date" />
          {schedules.isLoading ? (
            <PaperCard testID="next-date-loading" className="flex-row items-center">
              <ActivityIndicator color={colors.rose} />
              <AppText variant="body" tone="soft" className="ml-3">Loading your next date…</AppText>
            </PaperCard>
          ) : schedules.isError ? (
            <PaperCard testID="next-date-error">
              <AppText variant="body" tone="danger">We couldn't load the next date.</AppText>
            </PaperCard>
          ) : nextDate ? (
            <Pressable
              testID="next-date-card"
              accessibilityRole="button"
              accessibilityLabel={`Open ${nextDate.idea.title}`}
              onPress={() => router.push({ pathname: '/idea/[id]', params: { id: nextDate.idea.id } })}
              className="active:opacity-80">
              <PaperCard style={{ backgroundColor: colors.ochreSoft }}>
                <View className="flex-row items-start">
                  <View
                    className="h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: colors.surface }}>
                    <CalendarDays color={colors.ochre} size={23} />
                  </View>
                  <View className="ml-4 min-w-0 flex-1">
                    <AppText variant="heading" className="text-xl">
                      {nextDate.idea.title}
                    </AppText>
                    <AppText variant="body" tone="soft" className="mt-1">
                      {formatCalendarDate(nextDate.scheduledDate, 'EEEE, d MMMM')}
                      {formatTime(nextDate.startLocalTime) ? ` · ${formatTime(nextDate.startLocalTime)}` : ''}
                    </AppText>
                  </View>
                </View>
              </PaperCard>
            </Pressable>
          ) : (
            <EmptyState
              testID="next-date-empty"
              title="Nothing scheduled yet"
              message="When an idea becomes a real plan, it will appear here."
            />
          )}
        </View>

        {resurfaced ? (
          <View className="mt-11">
            <SectionHeader eyebrow={resurfaced.label} title={resurfaced.memory.title} />
            <Pressable
              testID="resurfaced-memory-card"
              accessibilityRole="button"
              accessibilityLabel={`Open Memory ${resurfaced.memory.title}`}
              onPress={() => router.push({ pathname: '/memory/[id]', params: { id: resurfaced.memory.id } })}
              className="active:opacity-80">
              <PaperCard className="overflow-hidden p-0">
                {resurfacedCover ? (
                  <AuthenticatedMediaImage
                    mediaId={resurfacedCover.id}
                    contentType={resurfacedCover.contentType}
                  />
                ) : null}
                <View className="px-5 py-5">
                  <AppText variant="label" tone="muted">
                    {formatCalendarDate(resurfaced.memory.startDate, 'd MMMM yyyy')}
                  </AppText>
                  {resurfacedExcerpt ? (
                    <AppText variant="body" tone="soft" className="mt-2" numberOfLines={2}>
                      {resurfacedExcerpt}
                    </AppText>
                  ) : null}
                  <View className="mt-4 flex-row items-center">
                    <AppText variant="label" tone="accent">Open Memory</AppText>
                    <ArrowRight color={colors.rose} size={17} className="ml-2" />
                  </View>
                </View>
              </PaperCard>
            </Pressable>
          </View>
        ) : null}
      </PageScroll>
    </Screen>
  );
}
