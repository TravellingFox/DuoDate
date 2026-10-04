import type { Prisma } from "@prisma/client";
import { normalizeHandle } from "./auth";
import { env } from "./env";
import { prisma } from "./prisma";
import { provisionCanonicalCatalog } from "./scripts/provision";

interface DevelopmentProfile {
  id: string;
  displayName: string;
  loginHandle: string;
}

function configuredDevelopmentProfiles(): [DevelopmentProfile, DevelopmentProfile] {
  return [
    {
      id: env.DUODATE_USER_ONE_ID,
      displayName: env.DUODATE_USER_ONE_DISPLAY_NAME ?? "Pablo",
      loginHandle: normalizeHandle(env.DUODATE_USER_ONE_HANDLE ?? "pablo-development"),
    },
    {
      id: env.DUODATE_USER_TWO_ID,
      displayName: env.DUODATE_USER_TWO_DISPLAY_NAME ?? "Luane",
      loginHandle: normalizeHandle(env.DUODATE_USER_TWO_HANDLE ?? "luane-development"),
    },
  ];
}

async function ensureDevelopmentProfile(
  tx: Prisma.TransactionClient,
  profile: DevelopmentProfile,
): Promise<void> {
  const conflictingProfile = await tx.userProfile.findUnique({
    where: { loginHandle: profile.loginHandle },
    select: { id: true },
  });
  if (conflictingProfile && conflictingProfile.id !== profile.id) {
    throw new Error(
      `Development authentication refused: login handle ${profile.loginHandle} is already in use`,
    );
  }

  await tx.userProfile.upsert({
    where: { id: profile.id },
    create: profile,
    update: {
      displayName: profile.displayName,
      loginHandle: profile.loginHandle,
      disabledAt: null,
    },
  });

  const credential = await tx.authCredential.findUnique({
    where: { userId: profile.id },
    select: { userId: true },
  });
  if (!credential) {
    const passphrase =
      profile.id === env.DUODATE_USER_ONE_ID
        ? env.DUODATE_USER_ONE_PASSPHRASE
        : env.DUODATE_USER_TWO_PASSPHRASE;
    await tx.authCredential.create({
      data: {
        userId: profile.id,
        passwordHash: await Bun.password.hash(passphrase ?? crypto.randomUUID(), {
          algorithm: "argon2id",
        }),
      },
    });
  }

  await tx.householdMember.upsert({
    where: { userId: profile.id },
    create: { householdId: env.DUODATE_HOUSEHOLD_ID, userId: profile.id },
    update: { householdId: env.DUODATE_HOUSEHOLD_ID },
  });
}

export async function ensureDevelopmentAuthProfiles(): Promise<boolean> {
  if (env.NODE_ENV !== "development" || !env.DUODATE_DEV_AUTH_BYPASS) return false;

  const profiles = configuredDevelopmentProfiles();
  if (
    profiles[0].id === profiles[1].id ||
    profiles[0].loginHandle === profiles[1].loginHandle
  ) {
    throw new Error("Development authentication requires two distinct profiles");
  }

  await prisma.$transaction(async (tx) => {
    const unexpectedHousehold = await tx.household.findFirst({
      where: { id: { not: env.DUODATE_HOUSEHOLD_ID } },
      select: { id: true },
    });
    if (unexpectedHousehold) {
      throw new Error(
        "Development authentication refused: the database contains an unexpected household",
      );
    }

    await tx.household.upsert({
      where: { id: env.DUODATE_HOUSEHOLD_ID },
      create: {
        id: env.DUODATE_HOUSEHOLD_ID,
        defaultTimeZone: env.DUODATE_DEFAULT_TIME_ZONE,
        suggestionSeed: crypto.randomUUID(),
      },
      update: {},
    });
    await tx.householdSettings.upsert({
      where: { householdId: env.DUODATE_HOUSEHOLD_ID },
      create: { householdId: env.DUODATE_HOUSEHOLD_ID },
      update: {},
    });

    for (const profile of profiles) {
      await ensureDevelopmentProfile(tx, profile);
    }

    await provisionCanonicalCatalog(tx, env.DUODATE_HOUSEHOLD_ID);
  });

  return true;
}
