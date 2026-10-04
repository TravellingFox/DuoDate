import { createHash } from "node:crypto";
import { Prisma, type CostBasis, type DurationBand } from "@prisma/client";
import type { CalendarDate } from "../lib/date-time";
import { AppError } from "../lib/errors";
import { prisma } from "../prisma";
import type { LetsDateRequest } from "../types";
import {
  eligibilityService,
  evaluateIdeaEligibility,
  serializePlanningIdea,
  type EligibilityRequest,
  type IneligibilityReason,
  type PlanningIdea,
  type WeatherCondition,
} from "./eligibility-service";
import { durationRanks, normalizeMaximumBudget } from "./idea-normalization";
import {
  isTripActiveAt,
  planningContextService,
  type ResolvedPlanningContext,
} from "./planning-context-service";
import { scheduleMaintenanceService } from "./schedule-maintenance-service";

export const LETS_DATE_ALGORITHM_VERSION = 1;
const REQUESTED_SUGGESTION_COUNT = 3;

interface CanonicalLetsDateFilters {
  targetDate: CalendarDate;
  contextKind: ResolvedPlanningContext["kind"];
  contextId: string | null;
  maximumCostTotalCents: number | null;
  maximumDurationRank: number | null;
  weatherConditions: WeatherCondition[];
  costBasis: CostBasis;
  algorithmVersion: number;
}

interface RankedCandidate {
  idea: PlanningIdea;
  weatherScore: number;
  deterministicRank: string;
  scheduled: boolean;
}

function stableFiltersJson(filters: CanonicalLetsDateFilters): string {
  return JSON.stringify({
    targetDate: filters.targetDate,
    contextKind: filters.contextKind,
    contextId: filters.contextId,
    maximumCostTotalCents: filters.maximumCostTotalCents,
    maximumDurationRank: filters.maximumDurationRank,
    weatherConditions: filters.weatherConditions,
    costBasis: filters.costBasis,
    algorithmVersion: filters.algorithmVersion,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicIdeaRank(input: {
  suggestionSeed: string;
  targetDate: CalendarDate;
  filterHash: string;
  ideaId: string;
  algorithmVersion: number;
}): string {
  return sha256(
    JSON.stringify([
      input.suggestionSeed,
      input.targetDate,
      input.filterHash,
      input.ideaId,
      input.algorithmVersion,
    ]),
  );
}

function rankCandidates(
  candidates: Array<{
    idea: PlanningIdea;
    evaluation: { weatherScore: number; scheduled: boolean };
  }>,
  seed: string,
  filters: CanonicalLetsDateFilters,
  filterHash: string,
): RankedCandidate[] {
  return candidates
    .map(({ idea, evaluation }) => ({
      idea,
      weatherScore: evaluation.weatherScore,
      scheduled: evaluation.scheduled,
      deterministicRank: deterministicIdeaRank({
        suggestionSeed: seed,
        targetDate: filters.targetDate,
        filterHash,
        ideaId: idea.id,
        algorithmVersion: filters.algorithmVersion,
      }),
    }))
    .sort(
      (left, right) =>
        right.weatherScore - left.weatherScore ||
        left.deterministicRank.localeCompare(right.deterministicRank) ||
        left.idea.id.localeCompare(right.idea.id),
    );
}

function responseContext(context: ResolvedPlanningContext) {
  if (context.kind === "TRIP") {
    return {
      kind: context.kind,
      id: context.id,
      isDefault: context.isDefault,
      timeZone: context.timeZone,
      trip: {
        id: context.trip.id,
        name: context.trip.name,
        startDate: context.trip.startDate,
        endDate: context.trip.endDate,
        destination: context.trip.destination,
      },
    };
  }
  if (context.kind === "SPACE") {
    return {
      kind: context.kind,
      id: context.id,
      isDefault: context.isDefault,
      timeZone: context.timeZone,
      space: context.space,
    };
  }
  return context;
}

async function resolveRequest(
  householdId: string,
  householdTimeZone: string,
  input: LetsDateRequest,
  now: Date,
) {
  const [settings, household] = await Promise.all([
    prisma.householdSettings.findUnique({ where: { householdId } }),
    prisma.household.findUnique({ where: { id: householdId } }),
  ]);
  if (!settings || !household) throw new Error("Household planning settings are not configured");

  const context =
    input.context?.kind === "SPACE"
      ? await planningContextService.resolveSpace(
          householdId,
          householdTimeZone,
          input.context.id,
        )
      : input.context?.kind === "TRIP"
        ? await planningContextService.resolveTrip(householdId, input.context.id)
        : await planningContextService.resolveDefault(householdId, householdTimeZone, now);
  if (context.kind === "TRIP" && !isTripActiveAt(context.trip, now)) {
    throw new AppError(
      400,
      "TRIP_NOT_ACTIVE",
      "Let's Date only uses a Trip while it is active at the Destination",
    );
  }
  const targetDate = planningContextService.targetDateForContext(context, input.targetDate, now);
  const weatherConditions = [...new Set(input.weather)].sort() as WeatherCondition[];
  const maximumCostTotalCents = input.maximumBudget
    ? normalizeMaximumBudget(input.maximumBudget, settings.costBasis)
    : null;
  const maximumDurationRank = input.maximumDuration
    ? durationRanks[input.maximumDuration as DurationBand]
    : null;
  const filters: CanonicalLetsDateFilters = {
    targetDate,
    contextKind: context.kind,
    contextId: context.id,
    maximumCostTotalCents,
    maximumDurationRank,
    weatherConditions,
    costBasis: settings.costBasis,
    algorithmVersion: LETS_DATE_ALGORITHM_VERSION,
  };
  const normalizedFiltersJson = stableFiltersJson(filters);

  return {
    context,
    household,
    filters,
    normalizedFiltersJson,
    filterHash: sha256(normalizedFiltersJson),
  };
}

function eligibilityRequest(
  householdId: string,
  context: ResolvedPlanningContext,
  filters: CanonicalLetsDateFilters,
  allowScheduledIdeaIds?: ReadonlySet<string>,
): EligibilityRequest {
  return {
    householdId,
    mode: "LETS_DATE",
    context,
    targetDate: filters.targetDate,
    maximumCostTotalCents: filters.maximumCostTotalCents,
    maximumDurationRank: filters.maximumDurationRank,
    weatherConditions: filters.weatherConditions,
    allowScheduledIdeaIds,
  };
}

async function findSet(
  householdId: string,
  filters: CanonicalLetsDateFilters,
  filterHash: string,
) {
  return prisma.suggestionSet.findUnique({
    where: {
      householdId_targetDate_filterHash_algorithmVersion: {
        householdId,
        targetDate: filters.targetDate,
        filterHash,
        algorithmVersion: filters.algorithmVersion,
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
}

async function createInitialSet(input: {
  householdId: string;
  filters: CanonicalLetsDateFilters;
  normalizedFiltersJson: string;
  filterHash: string;
  rankedCandidates: RankedCandidate[];
}) {
  try {
    return await prisma.suggestionSet.create({
      data: {
        householdId: input.householdId,
        targetDate: input.filters.targetDate,
        normalizedFiltersJson: input.normalizedFiltersJson,
        filterHash: input.filterHash,
        algorithmVersion: input.filters.algorithmVersion,
        items: {
          create: input.rankedCandidates.slice(0, REQUESTED_SUGGESTION_COUNT).map((candidate, index) => ({
            position: index + 1,
            ideaId: candidate.idea.id,
            weatherScore: candidate.weatherScore,
            deterministicRank: candidate.deterministicRank,
          })),
        },
      },
      include: { items: { orderBy: { position: "asc" } } },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findSet(input.householdId, input.filters, input.filterHash);
      if (winner) return winner;
    }
    throw error;
  }
}

function invalidationReason(reason: IneligibilityReason | null, ideaExists: boolean): string {
  return ideaExists ? (reason ?? "INELIGIBLE") : "IDEA_UNAVAILABLE";
}

async function repairAndBuildResponse(input: {
  householdId: string;
  context: ResolvedPlanningContext;
  filters: CanonicalLetsDateFilters;
  filterHash: string;
  suggestionSeed: string;
  setId: string;
}) {
  const [set, ideas] = await Promise.all([
    prisma.suggestionSet.findUniqueOrThrow({
      where: { id: input.setId },
      include: { items: { orderBy: { position: "asc" } } },
    }),
    eligibilityService.loadIdeas(input.householdId),
  ]);
  const ideasById = new Map(ideas.map((idea) => [idea.id, idea]));
  const persistedIdeaIds = new Set(
    set.items.flatMap((item) => (item.ideaId === null ? [] : [item.ideaId])),
  );
  const request = eligibilityRequest(
    input.householdId,
    input.context,
    input.filters,
    persistedIdeaIds,
  );
  const retainedByPosition = new Map<number, RankedCandidate>();
  const invalidItems = new Map<number, { id: string; reason: string }>();

  for (const item of set.items) {
    const idea = item.ideaId ? ideasById.get(item.ideaId) : undefined;
    const evaluation = idea ? evaluateIdeaEligibility(idea, request) : null;
    if (idea && evaluation?.eligible) {
      retainedByPosition.set(item.position, {
        idea,
        weatherScore: evaluation.weatherScore,
        deterministicRank: deterministicIdeaRank({
          suggestionSeed: input.suggestionSeed,
          targetDate: input.filters.targetDate,
          filterHash: input.filterHash,
          ideaId: idea.id,
          algorithmVersion: input.filters.algorithmVersion,
        }),
        scheduled: evaluation.scheduled,
      });
    } else {
      invalidItems.set(item.position, {
        id: item.id,
        reason: invalidationReason(evaluation?.reason ?? null, Boolean(idea)),
      });
    }
  }

  const retainedIds = new Set([...retainedByPosition.values()].map(({ idea }) => idea.id));
  const availableCandidates = rankCandidates(
    ideas
      .map((idea) => ({ idea, evaluation: evaluateIdeaEligibility(idea, {
        ...request,
        allowScheduledIdeaIds: undefined,
      }) }))
      .filter(({ evaluation, idea }) => evaluation.eligible && !retainedIds.has(idea.id)),
    input.suggestionSeed,
    input.filters,
    input.filterHash,
  );
  let candidateIndex = 0;

  for (let position = 1; position <= REQUESTED_SUGGESTION_COUNT; position += 1) {
    if (retainedByPosition.has(position)) continue;
    const replacement = availableCandidates[candidateIndex];
    const existingItem = invalidItems.get(position);
    if (!replacement) {
      if (existingItem) {
        await prisma.suggestionItem.update({
          where: { id: existingItem.id },
          data: { invalidatedAt: new Date(), invalidationReason: existingItem.reason },
        });
      }
      continue;
    }
    candidateIndex += 1;

    if (existingItem) {
      await prisma.suggestionItem.update({
        where: { id: existingItem.id },
        data: {
          ideaId: replacement.idea.id,
          weatherScore: replacement.weatherScore,
          deterministicRank: replacement.deterministicRank,
          invalidatedAt: null,
          invalidationReason: null,
        },
      });
    } else {
      await prisma.suggestionItem.create({
        data: {
          suggestionSetId: set.id,
          ideaId: replacement.idea.id,
          position,
          weatherScore: replacement.weatherScore,
          deterministicRank: replacement.deterministicRank,
        },
      });
    }
    retainedByPosition.set(position, replacement);
  }

  const suggestions = [...retainedByPosition.entries()]
    .sort(([left], [right]) => left - right)
    .map(([position, candidate]) => ({
      position,
      scheduled: candidate.scheduled,
      idea: serializePlanningIdea(candidate.idea),
    }));
  const occupiedPositions = new Set(suggestions.map(({ position }) => position));
  const missingPositions = [1, 2, 3].filter((position) => !occupiedPositions.has(position));

  return {
    status: suggestions.length === REQUESTED_SUGGESTION_COUNT ? "READY" as const : "INSUFFICIENT_MATCHES" as const,
    requestedCount: REQUESTED_SUGGESTION_COUNT,
    matchCount: suggestions.length,
    missingPositions,
    targetDate: input.filters.targetDate,
    context: responseContext(input.context),
    suggestions,
  };
}

export const letsDateService = {
  async suggest(
    householdId: string,
    householdTimeZone: string,
    requestInput: LetsDateRequest,
    now = new Date(),
  ) {
    await scheduleMaintenanceService.run(householdId, now);
    const resolved = await resolveRequest(householdId, householdTimeZone, requestInput, now);
    const existing = await findSet(householdId, resolved.filters, resolved.filterHash);

    let set = existing;
    if (!set) {
      const candidates = await eligibilityService.eligibleIdeas(
        eligibilityRequest(householdId, resolved.context, resolved.filters),
      );
      const rankedCandidates = rankCandidates(
        candidates,
        resolved.household.suggestionSeed,
        resolved.filters,
        resolved.filterHash,
      );
      set = await createInitialSet({
        householdId,
        filters: resolved.filters,
        normalizedFiltersJson: resolved.normalizedFiltersJson,
        filterHash: resolved.filterHash,
        rankedCandidates,
      });
    }

    return repairAndBuildResponse({
      householdId,
      context: resolved.context,
      filters: resolved.filters,
      filterHash: resolved.filterHash,
      suggestionSeed: resolved.household.suggestionSeed,
      setId: set.id,
    });
  },
};
