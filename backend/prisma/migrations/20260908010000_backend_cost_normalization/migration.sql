-- Preserve the human-entered exact amount separately from server-derived totals.
ALTER TABLE "Idea" ADD COLUMN "exactCostCents" INTEGER;

-- Backfill values written before exactCostCents existed. PER_PERSON totals
-- were always multiplied by two by the backend, so this division is exact.
UPDATE "Idea"
SET "exactCostCents" = CASE
  WHEN "exactCostTotalCents" IS NULL THEN NULL
  WHEN "costBasisAtEntry" = 'PER_PERSON' THEN "exactCostTotalCents" / 2
  ELSE "exactCostTotalCents"
END;
