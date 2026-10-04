ALTER TABLE "Idea" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Idea_householdId_clientRequestId_key"
ON "Idea"("householdId", "clientRequestId");
