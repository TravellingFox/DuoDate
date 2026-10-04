import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, type DateData } from 'react-native-calendars';
import { Check, X } from 'lucide-react-native';
import { AppText, colors, PrimaryButton, radii } from '@/components/ui';
import { duodateApi, queryKeys, type SpecificOccurrence } from '@/lib/api/duodate';
import {
  calendarDateInTimeZone,
  dateForZonedWallTime,
  formatCalendarDate,
  formatTime,
  localTimeInTimeZone,
} from '@/lib/format';
import {
  clearScheduleTime,
  dayPeriods,
  occurrenceTimeZoneForScheduleSelection,
  occurrencesForDate,
  resolveSchedulingTimeZone,
  scheduleTimesForOccurrence,
  scheduleTimeValue,
  selectExactScheduleTime,
  toggleSchedulePeriod,
  type DayPeriod,
} from '@/lib/scheduling';

interface SchedulingSheetProps {
  visible: boolean;
  ideaId: string;
  timeZone: string;
  initialDate?: string;
  initialTime?: string | null;
  initialEndTime?: string | null;
  occurrenceId?: string | null;
  occurrences?: SpecificOccurrence[];
  scheduleId?: string;
  onClose: () => void;
  onScheduled: () => void;
}

function ChoiceButton({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="mb-2 mr-2 min-h-11 items-center justify-center border px-4 active:opacity-75"
      style={{
        backgroundColor: selected ? colors.ink : colors.surface,
        borderColor: selected ? colors.ink : colors.lineStrong,
        borderRadius: radii.pill,
      }}>
      <AppText variant="label" tone={selected ? 'inverse' : 'default'}>{label}</AppText>
    </Pressable>
  );
}

export function SchedulingSheet({
  visible,
  ideaId,
  timeZone,
  initialDate,
  initialTime = null,
  initialEndTime = null,
  occurrenceId,
  occurrences = [],
  scheduleId,
  onClose,
  onScheduled,
}: SchedulingSheetProps) {
  const queryClient = useQueryClient();
  const today = calendarDateInTimeZone(new Date(), timeZone);
  const safeInitialDate = initialDate && initialDate >= today ? initialDate : today;
  const safeInitialOccurrenceId = initialDate === safeInitialDate ? occurrenceId ?? null : null;
  const [date, setDate] = useState<string>(safeInitialDate);
  const [period, setPeriod] = useState<DayPeriod | null>(null);
  const [exactTime, setExactTime] = useState<string | null>(initialTime);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(safeInitialOccurrenceId);
  const [showTimePicker, setShowTimePicker] = useState<boolean>(false);
  const isRescheduling = Boolean(scheduleId);
  const scheduledTime = scheduleTimeValue({ period, exactTime });
  const selectedOccurrence = occurrences.find((item) => item.id === selectedOccurrenceId) ?? null;
  const effectiveTimeZone = resolveSchedulingTimeZone({
    occurrenceTimeZone: occurrenceTimeZoneForScheduleSelection(
      selectedOccurrence,
      safeInitialOccurrenceId,
      isRescheduling,
    ),
    existingScheduleTimeZone: timeZone,
    householdTimeZone: timeZone,
  });
  const dateOccurrences = useMemo(() => occurrencesForDate(occurrences, date), [date, occurrences]);
  const markedDates = useMemo(() => {
    const marks: Record<string, { marked?: boolean; dotColor?: string; selected?: boolean; selectedColor?: string }> = {};
    for (const occurrence of occurrences) {
      if (occurrence.localDate < today) continue;
      marks[occurrence.localDate] = { marked: true, dotColor: colors.rose };
    }
    marks[date] = {
      ...(marks[date] ?? {}),
      selected: true,
      selectedColor: colors.ink,
    };
    return marks;
  }, [date, occurrences, today]);

  useEffect(() => {
    if (visible) {
      const nextDate = initialDate && initialDate >= today ? initialDate : today;
      setDate(nextDate);
      setPeriod(null);
      setExactTime(initialTime);
      setSelectedOccurrenceId(initialDate === nextDate ? occurrenceId ?? null : null);
      setShowTimePicker(false);
    }
  }, [initialDate, initialTime, occurrenceId, today, visible]);

  const chooseOccurrence = (occurrence: SpecificOccurrence) => {
    setDate(occurrence.localDate);
    setSelectedOccurrenceId(occurrence.id);
    setPeriod(null);
    setExactTime(occurrence.startLocalTime);
    setShowTimePicker(false);
  };

  const chooseDate = (nextDate: string) => {
    setDate(nextDate);
    const matches = occurrencesForDate(occurrences, nextDate);
    if (matches.length === 1 && matches[0]) {
      chooseOccurrence(matches[0]);
      return;
    }
    setSelectedOccurrenceId(null);
  };

  const save = useMutation({
    mutationFn: () => {
      const occurrenceTimes = scheduleTimesForOccurrence(
        selectedOccurrence,
        initialTime,
        initialEndTime,
      );
      const keepExistingEnd = period === null && scheduledTime === occurrenceTimes.startLocalTime;
      const input = {
        occurrenceId: selectedOccurrenceId,
        scheduledDate: date,
        startLocalTime: scheduledTime,
        endLocalTime: keepExistingEnd ? occurrenceTimes.endLocalTime : null,
        timeZone: effectiveTimeZone,
      };
      if (scheduleId) return duodateApi.rescheduleSchedule(scheduleId, input);
      return duodateApi.createSchedule({ ideaId, ...input });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.schedules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.idea(ideaId) }),
        queryClient.invalidateQueries({ queryKey: ['ideas'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tripRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.letsDateRoot }),
      ]);
      onScheduled();
    },
  });

  const timePickerValue = dateForZonedWallTime(date, exactTime ?? '18:00', effectiveTimeZone);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(40,38,33,0.34)' }}>
        <Pressable
          testID="schedule-dismiss-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Close scheduling"
          onPress={onClose}
          className="flex-1"
        />
        <View
          testID="schedule-sheet"
          style={{
            maxHeight: '92%',
            backgroundColor: colors.paper,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
          }}>
          <View className="flex-row items-start justify-between px-5 pb-2 pt-4">
            <View className="flex-1 pr-4">
              <AppText variant="title">{isRescheduling ? 'Move this plan' : 'Choose a date'}</AppText>
            </View>
            <Pressable
              testID="schedule-close-button"
              accessibilityRole="button"
              accessibilityLabel="Close scheduling"
              onPress={onClose}
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.surface }}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          <ScrollView
            testID="schedule-sheet-scroll"
            showsVerticalScrollIndicator={false}
            contentContainerClassName="px-5 pb-7"
            keyboardShouldPersistTaps="handled">
            <View
              testID="schedule-month-calendar"
              className="mt-2 overflow-hidden border"
              style={{ backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.large }}>
              <Calendar
                current={date}
                minDate={today}
                markedDates={markedDates}
                onDayPress={(day: DateData) => chooseDate(day.dateString)}
                enableSwipeMonths
                hideExtraDays={false}
                firstDay={1}
                theme={{
                  calendarBackground: colors.surface,
                  backgroundColor: colors.surface,
                  textSectionTitleColor: colors.inkMuted,
                  dayTextColor: colors.ink,
                  monthTextColor: colors.ink,
                  textDisabledColor: colors.lineStrong,
                  arrowColor: colors.rose,
                  todayTextColor: colors.rose,
                  selectedDayBackgroundColor: colors.ink,
                  selectedDayTextColor: colors.surface,
                  textMonthFontWeight: '700',
                  textDayHeaderFontWeight: '600',
                }}
              />
            </View>

            <AppText testID="schedule-selected-date" variant="label" className="mt-3 text-center">
              {formatCalendarDate(date, 'EEEE, d MMMM yyyy')}
            </AppText>

            {dateOccurrences.length > 1 ? (
              <View testID="schedule-existing-slots" className="mt-5">
                <AppText variant="label">Saved options</AppText>
                <View className="mt-1 flex-row flex-wrap">
                  {dateOccurrences.map((occurrence) => (
                    <ChoiceButton
                      key={occurrence.id}
                      testID={`schedule-slot-${occurrence.id}`}
                      label={formatTime(occurrence.startLocalTime) ?? 'Date only'}
                      selected={selectedOccurrenceId === occurrence.id}
                      onPress={() => chooseOccurrence(occurrence)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <View className="mt-5">
              <View className="flex-row items-baseline">
                <AppText variant="label">Time</AppText>
                <AppText variant="meta" tone="muted" className="ml-2">Optional</AppText>
              </View>
              <View className="mt-1 flex-row flex-wrap">
                {dayPeriods.map((option) => (
                  <ChoiceButton
                    key={option.value}
                    testID={`schedule-period-${option.value.toLowerCase()}`}
                    label={option.label}
                    selected={period === option.value}
                    onPress={() => {
                      const selection = toggleSchedulePeriod({ period, exactTime }, option.value);
                      setPeriod(selection.period);
                      setExactTime(selection.exactTime);
                      setShowTimePicker(false);
                    }}
                  />
                ))}
                <ChoiceButton
                  testID="schedule-exact-time"
                  label={period === null && exactTime ? `Exact · ${formatTime(exactTime)}` : 'Exact time'}
                  selected={period === null && exactTime !== null}
                  onPress={() => {
                    setPeriod(null);
                    setShowTimePicker(true);
                  }}
                />
              </View>
              {scheduledTime ? (
                <Pressable
                  testID="schedule-clear-time"
                  accessibilityRole="button"
                  accessibilityLabel="Remove selected time"
                  onPress={() => {
                    const selection = clearScheduleTime();
                    setPeriod(selection.period);
                    setExactTime(selection.exactTime);
                    setShowTimePicker(false);
                  }}
                  className="min-h-11 self-start justify-center px-1 active:opacity-70">
                  <AppText variant="meta" tone="accent">Remove time</AppText>
                </Pressable>
              ) : null}
            </View>

            {showTimePicker ? (
              <View className="mt-2 border-t pt-2" style={{ borderColor: colors.line }}>
                <DateTimePicker
                  testID="schedule-time-picker"
                  value={timePickerValue}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  timeZoneName={effectiveTimeZone}
                  onChange={(event: DateTimePickerEvent, value?: Date) => {
                    if (Platform.OS === 'android') setShowTimePicker(false);
                    if (event.type !== 'set' || !value) return;
                    const selection = selectExactScheduleTime(localTimeInTimeZone(value, effectiveTimeZone));
                    setPeriod(selection.period);
                    setExactTime(selection.exactTime);
                  }}
                />
                {Platform.OS === 'ios' ? (
                  <Pressable
                    testID="schedule-time-picker-done"
                    accessibilityRole="button"
                    accessibilityLabel="Finish choosing a time"
                    onPress={() => setShowTimePicker(false)}
                    className="min-h-11 items-center justify-center">
                    <AppText variant="label" tone="accent">Done</AppText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {save.isError ? (
              <View
                testID="schedule-error"
                className="mb-3 mt-3 border px-4 py-3"
                style={{ backgroundColor: colors.dangerSoft, borderColor: colors.roseSoft, borderRadius: radii.medium }}>
                <AppText variant="meta" tone="danger">
                  This date could not be {isRescheduling ? 'moved' : 'scheduled'}. Please try again.
                </AppText>
              </View>
            ) : null}

            <PrimaryButton
              testID="confirm-schedule-button"
              label={isRescheduling ? 'Move this plan' : 'Schedule this idea'}
              loading={save.isPending}
              icon={<Check color={colors.surface} size={19} />}
              onPress={() => save.mutate()}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
