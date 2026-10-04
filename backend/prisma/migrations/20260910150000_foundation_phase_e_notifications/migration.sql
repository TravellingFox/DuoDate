-- AlterTable
ALTER TABLE "Device" ADD COLUMN "authSessionId" TEXT REFERENCES "AuthSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "NotificationIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "memoryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "earliestAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL,
    "claimedAt" DATETIME,
    "sentAt" DATETIME,
    "cancelledAt" DATETIME,
    "failedAt" DATETIME,
    "lastErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationIntent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationIntent_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationIntent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "UserProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NotificationIntent_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intentId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL,
    "claimedAt" DATETIME,
    "expoTicketId" TEXT,
    "receiptAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "receiptNextAt" DATETIME,
    "sentAt" DATETIME,
    "cancelledAt" DATETIME,
    "failedAt" DATETIME,
    "lastErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationDelivery_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "NotificationIntent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Device_installationId_idx" ON "Device"("installationId");

-- CreateIndex
CREATE INDEX "Device_authSessionId_idx" ON "Device"("authSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationIntent_dedupeKey_key" ON "NotificationIntent"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationIntent_status_nextAttemptAt_idx" ON "NotificationIntent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationIntent_householdId_recipientUserId_status_idx" ON "NotificationIntent"("householdId", "recipientUserId", "status");

-- CreateIndex
CREATE INDEX "NotificationIntent_memoryId_type_idx" ON "NotificationIntent"("memoryId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_expoTicketId_key" ON "NotificationDelivery"("expoTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_intentId_deviceId_key" ON "NotificationDelivery"("intentId", "deviceId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_receiptNextAt_idx" ON "NotificationDelivery"("status", "receiptNextAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_deviceId_status_idx" ON "NotificationDelivery"("deviceId", "status");
