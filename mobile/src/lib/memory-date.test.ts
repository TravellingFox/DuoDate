// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';
import { calendarDateInTimeZone, dateForZonedWallTime } from './format';
import {
  initialMemoryDate,
  memoryDateFallbackTimeZone,
  memoryDateTimeZone,
} from './memory-date';

describe('Memory date semantics', () => {
  test('uses the selected planning context timezone at a date boundary', () => {
    const instant = new Date('2026-09-14T00:30:00.000Z');

    expect(initialMemoryDate('Pacific/Honolulu', instant)).toBe('2026-09-13');
    expect(initialMemoryDate('Europe/Berlin', instant)).toBe('2026-09-14');
  });

  test('round-trips a date-only picker value in the relevant timezone', () => {
    const calendarDate = '2026-09-13';

    for (const timeZone of ['Pacific/Honolulu', 'Pacific/Kiritimati']) {
      const pickerValue = dateForZonedWallTime(calendarDate, '12:00', timeZone);
      expect(calendarDateInTimeZone(pickerValue, timeZone)).toBe(calendarDate);
    }
  });

  test('uses Europe/Berlin only when the context timezone is unavailable or invalid', () => {
    expect(memoryDateTimeZone(null)).toBe(memoryDateFallbackTimeZone);
    expect(memoryDateTimeZone('Not/AZone')).toBe(memoryDateFallbackTimeZone);
    expect(memoryDateTimeZone('America/Bahia')).toBe('America/Bahia');
  });
});
