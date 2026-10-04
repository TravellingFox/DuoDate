-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "defaultTimeZone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "suggestionSeed" TEXT NOT NULL,
    "maintenanceCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HouseholdSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "costBasis" TEXT NOT NULL DEFAULT 'PER_PERSON',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HouseholdSettings_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "loginHandle" TEXT NOT NULL,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuthCredential" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "passwordHash" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuthCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "deviceLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" DATETIME,
    "lastFailedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "pushToken" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'ANDROID',
    "label" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorToken" TEXT,
    "iconKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "timeZone" TEXT,
    "retiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Space_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "specificLocation" TEXT,
    "notes" TEXT,
    "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
    "costBand" TEXT,
    "costBasisAtEntry" TEXT,
    "costMinTotalCents" INTEGER,
    "costMaxTotalCents" INTEGER,
    "exactCostTotalCents" INTEGER,
    "durationBand" TEXT,
    "durationRank" INTEGER,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Idea_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Idea_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Idea_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdeaSpace" (
    "ideaId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,

    PRIMARY KEY ("ideaId", "spaceId"),
    CONSTRAINT "IdeaSpace_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IdeaSpace_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdeaDestination" (
    "ideaId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,

    PRIMARY KEY ("ideaId", "destinationId"),
    CONSTRAINT "IdeaDestination_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IdeaDestination_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdeaLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ideaId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IdeaLink_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeatherSuitability" (
    "ideaId" TEXT NOT NULL PRIMARY KEY,
    "sunny" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "rainy" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "indoor" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "outdoor" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeatherSuitability_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Availability" (
    "ideaId" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'ANYTIME',
    "rangeStartDate" TEXT,
    "rangeEndDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Availability_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpecificOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ideaId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "timeZone" TEXT,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpecificOccurrence_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "occurrenceId" TEXT,
    "createdById" TEXT NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "timeZone" TEXT NOT NULL,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "cleanupDueAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "activeSlot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Schedule_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Schedule_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "SpecificOccurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Schedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Destination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "country" TEXT,
    "notes" TEXT,
    "colorToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Destination_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "name" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trip_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trip_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "sourceIdeaId" TEXT,
    "sourceScheduleId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "locationSnapshot" TEXT,
    "categorySnapshot" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "generalText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CAPTURE_REQUIRED',
    "captureDueAt" DATETIME,
    "resolvedAt" DATETIME,
    "coverMediaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Memory_sourceIdeaId_fkey" FOREIGN KEY ("sourceIdeaId") REFERENCES "Idea" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Memory_sourceScheduleId_fkey" FOREIGN KEY ("sourceScheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Memory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Memory_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Memory_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "MemoryMedia" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryContribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryContribution_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryContribution_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageObjectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "encryptionVersion" INTEGER NOT NULL,
    "encryptedDataKey" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryMedia_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryMedia_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "MemoryContribution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdSettings_householdId_key" ON "HouseholdSettings"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_loginHandle_key" ON "UserProfile"("loginHandle");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_userId_key" ON "HouseholdMember"("userId");

-- CreateIndex
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_pushToken_key" ON "Device"("pushToken");

-- CreateIndex
CREATE INDEX "Device_householdId_userId_idx" ON "Device"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_installationId_key" ON "Device"("userId", "installationId");

-- CreateIndex
CREATE INDEX "Space_householdId_retiredAt_sortOrder_idx" ON "Space"("householdId", "retiredAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Space_householdId_name_key" ON "Space"("householdId", "name");

-- CreateIndex
CREATE INDEX "Category_householdId_deletedAt_sortOrder_idx" ON "Category"("householdId", "deletedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Category_householdId_name_key" ON "Category"("householdId", "name");

-- CreateIndex
CREATE INDEX "Idea_householdId_deletedAt_lifecycle_idx" ON "Idea"("householdId", "deletedAt", "lifecycle");

-- CreateIndex
CREATE INDEX "Idea_categoryId_idx" ON "Idea"("categoryId");

-- CreateIndex
CREATE INDEX "IdeaSpace_spaceId_idx" ON "IdeaSpace"("spaceId");

-- CreateIndex
CREATE INDEX "IdeaDestination_destinationId_idx" ON "IdeaDestination"("destinationId");

-- CreateIndex
CREATE INDEX "IdeaLink_ideaId_sortOrder_idx" ON "IdeaLink"("ideaId", "sortOrder");

-- CreateIndex
CREATE INDEX "SpecificOccurrence_ideaId_localDate_idx" ON "SpecificOccurrence"("ideaId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_activeSlot_key" ON "Schedule"("activeSlot");

-- CreateIndex
CREATE INDEX "Schedule_householdId_scheduledDate_status_idx" ON "Schedule"("householdId", "scheduledDate", "status");

-- CreateIndex
CREATE INDEX "Schedule_ideaId_idx" ON "Schedule"("ideaId");

-- CreateIndex
CREATE INDEX "Destination_householdId_name_idx" ON "Destination"("householdId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Destination_householdId_name_key" ON "Destination"("householdId", "name");

-- CreateIndex
CREATE INDEX "Trip_householdId_startDate_endDate_idx" ON "Trip"("householdId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Trip_destinationId_idx" ON "Trip"("destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_sourceScheduleId_key" ON "Memory"("sourceScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_coverMediaId_key" ON "Memory"("coverMediaId");

-- CreateIndex
CREATE INDEX "Memory_householdId_startDate_idx" ON "Memory"("householdId", "startDate");

-- CreateIndex
CREATE INDEX "Memory_sourceIdeaId_idx" ON "Memory"("sourceIdeaId");

-- CreateIndex
CREATE INDEX "Memory_status_captureDueAt_idx" ON "Memory"("status", "captureDueAt");

-- CreateIndex
CREATE INDEX "MemoryContribution_memoryId_sortOrder_idx" ON "MemoryContribution"("memoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "MemoryContribution_authorId_idx" ON "MemoryContribution"("authorId");

-- CreateIndex
CREATE INDEX "MemoryMedia_memoryId_sortOrder_idx" ON "MemoryMedia"("memoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "MemoryMedia_contributionId_idx" ON "MemoryMedia"("contributionId");
