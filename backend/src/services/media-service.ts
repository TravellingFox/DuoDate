import { randomUUID } from "node:crypto";
import { Prisma, type MediaKind, type MemoryMedia } from "@prisma/client";
import { env } from "../env";
import { AppError, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import type {
  MemoryCoverUpdateInput,
  MemoryMediaCaptionUpdate,
  MemoryMediaReorderInput,
  MemoryMediaUploadMetadata,
} from "../types";
import { getMediaStorageRuntime, type MediaStorageRuntime } from "../storage/media-storage";
import {
  decryptMediaObject,
  encryptMediaObject,
  MEDIA_ENCRYPTION_VERSION,
  MediaIntegrityError,
  type MediaAssociatedData,
} from "./media-encryption";
import {
  publicMemoryInclude,
  recomputeMemoryContentState,
  serializeMemory,
} from "./memory-service";

const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
export const MAX_PHOTO_REQUEST_BYTES = env.MEDIA_PHOTO_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
export const MAX_MEDIA_REQUEST_BYTES =
  Math.max(
    env.MEDIA_PHOTO_MAX_BYTES,
    env.MEDIA_VIDEO_MAX_BYTES,
    env.MEDIA_VOICE_NOTE_MAX_BYTES,
  ) + MAX_MULTIPART_OVERHEAD_BYTES;

const MIME_TYPES: Readonly<Record<MediaKind, ReadonlySet<string>>> = {
  PHOTO: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  VIDEO: new Set(["video/mp4", "video/quicktime", "video/webm", "video/3gpp"]),
  VOICE_NOTE: new Set([
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/mpeg",
    "audio/ogg",
    "audio/webm",
    "audio/wav",
    "audio/x-wav",
    "audio/3gpp",
  ]),
};

const publicMediaSelect = {
  id: true,
  memoryId: true,
  kind: true,
  contentType: true,
  byteSize: true,
  caption: true,
  width: true,
  height: true,
  durationMs: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  uploader: { select: { id: true, displayName: true } },
} satisfies Prisma.MemoryMediaSelect;

type PublicMedia = Prisma.MemoryMediaGetPayload<{ select: typeof publicMediaSelect }>;
type MediaWithHousehold = MemoryMedia & { memory: { householdId: string } };

function serializeMedia(media: PublicMedia, coverMediaId: string | null) {
  return {
    ...media,
    isCover: media.id === coverMediaId,
    contentPath: `/api/media/${media.id}/content`,
  };
}

function maxBytesForKind(kind: MediaKind): number {
  if (kind === "PHOTO") return env.MEDIA_PHOTO_MAX_BYTES;
  if (kind === "VIDEO") return env.MEDIA_VIDEO_MAX_BYTES;
  return env.MEDIA_VOICE_NOTE_MAX_BYTES;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function hasIsoBaseMediaSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";
}

function hasSupportedSignature(kind: MediaKind, contentType: string, bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (contentType === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (contentType === "image/png") {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === "image/webp") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  }
  if (contentType === "image/heic" || contentType === "image/heif") {
    if (!hasIsoBaseMediaSignature(bytes)) return false;
    const brand = ascii(bytes, 8, 4);
    return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand);
  }
  if (contentType === "video/webm" || contentType === "audio/webm") {
    return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  }
  if (contentType === "audio/ogg") return ascii(bytes, 0, 4) === "OggS";
  if (contentType === "audio/wav" || contentType === "audio/x-wav") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
  }
  if (contentType === "audio/mpeg") {
    return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  }
  if (contentType === "audio/aac") {
    return bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0;
  }
  if (
    contentType === "video/mp4" ||
    contentType === "video/quicktime" ||
    contentType === "video/3gpp" ||
    contentType === "audio/mp4" ||
    contentType === "audio/x-m4a" ||
    contentType === "audio/3gpp"
  ) {
    return hasIsoBaseMediaSignature(bytes);
  }
  return false;
}

export function validateMediaUpload(
  kind: MediaKind,
  declaredContentType: string,
  bytes: Uint8Array,
): string {
  const contentType = declaredContentType.toLowerCase().split(";", 1)[0]!.trim();
  if (!MIME_TYPES[kind].has(contentType)) {
    throw new AppError(400, "UNSUPPORTED_MEDIA_TYPE", "The selected media type is not supported");
  }
  if (bytes.byteLength === 0) {
    throw new AppError(400, "EMPTY_MEDIA", "The uploaded media file is empty");
  }
  if (bytes.byteLength > maxBytesForKind(kind)) {
    throw new AppError(413, "MEDIA_TOO_LARGE", "The uploaded media exceeds the allowed size");
  }
  if (!hasSupportedSignature(kind, contentType, bytes)) {
    throw new AppError(400, "MEDIA_SIGNATURE_MISMATCH", "The file contents do not match its media type");
  }
  return contentType;
}

function associatedData(media: {
  id: string;
  memoryId: string;
  uploaderId: string;
  kind: MediaKind;
  contentType: string;
  byteSize: number;
  encryptionVersion: number;
  keyVersion: number;
}, householdId: string): MediaAssociatedData {
  return {
    mediaId: media.id,
    householdId,
    memoryId: media.memoryId,
    uploaderId: media.uploaderId,
    kind: media.kind,
    contentType: media.contentType,
    byteSize: media.byteSize,
    encryptionVersion: media.encryptionVersion,
    keyVersion: media.keyVersion,
  };
}

async function requireMemory(householdId: string, memoryId: string) {
  const memory = await prisma.memory.findFirst({
    where: { id: memoryId, householdId },
    select: { id: true, coverMediaId: true },
  });
  if (!memory) notFound("Memory");
  return memory;
}

async function cleanupRecord(
  media: Pick<MemoryMedia, "id" | "storageObjectKey" | "state">,
  runtime: MediaStorageRuntime,
): Promise<boolean> {
  try {
    await runtime.storage.deleteObject(media.storageObjectKey);
    await prisma.memoryMedia.deleteMany({
      where: { id: media.id, state: media.state },
    });
    return true;
  } catch {
    await prisma.memoryMedia.updateMany({
      where: { id: media.id, state: media.state },
      data: {
        cleanupAttempts: { increment: 1 },
        lastStorageError: "STORAGE_DELETE_FAILED",
      },
    });
    return false;
  }
}

async function cleanupAfterFailedUpload(
  media: Pick<MemoryMedia, "id" | "storageObjectKey" | "state">,
  runtime: MediaStorageRuntime,
): Promise<void> {
  await cleanupRecord(media, runtime);
}

export async function runMediaCleanup(
  householdId: string,
  now = new Date(),
): Promise<{ removed: number; pending: number }> {
  const runtime = getMediaStorageRuntime();
  const staleBefore = new Date(now.getTime() - env.MEDIA_PENDING_CLEANUP_MINUTES * 60_000);
  const records = await prisma.memoryMedia.findMany({
    where: {
      memory: { householdId },
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
      const claimed = await prisma.memoryMedia.updateMany({
        where: { id: record.id, state: "PENDING", createdAt: { lt: staleBefore } },
        data: { state: "DELETION_PENDING" },
      });
      if (claimed.count === 0) continue;
      record.state = "DELETION_PENDING";
    }
    if (await cleanupRecord(record, runtime)) removed += 1;
  }
  return { removed, pending: records.length - removed };
}

async function runCleanupIfConfigured(householdId: string): Promise<void> {
  try {
    await runMediaCleanup(householdId);
  } catch (error) {
    if (!(error instanceof AppError && error.code === "MEDIA_STORAGE_NOT_CONFIGURED")) throw error;
  }
}

async function finalizeUpload(
  mediaId: string,
  memoryId: string,
  householdId: string,
  userId: string,
  kind: MediaKind,
  now: Date,
) {
  return prisma.$transaction(async (tx) => {
    const activated = await tx.memoryMedia.updateMany({
      where: { id: mediaId, memoryId, state: "PENDING", memory: { householdId } },
      data: { state: "ACTIVE", lastStorageError: null },
    });
    if (activated.count !== 1) {
      throw new AppError(409, "MEDIA_UPLOAD_STATE_CONFLICT", "Media upload could not be finalized");
    }
    if (kind === "PHOTO") {
      await tx.memory.updateMany({
        where: { id: memoryId, householdId, coverMediaId: null },
        data: { coverMediaId: mediaId },
      });
    }
    await recomputeMemoryContentState(tx, memoryId, userId, now);
    const [media, memory] = await Promise.all([
      tx.memoryMedia.findUniqueOrThrow({ where: { id: mediaId }, select: publicMediaSelect }),
      tx.memory.findUniqueOrThrow({ where: { id: memoryId }, include: publicMemoryInclude }),
    ]);
    return { media, memory };
  });
}

export const mediaService = {
  async upload(
    householdId: string,
    userId: string,
    memoryId: string,
    input: MemoryMediaUploadMetadata,
    declaredContentType: string,
    bytes: Uint8Array,
    now = new Date(),
  ) {
    const runtime = getMediaStorageRuntime();
    await runCleanupIfConfigured(householdId);
    const memory = await requireMemory(householdId, memoryId);
    const contentType = validateMediaUpload(input.kind, declaredContentType, bytes);
    const mediaId = input.clientRequestId ?? randomUUID();
    const existing = await prisma.memoryMedia.findUnique({ where: { id: mediaId }, select: { ...publicMediaSelect, state: true } });
    if (existing) {
      if (existing.memoryId !== memoryId || existing.uploader.id !== userId || existing.kind !== input.kind || existing.contentType !== contentType || existing.byteSize !== bytes.byteLength) {
        throw new AppError(409, "MEDIA_REQUEST_CONFLICT", "This upload identity belongs to another contribution");
      }
      if (existing.state !== "ACTIVE") {
        throw new AppError(409, "MEDIA_UPLOAD_PENDING", "The previous upload is still settling. Please retry shortly.");
      }
      const saved = await prisma.memory.findUniqueOrThrow({ where: { id: memoryId }, include: publicMemoryInclude });
      return { media: serializeMedia(existing, saved.coverMediaId), memory: serializeMemory(saved, now) };
    }
    const keyVersion = runtime.currentKeyVersion;
    const masterKey = runtime.masterKeys.get(keyVersion);
    if (!masterKey) {
      throw new AppError(503, "MEDIA_KEY_UNAVAILABLE", "The current media encryption key is unavailable");
    }
    const latest = input.sortOrder === undefined
      ? await prisma.memoryMedia.findFirst({
          where: { memoryId, state: "ACTIVE" },
          orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
          select: { sortOrder: true },
        })
      : null;
    const sortOrder = input.sortOrder ?? ((latest?.sortOrder ?? -1) + 1);
    const encryptionContext: MediaAssociatedData = {
      mediaId,
      householdId,
      memoryId,
      uploaderId: userId,
      kind: input.kind,
      contentType,
      byteSize: bytes.byteLength,
      encryptionVersion: MEDIA_ENCRYPTION_VERSION,
      keyVersion,
    };
    const encrypted = encryptMediaObject(bytes, masterKey, encryptionContext);
    const storageObjectKey = `households/${householdId}/memories/${memoryId}/${mediaId}.enc`;
    const pending = await prisma.memoryMedia.create({
      data: {
        id: mediaId,
        memoryId,
        uploaderId: userId,
        kind: input.kind,
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
        caption: input.caption?.trim() || null,
        width: input.width,
        height: input.height,
        durationMs: input.durationMs,
        sortOrder,
      },
    });

    try {
      await runtime.storage.putObject(storageObjectKey, encrypted.ciphertext);
    } catch {
      await cleanupAfterFailedUpload(pending, runtime);
      throw new AppError(503, "MEDIA_STORAGE_WRITE_FAILED", "The encrypted media could not be stored");
    }

    try {
      const result = await finalizeUpload(mediaId, memoryId, householdId, userId, input.kind, now);
      return {
        media: serializeMedia(result.media, result.memory.coverMediaId),
        memory: serializeMemory(result.memory, now),
      };
    } catch (error) {
      await cleanupAfterFailedUpload(pending, runtime);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "MEDIA_FINALIZATION_FAILED", "The media upload could not be finalized");
    }
  },

  async updateCaption(
    householdId: string,
    memoryId: string,
    mediaId: string,
    input: MemoryMediaCaptionUpdate,
  ) {
    await runCleanupIfConfigured(householdId);
    const existing = await prisma.memoryMedia.findFirst({
      where: { id: mediaId, memoryId, state: "ACTIVE", memory: { householdId } },
      select: { id: true },
    });
    if (!existing) notFound("Memory media");
    const media = await prisma.memoryMedia.update({
      where: { id: mediaId },
      data: { caption: input.caption?.trim() || null },
      select: publicMediaSelect,
    });
    const memory = await prisma.memory.findUniqueOrThrow({
      where: { id: memoryId },
      select: { coverMediaId: true },
    });
    return serializeMedia(media, memory.coverMediaId);
  },

  async reorder(
    householdId: string,
    memoryId: string,
    input: MemoryMediaReorderInput,
    now = new Date(),
  ) {
    await runCleanupIfConfigured(householdId);
    const memory = await prisma.$transaction(async (tx) => {
      const ownedMemory = await tx.memory.findFirst({
        where: { id: memoryId, householdId },
        select: { id: true },
      });
      if (!ownedMemory) notFound("Memory");
      const active = await tx.memoryMedia.findMany({
        where: { memoryId, state: "ACTIVE" },
        select: { id: true },
      });
      if (
        active.length !== input.mediaIds.length ||
        active.some(({ id }) => !input.mediaIds.includes(id))
      ) {
        throw new AppError(
          400,
          "INVALID_MEDIA_ORDER",
          "The order must contain every active media item from this Memory exactly once",
        );
      }
      for (const [sortOrder, id] of input.mediaIds.entries()) {
        await tx.memoryMedia.update({ where: { id }, data: { sortOrder } });
      }
      return tx.memory.findUniqueOrThrow({
        where: { id: memoryId },
        include: publicMemoryInclude,
      });
    });
    return serializeMemory(memory, now);
  },

  async setCover(
    householdId: string,
    userId: string,
    memoryId: string,
    input: MemoryCoverUpdateInput,
    now = new Date(),
  ) {
    await runCleanupIfConfigured(householdId);
    const memory = await prisma.$transaction(async (tx) => {
      const ownedMemory = await tx.memory.findFirst({
        where: { id: memoryId, householdId },
        select: { id: true },
      });
      if (!ownedMemory) notFound("Memory");
      if (input.mediaId) {
        const photo = await tx.memoryMedia.findFirst({
          where: {
            id: input.mediaId,
            memoryId,
            kind: "PHOTO",
            state: "ACTIVE",
            memory: { householdId },
          },
          select: { id: true },
        });
        if (!photo) {
          throw new AppError(400, "INVALID_COVER_MEDIA", "The cover must be an active photo from this Memory");
        }
      }
      return tx.memory.update({
        where: { id: memoryId },
        data: { coverMediaId: input.mediaId, updatedById: userId },
        include: publicMemoryInclude,
      });
    });
    return serializeMemory(memory, now);
  },

  async getContent(householdId: string, mediaId: string) {
    const media = await prisma.memoryMedia.findFirst({
      where: { id: mediaId, state: "ACTIVE", memory: { householdId } },
      include: { memory: { select: { householdId: true } } },
    });
    if (!media) notFound("Memory media");
    if (media.encryptionVersion !== MEDIA_ENCRYPTION_VERSION) {
      throw new AppError(503, "MEDIA_ENCRYPTION_UNSUPPORTED", "This media encryption version is unavailable");
    }
    const runtime = getMediaStorageRuntime();
    const masterKey = runtime.masterKeys.get(media.keyVersion);
    if (!masterKey) {
      throw new AppError(503, "MEDIA_KEY_UNAVAILABLE", "The media encryption key is unavailable");
    }
    let ciphertext: Uint8Array;
    try {
      ciphertext = await runtime.storage.getObject(media.storageObjectKey);
    } catch {
      throw new AppError(503, "MEDIA_STORAGE_READ_FAILED", "The encrypted media could not be read");
    }
    try {
      const plaintext = decryptMediaObject(
        ciphertext,
        media,
        masterKey,
        associatedData(media, media.memory.householdId),
      );
      const stillActive = await prisma.memoryMedia.count({
        where: { id: media.id, state: "ACTIVE", memory: { householdId } },
      });
      if (stillActive !== 1) notFound("Memory media");
      return { bytes: plaintext, contentType: media.contentType };
    } catch (error) {
      if (error instanceof MediaIntegrityError) {
        throw new AppError(500, "MEDIA_INTEGRITY_CHECK_FAILED", "The media failed its integrity check");
      }
      throw error;
    }
  },

  async delete(
    householdId: string,
    userId: string,
    memoryId: string,
    mediaId: string,
    now = new Date(),
  ) {
    let media = await prisma.memoryMedia.findFirst({
      where: {
        id: mediaId,
        memoryId,
        state: { in: ["ACTIVE", "DELETION_PENDING"] },
        memory: { householdId },
      },
      include: { memory: { select: { coverMediaId: true } } },
    });
    if (!media) notFound("Memory media");

    if (media.state === "ACTIVE") {
      media = await prisma.$transaction(async (tx) => {
        const tombstoned = await tx.memoryMedia.update({
          where: { id: mediaId },
          data: { state: "DELETION_PENDING", lastStorageError: null },
          include: { memory: { select: { coverMediaId: true } } },
        });
        if (tombstoned.memory.coverMediaId === mediaId) {
          const fallback = await tx.memoryMedia.findFirst({
            where: {
              memoryId,
              state: "ACTIVE",
              kind: "PHOTO",
              id: { not: mediaId },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: { id: true },
          });
          await tx.memory.update({
            where: { id: memoryId },
            data: { coverMediaId: fallback?.id ?? null },
          });
        }
        await recomputeMemoryContentState(tx, memoryId, userId, now);
        return tombstoned;
      });
    }

    let runtime: MediaStorageRuntime;
    try {
      runtime = getMediaStorageRuntime();
    } catch (error) {
      if (error instanceof AppError && error.code === "MEDIA_STORAGE_NOT_CONFIGURED") {
        return { mediaId, deleted: false, deletionPending: true };
      }
      throw error;
    }
    const deleted = await cleanupRecord(media, runtime);
    return { mediaId, deleted, deletionPending: !deleted };
  },
};
