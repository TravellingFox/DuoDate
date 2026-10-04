import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../env";
import { prisma } from "../prisma";

type InvariantClient = Pick<PrismaClient, "household" | "userProfile" | "householdMember"> | Prisma.TransactionClient;

export async function validatePrivateAppInvariant(
  client: InvariantClient = prisma,
): Promise<void> {
  const [households, enabledProfiles, memberships] = await Promise.all([
    client.household.findMany({ select: { id: true } }),
    client.userProfile.findMany({
      where: { disabledAt: null },
      select: { id: true },
    }),
    client.householdMember.findMany({
      select: {
        householdId: true,
        userId: true,
        user: { select: { disabledAt: true } },
      },
    }),
  ]);

  const expectedUserIds = new Set([env.DUODATE_USER_ONE_ID, env.DUODATE_USER_TWO_ID]);
  const enabledUserIds = new Set(enabledProfiles.map(({ id }) => id));
  const valid =
    households.length === 1 &&
    households[0]?.id === env.DUODATE_HOUSEHOLD_ID &&
    enabledProfiles.length === 2 &&
    enabledUserIds.size === 2 &&
    [...expectedUserIds].every((id) => enabledUserIds.has(id)) &&
    memberships.length === 2 &&
    memberships.every(
      (membership) =>
        membership.householdId === env.DUODATE_HOUSEHOLD_ID &&
        expectedUserIds.has(membership.userId) &&
        membership.user.disabledAt === null,
    );

  if (!valid) {
    throw new Error(
      "DuoDate startup invariant failed: expected one configured household, exactly two enabled configured profiles, and exactly two valid memberships",
    );
  }
}
