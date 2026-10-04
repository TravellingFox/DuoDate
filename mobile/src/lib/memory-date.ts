import { calendarDateInTimeZone, validTimeZone } from './format';

export const memoryDateFallbackTimeZone = 'Europe/Berlin';

export function memoryDateTimeZone(contextTimeZone: string | null | undefined): string {
  return validTimeZone(contextTimeZone) ?? memoryDateFallbackTimeZone;
}

export function initialMemoryDate(
  contextTimeZone: string | null | undefined,
  now = new Date(),
): string {
  return calendarDateInTimeZone(now, memoryDateTimeZone(contextTimeZone));
}
