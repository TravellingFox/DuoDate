import { PrismaClient } from "@prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDatabaseUrl?: string;
};

process.env.DATABASE_URL ??= env.DATABASE_URL;

export const prisma =
  globalForPrisma.prisma && globalForPrisma.prismaDatabaseUrl === env.DATABASE_URL
    ? globalForPrisma.prisma
    : new PrismaClient({ datasourceUrl: env.DATABASE_URL });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDatabaseUrl = env.DATABASE_URL;
}

let initialization: Promise<void> | undefined;

export function initializeDatabase(): Promise<void> {
  initialization ??= (async () => {
    await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
    await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
  })();

  return initialization;
}
