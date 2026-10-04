import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export type CalendarDate = string & { readonly __calendarDate: unique symbol };

export function isCalendarDate(value: string): value is CalendarDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
}

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export function isLocalTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Expected a real calendar date in YYYY-MM-DD format")
  .transform((value) => value as CalendarDate);

export const ianaTimeZoneSchema = z
  .string()
  .refine(isIanaTimeZone, "Expected a valid IANA timezone");

export const localTimeSchema = z
  .string()
  .refine(isLocalTime, "Expected local wall-clock time in HH:mm format");

export function localTimeToMinute(value: string): number {
  if (!isLocalTime(value)) throw new Error("Invalid local wall-clock time");
  const [hour, minute] = value.split(":").map(Number) as [number, number];
  return hour * 60 + minute;
}

export function minuteToLocalTime(value: number | null): string | null {
  if (value === null) return null;
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function zonedDateTime(localDate: CalendarDate, minute: number, timeZone: string) {
  const date = Temporal.PlainDate.from(localDate);
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;

  return Temporal.ZonedDateTime.from(
    {
      timeZone,
      year: date.year,
      month: date.month,
      day: date.day,
      hour,
      minute: minuteOfHour,
    },
    { disambiguation: "reject" },
  );
}

export interface TimedProjection {
  startMinute: number | null;
  endMinute: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export function projectLocalTimes(input: {
  localDate: CalendarDate;
  startLocalTime?: string | null;
  endLocalTime?: string | null;
  timeZone?: string | null;
}): TimedProjection {
  const hasStart = input.startLocalTime != null;
  const hasEnd = input.endLocalTime != null;

  if (!hasStart && !hasEnd) {
    return { startMinute: null, endMinute: null, startsAt: null, endsAt: null };
  }
  if (!hasStart) throw new Error("An end time requires a start time");
  if (!input.timeZone || !isIanaTimeZone(input.timeZone)) {
    throw new Error("A valid IANA timezone is required when a local time is present");
  }

  const startMinute = localTimeToMinute(input.startLocalTime!);
  const endMinute = hasEnd ? localTimeToMinute(input.endLocalTime!) : null;
  if (endMinute !== null && endMinute <= startMinute) {
    throw new Error("End time must be later than start time on the same local date");
  }

  const startsAt = new Date(
    zonedDateTime(input.localDate, startMinute, input.timeZone).epochMilliseconds,
  );
  const endsAt =
    endMinute === null
      ? null
      : new Date(zonedDateTime(input.localDate, endMinute, input.timeZone).epochMilliseconds);

  return { startMinute, endMinute, startsAt, endsAt };
}

export function scheduleCleanupDueAt(input: {
  scheduledDate: CalendarDate;
  endMinute: number | null;
  timeZone: string;
}): Date {
  const base =
    input.endMinute === null
      ? Temporal.PlainDate.from(input.scheduledDate)
          .add({ days: 1 })
          .toZonedDateTime({ timeZone: input.timeZone, plainTime: "00:00" })
      : zonedDateTime(input.scheduledDate, input.endMinute, input.timeZone);

  return new Date(base.add({ hours: 48 }).epochMilliseconds);
}

export function calendarDateInTimeZone(
  instant: Date,
  timeZone: string,
): CalendarDate {
  if (!isIanaTimeZone(timeZone)) throw new Error("Expected a valid IANA timezone");
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString() as CalendarDate;
}

export function assertOrderedDateRange(startDate: CalendarDate, endDate: CalendarDate): void {
  if (startDate > endDate) throw new Error("Start date must not be after end date");
}
