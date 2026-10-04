import { initializeDatabase, prisma } from "../prisma";
import { runNotificationSweep } from "../services/notification-service";

try {
  await initializeDatabase();
  const result = await runNotificationSweep();
  console.log(
    `Notification sweep complete: ${result.intentsProcessed} intents processed, ${result.receiptsChecked} receipts checked`,
  );
} catch (error) {
  console.error("Notification sweep failed", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
