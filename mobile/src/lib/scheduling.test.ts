// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';
import type { SpecificOccurrence } from './api/duodate';
import {
  clearScheduleTime,
  occurrenceTimeZoneForScheduleSelection,
  occurrencesForDate,
  resolveSchedulingTimeZone,
  scheduleTimesForOccurrence,
  scheduleTimeValue,
  selectExactScheduleTime,
  toggleSchedulePeriod,
} from './scheduling';

function occurrence(id: string, localDate: string, startLocalTime: string | null): SpecificOccurrence {
  return {
    id,
    ideaId: 'idea-1',
    localDate,
    startMinute: null,
    endMinute: null,
    startLocalTime,
    endLocalTime: null,
    timeZone: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
}

describe('schedule time choices', () => {
  test('keeps day periods and exact time mutually exclusive', () => {
    const exact = selectExactScheduleTime('19:30');
    expect(exact).toEqual({ period: null, exactTime: '19:30' });

    const evening = toggleSchedulePeriod(exact, 'EVENING');
    expect(evening).toEqual({ period: 'EVENING', exactTime: null });
    expect(scheduleTimeValue(evening)).toBe('18:00');
  });

  test('allows the selected period or exact time to be removed', () => {
    const morning = toggleSchedulePeriod({ period: null, exactTime: null }, 'MORNING');
    expect(toggleSchedulePeriod(morning, 'MORNING')).toEqual({ period: null, exactTime: null });
    expect(scheduleTimeValue(clearScheduleTime())).toBeNull();
  });

  test('does not carry an old end time into a newly selected date-only occurrence', () => {
    const selected = occurrence('date-only', '2026-10-04', null);

    expect(scheduleTimesForOccurrence(selected, '18:00', '20:00')).toEqual({
      startLocalTime: null,
      endLocalTime: null,
    });
    expect(scheduleTimesForOccurrence(null, '18:00', '20:00')).toEqual({
      startLocalTime: '18:00',
      endLocalTime: '20:00',
    });
  });

  test('preserves an existing schedule timezone when only its calendar date moves', () => {
    expect(resolveSchedulingTimeZone({
      existingScheduleTimeZone: 'Pacific/Honolulu',
      destinationTimeZone: 'Europe/Lisbon',
      spaceTimeZone: 'Europe/Berlin',
      householdTimeZone: 'Europe/Berlin',
    })).toBe('Pacific/Honolulu');
  });

  test('changes timezone only when a different occurrence is selected while rescheduling', () => {
    const initial = { ...occurrence('initial', '2026-10-04', '18:00'), timeZone: 'Pacific/Honolulu' };
    const replacement = { ...occurrence('replacement', '2026-10-05', '18:00'), timeZone: 'America/Bahia' };

    expect(occurrenceTimeZoneForScheduleSelection(initial, initial.id, true)).toBeNull();
    expect(occurrenceTimeZoneForScheduleSelection(replacement, initial.id, true)).toBe('America/Bahia');
    expect(occurrenceTimeZoneForScheduleSelection(initial, initial.id, false)).toBe('Pacific/Honolulu');
  });

  test('uses a genuinely selected occurrence or explicit trip context timezone', () => {
    expect(resolveSchedulingTimeZone({
      occurrenceTimeZone: 'America/Bahia',
      contextTimeZone: 'Europe/Lisbon',
      existingScheduleTimeZone: 'Pacific/Honolulu',
      householdTimeZone: 'Europe/Berlin',
    })).toBe('America/Bahia');
    expect(resolveSchedulingTimeZone({
      contextTimeZone: 'Europe/Lisbon',
      existingScheduleTimeZone: 'Pacific/Honolulu',
      householdTimeZone: 'Europe/Berlin',
    })).toBe('Europe/Lisbon');
  });

  test('uses destination and household zones only when no more specific zone exists', () => {
    expect(resolveSchedulingTimeZone({
      destinationTimeZone: 'America/Bahia',
      householdTimeZone: 'Europe/Berlin',
    })).toBe('America/Bahia');
    expect(resolveSchedulingTimeZone({
      destinationTimeZone: 'Not/AZone',
      householdTimeZone: 'Europe/Berlin',
    })).toBe('Europe/Berlin');
  });

  test('keeps every saved slot on a selected date in time order', () => {
    const slots = [
      occurrence('late', '2026-10-04', '20:00'),
      occurrence('other-day', '2026-10-05', '09:00'),
      occurrence('date-only', '2026-10-04', null),
      occurrence('early', '2026-10-04', '10:00'),
    ];

    expect(occurrencesForDate(slots, '2026-10-04').map(({ id }) => id)).toEqual([
      'early',
      'late',
      'date-only',
    ]);
  });
});
