import type { CostBasis } from "@prisma/client";
import { prisma } from "../prisma";
import { recomputeCostFields } from "./idea-normalization";

const costFields = {
  costBand: true,
  exactCostCents: true,
  costBasisAtEntry: true,
  costMinTotalCents: true,
  costMaxTotalCents: true,
  exactCostTotalCents: true,
} as const;

export const householdSettingsService = {
  async setCostBasis(householdId: string, costBasis: CostBasis) {
    return prisma.$transaction(async (tx) => {
      const settings = await tx.householdSettings.update({
        where: { householdId },
        data: { costBasis },
      });
      const ideas = await tx.idea.findMany({
        where: { householdId },
        select: { id: true, ...costFields },
      });

      for (const idea of ideas) {
        await tx.idea.update({
          where: { id: idea.id },
          data: recomputeCostFields(idea, costBasis),
        });
      }

      return settings;
    });
  },
};
