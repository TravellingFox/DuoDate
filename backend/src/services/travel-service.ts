import { Prisma } from "@prisma/client";
import { calendarDateInTimeZone, type CalendarDate } from "../lib/date-time";
import { AppError, conflict, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import { authoritativeDestinationTimeZone, withAuthoritativeDestinationTimeZone } from "./destination-time-zone";
import { eligibilityService, serializePlanningIdea } from "./eligibility-service";
import {
  planningContextService,
  selectPrimaryActiveTrip,
  tripStatusAt,
} from "./planning-context-service";
import { scheduleMaintenanceService } from "./schedule-maintenance-service";
import {
  publicTripHeroImageSelect,
  serializeTripHeroImage,
  tripHeroImageService,
} from "./trip-hero-image-service";
import type {
  DestinationCreateInput,
  DestinationUpdateInput,
  TripCreateInput,
  TripUpdateInput,
} from "../types";

function translateUniqueError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    conflict("A Destination with that name already exists");
  }
  throw error;
}

const tripOverviewInclude = {
  destination: true,
  heroImages: {
    where: { state: "ACTIVE" as const },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: publicTripHeroImageSelect,
  },
} satisfies Prisma.TripInclude;

type TripForOverview = Prisma.TripGetPayload<{ include: typeof tripOverviewInclude }>;

function serializeTripForOverview(
  trip: TripForOverview,
  now: Date,
  primaryActiveTripId?: string | null,
) {
  const { heroImages, ...persistedTrip } = trip;
  const destination = withAuthoritativeDestinationTimeZone(trip.destination);
  const resolvedTrip = { ...trip, destination };
  const localToday = calendarDateInTimeZone(now, destination.timeZone);
  const status = tripStatusAt(resolvedTrip, now);
  return {
    ...persistedTrip,
    destination,
    cancelledAt: trip.cancelledAt?.toISOString() ?? null,
    hero: heroImages[0] ? serializeTripHeroImage(heroImages[0]) : null,
    localToday,
    status,
    isActive: status === "ACTIVE",
    isCancelled: status === "CANCELLED",
    isPrimaryActive: status === "ACTIVE" && trip.id === primaryActiveTripId,
  };
}

async function primaryActiveTripId(householdId: string, now: Date) {
  const trips = await prisma.trip.findMany({
    where: { householdId, cancelledAt: null },
    include: { destination: true },
  });
  return selectPrimaryActiveTrip(trips, now)?.id ?? null;
}

export const travelService = {
  async listDestinations(householdId: string) {
    const destinations = await prisma.destination.findMany({
      where: { householdId },
      include: { _count: { select: { trips: true, ideas: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return destinations.map(withAuthoritativeDestinationTimeZone);
  },

  async createDestination(householdId: string, input: DestinationCreateInput) {
    try {
      return await prisma.destination.create({
        data: {
          householdId,
          ...input,
          timeZone: authoritativeDestinationTimeZone(input.name, input.timeZone),
        },
      });
    } catch (error) {
      translateUniqueError(error);
    }
  },

  async updateDestination(householdId: string, id: string, input: DestinationUpdateInput) {
    const destination = await prisma.destination.findFirst({ where: { id, householdId } });
    if (!destination) notFound("Destination");
    const name = input.name ?? destination.name;
    const timeZone = authoritativeDestinationTimeZone(
      name,
      input.timeZone ?? destination.timeZone,
    );
    try {
      return await prisma.destination.update({ where: { id }, data: { ...input, timeZone } });
    } catch (error) {
      translateUniqueError(error);
    }
  },

  async deleteDestination(householdId: string, id: string) {
    const destination = await prisma.destination.findFirst({
      where: { id, householdId },
      include: { _count: { select: { trips: true, ideas: true } } },
    });
    if (!destination) notFound("Destination");
    if (destination._count.trips > 0 || destination._count.ideas > 0) {
      throw new AppError(
        409,
        "DESTINATION_IN_USE",
        "Destination cannot be deleted while Trips or Ideas reference it",
      );
    }
    await prisma.destination.delete({ where: { id } });
  },

  async listTrips(householdId: string, planningDate?: string, now = new Date()) {
    await scheduleMaintenanceService.run(householdId, now);
    const storedTrips = await prisma.trip.findMany({
      where: {
        householdId,
        ...(planningDate ? { cancelledAt: null, endDate: { gte: planningDate } } : {}),
      },
      include: tripOverviewInclude,
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    });
    const trips = storedTrips.map((trip) => ({
      ...trip,
      destination: withAuthoritativeDestinationTimeZone(trip.destination),
    }));
    const primaryActiveTripId = selectPrimaryActiveTrip(trips, now)?.id ?? null;
    return trips.map((trip) => serializeTripForOverview(trip, now, primaryActiveTripId));
  },

  async getTripForPlanning(householdId: string, id: string, now = new Date()) {
    await scheduleMaintenanceService.run(householdId, now);
    const context = await planningContextService.resolveTrip(householdId, id);
    if (context.kind !== "TRIP") throw new Error("Expected a Trip planning context");

    const evaluated = await eligibilityService.eligibleIdeas({
      householdId,
      mode: "TRIP_PLANNING",
      context,
      targetDate: context.trip.startDate as CalendarDate,
      maximumCostTotalCents: null,
      maximumDurationRank: null,
      weatherConditions: [],
    });
    const localToday = calendarDateInTimeZone(now, context.timeZone);
    const status = tripStatusAt(context.trip, now);
    const hero = await tripHeroImageService.findPublicHero(householdId, context.trip.id);

    return {
      ...context.trip,
      cancelledAt: context.trip.cancelledAt?.toISOString() ?? null,
      hero,
      isActive: status === "ACTIVE",
      isCancelled: false,
      status,
      localToday,
      destination: {
        ...context.trip.destination,
        ideas: evaluated.map(({ idea, evaluation }) => ({
          ...serializePlanningIdea(idea),
          planning: {
            scheduled: evaluation.scheduled,
            weatherPreferenceScore: evaluation.weatherScore,
          },
        })),
      },
    };
  },

  async createTrip(householdId: string, input: TripCreateInput, now = new Date()) {
    const destination = await prisma.destination.findFirst({
      where: { id: input.destinationId, householdId },
    });
    if (!destination) throw new AppError(400, "INVALID_DESTINATION", "Destination is not available");
    const trip = await prisma.trip.create({
      data: { householdId, ...input },
      include: tripOverviewInclude,
    });
    return serializeTripForOverview(
      trip,
      now,
      await primaryActiveTripId(householdId, now),
    );
  },

  async updateTrip(householdId: string, id: string, input: TripUpdateInput, now = new Date()) {
    const existing = await prisma.trip.findFirst({
      where: { id, householdId, cancelledAt: null },
    });
    if (!existing) notFound("Trip");
    const startDate = input.startDate ?? existing.startDate;
    const endDate = input.endDate ?? existing.endDate;
    if (startDate > endDate) {
      throw new AppError(400, "INVALID_DATE_RANGE", "Trip start must not follow trip end");
    }
    if (input.destinationId) {
      const destination = await prisma.destination.findFirst({
        where: { id: input.destinationId, householdId },
      });
      if (!destination) {
        throw new AppError(400, "INVALID_DESTINATION", "Destination is not available");
      }
    }
    const trip = await prisma.trip.update({
      where: { id },
      data: input,
      include: tripOverviewInclude,
    });
    return serializeTripForOverview(
      trip,
      now,
      await primaryActiveTripId(householdId, now),
    );
  },

  async deleteTrip(householdId: string, id: string) {
    const result = await prisma.trip.updateMany({
      where: { id, householdId, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    if (result.count === 0) notFound("Trip");
  },
};
