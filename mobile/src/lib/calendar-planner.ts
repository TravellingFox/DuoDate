import type { Idea, Schedule, SpecificOccurrence } from '@/lib/api/duodate';
import { addCalendarDays, calendarDateInTimeZone } from '@/lib/format';

export type CalendarPlannerEntry =
  | { kind: 'scheduled'; date: string; schedule: Schedule }
  | {
      kind: 'possible';
      date: string;
      idea: Idea;
      occurrence: SpecificOccurrence;
      occurrenceIndex: number;
      occurrenceCount: number;
    };

export interface PlannerDay {
  date: string;
  inVisualMonth: boolean;
}

export interface PlannerWeek {
  key: string;
  visualMonth: string;
  startsNewMonth: boolean;
  days: PlannerDay[];
}

function startOfMondayWeek(calendarDate: string) {
  const [year, month, day] = calendarDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addCalendarDays(calendarDate, -daysSinceMonday);
}

const recurrenceWeekdays = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

function weekdayAndOrdinal(calendarDate: string) {
  const [year, month, day] = calendarDate.split('-').map(Number);
  return {
    weekday: recurrenceWeekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
    ordinal: Math.ceil(day / 7),
  };
}

export function recurrenceDates(idea: Idea, today: string, horizonDays = 182) {
  if (idea.recurrence.kind === 'NONE') return [];
  const availabilityStart = idea.availability?.mode === 'DATE_RANGE'
    ? idea.availability.rangeStartDate
    : null;
  const availabilityEnd = idea.availability?.mode === 'DATE_RANGE'
    ? idea.availability.rangeEndDate
    : null;
  const firstDate = [today, idea.recurrence.startDate, availabilityStart]
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)!;
  const horizon = addCalendarDays(today, horizonDays);
  const lastDate = [horizon, idea.recurrence.endDate, availabilityEnd]
    .filter((date): date is string => Boolean(date))
    .sort()[0]!;
  const dates: string[] = [];

  for (let date = firstDate; date <= lastDate; date = addCalendarDays(date, 1)) {
    const { weekday, ordinal } = weekdayAndOrdinal(date);
    if (
      (idea.recurrence.kind === 'WEEKLY' && idea.recurrence.weekdays.includes(weekday)) ||
      (idea.recurrence.kind === 'MONTHLY_ORDINAL_WEEKDAY' &&
        idea.recurrence.weekday === weekday &&
        idea.recurrence.ordinal === ordinal)
    ) {
      dates.push(date);
    }
  }

  return dates;
}

export function normalizeCalendarTargetDate(
  value: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const match = candidate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);

  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? candidate ?? null
    : null;
}

export function buildRollingWeeks(today: string, weekCount = 26): PlannerWeek[] {
  const firstMonday = startOfMondayWeek(today);
  let previousVisualMonth: string | null = null;

  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = addCalendarDays(firstMonday, weekIndex * 7);
    const dates = Array.from({ length: 7 }, (_unused, dayIndex) =>
      addCalendarDays(weekStart, dayIndex),
    );
    const visualMonth = dates[3]?.slice(0, 7) ?? weekStart.slice(0, 7);
    const startsNewMonth = visualMonth !== previousVisualMonth;
    previousVisualMonth = visualMonth;

    return {
      key: weekStart,
      visualMonth,
      startsNewMonth,
      days: dates.map((date) => ({
        date,
        inVisualMonth: date.slice(0, 7) === visualMonth,
      })),
    };
  });
}

export function calendarWeekIndexForDate(weeks: PlannerWeek[], targetDate: string): number {
  return weeks.findIndex((week) => week.days.some((day) => day.date === targetDate));
}

export function buildRollingWeeksForTarget(
  today: string,
  targetDate: string | null,
  minimumWeekCount = 26,
): PlannerWeek[] {
  if (!targetDate) return buildRollingWeeks(today, minimumWeekCount);

  const currentWeekStart = startOfMondayWeek(today);
  const targetWeekStart = startOfMondayWeek(targetDate);
  const firstDate = targetWeekStart < currentWeekStart ? targetDate : today;
  const firstWeekStart = startOfMondayWeek(firstDate);
  const [firstYear, firstMonth, firstDay] = firstWeekStart.split('-').map(Number);
  const [targetYear, targetMonth, targetDay] = targetWeekStart.split('-').map(Number);
  const targetWeekIndex = Math.round((
    Date.UTC(targetYear, targetMonth - 1, targetDay)
    - Date.UTC(firstYear, firstMonth - 1, firstDay)
  ) / (7 * 24 * 60 * 60 * 1000));

  return buildRollingWeeks(firstDate, Math.max(minimumWeekCount, targetWeekIndex + 1));
}

export function calendarUpcomingInsertionIndex(
  weeks: PlannerWeek[],
  minimumWeekCount = 4,
  maximumWeekCount = 6,
) {
  if (weeks.length === 0) return -1;
  const firstMonth = weeks[0]?.visualMonth;
  const firstMonthWeekCount = weeks.findIndex((week) => week.visualMonth !== firstMonth);
  const monthBlockSize = firstMonthWeekCount === -1 ? weeks.length : firstMonthWeekCount;
  const blockSize = Math.min(
    weeks.length,
    maximumWeekCount,
    Math.max(minimumWeekCount, monthBlockSize),
  );
  return blockSize - 1;
}

export function schedulesForIdeas(
  schedules: Schedule[],
  ideas: Idea[],
  scoped: boolean,
) {
  if (!scoped) return schedules;
  const scopedIdeaIds = new Set(ideas.map((idea) => idea.id));
  return schedules.filter((schedule) => scopedIdeaIds.has(schedule.ideaId));
}

export function buildCalendarEntries(
  schedules: Schedule[],
  ideas: Idea[],
  today: string,
): Map<string, CalendarPlannerEntry[]> {
  const entries = new Map<string, CalendarPlannerEntry[]>();
  const activeSchedules = schedules.filter((schedule) => schedule.status === 'SCHEDULED');
  const scheduledIdeaIds = new Set(activeSchedules.map((schedule) => schedule.ideaId));
  const scheduledDatesByIdea = new Map<string, Set<string>>();
  for (const schedule of activeSchedules) {
    const dates = scheduledDatesByIdea.get(schedule.ideaId) ?? new Set<string>();
    dates.add(schedule.scheduledDate);
    scheduledDatesByIdea.set(schedule.ideaId, dates);
  }

  const addEntry = (date: string, entry: CalendarPlannerEntry) => {
    const current = entries.get(date) ?? [];
    current.push(entry);
    entries.set(date, current);
  };

  for (const schedule of activeSchedules) {
    addEntry(schedule.scheduledDate, { kind: 'scheduled', date: schedule.scheduledDate, schedule });
  }

  for (const idea of ideas) {
    if (idea.lifecycle !== 'ACTIVE') continue;

    const hasRecurrence = idea.recurrence.kind !== 'NONE';
    const explicitOccurrences =
      (hasRecurrence || idea.availability?.mode === 'SPECIFIC_OCCURRENCES')
      && !scheduledIdeaIds.has(idea.id)
        ? idea.occurrences
        : [];
    const scheduledDates = scheduledDatesByIdea.get(idea.id) ?? new Set<string>();
    const recurringOccurrences: SpecificOccurrence[] = hasRecurrence && !scheduledIdeaIds.has(idea.id)
      ? recurrenceDates(idea, today)
          .filter((date) => !scheduledDates.has(date))
          .map((date) => ({
            id: `recurrence:${idea.id}:${date}`,
            ideaId: idea.id,
            localDate: date,
            startMinute: null,
            endMinute: null,
            startLocalTime: null,
            endLocalTime: null,
            timeZone: null,
            createdAt: idea.createdAt,
            updatedAt: idea.updatedAt,
          }))
      : [];

    const occurrences = [...explicitOccurrences, ...recurringOccurrences]
      .filter((occurrence, index, all) =>
        occurrence.localDate >= today &&
        all.findIndex((candidate) =>
          candidate.localDate === occurrence.localDate &&
          candidate.startLocalTime === occurrence.startLocalTime
        ) === index
      )
      .sort(
        (left, right) =>
          left.localDate.localeCompare(right.localDate) ||
          (left.startLocalTime ?? '').localeCompare(right.startLocalTime ?? '') ||
          left.id.localeCompare(right.id),
      );

    occurrences.forEach((occurrence, occurrenceIndex) => {
      addEntry(occurrence.localDate, {
        kind: 'possible',
        date: occurrence.localDate,
        idea,
        occurrence,
        occurrenceIndex: occurrenceIndex + 1,
        occurrenceCount: occurrences.length,
      });
    });
  }

  for (const [date, dayEntries] of entries) {
    entries.set(date, dayEntries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'scheduled' ? -1 : 1;
      const leftTime = left.kind === 'scheduled'
        ? left.schedule.startLocalTime
        : left.occurrence.startLocalTime;
      const rightTime = right.kind === 'scheduled'
        ? right.schedule.startLocalTime
        : right.occurrence.startLocalTime;
      const timeOrder = (leftTime ?? '99:99').localeCompare(rightTime ?? '99:99');
      if (timeOrder !== 0) return timeOrder;
      const leftTitle = left.kind === 'scheduled' ? left.schedule.idea.title : left.idea.title;
      const rightTitle = right.kind === 'scheduled' ? right.schedule.idea.title : right.idea.title;
      return leftTitle.localeCompare(rightTitle);
    }));
  }

  return entries;
}

export function scheduleCanBeDated(schedule: Schedule, now = new Date()) {
  if (schedule.status !== 'SCHEDULED') return false;
  if (schedule.startsAt) return schedule.startsAt <= now.toISOString();
  return schedule.scheduledDate <= calendarDateInTimeZone(now, schedule.timeZone);
}

export function upcomingSchedules(schedules: Schedule[], today: string) {
  return schedules
    .filter((schedule) => schedule.status === 'SCHEDULED' && schedule.scheduledDate >= today)
    .sort((left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate) ||
      (left.startLocalTime ?? '99:99').localeCompare(right.startLocalTime ?? '99:99') ||
      left.id.localeCompare(right.id),
    );
}
