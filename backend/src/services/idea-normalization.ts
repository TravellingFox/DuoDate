import type { CostBand, CostBasis, DurationBand, Idea } from "@prisma/client";
import { AppError } from "../lib/errors";

const enteredCostBounds: Record<CostBand, { min: number; max: number | null }> = {
  FREE: { min: 0, max: 0 },
  UNDER_20: { min: 0, max: 1_999 },
  FROM_20_TO_50: { min: 2_000, max: 5_000 },
  FROM_50_TO_100: { min: 5_000, max: 10_000 },
  FROM_100: { min: 10_000, max: null },
};

export const durationRanks: Record<DurationBand, number> = {
  UNDER_ONE_HOUR: 1,
  ONE_TO_TWO_HOURS: 2,
  TWO_TO_FOUR_HOURS: 3,
  HALF_DAY: 4,
  FULL_DAY: 5,
  OVERNIGHT_OR_MULTI_DAY: 6,
};

const durationBandsByRank = Object.fromEntries(
  Object.entries(durationRanks).map(([band, rank]) => [rank, band]),
) as Record<number, DurationBand>;

type CostInput = {
  costBand?: CostBand | null;
  exactCostCents?: number | null;
};

type ExistingCost = Pick<
  Idea,
  | "costBand"
  | "exactCostCents"
  | "costBasisAtEntry"
  | "costMinTotalCents"
  | "costMaxTotalCents"
  | "exactCostTotalCents"
>;

type NormalizedCost = Pick<
  Idea,
  | "costBand"
  | "exactCostCents"
  | "costBasisAtEntry"
  | "costMinTotalCents"
  | "costMaxTotalCents"
  | "exactCostTotalCents"
>;

type DurationInput = {
  durationBand?: DurationBand | null;
  durationRank?: number | null;
};

type ExistingDuration = Pick<Idea, "durationBand" | "durationRank">;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeEnteredCents(value: number, costBasis: CostBasis): number {
  return costBasis === "PER_PERSON" ? value * 2 : value;
}

function recoverExactCostCents(existing: ExistingCost): number | null {
  if (existing.exactCostCents !== null) return existing.exactCostCents;
  if (existing.exactCostTotalCents === null) return null;

  if (existing.costBasisAtEntry === "PER_PERSON") {
    if (existing.exactCostTotalCents % 2 !== 0) {
      throw new Error("Stored per-person exact cost cannot be recovered without losing cents");
    }
    return existing.exactCostTotalCents / 2;
  }

  return existing.exactCostTotalCents;
}

export function deriveCostFields(
  costBand: CostBand | null,
  exactCostCents: number | null,
  costBasis: CostBasis,
): NormalizedCost {
  if (costBand === null && exactCostCents === null) {
    return {
      costBand: null,
      exactCostCents: null,
      costBasisAtEntry: null,
      costMinTotalCents: null,
      costMaxTotalCents: null,
      exactCostTotalCents: null,
    };
  }

  const multiplier = costBasis === "PER_PERSON" ? 2 : 1;
  const bounds = costBand === null ? null : enteredCostBounds[costBand];
  const exactCostTotalCents =
    exactCostCents === null ? null : normalizeEnteredCents(exactCostCents, costBasis);

  return {
    costBand,
    exactCostCents,
    costBasisAtEntry: costBasis,
    costMinTotalCents: exactCostTotalCents ?? (bounds === null ? null : bounds.min * multiplier),
    costMaxTotalCents:
      exactCostTotalCents ?? (bounds?.max === null || bounds === null ? null : bounds.max * multiplier),
    exactCostTotalCents,
  };
}

export function normalizeMaximumBudget(
  input:
    | { kind: "BAND"; costBand: Exclude<CostBand, "FROM_100"> }
    | { kind: "EXACT"; exactCostCents: number },
  costBasis: CostBasis,
): number {
  const normalized =
    input.kind === "BAND"
      ? deriveCostFields(input.costBand, null, costBasis)
      : deriveCostFields(null, input.exactCostCents, costBasis);
  if (normalized.costMaxTotalCents === null) {
    throw new Error("A maximum budget must have a finite normalized ceiling");
  }
  return normalized.costMaxTotalCents;
}

export function normalizeCostFields(
  input: CostInput,
  costBasis: CostBasis,
  existing?: ExistingCost,
): Partial<NormalizedCost> {
  const hasBand = hasOwn(input, "costBand");
  const hasExact = hasOwn(input, "exactCostCents");
  if (existing && !hasBand && !hasExact) return {};

  const costBand = hasBand ? (input.costBand ?? null) : (existing?.costBand ?? null);
  const exactCostCents = hasExact
    ? (input.exactCostCents ?? null)
    : existing
      ? recoverExactCostCents(existing)
      : null;

  return deriveCostFields(costBand, exactCostCents, costBasis);
}

export function recomputeCostFields(
  existing: ExistingCost,
  costBasis: CostBasis,
): NormalizedCost {
  return deriveCostFields(existing.costBand, recoverExactCostCents(existing), costBasis);
}

export function normalizeDurationFields(
  input: DurationInput,
  existing?: ExistingDuration,
): Partial<ExistingDuration> {
  const hasBand = hasOwn(input, "durationBand");
  const hasRank = hasOwn(input, "durationRank");
  if (existing && !hasBand && !hasRank) return {};

  if ((hasBand && input.durationBand === null) || (hasRank && input.durationRank === null)) {
    return { durationBand: null, durationRank: null };
  }

  let durationBand = hasBand ? input.durationBand : existing?.durationBand;
  let durationRank = hasRank ? input.durationRank : existing?.durationRank;

  if (hasBand && !hasRank && durationBand) {
    durationRank = durationRanks[durationBand];
  } else if (hasRank && !hasBand && durationRank != null && !durationBand) {
    durationBand = durationBandsByRank[durationRank];
  }

  if (durationBand == null && durationRank == null) {
    return { durationBand: null, durationRank: null };
  }
  if (
    durationBand == null ||
    durationRank == null ||
    durationRanks[durationBand] !== durationRank
  ) {
    throw new AppError(
      400,
      "INVALID_DURATION",
      "Duration band and rank must describe the same duration",
    );
  }

  return { durationBand, durationRank };
}
