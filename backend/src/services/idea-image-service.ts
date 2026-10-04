import { randomUUID } from "node:crypto";
import { Prisma, type IdeaImage } from "@prisma/client";
import { env } from "../env";
import { AppError, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import type { IdeaImageUploadMetadata, PublicIdeaImageDto } from "../types";
import { getMediaStorageRuntime, type MediaStorageRuntime } from "../storage/media-storage";
import {
  decryptIdeaImageObject,
  encryptIdeaImageObject,
  MEDIA_ENCRYPTION_VERSION,
  MediaIntegrityError,
  type IdeaImageAssociatedData,
} from "./media-encryption";
import { validateMediaUpload } from "./media-service";

export const publicIdeaImageSelect = {
  id: true,
  ideaId: true,
  contentType: true,
  byteSize: true,
  width: true,
  height: true,
  createdAt: true,
  updatedAt: true,
  uploader: { select: { id: true, displayName: true } },
} satisfies Prisma.IdeaImageSelect;

type PublicIdeaImage = Prisma.IdeaImageGetPayload<{ select: typeof publicIdeaImageSelect }>;
type ImageWithHousehold = IdeaImage & { idea: { householdId: string } };

export function serializeIdeaImage(image: PublicIdeaImage): PublicIdeaImageDto {
  return {
    ...image,
    createdAt: image.createdAt.toISOString(),
    updatedAt: image.updatedAt.toISOString(),
    contentPath: `/api/ideas/${image.ideaId}/image/content`,
  };
}

function associatedData(image: ImageWithHousehold): IdeaImageAssociatedData {
  return {
    imageId: image.id,
    householdId: image.idea.householdId,
    ideaId: image.ideaId,
    uploaderId: image.uploaderId,
    contentType: image.contentType,
    byteSize: image.byteSize,
    encryptionVersion: image.encryptionVersion,
    keyVersion: image.keyVersion,
  };
}

async function requireIdea(householdId: string, ideaId: string): Promise<void> {
  const idea = await prisma.idea.findFirst({
    where: { id: ideaId, householdId, deletedAt: null },
    select: { id: true },
  });
  if (!idea) notFound("Idea");
}

async function cleanupRecord(
  image: Pick<IdeaImage, "id" | "storageObjectKey" | "state">,
  runtime: MediaStorageRuntime,
): Promise<boolean> {
  try {
    await runtime.storage.deleteObject(image.storageObjectKey);
    await prisma.ideaImage.deleteMany({ where: { id: image.id, state: image.state } });
    return true;
  } catch {
    await prisma.ideaImage.updateMany({
      where: { id: image.id, state: image.state },
      data: {
        cleanupAttempts: { increment: 1 },
        lastStorageError: "STORAGE_DELETE_FAILED",
      },
    });
    return false;
  }
}

export async function runIdeaImageCleanup(
  householdId: string,
  now = new Date(),
): Promise<{ removed: number; pending: number }> {
  const runtime = getMediaStorageRuntime();
  const staleBefore = new Date(now.getTime() - env.MEDIA_PENDING_CLEANUP_MINUTES * 60_000);
  const records = await prisma.ideaImage.findMany({
    where: {
      idea: { householdId },
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
      const claimed = await prisma.ideaImage.updateMany({
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

export async function runIdeaImageCleanupIfConfigured(householdId: string): Promise<void> {
  try {
    await runIdeaImageCleanup(householdId);
  } catch (error) {
    if (!(error instanceof AppError && error.code === "MEDIA_STORAGE_NOT_CONFIGURED")) throw error;
  }
}

async function cleanupAfterFailedUpload(
  image: Pick<IdeaImage, "id" | "storageObjectKey" | "state">,
  runtime: MediaStorageRuntime,
): Promise<void> {
  await cleanupRecord(image, runtime);
}

export const ideaImageService = {
  async upload(
    householdId: string,
    userId: string,
    ideaId: string,
    input: IdeaImageUploadMetadata,
    declaredContentType: string,
    bytes: Uint8Array,
  ) {
    if (input.kind !== "PHOTO") {
      throw new AppError(400, "VALIDATION_ERROR", "Idea attachments must be photos or flyer images");
    }
    const runtime = getMediaStorageRuntime();
    await runIdeaImageCleanupIfConfigured(householdId);
    await requireIdea(householdId, ideaId);
    const contentType = validateMediaUpload("PHOTO", declaredContentType, bytes);
    const imageId = randomUUID();
    const keyVersion = runtime.currentKeyVersion;
    const masterKey = runtime.masterKeys.get(keyVersion);
    if (!masterKey) {
      throw new AppError(503, "MEDIA_KEY_UNAVAILABLE", "The current media encryption key is unavailable");
    }
    const encryptionContext: IdeaImageAssociatedData = {
      imageId,
      householdId,
      ideaId,
      uploaderId: userId,
      contentType,
      byteSize: bytes.byteLength,
      encryptionVersion: MEDIA_ENCRYPTION_VERSION,
      keyVersion,
    };
    const encrypted = encryptIdeaImageObject(bytes, masterKey, encryptionContext);
    const storageObjectKey = `households/${householdId}/ideas/${ideaId}/${imageId}.enc`;
    const pending = await prisma.ideaImage.create({
      data: {
        id: imageId,
        ideaId,
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
      throw new AppError(503, "MEDIA_STORAGE_WRITE_FAILED", "The encrypted image could not be stored");
    }

    let replaced: Pick<IdeaImage, "id" | "storageObjectKey" | "state"> | null = null;
    try {
      const image = await prisma.$transaction(async (tx) => {
        const idea = await tx.idea.findFirst({
          where: { id: ideaId, householdId, deletedAt: null },
          select: { id: true },
        });
        if (!idea) notFound("Idea");

        replaced = await tx.ideaImage.findFirst({
          where: { ideaId, state: "ACTIVE" },
          select: { id: true, storageObjectKey: true, state: true },
        });
        if (replaced) {
          replaced = await tx.ideaImage.update({
            where: { id: replaced.id },
            data: { state: "DELETION_PENDING", activeSlot: null, lastStorageError: null },
            select: { id: true, storageObjectKey: true, state: true },
          });
        }
        const activated = await tx.ideaImage.updateMany({
          where: { id: imageId, ideaId, state: "PENDING" },
          data: { state: "ACTIVE", activeSlot: ideaId, lastStorageError: null },
        });
        if (activated.count !== 1) {
          throw new AppError(409, "IDEA_IMAGE_STATE_CONFLICT", "The Idea image could not be finalized");
        }
        return tx.ideaImage.findUniqueOrThrow({
          where: { id: imageId },
          select: publicIdeaImageSelect,
        });
      });
      if (replaced) await cleanupRecord(replaced, runtime);
      return serializeIdeaImage(image);
    } catch (error) {
      await cleanupAfterFailedUpload(pending, runtime);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "IDEA_IMAGE_FINALIZATION_FAILED", "The Idea image could not be finalized");
    }
  },

  async getContent(householdId: string, ideaId: string) {
    const image = await prisma.ideaImage.findFirst({
      where: { ideaId, state: "ACTIVE", idea: { householdId, deletedAt: null } },
      include: { idea: { select: { householdId: true } } },
    });
    if (!image) notFound("Idea image");
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
      throw new AppError(503, "MEDIA_STORAGE_READ_FAILED", "The encrypted image could not be read");
    }
    try {
      const plaintext = decryptIdeaImageObject(
        ciphertext,
        image,
        masterKey,
        associatedData(image),
      );
      const stillActive = await prisma.ideaImage.count({
        where: { id: image.id, state: "ACTIVE", idea: { householdId, deletedAt: null } },
      });
      if (stillActive !== 1) notFound("Idea image");
      return { bytes: plaintext, contentType: image.contentType };
    } catch (error) {
      if (error instanceof MediaIntegrityError) {
        throw new AppError(500, "MEDIA_INTEGRITY_CHECK_FAILED", "The image failed its integrity check");
      }
      throw error;
    }
  },

  async delete(householdId: string, ideaId: string) {
    await requireIdea(householdId, ideaId);
    let image = await prisma.ideaImage.findFirst({
      where: { ideaId, state: "ACTIVE", idea: { householdId, deletedAt: null } },
      select: { id: true, storageObjectKey: true, state: true },
    });
    if (image) {
      image = await prisma.ideaImage.update({
        where: { id: image.id },
        data: { state: "DELETION_PENDING", activeSlot: null, lastStorageError: null },
        select: { id: true, storageObjectKey: true, state: true },
      });
    } else {
      image = await prisma.ideaImage.findFirst({
        where: { ideaId, state: "DELETION_PENDING", idea: { householdId } },
        orderBy: { createdAt: "desc" },
        select: { id: true, storageObjectKey: true, state: true },
      });
    }
    if (!image) notFound("Idea image");

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
