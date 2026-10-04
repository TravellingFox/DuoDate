import type { Trip } from './api/duodate';
import {
  applyTripDateSelection,
  buildTripCreateInput,
  buildTripUpdateInput,
  destinationTimeZoneForCreation,
  groupTrips,
  initialTripDates,
  resolveTripDestinationTimeZone,
} from './travel';

function trip(input: {
  id: string;
  status: Trip['status'];
  startDate: string;
  endDate: string;
  isPrimaryActive?: boolean;
}): Trip {
  return {
    id: input.id,
    householdId: 'household-1',
    destinationId: 'destination-1',
    name: null,
    startDate: input.startDate,
    endDate: input.endDate,
    cancelledAt: input.status === 'CANCELLED' ? '2026-09-01T00:00:00.000Z' : null,
    hero: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    destination: {
      id: 'destination-1',
      householdId: 'household-1',
      name: 'Lisbon',
      timeZone: 'Europe/Lisbon',
      country: 'Portugal',
      notes: null,
      colorToken: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    localToday: '2026-09-14',
    status: input.status,
    isActive: input.status === 'ACTIVE',
    isCancelled: input.status === 'CANCELLED',
    isPrimaryActive: input.isPrimaryActive ?? false,
  };
}

describe('Travel overview grouping', () => {
  test('uses backend statuses and keeps future Trips available for planning', () => {
    const groups = groupTrips([
      trip({ id: 'past-old', status: 'PAST', startDate: '2025-01-01', endDate: '2025-01-03' }),
      trip({ id: 'future-later', status: 'UPCOMING', startDate: '2027-04-01', endDate: '2027-04-05' }),
      trip({ id: 'active-secondary', status: 'ACTIVE', startDate: '2026-09-01', endDate: '2026-09-20' }),
      trip({ id: 'future-sooner', status: 'UPCOMING', startDate: '2026-11-10', endDate: '2026-11-15' }),
      trip({ id: 'active-primary', status: 'ACTIVE', startDate: '2026-09-10', endDate: '2026-09-18', isPrimaryActive: true }),
      trip({ id: 'past-recent', status: 'PAST', startDate: '2026-06-01', endDate: '2026-06-03' }),
      trip({ id: 'cancelled', status: 'CANCELLED', startDate: '2026-12-01', endDate: '2026-12-04' }),
    ]);

    expect(groups.active.map(({ id }) => id)).toEqual(['active-primary', 'active-secondary']);
    expect(groups.upcoming.map(({ id }) => id)).toEqual(['future-sooner', 'future-later']);
    expect(groups.past.map(({ id }) => id)).toEqual(['cancelled', 'past-recent', 'past-old']);
  });
});

describe('Trip date behavior', () => {
  test('uses only reliable destination timezone data', () => {
    const spaces = [
      { name: 'Berlin', timeZone: 'Europe/Berlin' },
      { name: 'Lisbon', timeZone: 'Europe/Berlin' },
      { name: 'Salvador', timeZone: 'America/Bahia' },
      { name: 'Reykjavik', timeZone: 'Atlantic/Reykjavik' },
      { name: 'Unknown space', timeZone: null },
    ];

    expect(resolveTripDestinationTimeZone('Berlin', spaces)).toBe('Europe/Berlin');
    expect(resolveTripDestinationTimeZone('Salvador', spaces)).toBe('America/Bahia');
    expect(resolveTripDestinationTimeZone('Lisbon', spaces)).toBe('Europe/Lisbon');
    expect(resolveTripDestinationTimeZone('Reykjavik', spaces)).toBe('Atlantic/Reykjavik');
    expect(resolveTripDestinationTimeZone('Online', spaces)).toBe('Europe/Berlin');
    expect(resolveTripDestinationTimeZone('Global', spaces)).toBe('Europe/Berlin');
    expect(resolveTripDestinationTimeZone('Unknown place', spaces)).toBeNull();
    expect(resolveTripDestinationTimeZone('Unknown space', spaces)).toBeNull();
  });

  test('requires a valid explicit IANA timezone for an unknown destination', () => {
    const spaces = [{ name: 'Berlin', timeZone: 'Europe/Berlin' }];

    expect(destinationTimeZoneForCreation('New place', spaces, '')).toBeNull();
    expect(destinationTimeZoneForCreation('New place', spaces, 'Berlin time')).toBeNull();
    expect(destinationTimeZoneForCreation('New place', spaces, ' Pacific/Honolulu ')).toBe('Pacific/Honolulu');
    expect(destinationTimeZoneForCreation('Berlin', spaces, 'Pacific/Honolulu')).toBe('Europe/Berlin');
  });

  test('initializes dates in the selected destination time zone', () => {
    const instant = new Date('2026-09-14T00:30:00.000Z');

    expect(initialTripDates('Pacific/Honolulu', instant)).toEqual({
      startDate: '2026-09-13',
      endDate: '2026-09-16',
    });
    expect(initialTripDates('Europe/Lisbon', instant).startDate).toBe('2026-09-14');
  });

  test('keeps date-only values and clamps the range in both directions', () => {
    expect(applyTripDateSelection('2026-10-10', '2026-10-12', 'start', '2026-10-14')).toEqual({
      startDate: '2026-10-14',
      endDate: '2026-10-14',
    });
    expect(applyTripDateSelection('2026-10-10', '2026-10-12', 'end', '2026-10-08')).toEqual({
      startDate: '2026-10-10',
      endDate: '2026-10-10',
    });
  });
});

describe('Trip date-only payloads', () => {
  test('serializes creation dates without converting them to instants', () => {
    expect(buildTripCreateInput({
      destinationId: 'destination-1',
      name: '  Autumn away  ',
      startDate: '2026-10-31',
      endDate: '2026-11-03',
    })).toEqual({
      destinationId: 'destination-1',
      name: 'Autumn away',
      startDate: '2026-10-31',
      endDate: '2026-11-03',
    });
  });

  test('edits only the safe name and date fields', () => {
    expect(buildTripUpdateInput({ name: '   ', startDate: '2027-03-01', endDate: '2027-03-07' })).toEqual({
      name: null,
      startDate: '2027-03-01',
      endDate: '2027-03-07',
    });
  });
});
