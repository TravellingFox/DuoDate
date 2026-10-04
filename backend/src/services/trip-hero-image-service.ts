import { randomUUID } from "node:crypto";
import { Prisma, type TripHeroImage } from "@prisma/client";
import { env } from "../env";
import { AppError, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import type {
  PublicTripHeroImageDto,
  TripHeroImageUploadMetadata,
} from "../types";
import { getMediaStorageRuntime, type MediaStorageRuntime } from "../storage/media-storage";
import {
  decryptTripHeroImageObject,
  encryptTripHeroImageObject,
  MEDIA_ENCRYPTION_VERSION,
  MediaIntegrityError,
  type TripHeroImageAssociatedData,
} from "./media-encryption";
import { validateMediaUpload } from "./media-service";

export const publicTripHeroImageSelect = {
  id: true,
  tripId: true,
  contentType: true,
  byteSize: true,
  width: true,
  height: true,
  createdAt: true,
  updatedAt: true,
  uploader: { select: { id: true, displayName: true } },
} satisfies Prisma.TripHeroImageSelect;

type PublicTripHeroImage = Prisma.TripHeroImageGetPayload<{
  select: typeof publicTripHeroImageSelect;
}>;
type ImageWithHousehold = TripHeroImage & { trip: { householdId: string } };

export function serializeTripHeroImage(image: PublicTripHeroImage): PublicTripHeroImageDto {
  return {
    ...image,
    createdAt: image.createdAt.toISOString(),
    updatedAt: image.updatedAt.toISOString(),
    contentPath: `/api/trips/${image.tripId}/hero`,
  };
}

function associatedData(image: ImageWithHousehold): TripHeroImageAssociatedData {
  return {
    imageId: image.id,
    householdId: image.trip.householdId,
    tripId: image.tripId,
    uploaderId: image.uploaderId,
    contentType: image.contentType,
    byteSize: image.byteSize,
    encryptionVersion: image.encryptionVersion,
    keyVersion: image.keyVersion,
  };
}

async function requireTrip(householdId: string, tripId: string): Promise<void> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, householdId },
    select: { id: true },
  });
  if (!trip) notFound("Trip");
}

async function cleanupRecord(
  image: Pick<TripHeroImage, "id" | "storageObjectKey" | "state">,
  runtime: MediaStorageRuntime,
): Promise<boolean> {
  try {
    await runtime.storage.deleteObject(image.storageObjectKey);
    await prisma.tripHeroImage.deleteMany({ where: { id: image.id, state: image.state } });
    return true;
  } catch {
    await prisma.tripHeroImage.updateMany({
      where: { id: image.id, state: image.state },
      data: {
        cleanupAttempts: { increment: 1 },
        lastStorageError: "STORAGE_DELETE_FAILED",
      },
    });
    return false;
  }
}

export async function runTripHeroImageCleanup(
  householdId: string,
  now = new Date(),
): Promise<{ removed: number; pending: number }> {
  const runtime = getMediaStorageRuntime();
  const staleBefore = new Date(now.getTime() - env.MEDIA_PENDING_CLEANUP_MINUTES * 60_000);
  const records = await prisma.tripHeroImage.findMany({
    where: {
      trip: { householdId },
      OR: [
        { state: "DELETION_PENDING" },
        { state: "PENDING", createdAt: { lt: staleBefore } },
      ],
    },
    select: { id: true, storageObjectKey: true, state: true },
    orderBy: { createdAt: "asc" },
  });

  let removed = 0;
  for (const record of records) {
    if (record.state === "PENDING") {
      const claimed = await prisma.tripHeroImage.updateMany({
        where: { id: record.id, state: "PENDING", createdAt: { lt: staleBefore } },
        data: { state: "DELETION_PENDING", activeSlot: null },
      });
      if (claimed.count === 0) continue;
      record.state = "DELETION_PENDING";
    }
    if (await cleanupRecord(record, runtime)) removed += 1;
  }
  return { removed, pending: records.length - removed };
}

export async function runTripHeroImageCleanupIfConfigured(householdId: string): Promise<void> {
  try {
    await runTripHeroImageCleanup(householdId);
  } catch (error) {
    if (!(error instanceof AppError && error.code === "MEDIA_STORAGE_NOT_CONFIGURED")) throw error;
  }
}

async function cleanupAfterFailedUpload(
  image: Pick<TripHeroImage, "id" | "storageObjectKey" | "state">,
  runtime: MediaStorageRuntime,
): Promise<void> {
  await cleanupRecord(image, runtime);
}

export const tripHeroImageService = {
  async findPublicHero(
    householdId: string,
    tripId: string,
  ): Promise<PublicTripHeroImageDto | null> {
    const image = await prisma.tripHeroImage.findFirst({
      where: { tripId, state: "ACTIVE", trip: { householdId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: publicTripHeroImageSelect,
    });
    return image ? serializeTripHeroImage(image) : null;
  },

  async upload(
    householdId: string,
    userId: string,
    tripId: string,
    input: TripHeroImageUploadMetadata,
    declaredContentType: string,
    bytes: Uint8Array,
  ) {
    const runtime = getMediaStorageRuntime();
    await runTripHeroImageCleanupIfConfigured(householdId);
    await requireTrip(householdId, tripId);
    const contentType = validateMediaUpload("PHOTO", declaredContentType, bytes);
    const imageId = randomUUID();
    const keyVersion = runtime.currentKeyVersion;
    const masterKey = runtime.masterKeys.get(keyVersion);
    if (!masterKey) {
      throw new AppError(503, "MEDIA_KEY_UNAVAILABLE", "The current media encryption key is unavailable");
    }
    const encryptionContext: TripHeroImageAssociatedData = {
      imageId,
      householdId,
      tripId,
      uploaderId: userId,
      contentType,
      byteSize: bytes.byteLength,
      encryptionVersion: MEDIA_ENCRYPTION_VERSION,
      keyVersion,
    };
    const encrypted = encryptTripHeroImageObject(bytes, masterKey, encryptionContext);
    const storageObjectKey = `households/${householdId}/trips/${tripId}/hero/${imageId}.enc`;
    const pending = await prisma.tripHeroImage.create({
      data: {
        id: imageId,
        tripId,
        uploaderId: userId,
        state: "PENDING",
        storageObjectKey,
        contentType,
        byteSize: bytes.byteLength,
        encryptionVersion: MEDIA_ENCRYPTION_VERSION,
        keyVersion,
        encryptedDataKey: encrypted.encryptedDataKey,
        keyWrapNonce: encrypted.keyWrapNonce,
        keyWrapAuthTag: encrypted.keyWrapAuthTag,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        width: input.width,
        height: input.height,
      },
    });

    try {
      await runtime.storage.putObject(storageObjectKey, encrypted.ciphertext);
    } catch {
      await cleanupAfterFailedUpload(pending, runtime);
      throw new AppError(503, "MEDIA_STORAGE_WRITE_FAILED", "The encrypted Trip hero could not be stored");
    }

    let replaced: Pick<TripHeroImage, "id" | "storageObjectKey" | "state"> | null = null;
    let image: PublicTripHeroImage;
    try {
      image = await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findFirst({
          where: { id: tripId, householdId },
          select: { id: true },
        });
        if (!trip) notFound("Trip");

        replaced = await tx.tripHeroImage.findFirst({
          where: { tripId, state: "ACTIVE" },
          select: { id: true, storageObjectKey: true, state: true },
        });
        if (replaced) {
          replaced = await tx.tripHeroImage.update({
            where: { id: replaced.id },
            data: { state: "DELETION_PENDING", activeSlot: null, lastStorageError: null },
            select: { id: true, storageObjectKey: true, state: true },
          });
        }
        const activated = await tx.tripHeroImage.updateMany({
          where: { id: imageId, tripId, state: "PENDING" },
          data: { state: "ACTIVE", activeSlot: tripId, lastStorageError: null },
        });
        if (activated.count !== 1) {
          throw new AppError(409, "TRIP_HERO_STATE_CONFLICT", "The Trip hero could not be finalized");
        }
        return tx.tripHeroImage.findUniqueOrThrow({
          where: { id: imageId },
          select: publicTripHeroImageSelect,
        });
      });
    } catch (error) {
      await cleanupAfterFailedUpload(pending, runtime);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "TRIP_HERO_FINALIZATION_FAILED", "The Trip hero could not be finalized");
    }

    if (replaced) {
      try {
        await cleanupRecord(replaced, runtime);
      } catch {
        // The replacement is already marked for the normal cleanup retry path.
      }
    }
    return serializeTripHeroImage(image);
  },

  async getContent(householdId: string, tripId: string) {
    const image = await prisma.tripHeroImage.findFirst({
      where: { tripId, state: "ACTIVE", trip: { householdId } },
      include: { trip: { select: { householdId: true } } },
    });
    if (!image) notFound("Trip hero");
    if (image.encryptionVersion !== MEDIA_ENCRYPTION_VERSION) {
      throw new AppError(503, "MEDIA_ENCRYPTION_UNSUPPORTED", "This media encryption version is unavailable");
    }
    const runtime = getMediaStorageRuntime();
    const masterKey = runtime.masterKeys.get(image.keyVersion);
    if (!masterKey) {
      throw new AppError(503, "MEDIA_KEY_UNAVAILABLE", "The media encryption key is unavailable");
    }

    let ciphertext: Uint8Array;
    try {
      ciphertext = await runtime.storage.getObject(image.storageObjectKey);
    } catch {
      throw new AppError(503, "MEDIA_STORAGE_READ_FAILED", "The encrypted Trip hero could not be read");
    }
    try {
      const plaintext = decryptTripHeroImageObject(
        ciphertext,
        image,
        masterKey,
        associatedData(image),
      );
      const stillActive = await prisma.tripHeroImage.count({
        where: { id: image.id, state: "ACTIVE", trip: { householdId } },
      });
      if (stillActive !== 1) notFound("Trip hero");
      return { bytes: plaintext, contentType: image.contentType };
    } catch (error) {
      if (error instanceof MediaIntegrityError) {
        throw new AppError(500, "MEDIA_INTEGRITY_CHECK_FAILED", "The Trip hero failed its integrity check");
      }
      throw error;
    }
  },

  async delete(householdId: string, tripId: string) {
    await requireTrip(householdId, tripId);
    let image = await prisma.tripHeroImage.findFirst({
      where: { tripId, state: "ACTIVE", trip: { householdId } },
      select: { id: true, storageObjectKey: true, state: true },
    });
    if (image) {
      image = await prisma.tripHeroImage.update({
        where: { id: image.id },
        data: { state: "DELETION_PENDING", activeSlot: null, lastStorageError: null },
        select: { id: true, storageObjectKey: true, state: true },
      });
    } else {
      image = await prisma.tripHeroImage.findFirst({
        where: { tripId, state: "DELETION_PENDING", trip: { householdId } },
        orderBy: { createdAt: "desc" },
        select: { id: true, storageObjectKey: true, state: true },
      });
    }
    if (!image) notFound("Trip hero");

    let runtime: MediaStorageRuntime;
    try {
      runtime = getMediaStorageRuntime();
    } catch (error) {
      if (error instanceof AppError && error.code === "MEDIA_STORAGE_NOT_CONFIGURED") {
        return { imageId: image.id, deleted: false, deletionPending: true };
      }
      throw error;
    }
    const deleted = await cleanupRecord(image, runtime);
    return { imageId: image.id, deleted, deletionPending: !deleted };
  },
};
