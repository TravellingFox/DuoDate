import { Temporal } from "@js-temporal/polyfill";
import type { Idea } from "@prisma/client";
import type {
  IdeaRecurrenceInput,
  RecurrenceWeekday,
} from "../types";
import type { CalendarDate } from "../lib/date-time";

const weekdays: readonly RecurrenceWeekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const weekdayBit = new Map(weekdays.map((weekday, index) => [weekday, 1 << index]));

type StoredRecurrence = Pick<
  Idea,
  | "recurrenceKind"
  | "recurrenceStartDate"
  | "recurrenceEndDate"
  | "recurrenceWeekdayMask"
  | "recurrenceOrdinal"
  | "recurrenceWeekday"
>;

function weekdayForDate(localDate: string): RecurrenceWeekday {
  return weekdays[Temporal.PlainDate.from(localDate).dayOfWeek - 1]!;
}

export function recurrenceFields(input: IdeaRecurrenceInput) {
  if (input.kind === "NONE") {
    return {
      recurrenceKind: "NONE" as const,
      recurrenceStartDate: null,
      recurrenceEndDate: null,
      recurrenceWeekdayMask: null,
      recurrenceOrdinal: null,
      recurrenceWeekday: null,
    };
  }

  if (input.kind === "WEEKLY") {
    return {
      recurrenceKind: input.kind,
      recurrenceStartDate: input.startDate,
      recurrenceEndDate: input.endDate ?? null,
      recurrenceWeekdayMask: input.weekdays.reduce(
        (mask, weekday) => mask | weekdayBit.get(weekday)!,
        0,
      ),
      recurrenceOrdinal: null,
      recurrenceWeekday: null,
    };
  }

  return {
    recurrenceKind: input.kind,
    recurrenceStartDate: input.startDate,
    recurrenceEndDate: input.endDate ?? null,
    recurrenceWeekdayMask: null,
    recurrenceOrdinal: input.ordinal,
    recurrenceWeekday: input.weekday,
  };
}

export function serializeRecurrence(recurrence: StoredRecurrence): IdeaRecurrenceInput {
  if (recurrence.recurrenceKind === "WEEKLY") {
    const mask = recurrence.recurrenceWeekdayMask ?? 0;
    return {
      kind: "WEEKLY",
      startDate: recurrence.recurrenceStartDate as CalendarDate,
      endDate: (recurrence.recurrenceEndDate as CalendarDate | null) ?? null,
      weekdays: weekdays.filter((weekday) => (mask & weekdayBit.get(weekday)!) !== 0),
    };
  }

  if (recurrence.recurrenceKind === "MONTHLY_ORDINAL_WEEKDAY") {
    return {
      kind: "MONTHLY_ORDINAL_WEEKDAY",
      startDate: recurrence.recurrenceStartDate as CalendarDate,
      endDate: (recurrence.recurrenceEndDate as CalendarDate | null) ?? null,
      ordinal: recurrence.recurrenceOrdinal!,
      weekday: recurrence.recurrenceWeekday as RecurrenceWeekday,
    };
  }

  return { kind: "NONE" };
}

export function recurrenceMatchesDate(
  recurrence: StoredRecurrence,
  localDate: CalendarDate,
): boolean {
  if (recurrence.recurrenceKind === "NONE" || !recurrence.recurrenceStartDate) return false;
  if (localDate < recurrence.recurrenceStartDate) return false;
  if (recurrence.recurrenceEndDate && localDate > recurrence.recurrenceEndDate) return false;

  const weekday = weekdayForDate(localDate);
  if (recurrence.recurrenceKind === "WEEKLY") {
    const bit = weekdayBit.get(weekday)!;
    return ((recurrence.recurrenceWeekdayMask ?? 0) & bit) !== 0;
  }

  if (
    recurrence.recurrenceKind === "MONTHLY_ORDINAL_WEEKDAY" &&
    recurrence.recurrenceWeekday &&
    recurrence.recurrenceOrdinal
  ) {
    const date = Temporal.PlainDate.from(localDate);
    return (
      weekday === recurrence.recurrenceWeekday &&
      Math.floor((date.day - 1) / 7) + 1 === recurrence.recurrenceOrdinal
    );
  }

  return false;
}

export function recurrenceHasMatchInRange(
  recurrence: StoredRecurrence,
  rangeStart: CalendarDate,
  rangeEnd: CalendarDate,
): boolean {
  if (recurrence.recurrenceKind === "NONE" || !recurrence.recurrenceStartDate) return false;

  const lower = (recurrence.recurrenceStartDate > rangeStart
    ? recurrence.recurrenceStartDate
    : rangeStart) as CalendarDate;
  const upper = (recurrence.recurrenceEndDate && recurrence.recurrenceEndDate < rangeEnd
    ? recurrence.recurrenceEndDate
    : rangeEnd) as CalendarDate;
  if (lower > upper) return false;

  if (recurrence.recurrenceKind === "WEEKLY") {
    let candidate = Temporal.PlainDate.from(lower);
    for (let offset = 0; offset < 7 && candidate.toString() <= upper; offset += 1) {
      if (recurrenceMatchesDate(recurrence, candidate.toString() as CalendarDate)) return true;
      candidate = candidate.add({ days: 1 });
    }
    return false;
  }

  if (!recurrence.recurrenceWeekday || !recurrence.recurrenceOrdinal) return false;
  const targetDayOfWeek = weekdays.indexOf(recurrence.recurrenceWeekday) + 1;
  let month = Temporal.PlainDate.from(lower).with({ day: 1 });
  for (let checked = 0; checked < 14 && month.toString() <= upper; checked += 1) {
    const offset = (targetDayOfWeek - month.dayOfWeek + 7) % 7;
    const candidate = month.add({ days: offset + 7 * (recurrence.recurrenceOrdinal - 1) });
    if (
      candidate.month === month.month &&
      candidate.year === month.year &&
      candidate.toString() >= lower &&
      candidate.toString() <= upper
    ) {
      return true;
    }
    month = month.add({ months: 1 });
  }
  return false;
}
