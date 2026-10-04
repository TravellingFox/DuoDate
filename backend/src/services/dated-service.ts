import { Prisma } from "@prisma/client";
import { AppError, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import {
  publicMemoryInclude,
  serializeMemory,
  type PublicMemory,
} from "./memory-service";
import { createDatedNotificationIntents } from "./notification-service";
import { scheduleMaintenanceService } from "./schedule-maintenance-service";

const CAPTURE_WINDOW_MS = 48 * 60 * 60 * 1000;

class DatedTransitionLost extends Error {}

function scheduleStateConflict(status: "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED"): never {
  if (status === "MISSED") {
    throw new AppError(
      409,
      "SCHEDULE_MISSED",
      "A missed Schedule cannot be marked Dated",
    );
  }
  if (status === "CANCELLED") {
    throw new AppError(
      409,
      "SCHEDULE_CANCELLED",
      "A cancelled Schedule cannot be marked Dated",
    );
  }
  if (status === "SCHEDULED") {
    throw new AppError(
      409,
      "SCHEDULE_CHANGED",
      "The Schedule changed while it was being marked Dated; retry the action",
    );
  }
  throw new AppError(409, "SCHEDULE_NOT_DATEABLE", "This Schedule cannot be marked Dated");
}

async function resolveExistingDatedMemory(
  householdId: string,
  scheduleId: string,
  now: Date,
) {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, householdId },
    select: { status: true },
  });
  if (!schedule) notFound("Schedule");

  if (schedule.status === "COMPLETED") {
    const memory = await prisma.memory.findUnique({
      where: { sourceScheduleId: scheduleId },
      include: publicMemoryInclude,
    });
    if (memory?.householdId === householdId) return serializeMemory(memory, now);
  }

  scheduleStateConflict(schedule.status);
}

export const datedService = {
  async dateSchedule(
    householdId: string,
    userId: string,
    scheduleId: string,
    now = new Date(),
  ) {
    await scheduleMaintenanceService.run(householdId, now);

    try {
      const memory = await prisma.$transaction(async (tx): Promise<PublicMemory> => {
        const schedule = await tx.schedule.findFirst({
          where: { id: scheduleId, householdId },
          include: {
            idea: {
              include: { category: { select: { name: true } } },
            },
          },
        });
        if (!schedule) notFound("Schedule");

        if (schedule.status === "COMPLETED") {
          const existing = await tx.memory.findUnique({
            where: { sourceScheduleId: scheduleId },
            include: publicMemoryInclude,
          });
          if (existing?.householdId === householdId) return existing;
          scheduleStateConflict(schedule.status);
        }
        if (schedule.status !== "SCHEDULED") scheduleStateConflict(schedule.status);

        const transitioned = await tx.schedule.updateMany({
          where: {
            id: scheduleId,
            householdId,
            status: "SCHEDULED",
            updatedAt: schedule.updatedAt,
          },
          data: {
            status: "COMPLETED",
            activeSlot: null,
          },
        });
        if (transitioned.count === 0) throw new DatedTransitionLost();

        const completedIdea = await tx.idea.updateMany({
          where: {
            id: schedule.ideaId,
            householdId,
            updatedAt: schedule.idea.updatedAt,
          },
          data: { lifecycle: "COMPLETED" },
        });
        if (completedIdea.count === 0) throw new DatedTransitionLost();

        const captureDueAt = new Date(now.getTime() + CAPTURE_WINDOW_MS);
        const memory = await tx.memory.create({
          data: {
            householdId,
            sourceIdeaId: schedule.ideaId,
            sourceScheduleId: schedule.id,
            createdById: userId,
            updatedById: userId,
            title: schedule.idea.title,
            locationSnapshot: schedule.idea.specificLocation,
            categorySnapshot: schedule.idea.category?.name ?? null,
            startDate: schedule.scheduledDate,
            endDate: null,
            status: "CAPTURE_REQUIRED",
            captureDueAt,
            resolvedAt: null,
          },
          include: publicMemoryInclude,
        });
        await createDatedNotificationIntents(tx, {
          householdId,
          actorUserId: userId,
          memoryId: memory.id,
          captureDueAt,
          now,
        });
        return memory;
      });

      return serializeMemory(memory, now);
    } catch (error) {
      if (
        error instanceof DatedTransitionLost ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      ) {
        return resolveExistingDatedMemory(householdId, scheduleId, now);
      }
      throw error;
    }
  },
};
