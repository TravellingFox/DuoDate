import type { Prisma } from "@prisma/client";
import { env } from "../env";
import { isIanaTimeZone } from "../lib/date-time";
import { initializeDatabase, prisma } from "../prisma";
import { normalizeHandle } from "../auth";

interface ProfileConfiguration {
  id: string;
  displayName: string;
  loginHandle: string;
  passphrase: string;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for provisioning`);
  return value;
}

export const canonicalCategories = [
  { name: "Get Active", sortOrder: 0 },
  { name: "Outdoors", sortOrder: 1 },
  { name: "Food & Drink", sortOrder: 2 },
  { name: "Museums", sortOrder: 3 },
  { name: "Culture", sortOrder: 4 },
  { name: "Mini Adventures", sortOrder: 5 },
  { name: "Learning Something", sortOrder: 6 },
] as const;

export const canonicalSpaces = [
  { name: "Berlin", timeZone: "Europe/Berlin", sortOrder: 0 },
  { name: "Salvador", timeZone: "America/Bahia", sortOrder: 1 },
  { name: "Online", timeZone: null, sortOrder: 2 },
] as const;

export async function provisionCanonicalCatalog(
  tx: Prisma.TransactionClient,
  householdId: string,
): Promise<void> {
  // Include retired records: defaults must not recreate renamed/retired Spaces
  // or add canonical names to an existing custom catalog.
  if ((await tx.space.count({ where: { householdId } })) === 0) {
    await tx.space.createMany({
      data: canonicalSpaces.map((space) => ({ householdId, ...space })),
    });
  }

  await provisionCanonicalCategories(tx, householdId);
}

export async function provisionCanonicalCategories(
  tx: Prisma.TransactionClient,
  householdId: string,
): Promise<void> {
  // Defaults initialize an empty catalog only. Include tombstones so a deleted
  // or customized catalog is never repopulated on provisioning or restart.
  if ((await tx.category.count({ where: { householdId } })) !== 0) return;

  await tx.category.createMany({
    data: canonicalCategories.map((category) => ({ householdId, ...category })),
  });
}

async function main() {
  await initializeDatabase();

  if (!isIanaTimeZone(env.DUODATE_DEFAULT_TIME_ZONE)) {
    throw new Error("DUODATE_DEFAULT_TIME_ZONE must be a valid IANA timezone");
  }

  const profiles: [ProfileConfiguration, ProfileConfiguration] = [
    {
      id: env.DUODATE_USER_ONE_ID,
      displayName: required(
        env.DUODATE_USER_ONE_DISPLAY_NAME,
        "DUODATE_USER_ONE_DISPLAY_NAME",
      ),
      loginHandle: normalizeHandle(
        required(env.DUODATE_USER_ONE_HANDLE, "DUODATE_USER_ONE_HANDLE"),
      ),
      passphrase: required(
        env.DUODATE_USER_ONE_PASSPHRASE,
        "DUODATE_USER_ONE_PASSPHRASE",
      ),
    },
    {
      id: env.DUODATE_USER_TWO_ID,
      displayName: required(
        env.DUODATE_USER_TWO_DISPLAY_NAME,
        "DUODATE_USER_TWO_DISPLAY_NAME",
      ),
      loginHandle: normalizeHandle(
        required(env.DUODATE_USER_TWO_HANDLE, "DUODATE_USER_TWO_HANDLE"),
      ),
      passphrase: required(
        env.DUODATE_USER_TWO_PASSPHRASE,
        "DUODATE_USER_TWO_PASSPHRASE",
      ),
    },
  ];

  if (profiles[0].id === profiles[1].id || profiles[0].loginHandle === profiles[1].loginHandle) {
    throw new Error("The two configured profiles must have distinct IDs and login handles");
  }

  await prisma.$transaction(async (tx) => {
    const existingHouseholds = await tx.household.findMany({ select: { id: true } });
    if (
      existingHouseholds.length > 1 ||
      (existingHouseholds.length === 1 && existingHouseholds[0]?.id !== env.DUODATE_HOUSEHOLD_ID)
    ) {
      throw new Error("Provisioning refused: the database contains an unexpected household");
    }

    await tx.household.upsert({
      where: { id: env.DUODATE_HOUSEHOLD_ID },
      create: {
        id: env.DUODATE_HOUSEHOLD_ID,
        defaultTimeZone: env.DUODATE_DEFAULT_TIME_ZONE,
        suggestionSeed: crypto.randomUUID(),
      },
      update: { defaultTimeZone: env.DUODATE_DEFAULT_TIME_ZONE },
    });

    await tx.householdSettings.upsert({
      where: { householdId: env.DUODATE_HOUSEHOLD_ID },
      create: { householdId: env.DUODATE_HOUSEHOLD_ID },
      update: {},
    });

    for (const profile of profiles) {
      const existing = await tx.userProfile.findUnique({
        where: { id: profile.id },
        include: { credential: true },
      });
      if (existing && existing.loginHandle !== profile.loginHandle) {
        const conflicting = await tx.userProfile.findUnique({
          where: { loginHandle: profile.loginHandle },
        });
        if (conflicting && conflicting.id !== profile.id) {
          throw new Error("Provisioning refused: configured login handle is already in use");
        }
      }

      await tx.userProfile.upsert({
        where: { id: profile.id },
        create: {
          id: profile.id,
          displayName: profile.displayName,
          loginHandle: profile.loginHandle,
        },
        update: {
          displayName: profile.displayName,
          loginHandle: profile.loginHandle,
          disabledAt: null,
        },
      });

      if (!existing?.credential) {
        await tx.authCredential.create({
          data: {
            userId: profile.id,
            passwordHash: await Bun.password.hash(profile.passphrase, {
              algorithm: "argon2id",
            }),
          },
        });
      } else if (!(await Bun.password.verify(profile.passphrase, existing.credential.passwordHash))) {
        await tx.authCredential.update({
          where: { userId: profile.id },
          data: {
            passwordHash: await Bun.password.hash(profile.passphrase, {
              algorithm: "argon2id",
            }),
            credentialVersion: { increment: 1 },
          },
        });
        const revokedAt = new Date();
        await tx.device.updateMany({
          where: { userId: profile.id, revokedAt: null },
          data: { revokedAt, pushToken: null, authSessionId: null },
        });
        await tx.authSession.updateMany({
          where: { userId: profile.id, revokedAt: null },
          data: { revokedAt },
        });
      }

      await tx.householdMember.upsert({
        where: { userId: profile.id },
        create: { householdId: env.DUODATE_HOUSEHOLD_ID, userId: profile.id },
        update: { householdId: env.DUODATE_HOUSEHOLD_ID },
      });
    }

    const allowedUserIds = profiles.map((profile) => profile.id);
    const unexpectedUsers = await tx.userProfile.count({
      where: { id: { notIn: allowedUserIds } },
    });
    const members = await tx.householdMember.count({
      where: { householdId: env.DUODATE_HOUSEHOLD_ID },
    });
    if (unexpectedUsers !== 0 || members !== 2) {
      throw new Error("Provisioning requires exactly the two configured profiles and memberships");
    }

    await provisionCanonicalCatalog(tx, env.DUODATE_HOUSEHOLD_ID);
  });

  console.log("DuoDate provisioned with one household and exactly two profiles.");
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
