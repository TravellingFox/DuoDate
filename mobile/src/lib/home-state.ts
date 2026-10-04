import { differenceInCalendarDays } from 'date-fns';
import type { Schedule } from './api/duodate';
import { calendarDateInTimeZone, parseCalendarDate } from './format';

export function nextScheduledDate(schedules: Schedule[], now: Date): Schedule | null {
  return schedules
    .filter(
      (schedule) =>
        schedule.status === 'SCHEDULED' &&
        schedule.scheduledDate >= calendarDateInTimeZone(now, schedule.timeZone),
    )
    .sort((left, right) => {
      const dateOrder = left.scheduledDate.localeCompare(right.scheduledDate);
      if (dateOrder !== 0) return dateOrder;
      return (left.startLocalTime ?? '99:99').localeCompare(right.startLocalTime ?? '99:99');
    })[0] ?? null;
}

export function daysUntilSchedule(schedule: Schedule, now: Date): number {
  const localToday = calendarDateInTimeZone(now, schedule.timeZone);
  return differenceInCalendarDays(
    parseCalendarDate(schedule.scheduledDate),
    parseCalendarDate(localToday),
  );
}
