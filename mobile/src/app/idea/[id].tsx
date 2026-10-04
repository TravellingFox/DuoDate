import { useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  Images,
  MapPin,
  Minus,
  WalletCards,
  X,
} from 'lucide-react-native';
import { AuthenticatedIdeaImage } from '@/components/AuthenticatedIdeaImage';
import { AuthenticatedIdeaVideo } from '@/components/IdeaVideo';
import { SchedulingSheet } from '@/components/SchedulingSheet';
import {
  AppText,
  colors,
  Divider,
  ErrorState,
  LoadingState,
  PaperCard,
  PrimaryButton,
  radii,
  Screen,
  SecondaryButton,
  SectionHeader,
} from '@/components/ui';
import {
  duodateApi,
  queryKeys,
  type WeatherState,
  type WeatherSuitability,
} from '@/lib/api/duodate';
import {
  costLabels,
  durationLabels,
  formatCalendarDate,
  formatTime,
  readableLinkLabel,
  weatherStateLabels,
} from '@/lib/format';
import { ideaPlanningSummary } from '@/lib/idea-planning';
import { resolveSchedulingTimeZone } from '@/lib/scheduling';
import { findMemoryForIdea } from '@/lib/memory-album';

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View className="mb-4 flex-row items-start">
      <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: colors.paperDeep }}>
        {icon}
      </View>
      <View className="ml-3 flex-1">
        <AppText variant="meta" tone="muted">{label}</AppText>
        <AppText variant="body" className="mt-0.5">{value}</AppText>
      </View>
    </View>
  );
}

function WeatherPill({ label, state }: { label: string; state: WeatherState }) {
  const Icon = state === 'GOOD' ? Check : state === 'IMPOSSIBLE' ? X : Minus;
  const color = state === 'GOOD' ? colors.sage : state === 'IMPOSSIBLE' ? colors.danger : colors.inkMuted;
  return (
    <View
      className="mb-2 mr-2 min-h-11 flex-row items-center border px-3"
      style={{ borderColor: colors.line, backgroundColor: colors.surface, borderRadius: radii.pill }}>
      <Icon color={color} size={15} />
      <AppText variant="meta" className="ml-2">{label} · {weatherStateLabels[state]}</AppText>
    </View>
  );
}

export default function IdeaDetailScreen() {
  const {
    id,
    contextTimeZone,
    initialScheduleDate,
    initialScheduleTime,
    initialScheduleEndTime,
    occurrenceId,
  } = useLocalSearchParams<{
    id: string;
    contextTimeZone?: string;
    initialScheduleDate?: string;
    initialScheduleTime?: string;
    initialScheduleEndTime?: string;
    occurrenceId?: string;
  }>();
  const [scheduleOpen, setScheduleOpen] = useState<boolean>(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const idea = useQuery({
    queryKey: queryKeys.idea(id),
    queryFn: () => duodateApi.idea(id),
    enabled: Boolean(id),
    refetchInterval: 60_000,
  });
  const memories = useQuery({
    queryKey: queryKeys.memories,
    queryFn: duodateApi.memories,
    enabled: idea.data?.lifecycle === 'COMPLETED',
  });

  const weatherItems = useMemo(() => {
    const weather = idea.data?.weatherSuitability;
    if (!weather) return [];
    const items: [keyof WeatherSuitability, WeatherState][] = [
      ['sunny', weather.sunny],
      ['rainy', weather.rainy],
      ['indoor', weather.indoor],
      ['outdoor', weather.outdoor],
    ];
    return items.filter(([, state]) => state !== 'NEUTRAL');
  }, [idea.data?.weatherSuitability]);

  if (bootstrap.isLoading || idea.isLoading) return <Screen testID="idea-detail-screen"><LoadingState label="Opening idea…" /></Screen>;
  if (bootstrap.isError || idea.isError || !bootstrap.data || !idea.data) {
    return (
      <Screen testID="idea-detail-screen">
        <View className="px-5 pt-3">
          <Pressable
            testID="idea-detail-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
        </View>
        <ErrorState
          message="We couldn't open this idea."
          onRetry={() => void Promise.all([bootstrap.refetch(), idea.refetch()])}
        />
      </Screen>
    );
  }

  const value = idea.data;
  const activeSchedule = value.schedules.find((schedule) => schedule.status === 'SCHEDULED');
  const completedMemory = value.lifecycle === 'COMPLETED'
    ? findMemoryForIdea(memories.data ?? [], value.id)
    : null;
  const refresh = async () => {
    await Promise.all([
      idea.refetch(),
      ...(value.lifecycle === 'COMPLETED' ? [memories.refetch()] : []),
    ]);
  };
  const exactCost = value.exactCostCents !== null
    ? `Exact amount · ${(value.exactCostCents / 100).toFixed(value.exactCostCents % 100 === 0 ? 0 : 2)}`
    : null;
  const costValue = exactCost ?? (value.costBand ? costLabels[value.costBand] : null);
  const visibleOccurrences = value.recurrence.kind !== 'NONE'
    || value.availability?.mode === 'SPECIFIC_OCCURRENCES'
    ? value.occurrences
    : [];
  const planningSummary = ideaPlanningSummary(value.availability, value.recurrence, visibleOccurrences);
  const costBasis = value.costBasisAtEntry === 'TOTAL_FOR_TWO' ? 'total for two' : value.costBasisAtEntry === 'PER_PERSON' ? 'per person' : null;
  const initialOccurrence = value.occurrences.find(
    (item) => item.id === (activeSchedule?.occurrenceId ?? occurrenceId),
  ) ?? null;
  const schedulingTimeZone = resolveSchedulingTimeZone({
    occurrenceTimeZone: activeSchedule ? null : initialOccurrence?.timeZone,
    contextTimeZone,
    existingScheduleTimeZone: activeSchedule?.timeZone,
    destinationTimeZone: value.destinations.length === 1
      ? value.destinations[0]?.timeZone
      : null,
    spaceTimeZone: value.spaces.length === 1 ? value.spaces[0]?.timeZone : null,
    householdTimeZone: bootstrap.data.household.defaultTimeZone,
  });

  return (
    <Screen testID="idea-detail-screen" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between px-5 py-3">
        <Pressable
          testID="idea-detail-back-button"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
          style={{ backgroundColor: colors.surface }}>
          <ArrowLeft color={colors.ink} size={22} />
        </Pressable>
        <AppText variant="label" tone="muted">IDEA</AppText>
        <View className="h-12 w-12" />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="px-5 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={idea.isRefetching || memories.isRefetching}
            onRefresh={() => void refresh()}
            tintColor={colors.rose}
            colors={[colors.rose]}
          />
        }>
        <View className="pt-5">
          {value.category ? <AppText variant="label" tone="accent" className="uppercase">{value.category.name}</AppText> : null}
          <AppText variant="display" className="mt-2 leading-[44px]">{value.title}</AppText>
          <AppText testID="idea-authorship" variant="meta" tone="muted" className="mt-2">
            Idea by {value.createdBy.displayName}
          </AppText>
        </View>

        {(costValue || value.durationBand || value.specificLocation || activeSchedule) ? (
          <PaperCard className="mt-8 pb-1">
            {activeSchedule ? (
              <DetailRow
                icon={<CalendarDays color={colors.ochre} size={17} />}
                label="Scheduled"
                value={`${formatCalendarDate(activeSchedule.scheduledDate, 'EEEE, d MMMM')}${activeSchedule.startLocalTime ? ` · ${formatTime(activeSchedule.startLocalTime)}` : ''}`}
              />
            ) : null}
            {costValue ? (
              <DetailRow icon={<WalletCards color={colors.inkSoft} size={17} />} label="Cost" value={`${costValue}${costBasis ? ` · ${costBasis}` : ''}`} />
            ) : null}
            {value.durationBand ? (
              <DetailRow icon={<Clock3 color={colors.inkSoft} size={17} />} label="Duration" value={durationLabels[value.durationBand]} />
            ) : null}
            {value.specificLocation ? (
              <DetailRow icon={<MapPin color={colors.inkSoft} size={17} />} label="Location" value={value.specificLocation} />
            ) : null}
          </PaperCard>
        ) : null}

        {value.image ? (
          <View className="mt-8">
            {value.image.contentType.startsWith('video/') ? (
              <AuthenticatedIdeaVideo image={value.image} />
            ) : (
              <AuthenticatedIdeaImage key={value.image.id} image={value.image} />
            )}
          </View>
        ) : null}

        {value.notes ? (
          <View className="mt-9">
            <SectionHeader title="Notes" />
            <AppText testID="idea-notes" variant="body" tone="soft" selectable>{value.notes}</AppText>
          </View>
        ) : null}

        {value.links.length > 0 ? (
          <View className="mt-9">
            <SectionHeader title="Links" />
            {value.links.map((link) => (
              <Pressable
                key={link.id}
                testID={`idea-link-${link.id}`}
                accessibilityRole="link"
                accessibilityLabel={`Open ${readableLinkLabel(link.url, link.label)}`}
                onPress={() => {
                  setLinkError(null);
                  void Linking.openURL(link.url).catch(() => setLinkError('That link could not be opened.'));
                }}
                className="mb-3 min-h-14 flex-row items-center border px-4 active:opacity-70"
                style={{ backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.medium }}>
                <View className="min-w-0 flex-1">
                  <AppText variant="label">{readableLinkLabel(link.url, link.label)}</AppText>
                </View>
                <ExternalLink color={colors.inkMuted} size={18} />
              </Pressable>
            ))}
            {linkError ? <AppText testID="link-error" variant="meta" tone="danger">{linkError}</AppText> : null}
          </View>
        ) : null}

        <View className="mt-9">
          <SectionHeader title="When it could work" />
          <PaperCard className="py-4">
            <AppText testID="idea-planning-summary" variant="body">{planningSummary.primary}</AppText>
            {visibleOccurrences.length > 0 ? (
              <View className="mt-3 border-t pt-3" style={{ borderColor: colors.line }}>
                {planningSummary.specificDateLabel ? (
                  <AppText variant="meta" tone="muted" className="mb-1">
                    {planningSummary.specificDateLabel}
                  </AppText>
                ) : null}
                {visibleOccurrences.map((occurrence, index) => (
                  <View key={occurrence.id}>
                    {index > 0 ? <Divider /> : null}
                    <AppText variant="label">
                      {formatCalendarDate(occurrence.localDate, 'EEEE, d MMMM yyyy')}
                      {occurrence.startLocalTime ? ` · ${formatTime(occurrence.startLocalTime)}` : ''}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </PaperCard>
        </View>

        {weatherItems.length > 0 ? (
          <View className="mt-9">
            <SectionHeader title="Weather fit" />
            <View className="flex-row flex-wrap">
              {weatherItems.map(([key, state]) => (
                <WeatherPill key={key} label={key.charAt(0).toUpperCase() + key.slice(1)} state={state} />
              ))}
            </View>
          </View>
        ) : null}

        {value.spaces.length > 0 ? (
          <View className="mt-9">
            <SectionHeader title="Spaces" />
            <View className="flex-row flex-wrap">
              {value.spaces.map((space) => (
                <View key={space.id} className="mb-2 mr-2 min-h-11 justify-center border px-4" style={{ backgroundColor: colors.blueSoft, borderColor: colors.line, borderRadius: radii.pill }}>
                  <AppText variant="label">{space.name}</AppText>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 border-t px-5 pb-4 pt-3" style={{ backgroundColor: colors.paper, borderColor: colors.line }}>
        {value.lifecycle === 'COMPLETED' ? (
          <PrimaryButton
            testID="open-idea-memory-button"
            label={completedMemory
              ? 'Open Memory'
              : memories.isError
                ? 'Try loading Memory again'
                : 'Memory unavailable'}
            disabled={!completedMemory && !memories.isError}
            loading={Boolean(memories.isFetching && completedMemory === null)}
            icon={<Images color={colors.surface} size={19} />}
            onPress={() => {
              if (completedMemory) {
                router.push({ pathname: '/memory/[id]', params: { id: completedMemory.id } });
              } else if (memories.isError) {
                void memories.refetch();
              }
            }}
          />
        ) : activeSchedule ? (
          <View className="flex-row gap-3">
            <View className="flex-1">
              <PrimaryButton
                testID="view-scheduled-date-button"
                label="View date"
                icon={<CalendarDays color={colors.surface} size={19} />}
                onPress={() => router.push({
                  pathname: '/calendar',
                  params: { targetDate: activeSchedule.scheduledDate },
                })}
              />
            </View>
            <View className="flex-1">
              <SecondaryButton
                testID="move-scheduled-date-button"
                label="Move"
                icon={<Clock3 color={colors.ink} size={18} />}
                onPress={() => setScheduleOpen(true)}
              />
            </View>
          </View>
        ) : (
          <PrimaryButton
            testID="add-to-calendar-button"
            label="Schedule idea"
            icon={<CalendarDays color={colors.surface} size={19} />}
            onPress={() => setScheduleOpen(true)}
          />
        )}
      </View>

      <SchedulingSheet
        visible={scheduleOpen}
        ideaId={value.id}
        scheduleId={activeSchedule?.id}
        timeZone={schedulingTimeZone}
        initialDate={activeSchedule?.scheduledDate ?? initialScheduleDate}
        initialTime={activeSchedule?.startLocalTime ?? initialScheduleTime}
        initialEndTime={activeSchedule?.endLocalTime ?? initialScheduleEndTime}
        occurrenceId={activeSchedule ? activeSchedule.occurrenceId : occurrenceId}
        occurrences={value.occurrences}
        onClose={() => setScheduleOpen(false)}
        onScheduled={() => setScheduleOpen(false)}
      />
    </Screen>
  );
}
