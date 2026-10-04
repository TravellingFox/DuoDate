import { Prisma } from "@prisma/client";
import { AppError, conflict, notFound } from "../lib/errors";
import {
  minuteToLocalTime,
  projectLocalTimes,
  scheduleCleanupDueAt,
  type CalendarDate,
} from "../lib/date-time";
import { prisma } from "../prisma";
import type { ScheduleCreateInput, ScheduleUpdateInput } from "../types";
import { scheduleMaintenanceService } from "./schedule-maintenance-service";

function serializeSchedule<T extends { startMinute: number | null; endMinute: number | null }>(
  schedule: T,
) {
  return {
    ...schedule,
    startLocalTime: minuteToLocalTime(schedule.startMinute),
    endLocalTime: minuteToLocalTime(schedule.endMinute),
  };
}

async function validateIdeaAndOccurrence(
  householdId: string,
  ideaId: string,
  occurrenceId?: string | null,
) {
  const idea = await prisma.idea.findFirst({
    where: { id: ideaId, householdId, deletedAt: null, lifecycle: "ACTIVE" },
  });
  if (!idea) throw new AppError(400, "INVALID_IDEA", "Idea is not available");

  if (!occurrenceId) return null;
  const occurrence = await prisma.specificOccurrence.findFirst({
    where: { id: occurrenceId, ideaId, idea: { householdId, deletedAt: null } },
  });
  if (!occurrence) throw new AppError(400, "INVALID_OCCURRENCE", "Occurrence is not available");
  return occurrence;
}

function translateActiveConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    conflict("This Idea already has an active Schedule");
  }
  throw error;
}

export const scheduleService = {
  async list(householdId: string) {
    await scheduleMaintenanceService.run(householdId);
    const schedules = await prisma.schedule.findMany({
      where: { householdId },
      include: { idea: { select: { id: true, title: true } }, occurrence: true },
      orderBy: [{ scheduledDate: "asc" }, { startMinute: "asc" }, { id: "asc" }],
    });
    return schedules.map(serializeSchedule);
  },

  async get(householdId: string, id: string) {
    await scheduleMaintenanceService.run(householdId);
    const schedule = await prisma.schedule.findFirst({
      where: { id, householdId },
      include: { idea: true, occurrence: true },
    });
    if (!schedule) notFound("Schedule");
    return serializeSchedule(schedule);
  },

  async create(householdId: string, userId: string, input: ScheduleCreateInput) {
    await scheduleMaintenanceService.run(householdId);
    await validateIdeaAndOccurrence(householdId, input.ideaId, input.occurrenceId);
    const projection = projectLocalTimes({
      localDate: input.scheduledDate,
      startLocalTime: input.startLocalTime,
      endLocalTime: input.endLocalTime,
      timeZone: input.timeZone,
    });
    const cleanupDueAt = scheduleCleanupDueAt({
      scheduledDate: input.scheduledDate,
      endMinute: projection.endMinute,
      timeZone: input.timeZone,
    });

    try {
      const schedule = await prisma.schedule.create({
        data: {
          householdId,
          ideaId: input.ideaId,
          occurrenceId: input.occurrenceId,
          createdById: userId,
          scheduledDate: input.scheduledDate,
          timeZone: input.timeZone,
          cleanupDueAt,
          activeSlot: input.ideaId,
          ...projection,
        },
        include: { idea: true, occurrence: true },
      });
      return serializeSchedule(schedule);
    } catch (error) {
      translateActiveConflict(error);
    }
  },

  async update(householdId: string, id: string, input: ScheduleUpdateInput) {
    await scheduleMaintenanceService.run(householdId);
    const existing = await prisma.schedule.findFirst({ where: { id, householdId } });
    if (!existing) notFound("Schedule");
    if (existing.status !== "SCHEDULED") {
      conflict("Only an active Schedule can be rescheduled");
    }

    const occurrenceId = input.occurrenceId === undefined ? existing.occurrenceId : input.occurrenceId;
    await validateIdeaAndOccurrence(householdId, existing.ideaId, occurrenceId);
    const scheduledDate = (input.scheduledDate ?? existing.scheduledDate) as CalendarDate;
    const startLocalTime =
      input.startLocalTime === undefined
        ? minuteToLocalTime(existing.startMinute)
        : input.startLocalTime;
    const endLocalTime =
      input.endLocalTime === undefined ? minuteToLocalTime(existing.endMinute) : input.endLocalTime;
    const timeZone = input.timeZone ?? existing.timeZone;
    const projection = projectLocalTimes({
      localDate: scheduledDate,
      startLocalTime,
      endLocalTime,
      timeZone,
    });
    const cleanupDueAt = scheduleCleanupDueAt({
      scheduledDate,
      endMinute: projection.endMinute,
      timeZone,
    });

    try {
      const result = await prisma.schedule.updateMany({
        where: { id, householdId, status: "SCHEDULED" },
        data: {
          occurrenceId,
          scheduledDate,
          timeZone,
          cleanupDueAt,
          ...projection,
        },
      });
      if (result.count === 0) conflict("Only an active Schedule can be rescheduled");
      return this.get(householdId, id);
    } catch (error) {
      translateActiveConflict(error);
    }
  },

  async cancel(householdId: string, id: string) {
    await scheduleMaintenanceService.run(householdId);
    const result = await prisma.schedule.updateMany({
      where: { id, householdId, status: "SCHEDULED" },
      data: { status: "CANCELLED", activeSlot: null },
    });
    if (result.count === 0) notFound("Active Schedule");
    return this.get(householdId, id);
  },
};
