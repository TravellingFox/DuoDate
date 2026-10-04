import type { SpecificOccurrence } from './api/duodate';
import { validTimeZone } from './format';

export type DayPeriod = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export const dayPeriods: { value: DayPeriod; label: string; time: string }[] = [
  { value: 'MORNING', label: 'Morning', time: '09:00' },
  { value: 'AFTERNOON', label: 'Afternoon', time: '14:00' },
  { value: 'EVENING', label: 'Evening', time: '18:00' },
  { value: 'NIGHT', label: 'Night', time: '21:00' },
];

export interface ScheduleTimeSelection {
  period: DayPeriod | null;
  exactTime: string | null;
}

export function toggleSchedulePeriod(
  selection: ScheduleTimeSelection,
  nextPeriod: DayPeriod,
): ScheduleTimeSelection {
  return selection.period === nextPeriod
    ? { period: null, exactTime: null }
    : { period: nextPeriod, exactTime: null };
}

export function selectExactScheduleTime(exactTime: string): ScheduleTimeSelection {
  return { period: null, exactTime };
}

export function clearScheduleTime(): ScheduleTimeSelection {
  return { period: null, exactTime: null };
}

export function scheduleTimeValue(selection: ScheduleTimeSelection): string | null {
  return dayPeriods.find((option) => option.value === selection.period)?.time
    ?? selection.exactTime;
}

export function scheduleTimesForOccurrence(
  occurrence: SpecificOccurrence | null,
  initialTime: string | null,
  initialEndTime: string | null,
): { startLocalTime: string | null; endLocalTime: string | null } {
  return occurrence
    ? {
        startLocalTime: occurrence.startLocalTime,
        endLocalTime: occurrence.endLocalTime,
      }
    : {
        startLocalTime: initialTime,
        endLocalTime: initialEndTime,
      };
}

export function occurrenceTimeZoneForScheduleSelection(
  occurrence: SpecificOccurrence | null,
  initialOccurrenceId: string | null,
  isRescheduling: boolean,
): string | null {
  if (!occurrence) return null;
  if (isRescheduling && occurrence.id === initialOccurrenceId) return null;
  return occurrence.timeZone;
}

export function resolveSchedulingTimeZone({
  occurrenceTimeZone,
  contextTimeZone,
  existingScheduleTimeZone,
  destinationTimeZone,
  spaceTimeZone,
  householdTimeZone,
}: {
  occurrenceTimeZone?: string | null;
  contextTimeZone?: string | null;
  existingScheduleTimeZone?: string | null;
  destinationTimeZone?: string | null;
  spaceTimeZone?: string | null;
  householdTimeZone: string;
}): string {
  return validTimeZone(occurrenceTimeZone)
    ?? validTimeZone(contextTimeZone)
    ?? validTimeZone(existingScheduleTimeZone)
    ?? validTimeZone(destinationTimeZone)
    ?? validTimeZone(spaceTimeZone)
    ?? validTimeZone(householdTimeZone)
    ?? 'Europe/Berlin';
}

export function occurrencesForDate(
  occurrences: SpecificOccurrence[],
  date: string,
): SpecificOccurrence[] {
  return occurrences
    .filter((occurrence) => occurrence.localDate === date)
    .sort(
      (left, right) =>
        (left.startLocalTime ?? '99:99').localeCompare(right.startLocalTime ?? '99:99')
        || left.id.localeCompare(right.id),
    );
}
