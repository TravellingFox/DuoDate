-- RedefineTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

UPDATE "Memory" SET "coverMediaId" = NULL WHERE "coverMediaId" IS NOT NULL;

CREATE TABLE "new_MemoryMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
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
    "caption" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastStorageError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryMedia_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryMedia_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_MemoryMedia" (
    "id", "memoryId", "uploaderId", "kind", "state", "storageObjectKey", "contentType",
    "byteSize", "encryptionVersion", "keyVersion", "encryptedDataKey", "keyWrapNonce",
    "keyWrapAuthTag", "nonce", "authTag", "caption", "sortOrder", "createdAt", "updatedAt"
)
SELECT
    media."id", media."memoryId", contribution."authorId", media."kind", 'PENDING',
    media."storageObjectKey", media."contentType", media."byteSize", media."encryptionVersion",
    1, media."encryptedDataKey", '', '', media."nonce", media."authTag", media."caption",
    media."sortOrder", media."createdAt", media."updatedAt"
FROM "MemoryMedia" AS media
JOIN "MemoryContribution" AS contribution ON contribution."id" = media."contributionId";

DROP TABLE "MemoryMedia";
ALTER TABLE "new_MemoryMedia" RENAME TO "MemoryMedia";

CREATE UNIQUE INDEX "MemoryMedia_storageObjectKey_key" ON "MemoryMedia"("storageObjectKey");
CREATE INDEX "MemoryMedia_memoryId_state_sortOrder_idx" ON "MemoryMedia"("memoryId", "state", "sortOrder");
CREATE INDEX "MemoryMedia_uploaderId_idx" ON "MemoryMedia"("uploaderId");
CREATE INDEX "MemoryMedia_state_createdAt_idx" ON "MemoryMedia"("state", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
