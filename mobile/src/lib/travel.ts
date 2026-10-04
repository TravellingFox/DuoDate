import type { Space, Trip, TripCreateInput, TripUpdateInput } from '@/lib/api/duodate';
import { addCalendarDays, calendarDateInTimeZone, validTimeZone } from '@/lib/format';

export interface TripGroups {
  active: Trip[];
  upcoming: Trip[];
  past: Trip[];
}

export function groupTrips(trips: Trip[]): TripGroups {
  const active = trips
    .filter((trip) => trip.status === 'ACTIVE')
    .sort((left, right) =>
      Number(right.isPrimaryActive) - Number(left.isPrimaryActive) ||
      right.startDate.localeCompare(left.startDate) ||
      left.id.localeCompare(right.id),
    );
  const upcoming = trips
    .filter((trip) => trip.status === 'UPCOMING')
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id));
  const past = trips
    .filter((trip) => trip.status === 'PAST' || trip.status === 'CANCELLED')
    .sort((left, right) =>
      (right.cancelledAt ?? right.endDate).localeCompare(left.cancelledAt ?? left.endDate) ||
      left.id.localeCompare(right.id),
    );

  return { active, upcoming, past };
}

const destinationTimeZones: Record<string, string> = {
  berlin: 'Europe/Berlin',
  global: 'Europe/Berlin',
  lisbon: 'Europe/Lisbon',
  online: 'Europe/Berlin',
  salvador: 'America/Bahia',
};

export function resolveTripDestinationTimeZone(
  destinationName: string,
  spaces: Pick<Space, 'name' | 'timeZone'>[],
): string | null {
  const normalizedName = destinationName.trim().toLocaleLowerCase();
  const matchingSpace = spaces.find(
    (space) => space.name.trim().toLocaleLowerCase() === normalizedName,
  );

  return destinationTimeZones[normalizedName] ?? validTimeZone(matchingSpace?.timeZone);
}

export function destinationTimeZoneForCreation(
  destinationName: string,
  spaces: Pick<Space, 'name' | 'timeZone'>[],
  explicitTimeZone: string,
): string | null {
  return resolveTripDestinationTimeZone(destinationName, spaces) ?? validTimeZone(explicitTimeZone.trim());
}

export function initialTripDates(timeZone: string, now = new Date()) {
  const startDate = calendarDateInTimeZone(now, timeZone);
  return { startDate, endDate: addCalendarDays(startDate, 3) };
}

export function applyTripDateSelection(
  startDate: string,
  endDate: string,
  target: 'start' | 'end',
  selectedDate: string,
) {
  if (target === 'start') {
    return {
      startDate: selectedDate,
      endDate: selectedDate > endDate ? selectedDate : endDate,
    };
  }
  return {
    startDate,
    endDate: selectedDate < startDate ? startDate : selectedDate,
  };
}

export function buildTripCreateInput(input: {
  destinationId: string;
  name: string;
  startDate: string;
  endDate: string;
}): TripCreateInput {
  return {
    destinationId: input.destinationId,
    name: input.name.trim() || null,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}

export function buildTripUpdateInput(input: {
  name: string;
  startDate: string;
  endDate: string;
}): TripUpdateInput {
  return {
    name: input.name.trim() || null,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}
