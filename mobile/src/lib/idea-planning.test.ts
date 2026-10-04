// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';
import type { Availability, IdeaRecurrence, SpecificOccurrence } from './api/duodate';
import { ideaPlanningSummary, recurrenceSummary } from './idea-planning';

function occurrence(localDate: string): SpecificOccurrence {
  return {
    id: `occurrence-${localDate}`,
    ideaId: 'idea-1',
    localDate,
    startMinute: null,
    endMinute: null,
    startLocalTime: null,
    endLocalTime: null,
    timeZone: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
}

const anytime: Availability = {
  mode: 'ANYTIME',
  rangeStartDate: null,
  rangeEndDate: null,
};

const weekly: IdeaRecurrence = {
  kind: 'WEEKLY',
  startDate: '2026-09-15',
  endDate: null,
  weekdays: ['FRIDAY', 'SATURDAY'],
};

describe('idea planning summaries', () => {
  test('does not describe a recurring idea as available anytime', () => {
    const summary = ideaPlanningSummary(anytime, weekly, []);

    expect(summary.primary).toContain('Weekly on Friday, Saturday');
    expect(summary.primary).not.toContain('Any');
  });

  test('combines a recurrence with its limiting date range', () => {
    const summary = ideaPlanningSummary(
      {
        mode: 'DATE_RANGE',
        rangeStartDate: '2026-10-01',
        rangeEndDate: '2026-10-31',
      },
      weekly,
      [],
    );

    expect(summary.primary).toContain('Weekly on Friday, Saturday');
    expect(summary.primary).toContain('within');
    expect(summary.primary).toContain('1 Oct');
    expect(summary.primary).toContain('31 Oct');
  });

  test('shows when a finite recurrence ends', () => {
    const summary = recurrenceSummary({ ...weekly, endDate: '2026-10-31' });

    expect(summary).toContain('until');
    expect(summary).toContain('31 Oct');
  });

  test('frames explicit dates as additions to a repeating pattern', () => {
    const summary = ideaPlanningSummary(
      { mode: 'SPECIFIC_OCCURRENCES', rangeStartDate: null, rangeEndDate: null },
      weekly,
      [occurrence('2026-09-20'), occurrence('2026-09-27')],
    );

    expect(summary.specificDateLabel).toBe('Also available');
  });

  test('uses date-only wording for non-recurring specific slots', () => {
    const summary = ideaPlanningSummary(
      { mode: 'SPECIFIC_OCCURRENCES', rangeStartDate: null, rangeEndDate: null },
      { kind: 'NONE' },
      [occurrence('2026-09-20')],
    );

    expect(summary).toEqual({ primary: 'On these dates', specificDateLabel: null });
  });

  test('formats monthly recurrence without a competing availability state', () => {
    expect(recurrenceSummary({
      kind: 'MONTHLY_ORDINAL_WEEKDAY',
      startDate: '2026-09-15',
      endDate: null,
      ordinal: 2,
      weekday: 'SUNDAY',
    })).toContain('Second Sunday each month');
  });
});
