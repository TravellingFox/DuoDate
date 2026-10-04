import { Prisma } from "@prisma/client";
import { conflict, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import type { DeviceRegistrationInput } from "../types";

function publicDevice(device: {
  id: string;
  installationId: string;
  platform: "ANDROID";
  label: string | null;
  pushToken: string | null;
  lastSeenAt: Date;
  disabledAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: device.id,
    installationId: device.installationId,
    platform: device.platform,
    label: device.label,
    hasPushToken: device.pushToken !== null,
    lastSeenAt: device.lastSeenAt,
    disabledAt: device.disabledAt,
    revokedAt: device.revokedAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

export const deviceService = {
  async listOwn(householdId: string, userId: string) {
    const devices = await prisma.device.findMany({
      where: { householdId, userId, revokedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return devices.map(publicDevice);
  },

  async register(
    householdId: string,
    userId: string,
    authSessionId: string,
    input: DeviceRegistrationInput,
  ) {
    try {
      const device = await prisma.$transaction(async (tx) => {
        const now = new Date();
        await tx.device.updateMany({
          where: {
            installationId: input.installationId,
            NOT: { userId },
            revokedAt: null,
          },
          data: { revokedAt: now, pushToken: null, authSessionId: null },
        });
        if (input.pushToken) {
          await tx.device.updateMany({
            where: {
              pushToken: input.pushToken,
              NOT: { userId, installationId: input.installationId },
            },
            data: { revokedAt: now, pushToken: null, authSessionId: null },
          });
        }

        return tx.device.upsert({
          where: { userId_installationId: { userId, installationId: input.installationId } },
          create: {
            householdId,
            userId,
            authSessionId,
            ...input,
            disabledAt: null,
            revokedAt: null,
            lastSeenAt: now,
          },
          update: {
            householdId,
            authSessionId,
            pushToken: input.pushToken,
            platform: input.platform,
            label: input.label,
            disabledAt: null,
            revokedAt: null,
            lastSeenAt: now,
          },
        });
      });
      return publicDevice(device);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        conflict("That device registration could not be safely reassigned");
      }
      throw error;
    }
  },

  async revoke(householdId: string, userId: string, id: string) {
    const result = await prisma.device.updateMany({
      where: { id, householdId, userId, revokedAt: null },
      data: { revokedAt: new Date(), pushToken: null, authSessionId: null },
    });
    if (result.count === 0) notFound("Device");
  },

  async revokeInstallation(householdId: string, userId: string, installationId: string) {
    await prisma.device.updateMany({
      where: { householdId, userId, installationId, revokedAt: null },
      data: { revokedAt: new Date(), pushToken: null, authSessionId: null },
    });
  },
};
