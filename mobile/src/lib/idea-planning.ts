import type { Availability, IdeaRecurrence, SpecificOccurrence } from './api/duodate';
import { formatCalendarDate } from './format';

const weekdayNames = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
} as const;

const ordinalNames = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];

export interface IdeaPlanningSummary {
  primary: string;
  specificDateLabel: string | null;
}

export function recurrenceSummary(recurrence: IdeaRecurrence): string | null {
  if (recurrence.kind === 'NONE') return null;
  const start = recurrence.endDate
    ? `from ${formatCalendarDate(recurrence.startDate)} until ${formatCalendarDate(recurrence.endDate)}`
    : `from ${formatCalendarDate(recurrence.startDate)}`;
  if (recurrence.kind === 'WEEKLY') {
    return `Weekly on ${recurrence.weekdays.map((weekday) => weekdayNames[weekday]).join(', ')}, ${start}`;
  }
  return `${ordinalNames[recurrence.ordinal - 1] ?? recurrence.ordinal} ${weekdayNames[recurrence.weekday]} each month, ${start}`;
}

export function ideaPlanningSummary(
  availability: Availability | null,
  recurrence: IdeaRecurrence,
  occurrences: SpecificOccurrence[],
): IdeaPlanningSummary {
  const repeating = recurrenceSummary(recurrence);
  const range = availability?.mode === 'DATE_RANGE'
    && availability.rangeStartDate
    && availability.rangeEndDate
    ? `${formatCalendarDate(availability.rangeStartDate)} – ${formatCalendarDate(availability.rangeEndDate)}`
    : null;
  const hasSpecificDates = occurrences.length > 0;

  if (repeating) {
    return {
      primary: range ? `${repeating} · within ${range}` : repeating,
      specificDateLabel: hasSpecificDates ? 'Also available' : null,
    };
  }

  if (range) return { primary: range, specificDateLabel: null };
  if (availability?.mode === 'SPECIFIC_OCCURRENCES') {
    return {
      primary: hasSpecificDates ? 'On these dates' : 'No dates added yet',
      specificDateLabel: null,
    };
  }
  return { primary: 'Any day', specificDateLabel: null };
}
