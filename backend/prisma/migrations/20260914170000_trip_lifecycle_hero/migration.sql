ALTER TABLE "Trip" ADD COLUMN "cancelledAt" DATETIME;

CREATE INDEX "Trip_householdId_cancelledAt_startDate_endDate_idx"
ON "Trip"("householdId", "cancelledAt", "startDate", "endDate");

CREATE TABLE "TripHeroImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
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
    CONSTRAINT "TripHeroImage_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TripHeroImage_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TripHeroImage_activeSlot_key" ON "TripHeroImage"("activeSlot");
CREATE UNIQUE INDEX "TripHeroImage_storageObjectKey_key" ON "TripHeroImage"("storageObjectKey");
CREATE INDEX "TripHeroImage_tripId_state_createdAt_idx" ON "TripHeroImage"("tripId", "state", "createdAt");
CREATE INDEX "TripHeroImage_uploaderId_idx" ON "TripHeroImage"("uploaderId");
CREATE INDEX "TripHeroImage_state_createdAt_idx" ON "TripHeroImage"("state", "createdAt");
