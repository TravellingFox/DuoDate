import { initializeDatabase, prisma } from "../prisma";
import { validatePrivateAppInvariant } from "../services/startup-invariant";

async function main() {
  await initializeDatabase();
  await validatePrivateAppInvariant();
  console.log("DuoDate startup invariant is valid.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
