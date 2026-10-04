-- CreateIndex
CREATE INDEX "Schedule_householdId_status_cleanupDueAt_idx" ON "Schedule"("householdId", "status", "cleanupDueAt");
