-- CreateTable
CREATE TABLE "SuggestionSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "targetDate" TEXT NOT NULL,
    "normalizedFiltersJson" TEXT NOT NULL,
    "filterHash" TEXT NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SuggestionSet_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SuggestionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "suggestionSetId" TEXT NOT NULL,
    "ideaId" TEXT,
    "position" INTEGER NOT NULL,
    "weatherScore" INTEGER NOT NULL,
    "deterministicRank" TEXT NOT NULL,
    "invalidatedAt" DATETIME,
    "invalidationReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SuggestionItem_suggestionSetId_fkey" FOREIGN KEY ("suggestionSetId") REFERENCES "SuggestionSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SuggestionItem_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SuggestionSet_householdId_createdAt_idx" ON "SuggestionSet"("householdId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionSet_householdId_targetDate_filterHash_algorithmVersion_key" ON "SuggestionSet"("householdId", "targetDate", "filterHash", "algorithmVersion");

-- CreateIndex
CREATE INDEX "SuggestionItem_ideaId_idx" ON "SuggestionItem"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionItem_suggestionSetId_position_key" ON "SuggestionItem"("suggestionSetId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionItem_suggestionSetId_ideaId_key" ON "SuggestionItem"("suggestionSetId", "ideaId");
