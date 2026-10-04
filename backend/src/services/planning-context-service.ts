import type { Destination, Space, Trip } from "@prisma/client";
import { calendarDateInTimeZone, type CalendarDate } from "../lib/date-time";
import { AppError, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import type { TripStatus } from "../types";
import { isGenericTravelSpaceName } from "./catalog-service";
import {
  authoritativeDestinationTimeZone,
  withAuthoritativeDestinationTimeZone,
} from "./destination-time-zone";

export type TripWithDestination = Trip & { destination: Destination };

export type ResolvedPlanningContext =
  | {
      kind: "ACTIVE_POOL";
      id: null;
      timeZone: string;
      isDefault: boolean;
    }
  | {
      kind: "SPACE";
      id: string;
      timeZone: string;
      isDefault: boolean;
      space: Space;
    }
  | {
      kind: "TRIP";
      id: string;
      timeZone: string;
      isDefault: boolean;
      trip: TripWithDestination;
    };

export function tripStatusAt(trip: TripWithDestination, now: Date): TripStatus {
  if (trip.cancelledAt !== null) return "CANCELLED";
  const localToday = calendarDateInTimeZone(
    now,
    authoritativeDestinationTimeZone(trip.destination.name, trip.destination.timeZone),
  );
  if (localToday < trip.startDate) return "UPCOMING";
  if (localToday > trip.endDate) return "PAST";
  return "ACTIVE";
}

export function isTripActiveAt(trip: TripWithDestination, now: Date): boolean {
  return tripStatusAt(trip, now) === "ACTIVE";
}

export function selectPrimaryActiveTrip(
  trips: TripWithDestination[],
  now: Date,
): TripWithDestination | null {
  return (
    trips
      .filter((trip) => isTripActiveAt(trip, now))
      .sort((left, right) => {
        const startDateOrder = right.startDate.localeCompare(left.startDate);
        return startDateOrder !== 0 ? startDateOrder : left.id.localeCompare(right.id);
      })[0] ?? null
  );
}

async function listTripsWithDestinations(householdId: string): Promise<TripWithDestination[]> {
  const trips = await prisma.trip.findMany({
    where: { householdId, cancelledAt: null },
    include: { destination: true },
  });
  return trips.map((trip) => ({
    ...trip,
    destination: withAuthoritativeDestinationTimeZone(trip.destination),
  }));
}

export const planningContextService = {
  async getActiveTrip(householdId: string, now = new Date()): Promise<TripWithDestination | null> {
    return selectPrimaryActiveTrip(await listTripsWithDestinations(householdId), now);
  },

  async resolveDefault(
    householdId: string,
    householdTimeZone: string,
    now = new Date(),
  ): Promise<ResolvedPlanningContext> {
    const activeTrip = await this.getActiveTrip(householdId, now);
    if (activeTrip) {
      return {
        kind: "TRIP",
        id: activeTrip.id,
        timeZone: activeTrip.destination.timeZone,
        isDefault: true,
        trip: activeTrip,
      };
    }

    return {
      kind: "ACTIVE_POOL",
      id: null,
      timeZone: householdTimeZone,
      isDefault: true,
    };
  },

  async resolveSpace(
    householdId: string,
    householdTimeZone: string,
    spaceId: string,
  ): Promise<ResolvedPlanningContext> {
    const space = await prisma.space.findFirst({
      where: { id: spaceId, householdId, retiredAt: null },
    });
    if (!space || isGenericTravelSpaceName(space.name)) notFound("Space");
    return {
      kind: "SPACE",
      id: space.id,
      timeZone: space.timeZone ?? householdTimeZone,
      isDefault: false,
      space,
    };
  },

  async resolveTrip(householdId: string, tripId: string): Promise<ResolvedPlanningContext> {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, householdId, cancelledAt: null },
      include: { destination: true },
    });
    if (!trip) notFound("Trip");
    const resolvedTrip = {
      ...trip,
      destination: withAuthoritativeDestinationTimeZone(trip.destination),
    };
    return {
      kind: "TRIP",
      id: resolvedTrip.id,
      timeZone: resolvedTrip.destination.timeZone,
      isDefault: false,
      trip: resolvedTrip,
    };
  },

  targetDateForContext(
    context: ResolvedPlanningContext,
    requestedDate: CalendarDate | undefined,
    now = new Date(),
  ): CalendarDate {
    if (requestedDate) {
      if (
        context.kind === "TRIP" &&
        (requestedDate < context.trip.startDate || requestedDate > context.trip.endDate)
      ) {
        throw new AppError(
          400,
          "DATE_OUTSIDE_TRIP",
          "The target date must fall within the selected Trip",
        );
      }
      return requestedDate;
    }

    if (context.kind === "TRIP") {
      if (!isTripActiveAt(context.trip, now)) {
        throw new AppError(
          400,
          "TARGET_DATE_REQUIRED",
          "An explicit target date is required for a Trip that is not active",
        );
      }
    }

    return calendarDateInTimeZone(now, context.timeZone);
  },
};
