import { Prisma } from "@prisma/client";
import { minuteToLocalTime, type CalendarDate } from "../lib/date-time";
import { prisma } from "../prisma";
import type { ResolvedPlanningContext } from "./planning-context-service";
import {
  recurrenceHasMatchInRange,
  recurrenceMatchesDate,
  serializeRecurrence,
} from "./idea-recurrence";
import { isGenericTravelSpaceName } from "./catalog-service";
import { publicIdeaImageSelect, serializeIdeaImage } from "./idea-image-service";

export const planningIdeaInclude = {
  category: true,
  createdBy: { select: { id: true, displayName: true } },
  spaces: { include: { space: true } },
  destinations: { include: { destination: true } },
  links: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
  weatherSuitability: true,
  availability: true,
  occurrences: {
    orderBy: [
      { localDate: "asc" as const },
      { startMinute: "asc" as const },
      { createdAt: "asc" as const },
      { id: "asc" as const },
    ],
  },
  schedules: { where: { status: "SCHEDULED" as const } },
  images: {
    where: { state: "ACTIVE" as const },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: publicIdeaImageSelect,
  },
} satisfies Prisma.IdeaInclude;

export type PlanningIdea = Prisma.IdeaGetPayload<{ include: typeof planningIdeaInclude }>;

export type EligibilityMode = "ACTIVE_BROWSE" | "TRIP_PLANNING" | "LETS_DATE";
export type WeatherCondition = "SUNNY" | "RAINY" | "INDOOR" | "OUTDOOR";

export interface EligibilityRequest {
  householdId: string;
  mode: EligibilityMode;
  context: ResolvedPlanningContext;
  targetDate: CalendarDate;
  maximumCostTotalCents: number | null;
  maximumDurationRank: number | null;
  weatherConditions: WeatherCondition[];
  allowScheduledIdeaIds?: ReadonlySet<string>;
}

export type IneligibilityReason =
  | "DELETED"
  | "INACTIVE"
  | "OUTSIDE_CONTEXT"
  | "EXPIRED"
  | "UNAVAILABLE"
  | "ABOVE_BUDGET"
  | "UNKNOWN_COST"
  | "TOO_LONG"
  | "UNKNOWN_DURATION"
  | "WEATHER_IMPOSSIBLE"
  | "ALREADY_SCHEDULED";

export interface EligibilityEvaluation {
  eligible: boolean;
  reason: IneligibilityReason | null;
  weatherScore: number;
  scheduled: boolean;
}

const weatherFieldByCondition = {
  SUNNY: "sunny",
  RAINY: "rainy",
  INDOOR: "indoor",
  OUTDOOR: "outdoor",
} as const;

function availabilityEvaluation(
  idea: PlanningIdea,
  request: EligibilityRequest,
): IneligibilityReason | null {
  const availability = idea.availability;
  const hasRecurrence = idea.recurrenceKind !== "NONE";

  if (request.mode === "TRIP_PLANNING" && request.context.kind === "TRIP") {
    const { startDate, endDate } = request.context.trip;
    const hasOccurrenceInTrip = idea.occurrences.some(
      ({ localDate }) => startDate <= localDate && localDate <= endDate,
    );

    if (hasRecurrence) {
      if (hasOccurrenceInTrip) return null;
      let recurrenceRangeStart = startDate as CalendarDate;
      let recurrenceRangeEnd = endDate as CalendarDate;
      if (availability?.mode === "DATE_RANGE") {
        if (!availability.rangeStartDate || !availability.rangeEndDate) return "UNAVAILABLE";
        if (availability.rangeStartDate > recurrenceRangeStart) {
          recurrenceRangeStart = availability.rangeStartDate as CalendarDate;
        }
        if (availability.rangeEndDate < recurrenceRangeEnd) {
          recurrenceRangeEnd = availability.rangeEndDate as CalendarDate;
        }
      }
      if (
        recurrenceRangeStart <= recurrenceRangeEnd &&
        recurrenceHasMatchInRange(idea, recurrenceRangeStart, recurrenceRangeEnd)
      ) {
        return null;
      }
      const finalOccurrence = idea.occurrences.at(-1)?.localDate;
      const recurrenceExpired =
        idea.recurrenceEndDate !== null && idea.recurrenceEndDate < startDate;
      const availabilityExpired =
        availability?.mode === "DATE_RANGE" &&
        availability.rangeEndDate !== null &&
        availability.rangeEndDate < startDate;
      const explicitExpired = !finalOccurrence || finalOccurrence < startDate;
      return (recurrenceExpired || availabilityExpired) && explicitExpired
        ? "EXPIRED"
        : "UNAVAILABLE";
    }

    if (!availability || availability.mode === "ANYTIME") return null;
    if (availability.mode === "DATE_RANGE") {
      if (!availability.rangeStartDate || !availability.rangeEndDate) return "UNAVAILABLE";
      if (availability.rangeEndDate < startDate) return "EXPIRED";
      return availability.rangeStartDate <= endDate ? null : "UNAVAILABLE";
    }

    if (hasOccurrenceInTrip) return null;
    const finalOccurrence = idea.occurrences.at(-1)?.localDate;
    return finalOccurrence && finalOccurrence < startDate ? "EXPIRED" : "UNAVAILABLE";
  }

  if (hasRecurrence) {
    if (idea.occurrences.some(({ localDate }) => localDate === request.targetDate)) return null;
    const insideAvailabilityRange =
      availability?.mode !== "DATE_RANGE" ||
      (availability.rangeStartDate !== null &&
        availability.rangeEndDate !== null &&
        availability.rangeStartDate <= request.targetDate &&
        request.targetDate <= availability.rangeEndDate);
    if (insideAvailabilityRange && recurrenceMatchesDate(idea, request.targetDate)) return null;

    const finalOccurrence = idea.occurrences.at(-1)?.localDate;
    const recurrenceExpired =
      idea.recurrenceEndDate !== null && idea.recurrenceEndDate < request.targetDate;
    const availabilityExpired =
      availability?.mode === "DATE_RANGE" &&
      availability.rangeEndDate !== null &&
      availability.rangeEndDate < request.targetDate;
    const explicitExpired = !finalOccurrence || finalOccurrence < request.targetDate;
    return (recurrenceExpired || availabilityExpired) && explicitExpired
      ? "EXPIRED"
      : "UNAVAILABLE";
  }

  if (!availability || availability.mode === "ANYTIME") return null;
  if (availability.mode === "DATE_RANGE") {
    if (!availability.rangeStartDate || !availability.rangeEndDate) return "UNAVAILABLE";
    if (request.targetDate > availability.rangeEndDate) return "EXPIRED";
    return availability.rangeStartDate <= request.targetDate ? null : "UNAVAILABLE";
  }

  if (idea.occurrences.some(({ localDate }) => localDate === request.targetDate)) return null;
  const finalOccurrence = idea.occurrences.at(-1)?.localDate;
  return finalOccurrence && finalOccurrence < request.targetDate ? "EXPIRED" : "UNAVAILABLE";
}

function contextMatches(idea: PlanningIdea, context: ResolvedPlanningContext): boolean {
  if (context.kind === "SPACE") {
    return idea.spaces.some(
      ({ space }) =>
        space.id === context.id &&
        space.retiredAt === null &&
        !isGenericTravelSpaceName(space.name),
    );
  }

  if (context.kind === "TRIP") {
    return idea.destinations.some(({ destination }) => destination.id === context.trip.destinationId);
  }

  const hasActiveSpace = idea.spaces.some(
    ({ space }) => space.retiredAt === null && !isGenericTravelSpaceName(space.name),
  );
  const hasNoExplicitContext = idea.spaces.length === 0 && idea.destinations.length === 0;
  return hasActiveSpace || hasNoExplicitContext;
}

function weatherEvaluation(
  idea: PlanningIdea,
  selected: WeatherCondition[],
): { impossible: boolean; score: number } {
  let score = 0;
  for (const condition of selected) {
    const field = weatherFieldByCondition[condition];
    const state = idea.weatherSuitability?.[field] ?? "NEUTRAL";
    if (state === "IMPOSSIBLE") return { impossible: true, score: 0 };
    if (state === "GOOD") score += 1;
  }
  return { impossible: false, score };
}

export function evaluateIdeaEligibility(
  idea: PlanningIdea,
  request: EligibilityRequest,
): EligibilityEvaluation {
  const scheduled = idea.schedules.length > 0;
  const rejected = (reason: IneligibilityReason, weatherScore = 0): EligibilityEvaluation => ({
    eligible: false,
    reason,
    weatherScore,
    scheduled,
  });

  if (idea.deletedAt !== null) return rejected("DELETED");
  if (idea.lifecycle !== "ACTIVE") return rejected("INACTIVE");
  if (!contextMatches(idea, request.context)) return rejected("OUTSIDE_CONTEXT");

  const availabilityReason = availabilityEvaluation(idea, request);
  if (availabilityReason) return rejected(availabilityReason);

  if (request.maximumCostTotalCents !== null) {
    const comparableCost = idea.exactCostTotalCents ?? idea.costMaxTotalCents;
    if (comparableCost === null) return rejected("UNKNOWN_COST");
    if (comparableCost > request.maximumCostTotalCents) return rejected("ABOVE_BUDGET");
  }

  if (request.maximumDurationRank !== null) {
    if (idea.durationRank === null) return rejected("UNKNOWN_DURATION");
    if (idea.durationRank > request.maximumDurationRank) return rejected("TOO_LONG");
  }

  const weather = weatherEvaluation(idea, request.weatherConditions);
  if (weather.impossible) return rejected("WEATHER_IMPOSSIBLE");

  if (
    request.mode === "LETS_DATE" &&
    scheduled &&
    !request.allowScheduledIdeaIds?.has(idea.id)
  ) {
    return rejected("ALREADY_SCHEDULED", weather.score);
  }

  return { eligible: true, reason: null, weatherScore: weather.score, scheduled };
}

export function serializePlanningIdea(idea: PlanningIdea) {
  const {
    clientRequestId: _clientRequestId,
    recurrenceKind: _recurrenceKind,
    recurrenceStartDate: _recurrenceStartDate,
    recurrenceEndDate: _recurrenceEndDate,
    recurrenceWeekdayMask: _recurrenceWeekdayMask,
    recurrenceOrdinal: _recurrenceOrdinal,
    recurrenceWeekday: _recurrenceWeekday,
    images,
    ...persistedIdea
  } = idea;
  return {
    ...persistedIdea,
    recurrence: serializeRecurrence(idea),
    image: images[0] ? serializeIdeaImage(images[0]) : null,
    spaces: idea.spaces.map(({ space }) => space),
    destinations: idea.destinations.map(({ destination }) => destination),
    occurrences: idea.occurrences.map((occurrence) => ({
      ...occurrence,
      startLocalTime: minuteToLocalTime(occurrence.startMinute),
      endLocalTime: minuteToLocalTime(occurrence.endMinute),
    })),
  };
}

export const eligibilityService = {
  async loadIdeas(householdId: string): Promise<PlanningIdea[]> {
    return prisma.idea.findMany({
      where: { householdId },
      include: planningIdeaInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
  },

  async evaluateAll(request: EligibilityRequest) {
    const ideas = await this.loadIdeas(request.householdId);
    return ideas.map((idea) => ({
      idea,
      evaluation: evaluateIdeaEligibility(idea, request),
    }));
  },

  async eligibleIdeas(request: EligibilityRequest) {
    return (await this.evaluateAll(request)).filter(({ evaluation }) => evaluation.eligible);
  },
};
