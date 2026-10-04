import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowUpRight,
  CalendarCheck,
  CalendarDays,
  CircleDashed,
  Clock3,
  GripHorizontal,
  Move,
  X,
} from 'lucide-react-native';
import { SchedulingSheet } from '@/components/SchedulingSheet';
import {
  AppText,
  colors,
  ErrorState,
  PaperCard,
  PrimaryButton,
  radii,
  Screen,
  SecondaryButton,
  SectionHeader,
} from '@/components/ui';
import { duodateApi, queryKeys, type Schedule } from '@/lib/api/duodate';
import {
  buildCalendarEntries,
  buildRollingWeeksForTarget,
  calendarUpcomingInsertionIndex,
  calendarWeekIndexForDate,
  normalizeCalendarTargetDate,
  type CalendarPlannerEntry,
  type PlannerWeek,
  scheduleCanBeDated,
  schedulesForIdeas,
  upcomingSchedules,
} from '@/lib/calendar-planner';
import { calendarDateInTimeZone, formatCalendarDate, formatTime } from '@/lib/format';
import { subscribeToCalendarScrollToTop } from '@/lib/calendar-tab-reset';
import { usePlanningContext } from '@/lib/planning-context';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const PLANNER_WEEK_COUNT = 26;

function DayMarker({ kind }: { kind: CalendarPlannerEntry['kind'] }) {
  if (kind === 'scheduled') {
    return <View className="h-1.5 w-3 rounded-full" style={{ backgroundColor: colors.ochre }} />;
  }
  return (
    <View
      className="h-2 w-2 rounded-full border"
      style={{ backgroundColor: colors.surface, borderColor: colors.blue, borderWidth: 1.5 }}
    />
  );
}

function PossiblePlanCard({
  entry,
  fallbackTimeZone,
}: {
  entry: Extract<CalendarPlannerEntry, { kind: 'possible' }>;
  fallbackTimeZone: string;
}) {
  const occurrenceLabel = entry.occurrenceCount > 1
    ? `${entry.occurrenceIndex}/${entry.occurrenceCount}`
    : 'Possible';

  return (
    <Pressable
      testID={`possible-plan-${entry.occurrence.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open possible activity ${entry.idea.title}`}
      onPress={() =>
        router.push({
          pathname: '/idea/[id]',
          params: {
            id: entry.idea.id,
            initialScheduleDate: entry.occurrence.localDate,
            ...(entry.occurrence.id.startsWith('recurrence:')
              ? {}
              : { occurrenceId: entry.occurrence.id }),
            ...(entry.occurrence.startLocalTime
              ? { initialScheduleTime: entry.occurrence.startLocalTime }
              : {}),
            ...(entry.occurrence.endLocalTime
              ? { initialScheduleEndTime: entry.occurrence.endLocalTime }
              : {}),
            contextTimeZone: entry.occurrence.timeZone ?? fallbackTimeZone,
          },
        })
      }
      className="mb-3 active:opacity-75">
      <View
        className="min-h-16 flex-row items-center border px-4 py-3"
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.blue,
          borderRadius: radii.medium,
          borderStyle: 'dashed',
        }}>
        <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: colors.blueSoft }}>
          <CircleDashed color={colors.blue} size={19} />
        </View>
        <View className="ml-3 min-w-0 flex-1">
          <AppText variant="label" tone="muted">{occurrenceLabel} · POSSIBLE</AppText>
          <AppText variant="body" className="mt-0.5" numberOfLines={2}>{entry.idea.title}</AppText>
          {entry.occurrence.startLocalTime ? (
            <AppText variant="meta" tone="soft" className="mt-0.5">
              {formatTime(entry.occurrence.startLocalTime)}
            </AppText>
          ) : null}
        </View>
        <ArrowUpRight color={colors.inkMuted} size={18} />
      </View>
    </Pressable>
  );
}

function ScheduledPlanCard({
  schedule,
  onOpen,
  onMove,
}: {
  schedule: Schedule;
  onOpen: () => void;
  onMove: () => void;
}) {
  const lastLongPressAt = useRef<number>(0);

  return (
    <Pressable
      testID={`scheduled-plan-${schedule.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open scheduled plan ${schedule.idea.title}`}
      accessibilityHint="Press and hold to move this plan"
      delayLongPress={450}
      onPress={() => {
        if (Date.now() - lastLongPressAt.current < 700) return;
        onOpen();
      }}
      onLongPress={() => {
        lastLongPressAt.current = Date.now();
        onMove();
      }}
      className="mb-3 active:opacity-80">
      <View
        className="min-h-16 flex-row items-center border px-4 py-3"
        style={{ backgroundColor: colors.ochreSoft, borderColor: colors.ochre, borderRadius: radii.medium }}>
        <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: colors.surface }}>
          <CalendarCheck color={colors.ochre} size={19} />
        </View>
        <View className="ml-3 min-w-0 flex-1">
          <AppText variant="label" style={{ color: colors.ochre }}>SCHEDULED</AppText>
          <AppText variant="body" className="mt-0.5" numberOfLines={2}>{schedule.idea.title}</AppText>
          {schedule.startLocalTime ? (
            <AppText variant="meta" tone="soft" className="mt-0.5">
              {formatTime(schedule.startLocalTime)}
            </AppText>
          ) : null}
        </View>
        <GripHorizontal color={colors.ochre} size={20} />
      </View>
    </Pressable>
  );
}

export default function CalendarScreen() {
  const { targetDate: targetDateParam } = useLocalSearchParams<{
    targetDate?: string | string[];
  }>();
  const targetDate = normalizeCalendarTargetDate(targetDateParam);
  const focusedTargetDate = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<PlannerWeek>>(null);
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const planningContext = usePlanningContext(bootstrap.data);
  const schedules = useQuery({
    queryKey: queryKeys.schedules,
    queryFn: duodateApi.schedules,
    enabled: Boolean(bootstrap.data),
    refetchInterval: 60_000,
  });
  const ideas = useQuery({
    queryKey: [
      ...queryKeys.ideas(`calendar-${planningContext.effectiveKey ?? 'pending'}`),
      planningContext.apiContext,
    ],
    queryFn: () => duodateApi.ideas(planningContext.apiContext),
    enabled: Boolean(bootstrap.data && planningContext.effectiveKey),
    refetchInterval: 60_000,
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailSchedule, setDetailSchedule] = useState<Schedule | null>(null);
  const [reschedule, setReschedule] = useState<Schedule | null>(null);

  useEffect(() => subscribeToCalendarScrollToTop(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }), []);

  const planningTimeZone = planningContext.timeZone ?? bootstrap.data?.household.defaultTimeZone ?? 'UTC';
  const scopedSchedules = useMemo(
    () => schedulesForIdeas(schedules.data ?? [], ideas.data ?? [], Boolean(planningContext.apiContext)),
    [ideas.data, planningContext.apiContext, schedules.data],
  );
  const today = calendarDateInTimeZone(new Date(), planningTimeZone);
  const effectiveSelectedDate = selectedDate ?? today;
  const entriesByDate = useMemo(
    () => buildCalendarEntries(scopedSchedules, ideas.data ?? [], today),
    [ideas.data, scopedSchedules, today],
  );
  const weeks = useMemo(
    () => buildRollingWeeksForTarget(today, targetDate, PLANNER_WEEK_COUNT),
    [targetDate, today],
  );
  const upcomingInsertionIndex = useMemo(() => calendarUpcomingInsertionIndex(weeks), [weeks]);
  const upcoming = useMemo(() => upcomingSchedules(scopedSchedules, today), [scopedSchedules, today]);

  useEffect(() => {
    if (!targetDate) {
      focusedTargetDate.current = null;
      return;
    }
    if (
      focusedTargetDate.current === targetDate
      || !bootstrap.isSuccess
      || !schedules.isSuccess
      || !ideas.isSuccess
    ) return;

    const targetWeekIndex = calendarWeekIndexForDate(weeks, targetDate);
    if (targetWeekIndex < 0) return;

    focusedTargetDate.current = targetDate;
    setSelectedDate(targetDate);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: targetWeekIndex,
        animated: false,
        viewPosition: 0.08,
      });
    });
  }, [bootstrap.isSuccess, ideas.isSuccess, schedules.isSuccess, targetDate, weeks]);
  const rescheduleOccurrences = reschedule
    ? ideas.data?.find((idea) => idea.id === reschedule.ideaId)?.occurrences ?? []
    : [];
  const availableRescheduleOccurrences = reschedule?.occurrence
    && !rescheduleOccurrences.some((occurrence) => occurrence.id === reschedule.occurrence?.id)
    ? [...rescheduleOccurrences, reschedule.occurrence]
    : rescheduleOccurrences;

  const dated = useMutation({
    mutationFn: (schedule: Schedule) => duodateApi.dateSchedule(schedule.id),
    onSuccess: (memory, schedule) => {
      queryClient.setQueryData(queryKeys.memory(memory.id), memory);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.schedules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.idea(schedule.ideaId) }),
        queryClient.invalidateQueries({ queryKey: ['ideas'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.memories }),
        queryClient.invalidateQueries({ queryKey: queryKeys.letsDateRoot }),
      ]);
      setDetailSchedule(null);
      router.push({ pathname: '/memory/[id]', params: { id: memory.id } });
    },
  });

  const refresh = async () => {
    await Promise.all([bootstrap.refetch(), schedules.refetch(), ideas.refetch()]);
  };

  if (bootstrap.isLoading || schedules.isLoading || ideas.isLoading) {
    return (
      <Screen testID="calendar-screen">
        <View className="flex-1 items-center justify-center px-8">
          <CalendarDays color={colors.rose} size={30} />
          <AppText variant="body" tone="soft" className="mt-4 text-center">Opening your shared planner…</AppText>
        </View>
      </Screen>
    );
  }

  if (bootstrap.isError || schedules.isError || ideas.isError || !bootstrap.data) {
    return (
      <Screen testID="calendar-screen">
        <ErrorState
          message="We couldn't load your shared calendar."
          onRetry={() => void refresh()}
        />
      </Screen>
    );
  }

  const renderSelectedDay = (date: string) => {
    const dayEntries = entriesByDate.get(date) ?? [];
    return (
      <View testID="calendar-day-details" className="mb-5 mt-3 px-1">
        <View className="mb-3 flex-row items-end justify-between">
          <View className="min-w-0 flex-1 pr-4">
            <AppText variant="label" tone="muted" className="uppercase">Selected day</AppText>
            <AppText variant="heading" className="mt-1">{formatCalendarDate(date, 'EEEE, d MMMM')}</AppText>
          </View>
          <AppText variant="meta" tone="muted">
            {dayEntries.length === 0 ? 'No plans' : `${dayEntries.length} ${dayEntries.length === 1 ? 'item' : 'items'}`}
          </AppText>
        </View>
        {dayEntries.length === 0 ? (
          <View className="border px-4 py-4" style={{ backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.medium }}>
            <AppText variant="body" tone="soft">Nothing planned for this day.</AppText>
          </View>
        ) : (
          dayEntries.map((entry) => entry.kind === 'scheduled' ? (
            <ScheduledPlanCard
              key={`scheduled-${entry.schedule.id}`}
              schedule={entry.schedule}
              onOpen={() => {
                dated.reset();
                setDetailSchedule(entry.schedule);
              }}
              onMove={() => setReschedule(entry.schedule)}
            />
          ) : (
            <PossiblePlanCard
              key={`possible-${entry.occurrence.id}`}
              entry={entry}
              fallbackTimeZone={planningTimeZone}
            />
          ))
        )}
      </View>
    );
  };

  const renderUpcoming = () => (
    <View className="mb-6 mt-5">
      <SectionHeader eyebrow="A quick look" title="Upcoming" />
      {upcoming.length === 0 ? (
        <PaperCard testID="calendar-upcoming-empty" className="py-4">
          <AppText variant="body" tone="soft">No upcoming dates are scheduled yet.</AppText>
        </PaperCard>
      ) : (
        <PaperCard testID="calendar-upcoming-list" className="py-2">
          {upcoming.slice(0, 3).map((schedule, index) => (
            <Pressable
              key={schedule.id}
              testID={`upcoming-schedule-${schedule.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${schedule.idea.title}`}
              onPress={() => {
                dated.reset();
                setDetailSchedule(schedule);
              }}
              className="min-h-16 flex-row items-center py-3 active:opacity-70"
              style={index > 0 ? { borderTopWidth: 1, borderColor: colors.line } : undefined}>
              <View className="h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: colors.ochreSoft }}>
                <CalendarCheck color={colors.ochre} size={19} />
              </View>
              <View className="ml-3 min-w-0 flex-1">
                <AppText variant="label" numberOfLines={1}>{schedule.idea.title}</AppText>
                <AppText variant="meta" tone="muted" className="mt-0.5">
                  {formatCalendarDate(schedule.scheduledDate)}
                  {schedule.startLocalTime ? ` · ${formatTime(schedule.startLocalTime)}` : ''}
                </AppText>
              </View>
            </Pressable>
          ))}
          {upcoming.length > 3 ? (
            <AppText variant="meta" tone="muted" className="border-t py-3 text-center" style={{ borderColor: colors.line }}>
              +{upcoming.length - 3} more scheduled
            </AppText>
          ) : null}
        </PaperCard>
      )}
    </View>
  );

  return (
    <Screen testID="calendar-screen" edges={['top']}>
      <FlatList
        ref={listRef}
        testID="calendar-week-list"
        data={weeks}
        keyExtractor={(week) => week.key}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, index * averageItemLength),
            animated: false,
          });
          requestAnimationFrame(() => {
            listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.08 });
          });
        }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 128 }}
        refreshControl={
          <RefreshControl
            refreshing={bootstrap.isRefetching || schedules.isRefetching || ideas.isRefetching}
            onRefresh={() => void refresh()}
            tintColor={colors.rose}
            colors={[colors.rose]}
          />
        }
        ListHeaderComponent={
          <View testID="calendar-compact-header">
            <View className="flex-row items-center justify-between">
              <AppText variant="title">Calendar</AppText>
              <View className="ml-3 max-w-[58%] rounded-full px-3 py-1.5" style={{ backgroundColor: colors.surface }}>
                <AppText variant="meta" tone="soft" numberOfLines={1}>
                  {planningContext.selectedOption?.label ?? 'All spaces'}
                </AppText>
              </View>
            </View>
            <View className="mt-2 flex-row items-center">
              <View className="mr-4 flex-row items-center">
                <DayMarker kind="scheduled" />
                <AppText variant="meta" tone="muted" className="ml-1.5 text-xs">Scheduled</AppText>
              </View>
              <View className="flex-row items-center">
                <DayMarker kind="possible" />
                <AppText variant="meta" tone="muted" className="ml-1.5 text-xs">Possible</AppText>
              </View>
            </View>
            <View className="mt-2 flex-row border-b pb-1.5" style={{ borderColor: colors.line }}>
              {WEEKDAY_LABELS.map((label, index) => (
                <View key={`${label}-${index}`} className="flex-1 items-center">
                  <AppText variant="meta" tone="muted" className="text-xs">{label}</AppText>
                </View>
              ))}
            </View>
          </View>
        }
        renderItem={({ item: week, index }) => {
          const selectedIsInWeek = week.days.some((day) => day.date === effectiveSelectedDate);
          return (
            <View>
              {week.startsNewMonth ? (
                <View className="pb-1 pt-3">
                  <AppText variant="heading">{formatCalendarDate(`${week.visualMonth}-01`, 'MMMM yyyy')}</AppText>
                </View>
              ) : null}
              <View className="flex-row">
                {week.days.map((day) => {
                  const dayEntries = entriesByDate.get(day.date) ?? [];
                  const selected = day.date === effectiveSelectedDate;
                  const isToday = day.date === today;
                  const scheduledCount = dayEntries.filter((entry) => entry.kind === 'scheduled').length;
                  const possibleCount = dayEntries.length - scheduledCount;
                  return (
                    <Pressable
                      key={day.date}
                      testID={`calendar-day-${day.date}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${formatCalendarDate(day.date, 'EEEE, d MMMM')}, ${scheduledCount} scheduled, ${possibleCount} possible`}
                      onPress={() => setSelectedDate(day.date)}
                      className="min-h-[62px] flex-1 items-center justify-start py-2 active:opacity-70"
                      style={{
                        backgroundColor: selected ? colors.paperDeep : 'transparent',
                        borderRadius: radii.medium,
                      }}>
                      <View
                        className="h-8 w-8 items-center justify-center rounded-full"
                        style={{ backgroundColor: isToday ? colors.ink : 'transparent' }}>
                        <AppText
                          variant="label"
                          tone={isToday ? 'inverse' : day.inVisualMonth ? 'default' : 'muted'}>
                          {Number(day.date.slice(-2))}
                        </AppText>
                      </View>
                      <View className="mt-1 h-2 flex-row items-center justify-center gap-1">
                        {scheduledCount > 0 ? <DayMarker kind="scheduled" /> : null}
                        {possibleCount > 0 ? <DayMarker kind="possible" /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {selectedIsInWeek ? renderSelectedDay(effectiveSelectedDate) : null}
              {index === upcomingInsertionIndex ? renderUpcoming() : null}
            </View>
          );
        }}
      />

      <Modal
        visible={Boolean(detailSchedule)}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailSchedule(null)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(40,38,33,0.34)' }}>
          <Pressable
            testID="schedule-detail-backdrop"
            accessibilityRole="button"
            accessibilityLabel="Close scheduled plan"
            onPress={() => setDetailSchedule(null)}
            className="flex-1"
          />
          {detailSchedule ? (
            <View
              testID="schedule-detail-sheet"
              className="px-5 pb-7 pt-4"
              style={{ backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
              <View className="flex-row items-start justify-between">
                <View className="min-w-0 flex-1 pr-4">
                  <AppText variant="label" style={{ color: colors.ochre }}>SCHEDULED</AppText>
                  <AppText variant="title" className="mt-1">{detailSchedule.idea.title}</AppText>
                  <View className="mt-3 flex-row items-center">
                    <CalendarDays color={colors.inkMuted} size={17} />
                    <AppText variant="body" tone="soft" className="ml-2">
                      {formatCalendarDate(detailSchedule.scheduledDate, 'EEEE, d MMMM')}
                    </AppText>
                  </View>
                  {detailSchedule.startLocalTime ? (
                    <View className="mt-2 flex-row items-center">
                      <Clock3 color={colors.inkMuted} size={17} />
                      <AppText variant="body" tone="soft" className="ml-2">
                        {formatTime(detailSchedule.startLocalTime)}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <Pressable
                  testID="schedule-detail-close"
                  accessibilityRole="button"
                  accessibilityLabel="Close scheduled plan"
                  onPress={() => setDetailSchedule(null)}
                  className="h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: colors.surface }}>
                  <X color={colors.ink} size={20} />
                </Pressable>
              </View>

              <View className="mt-6 flex-row gap-3">
                <View className="flex-1">
                  <SecondaryButton
                    testID="schedule-open-idea"
                    label="Open idea"
                    icon={<ArrowUpRight color={colors.ink} size={18} />}
                    onPress={() => {
                      const schedule = detailSchedule;
                      setDetailSchedule(null);
                      router.push({
                        pathname: '/idea/[id]',
                        params: { id: schedule.ideaId, contextTimeZone: schedule.timeZone },
                      });
                    }}
                  />
                </View>
                <View className="flex-1">
                  <SecondaryButton
                    testID="schedule-reschedule"
                    label="Reschedule"
                    icon={<Move color={colors.ink} size={18} />}
                    onPress={() => {
                      setReschedule(detailSchedule);
                      setDetailSchedule(null);
                    }}
                  />
                </View>
              </View>

              {scheduleCanBeDated(detailSchedule) ? (
                <View className="mt-4">
                  {dated.isError ? (
                    <AppText testID="dated-error" variant="meta" tone="danger" className="mb-3">
                      This plan could not be marked Dated. Please try again.
                    </AppText>
                  ) : null}
                  <PrimaryButton
                    testID="dated-button"
                    label="Dated"
                    loading={dated.isPending}
                    onPress={() => dated.mutate(detailSchedule)}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>

      {reschedule ? (
        <SchedulingSheet
          visible
          ideaId={reschedule.ideaId}
          scheduleId={reschedule.id}
          timeZone={reschedule.timeZone}
          initialDate={reschedule.scheduledDate}
          initialTime={reschedule.startLocalTime}
          initialEndTime={reschedule.endLocalTime}
          occurrenceId={reschedule.occurrenceId}
          occurrences={availableRescheduleOccurrences}
          onClose={() => setReschedule(null)}
          onScheduled={() => setReschedule(null)}
        />
      ) : null}
    </Screen>
  );
}
