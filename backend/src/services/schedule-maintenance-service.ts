import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export async function markScheduleMissedIfStillDue(
  tx: Prisma.TransactionClient,
  householdId: string,
  scheduleId: string,
  now: Date,
): Promise<boolean> {
  const result = await tx.schedule.updateMany({
    where: {
      id: scheduleId,
      householdId,
      status: "SCHEDULED",
      cleanupDueAt: { lte: now },
    },
    data: {
      status: "MISSED",
      activeSlot: null,
    },
  });
  return result.count === 1;
}

interface MaintenanceResult {
  transitionedCount: number;
}

const activeMaintenanceRuns = new Map<string, Promise<MaintenanceResult>>();

export const scheduleMaintenanceService = {
  async run(householdId: string, now = new Date()): Promise<MaintenanceResult> {
    const activeRun = activeMaintenanceRuns.get(householdId);
    if (activeRun) return activeRun;

    const run = prisma.$transaction(async (tx) => {
      const dueSchedules = await tx.schedule.findMany({
        where: {
          householdId,
          status: "SCHEDULED",
          cleanupDueAt: { lte: now },
        },
        select: { id: true },
      });

      let transitionedCount = 0;
      for (const { id } of dueSchedules) {
        if (await markScheduleMissedIfStillDue(tx, householdId, id, now)) {
          transitionedCount += 1;
        }
      }

      await tx.household.updateMany({
        where: { id: householdId },
        data: { maintenanceCheckedAt: now },
      });

      return { transitionedCount };
    });
    activeMaintenanceRuns.set(householdId, run);

    try {
      return await run;
    } finally {
      if (activeMaintenanceRuns.get(householdId) === run) {
        activeMaintenanceRuns.delete(householdId);
      }
    }
  },
};
