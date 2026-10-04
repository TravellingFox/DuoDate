import { format, isValid, parseISO } from 'date-fns';
import type { CostBand, DurationBand, WeatherState } from '@/lib/api/duodate';

export function todayCalendarDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function zonedDateTimeParts(value: Date, timeZone: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);

  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

export function calendarDateInTimeZone(date: Date, timeZone: string) {
  const { year, month, day } = zonedDateTimeParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function localTimeInTimeZone(date: Date, timeZone: string) {
  const { hour, minute } = zonedDateTimeParts(date, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function validTimeZone(value: string | undefined | null) {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

export function addCalendarDays(value: string, amount: number) {
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + amount));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
}

export function dateForZonedWallTime(calendarDate: string, localTime: string, timeZone: string) {
  const [year, month, day] = calendarDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  const targetTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  let result = new Date(targetTimestamp);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = zonedDateTimeParts(result, timeZone);
    const actualTimestamp = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    result = new Date(result.getTime() + targetTimestamp - actualTimestamp);
  }

  return result;
}

export function parseCalendarDate(value: string) {
  return parseISO(`${value}T12:00:00`);
}

export function formatCalendarDate(value: string, pattern = 'EEE, d MMM') {
  const date = parseCalendarDate(value);
  return isValid(date) ? format(date, pattern) : value;
}

export const costLabels: Record<CostBand, string> = {
  FREE: 'Free',
  UNDER_20: 'Low',
  FROM_20_TO_50: 'Medium',
  FROM_50_TO_100: 'High',
  FROM_100: 'Splurge',
};

export const durationLabels: Record<DurationBand, string> = {
  UNDER_ONE_HOUR: 'Under 1h',
  ONE_TO_TWO_HOURS: '1–2h',
  TWO_TO_FOUR_HOURS: '2–4h',
  HALF_DAY: 'Half day',
  FULL_DAY: 'Full day',
  OVERNIGHT_OR_MULTI_DAY: 'Overnight',
};

export const weatherStateLabels: Record<WeatherState, string> = {
  NEUTRAL: 'Neutral',
  GOOD: 'Good',
  IMPOSSIBLE: 'Not possible',
};

export function formatTime(value: string | null) {
  if (!value) return null;
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return format(new Date(2020, 0, 1, hour, minute), 'HH:mm');
}

export function readableLinkLabel(url: string, explicit?: string | null) {
  if (explicit?.trim()) return explicit.trim();
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.length > 42 ? `${url.slice(0, 39)}…` : url;
  }
}
