import { ensureDevelopmentAuthProfiles } from "../development-auth";
import { initializeDatabase, prisma } from "../prisma";

async function main(): Promise<void> {
  await initializeDatabase();
  const ensured = await ensureDevelopmentAuthProfiles();
  console.log(
    ensured
      ? "Development authentication profiles are ready."
      : "Development authentication profile setup is disabled.",
  );
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
