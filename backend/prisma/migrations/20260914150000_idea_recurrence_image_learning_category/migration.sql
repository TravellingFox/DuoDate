ALTER TABLE "Idea" ADD COLUMN "recurrenceKind" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Idea" ADD COLUMN "recurrenceStartDate" TEXT;
ALTER TABLE "Idea" ADD COLUMN "recurrenceEndDate" TEXT;
ALTER TABLE "Idea" ADD COLUMN "recurrenceWeekdayMask" INTEGER;
ALTER TABLE "Idea" ADD COLUMN "recurrenceOrdinal" INTEGER;
ALTER TABLE "Idea" ADD COLUMN "recurrenceWeekday" TEXT;

CREATE TABLE "IdeaImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ideaId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "activeSlot" TEXT,
    "storageObjectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptedDataKey" TEXT NOT NULL,
    "keyWrapNonce" TEXT NOT NULL,
    "keyWrapAuthTag" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastStorageError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IdeaImage_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IdeaImage_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "IdeaImage_activeSlot_key" ON "IdeaImage"("activeSlot");
CREATE UNIQUE INDEX "IdeaImage_storageObjectKey_key" ON "IdeaImage"("storageObjectKey");
CREATE INDEX "IdeaImage_ideaId_state_createdAt_idx" ON "IdeaImage"("ideaId", "state", "createdAt");
CREATE INDEX "IdeaImage_uploaderId_idx" ON "IdeaImage"("uploaderId");
CREATE INDEX "IdeaImage_state_createdAt_idx" ON "IdeaImage"("state", "createdAt");

INSERT INTO "Category" (
    "id", "householdId", "name", "sortOrder", "deletedAt", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    household."id",
    'Learning Something',
    6,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Household" AS household
WHERE true
ON CONFLICT("householdId", "name") DO UPDATE SET
    "sortOrder" = excluded."sortOrder",
    "deletedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP;
