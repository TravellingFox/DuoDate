import {
  buildCalendarEntries,
  buildRollingWeeks,
  buildRollingWeeksForTarget,
  calendarUpcomingInsertionIndex,
  calendarWeekIndexForDate,
  normalizeCalendarTargetDate,
  scheduleCanBeDated,
  schedulesForIdeas,
  upcomingSchedules,
} from './calendar-planner';
import type {
  AvailabilityMode,
  Idea,
  IdeaRecurrence,
  Schedule,
  SpecificOccurrence,
} from './api/duodate';
import { calendarDateInTimeZone } from './format';

function occurrence(id: string, ideaId: string, localDate: string): SpecificOccurrence {
  return {
    id,
    ideaId,
    localDate,
    startMinute: null,
    endMinute: null,
    startLocalTime: null,
    endLocalTime: null,
    timeZone: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function idea(input: {
  id: string;
  mode?: AvailabilityMode;
  occurrences?: SpecificOccurrence[];
  lifecycle?: Idea['lifecycle'];
  recurrence?: IdeaRecurrence;
}): Idea {
  return {
    id: input.id,
    householdId: 'household-1',
    createdById: 'user-1',
    categoryId: null,
    title: `Idea ${input.id}`,
    specificLocation: null,
    notes: null,
    lifecycle: input.lifecycle ?? 'ACTIVE',
    costBand: null,
    exactCostCents: null,
    costBasisAtEntry: null,
    costMinTotalCents: null,
    costMaxTotalCents: null,
    exactCostTotalCents: null,
    durationBand: null,
    durationRank: null,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    category: null,
    createdBy: { id: 'user-1', displayName: 'Pablo' },
    spaces: [],
    destinations: [],
    links: [],
    weatherSuitability: null,
    availability: {
      mode: input.mode ?? 'SPECIFIC_OCCURRENCES',
      rangeStartDate: input.mode === 'DATE_RANGE' ? '2026-09-01' : null,
      rangeEndDate: input.mode === 'DATE_RANGE' ? '2026-09-30' : null,
    },
    recurrence: input.recurrence ?? { kind: 'NONE' },
    image: null,
    occurrences: input.occurrences ?? [],
    schedules: [],
  };
}

function schedule(input: {
  id: string;
  ideaId: string;
  scheduledDate: string;
  status?: Schedule['status'];
}): Schedule {
  return {
    id: input.id,
    householdId: 'household-1',
    ideaId: input.ideaId,
    occurrenceId: null,
    createdById: 'user-1',
    scheduledDate: input.scheduledDate,
    startMinute: null,
    endMinute: null,
    startLocalTime: null,
    endLocalTime: null,
    timeZone: 'Europe/Berlin',
    startsAt: null,
    endsAt: null,
    cleanupDueAt: null,
    status: input.status ?? 'SCHEDULED',
    activeSlot: input.status && input.status !== 'SCHEDULED' ? null : input.ideaId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    idea: { id: input.ideaId, title: `Idea ${input.ideaId}` },
    occurrence: null,
  };
}

describe('calendar planner derivation', () => {
  test('keeps scheduled and possible activities as distinct states', () => {
    const possibleOccurrence = occurrence('occurrence-1', 'idea-possible', '2026-09-20');
    const entries = buildCalendarEntries(
      [schedule({ id: 'schedule-1', ideaId: 'idea-scheduled', scheduledDate: '2026-09-20' })],
      [idea({ id: 'idea-possible', occurrences: [possibleOccurrence] })],
      '2026-09-13',
    );

    expect(entries.get('2026-09-20')?.map((entry) => entry.kind)).toEqual(['scheduled', 'possible']);
  });

  test('does not expand date-range availability into daily calendar entries', () => {
    const entries = buildCalendarEntries(
      [],
      [idea({ id: 'idea-range', mode: 'DATE_RANGE' })],
      '2026-09-13',
    );

    expect(entries.size).toBe(0);
  });

  test('hides passed possibilities and all sibling dates once the idea is actively scheduled', () => {
    const occurrences = [
      occurrence('occurrence-past', 'idea-1', '2026-09-12'),
      occurrence('occurrence-future-1', 'idea-1', '2026-09-20'),
      occurrence('occurrence-future-2', 'idea-1', '2026-09-27'),
    ];
    const entries = buildCalendarEntries(
      [schedule({ id: 'schedule-1', ideaId: 'idea-1', scheduledDate: '2026-09-20' })],
      [idea({ id: 'idea-1', occurrences })],
      '2026-09-13',
    );

    expect(entries.has('2026-09-12')).toBe(false);
    expect(entries.get('2026-09-20')).toHaveLength(1);
    expect(entries.get('2026-09-20')?.[0]?.kind).toBe('scheduled');
    expect(entries.has('2026-09-27')).toBe(false);
  });

  test('ignores MISSED history while keeping future possible occurrences eligible for display', () => {
    const future = occurrence('occurrence-future', 'idea-1', '2026-09-20');
    const entries = buildCalendarEntries(
      [schedule({ id: 'schedule-missed', ideaId: 'idea-1', scheduledDate: '2026-09-10', status: 'MISSED' })],
      [idea({ id: 'idea-1', occurrences: [future] })],
      '2026-09-13',
    );

    expect(entries.has('2026-09-10')).toBe(false);
    expect(entries.get('2026-09-20')?.[0]?.kind).toBe('possible');
  });

  test('renumbers future possibilities after expired dates disappear', () => {
    const occurrences = [
      occurrence('occurrence-past', 'idea-1', '2026-09-12'),
      occurrence('occurrence-future-1', 'idea-1', '2026-09-20'),
      occurrence('occurrence-future-2', 'idea-1', '2026-09-27'),
    ];
    const entries = buildCalendarEntries([], [idea({ id: 'idea-1', occurrences })], '2026-09-13');

    const firstFuture = entries.get('2026-09-20')?.[0];
    const secondFuture = entries.get('2026-09-27')?.[0];
    expect(firstFuture?.kind === 'possible' ? [firstFuture.occurrenceIndex, firstFuture.occurrenceCount] : null).toEqual([1, 2]);
    expect(secondFuture?.kind === 'possible' ? [secondFuture.occurrenceIndex, secondFuture.occurrenceCount] : null).toEqual([2, 2]);
  });

  test('shows future weekly recurrence dates without turning a range into daily events', () => {
    const recurring = idea({
      id: 'idea-weekly',
      mode: 'ANYTIME',
      recurrence: {
        kind: 'WEEKLY',
        startDate: '2026-09-14',
        endDate: '2026-09-30',
        weekdays: ['MONDAY', 'SATURDAY'],
      },
    });
    const entries = buildCalendarEntries([], [recurring], '2026-09-14');

    expect([...entries.keys()]).toEqual([
      '2026-09-14',
      '2026-09-19',
      '2026-09-21',
      '2026-09-26',
      '2026-09-28',
    ]);
  });

  test('limits generated recurrence dates to the saved availability range', () => {
    const recurring = {
      ...idea({
        id: 'idea-weekly-range',
        mode: 'DATE_RANGE',
        recurrence: {
          kind: 'WEEKLY',
          startDate: '2026-09-01',
          endDate: '2026-10-31',
          weekdays: ['MONDAY'],
        },
      }),
      availability: {
        mode: 'DATE_RANGE' as const,
        rangeStartDate: '2026-09-20',
        rangeEndDate: '2026-09-25',
      },
    };

    const entries = buildCalendarEntries([], [recurring], '2026-09-14');

    expect([...entries.keys()]).toEqual(['2026-09-21']);
  });

  test('keeps explicit slots alongside a repeating pattern even when availability has no extra limit', () => {
    const explicit = occurrence('occurrence-extra', 'idea-weekly-extra', '2026-09-20');
    const recurring = idea({
      id: 'idea-weekly-extra',
      mode: 'ANYTIME',
      occurrences: [explicit],
      recurrence: {
        kind: 'WEEKLY',
        startDate: '2026-09-14',
        endDate: '2026-09-30',
        weekdays: ['MONDAY'],
      },
    });

    const entries = buildCalendarEntries([], [recurring], '2026-09-14');

    expect(entries.get('2026-09-14')?.map((entry) => entry.kind)).toEqual(['possible']);
    expect(entries.get('2026-09-20')?.map((entry) => entry.kind)).toEqual(['possible']);
  });

  test('does not show recurrence possibilities while the idea already has an active schedule', () => {
    const recurring = idea({
      id: 'idea-monthly',
      mode: 'ANYTIME',
      recurrence: {
        kind: 'MONTHLY_ORDINAL_WEEKDAY',
        startDate: '2026-09-01',
        endDate: '2026-12-31',
        ordinal: 1,
        weekday: 'SATURDAY',
      },
    });
    const entries = buildCalendarEntries(
      [schedule({ id: 'schedule-monthly', ideaId: recurring.id, scheduledDate: '2026-10-03' })],
      [recurring],
      '2026-09-14',
    );

    expect(entries.get('2026-10-03')?.map((entry) => entry.kind)).toEqual(['scheduled']);
    expect(entries.has('2026-11-07')).toBe(false);
    expect(entries.has('2026-12-05')).toBe(false);
  });

  test('starts the rolling planner on the current Monday and keeps weeks continuous', () => {
    const weeks = buildRollingWeeks('2026-09-13', 3);

    expect(weeks.map((week) => week.key)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
    expect(weeks.flatMap((week) => week.days).map((day) => day.date)).toHaveLength(21);
  });

  test('validates and locates a Calendar target date', () => {
    expect(normalizeCalendarTargetDate('2026-10-31')).toBe('2026-10-31');
    expect(normalizeCalendarTargetDate(['2026-10-31', '2026-11-01'])).toBe('2026-10-31');
    expect(normalizeCalendarTargetDate('2026-02-30')).toBeNull();
    expect(normalizeCalendarTargetDate('31-10-2026')).toBeNull();
    expect(normalizeCalendarTargetDate(undefined)).toBeNull();

    const weeks = buildRollingWeeksForTarget('2026-09-13', '2027-04-02', 26);
    const targetWeekIndex = calendarWeekIndexForDate(weeks, '2027-04-02');
    expect(targetWeekIndex).toBeGreaterThanOrEqual(26);
    expect(weeks[targetWeekIndex]?.days.some((day) => day.date === '2027-04-02')).toBe(true);
  });

  test('keeps the normal rolling range unchanged without a target date', () => {
    expect(buildRollingWeeksForTarget('2026-09-13', null, 3)).toEqual(
      buildRollingWeeks('2026-09-13', 3),
    );
  });

  test('includes an earlier target date so it can be focused', () => {
    const weeks = buildRollingWeeksForTarget('2026-09-13', '2026-08-15', 3);

    expect(calendarWeekIndexForDate(weeks, '2026-08-15')).toBe(0);
  });

  test('places Upcoming after a computed useful opening week block', () => {
    const lateMonthWeeks = buildRollingWeeks('2026-09-28', 10);
    const earlyMonthWeeks = buildRollingWeeks('2026-09-02', 10);

    expect(calendarUpcomingInsertionIndex(lateMonthWeeks)).toBe(4);
    expect(calendarUpcomingInsertionIndex(earlyMonthWeeks)).toBeGreaterThanOrEqual(3);
    expect(calendarUpcomingInsertionIndex(earlyMonthWeeks)).toBeLessThanOrEqual(5);
    expect(calendarUpcomingInsertionIndex([])).toBe(-1);
  });

  test('filters schedules to the ideas in an explicit planning context', () => {
    const allSchedules = [
      schedule({ id: 'berlin-plan', ideaId: 'berlin-idea', scheduledDate: '2026-09-20' }),
      schedule({ id: 'online-plan', ideaId: 'online-idea', scheduledDate: '2026-09-21' }),
    ];

    expect(schedulesForIdeas(allSchedules, [idea({ id: 'berlin-idea' })], true).map((item) => item.id)).toEqual([
      'berlin-plan',
    ]);
    expect(schedulesForIdeas(allSchedules, [], false)).toBe(allSchedules);
  });

  test('sorts only active future schedules into upcoming', () => {
    const values = upcomingSchedules([
      schedule({ id: 'later', ideaId: 'idea-later', scheduledDate: '2026-09-21' }),
      schedule({ id: 'missed', ideaId: 'idea-missed', scheduledDate: '2026-09-14', status: 'MISSED' }),
      schedule({ id: 'sooner', ideaId: 'idea-sooner', scheduledDate: '2026-09-20' }),
    ], '2026-09-13');

    expect(values.map((value) => value.id)).toEqual(['sooner', 'later']);
  });

  test('offers Dated only after a timed plan starts, or on its date when time is open', () => {
    const timed = {
      ...schedule({ id: 'timed', ideaId: 'idea-timed', scheduledDate: '2026-09-13' }),
      startsAt: '2026-09-13T18:00:00.000Z',
    };
    const dateOnly = schedule({ id: 'date-only', ideaId: 'idea-date-only', scheduledDate: '2026-09-13' });

    expect(scheduleCanBeDated(timed, new Date('2026-09-13T17:59:00.000Z'))).toBe(false);
    expect(scheduleCanBeDated(timed, new Date('2026-09-13T18:00:00.000Z'))).toBe(true);
    expect(scheduleCanBeDated(dateOnly, new Date('2026-09-13T00:00:00.000Z'))).toBe(true);
  });
});

describe('planning timezone dates', () => {
  test('uses the selected planning timezone rather than the device date', () => {
    const instant = new Date('2026-09-13T23:30:00.000Z');

    expect(calendarDateInTimeZone(instant, 'Pacific/Honolulu')).toBe('2026-09-13');
    expect(calendarDateInTimeZone(instant, 'Europe/Berlin')).toBe('2026-09-14');
  });
});
