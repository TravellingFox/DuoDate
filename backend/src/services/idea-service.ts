import { Prisma } from "@prisma/client";
import { AppError, notFound } from "../lib/errors";
import {
  minuteToLocalTime,
  projectLocalTimes,
  type CalendarDate,
} from "../lib/date-time";
import { prisma } from "../prisma";
import {
  eligibilityService,
  planningIdeaInclude,
  serializePlanningIdea,
} from "./eligibility-service";
import { normalizeCostFields, normalizeDurationFields } from "./idea-normalization";
import { recurrenceFields } from "./idea-recurrence";
import { runIdeaImageCleanupIfConfigured } from "./idea-image-service";
import { planningContextService } from "./planning-context-service";
import { scheduleMaintenanceService } from "./schedule-maintenance-service";
import type {
  AvailabilityInput,
  IdeaCreateInput,
  IdeaListQuery,
  IdeaLinkInput,
  IdeaUpdateInput,
  OccurrenceCreateInput,
  OccurrenceUpdateInput,
  WeatherInput,
} from "../types";

const ideaInclude = planningIdeaInclude;

async function requireIdea(householdId: string, id: string) {
  const idea = await prisma.idea.findFirst({ where: { id, householdId, deletedAt: null } });
  if (!idea) notFound("Idea");
  return idea;
}

async function assertOwnedReferences(
  tx: Prisma.TransactionClient,
  householdId: string,
  input: { categoryId?: string | null; spaceIds?: string[]; destinationIds?: string[] },
) {
  if (input.categoryId) {
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, householdId, deletedAt: null },
    });
    if (!category) throw new AppError(400, "INVALID_CATEGORY", "Category is not available");
  }

  if (input.spaceIds) {
    const ids = [...new Set(input.spaceIds)];
    const count = await tx.space.count({
      where: { id: { in: ids }, householdId, retiredAt: null },
    });
    if (count !== ids.length) throw new AppError(400, "INVALID_SPACE", "A Space is not available");
  }

  if (input.destinationIds) {
    const ids = [...new Set(input.destinationIds)];
    const count = await tx.destination.count({ where: { id: { in: ids }, householdId } });
    if (count !== ids.length) {
      throw new AppError(400, "INVALID_DESTINATION", "A Destination is not available");
    }
  }
}

function editableIdeaFields(input: IdeaCreateInput | IdeaUpdateInput) {
  return {
    title: input.title,
    categoryId: input.categoryId,
    specificLocation: input.specificLocation,
    notes: input.notes,
    lifecycle: input.lifecycle,
  };
}

async function requireCostBasis(tx: Prisma.TransactionClient, householdId: string) {
  const settings = await tx.householdSettings.findUnique({ where: { householdId } });
  if (!settings) {
    throw new Error("Household cost settings are not configured");
  }
  return settings.costBasis;
}

export const ideaService = {
  async list(
    householdId: string,
    householdTimeZone: string,
    input: IdeaListQuery = { scope: "ELIGIBLE" },
    now = new Date(),
  ) {
    await scheduleMaintenanceService.run(householdId, now);

    if (input.scope === "SAVED") {
      const where: Prisma.IdeaWhereInput = { householdId, deletedAt: null };
      if (input.contextKind === "SPACE" && input.contextId) {
        await planningContextService.resolveSpace(householdId, householdTimeZone, input.contextId);
        where.spaces = { some: { spaceId: input.contextId } };
      } else if (input.contextKind === "TRIP" && input.contextId) {
        const context = await planningContextService.resolveTrip(householdId, input.contextId);
        if (context.kind !== "TRIP") throw new Error("Expected a Trip planning context");
        where.destinations = { some: { destinationId: context.trip.destinationId } };
      }
      const ideas = await prisma.idea.findMany({
        where,
        include: ideaInclude,
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      });
      return ideas.map(serializePlanningIdea);
    }

    const context =
      input.contextKind === "SPACE" && input.contextId
        ? await planningContextService.resolveSpace(householdId, householdTimeZone, input.contextId)
        : input.contextKind === "TRIP" && input.contextId
          ? await planningContextService.resolveTrip(householdId, input.contextId)
          : await planningContextService.resolveDefault(householdId, householdTimeZone, now);
    const targetDate = planningContextService.targetDateForContext(
      context,
      input.targetDate,
      now,
    );
    const ideas = await eligibilityService.eligibleIdeas({
      householdId,
      mode: "ACTIVE_BROWSE",
      context,
      targetDate,
      maximumCostTotalCents: null,
      maximumDurationRank: null,
      weatherConditions: [],
    });
    return ideas.map(({ idea }) => serializePlanningIdea(idea));
  },

  async get(householdId: string, id: string) {
    await scheduleMaintenanceService.run(householdId);
    const idea = await prisma.idea.findFirst({
      where: { id, householdId, deletedAt: null },
      include: ideaInclude,
    });
    if (!idea) notFound("Idea");
    return serializePlanningIdea(idea);
  },

  async create(householdId: string, userId: string, input: IdeaCreateInput) {
    const idea = await prisma.$transaction(async (tx) => {
      if (input.clientRequestId) {
        const existing = await tx.idea.findUnique({
          where: {
            householdId_clientRequestId: {
              householdId,
              clientRequestId: input.clientRequestId,
            },
          },
          include: ideaInclude,
        });
        if (existing) return existing;
      }

      await assertOwnedReferences(tx, householdId, input);
      const costBasis = await requireCostBasis(tx, householdId);
      const occurrences = input.occurrences.map((occurrence) => {
        const projection = projectLocalTimes({
          localDate: occurrence.localDate,
          startLocalTime: occurrence.startLocalTime,
          endLocalTime: occurrence.endLocalTime,
          timeZone: occurrence.timeZone,
        });
        return {
          localDate: occurrence.localDate,
          timeZone: projection.startMinute === null ? null : occurrence.timeZone,
          ...projection,
        };
      });
      const data = {
        householdId,
        createdById: userId,
        clientRequestId: input.clientRequestId,
        ...editableIdeaFields(input),
        ...normalizeCostFields(input, costBasis),
        ...normalizeDurationFields(input),
        ...recurrenceFields(input.recurrence),
        title: input.title,
        spaces: {
          create: [...new Set(input.spaceIds)].map((spaceId) => ({ spaceId })),
        },
        destinations: {
          create: [...new Set(input.destinationIds)].map((destinationId) => ({ destinationId })),
        },
        links: { create: input.links },
        weatherSuitability: { create: input.weather ?? {} },
        availability: { create: input.availability ?? { mode: "ANYTIME" } },
        occurrences: { create: occurrences },
      };

      if (input.clientRequestId) {
        return tx.idea.upsert({
          where: {
            householdId_clientRequestId: {
              householdId,
              clientRequestId: input.clientRequestId,
            },
          },
          update: {},
          create: data,
          include: ideaInclude,
        });
      }

      return tx.idea.create({ data, include: ideaInclude });
    });
    return serializePlanningIdea(idea);
  },

  async update(householdId: string, id: string, input: IdeaUpdateInput) {
    const existing = await requireIdea(householdId, id);
    const idea = await prisma.$transaction(async (tx) => {
      await assertOwnedReferences(tx, householdId, input);
      const costBasis = await requireCostBasis(tx, householdId);
      return tx.idea.update({
        where: { id },
        data: {
          ...editableIdeaFields(input),
          ...normalizeCostFields(input, costBasis, existing),
          ...normalizeDurationFields(input, existing),
          ...(input.recurrence ? recurrenceFields(input.recurrence) : {}),
        },
        include: ideaInclude,
      });
    });
    return serializePlanningIdea(idea);
  },

  async delete(householdId: string, id: string) {
    await prisma.$transaction(async (tx) => {
      const result = await tx.idea.updateMany({
        where: { id, householdId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) notFound("Idea");
      await tx.ideaImage.updateMany({
        where: { ideaId: id, state: { in: ["PENDING", "ACTIVE"] } },
        data: { state: "DELETION_PENDING", activeSlot: null, lastStorageError: null },
      });
    });
    await runIdeaImageCleanupIfConfigured(householdId);
  },

  async replaceSpaces(householdId: string, id: string, spaceIds: string[]) {
    await requireIdea(householdId, id);
    await prisma.$transaction(async (tx) => {
      await assertOwnedReferences(tx, householdId, { spaceIds });
      await tx.ideaSpace.deleteMany({ where: { ideaId: id } });
      if (spaceIds.length > 0) {
        await tx.ideaSpace.createMany({
          data: [...new Set(spaceIds)].map((spaceId) => ({ ideaId: id, spaceId })),
        });
      }
    });
    return this.get(householdId, id);
  },

  async replaceDestinations(householdId: string, id: string, destinationIds: string[]) {
    await requireIdea(householdId, id);
    await prisma.$transaction(async (tx) => {
      await assertOwnedReferences(tx, householdId, { destinationIds });
      await tx.ideaDestination.deleteMany({ where: { ideaId: id } });
      if (destinationIds.length > 0) {
        await tx.ideaDestination.createMany({
          data: [...new Set(destinationIds)].map((destinationId) => ({
            ideaId: id,
            destinationId,
          })),
        });
      }
    });
    return this.get(householdId, id);
  },

  async addLink(householdId: string, id: string, input: IdeaLinkInput) {
    await requireIdea(householdId, id);
    return prisma.ideaLink.create({ data: { ideaId: id, ...input } });
  },

  async updateLink(
    householdId: string,
    ideaId: string,
    linkId: string,
    input: Partial<IdeaLinkInput>,
  ) {
    const link = await prisma.ideaLink.findFirst({
      where: { id: linkId, ideaId, idea: { householdId, deletedAt: null } },
    });
    if (!link) notFound("Idea link");
    return prisma.ideaLink.update({ where: { id: linkId }, data: input });
  },

  async deleteLink(householdId: string, ideaId: string, linkId: string) {
    const result = await prisma.ideaLink.deleteMany({
      where: { id: linkId, ideaId, idea: { householdId, deletedAt: null } },
    });
    if (result.count === 0) notFound("Idea link");
  },

  async setWeather(householdId: string, id: string, input: WeatherInput) {
    await requireIdea(householdId, id);
    return prisma.weatherSuitability.upsert({
      where: { ideaId: id },
      create: { ideaId: id, ...input },
      update: input,
    });
  },

  async setAvailability(householdId: string, id: string, input: AvailabilityInput) {
    await requireIdea(householdId, id);
    const data = {
      mode: input.mode,
      rangeStartDate: input.mode === "DATE_RANGE" ? input.rangeStartDate : null,
      rangeEndDate: input.mode === "DATE_RANGE" ? input.rangeEndDate : null,
    };
    return prisma.availability.upsert({
      where: { ideaId: id },
      create: { ideaId: id, ...data },
      update: data,
    });
  },

  async addOccurrence(householdId: string, ideaId: string, input: OccurrenceCreateInput) {
    await requireIdea(householdId, ideaId);
    const projection = projectLocalTimes({
      localDate: input.localDate,
      startLocalTime: input.startLocalTime,
      endLocalTime: input.endLocalTime,
      timeZone: input.timeZone,
    });
    const occurrence = await prisma.specificOccurrence.create({
      data: {
        ideaId,
        localDate: input.localDate,
        timeZone: projection.startMinute === null ? null : input.timeZone,
        ...projection,
      },
    });
    return {
      ...occurrence,
      startLocalTime: minuteToLocalTime(occurrence.startMinute),
      endLocalTime: minuteToLocalTime(occurrence.endMinute),
    };
  },

  async updateOccurrence(
    householdId: string,
    ideaId: string,
    occurrenceId: string,
    input: OccurrenceUpdateInput,
  ) {
    await requireIdea(householdId, ideaId);
    const existing = await prisma.specificOccurrence.findFirst({
      where: { id: occurrenceId, ideaId },
    });
    if (!existing) notFound("Occurrence");

    const localDate = (input.localDate ?? existing.localDate) as CalendarDate;
    const startLocalTime =
      input.startLocalTime === undefined
        ? minuteToLocalTime(existing.startMinute)
        : input.startLocalTime;
    const endLocalTime =
      input.endLocalTime === undefined ? minuteToLocalTime(existing.endMinute) : input.endLocalTime;
    const timeZone = input.timeZone === undefined ? existing.timeZone : input.timeZone;
    const projection = projectLocalTimes({ localDate, startLocalTime, endLocalTime, timeZone });

    const occurrence = await prisma.specificOccurrence.update({
      where: { id: occurrenceId },
      data: {
        localDate,
        timeZone: projection.startMinute === null ? null : timeZone,
        ...projection,
      },
    });
    return {
      ...occurrence,
      startLocalTime: minuteToLocalTime(occurrence.startMinute),
      endLocalTime: minuteToLocalTime(occurrence.endMinute),
    };
  },

  async deleteOccurrence(householdId: string, ideaId: string, occurrenceId: string) {
    await requireIdea(householdId, ideaId);
    const result = await prisma.specificOccurrence.deleteMany({
      where: { id: occurrenceId, ideaId },
    });
    if (result.count === 0) notFound("Occurrence");
  },
};
