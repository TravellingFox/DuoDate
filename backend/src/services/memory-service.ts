import { Prisma, type PrismaClient } from "@prisma/client";
import { calendarDateInTimeZone, type CalendarDate } from "../lib/date-time";
import { AppError, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import { cancelCaptureReminderIntents } from "./notification-service";
import type {
  MemoryContributionCreateInput,
  MemoryContributionUpdateInput,
  MemoryListQuery,
  MemoryUpdateInput,
  SpontaneousMemoryCreateInput,
} from "../types";

export const publicMemoryInclude = {
  contributions: {
    include: { author: { select: { id: true, displayName: true } } },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
  },
  mediaItems: {
    where: { state: "ACTIVE" as const },
    select: {
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
    },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
  },
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.MemoryInclude;

export type PublicMemory = Prisma.MemoryGetPayload<{ include: typeof publicMemoryInclude }>;
type MemoryTransaction = Prisma.TransactionClient;
type MemoryReader = Pick<PrismaClient, "memory"> | MemoryTransaction;

export function serializeMemory(memory: PublicMemory, now = new Date()) {
  return {
    ...memory,
    contributionCount: memory.contributions.length,
    mediaCount: memory.mediaItems.length,
    captureOverdue:
      memory.status === "CAPTURE_REQUIRED" &&
      memory.captureDueAt !== null &&
      memory.captureDueAt < now,
  };
}

async function findPublicMemory(
  client: MemoryReader,
  householdId: string,
  id: string,
): Promise<PublicMemory | null> {
  return client.memory.findFirst({
    where: { id, householdId },
    include: publicMemoryInclude,
  });
}

async function requirePublicMemory(
  client: MemoryReader,
  householdId: string,
  id: string,
): Promise<PublicMemory> {
  const memory = await findPublicMemory(client, householdId, id);
  if (!memory) notFound("Memory");
  return memory;
}

function assertDateRange(startDate: CalendarDate, endDate: CalendarDate | null): void {
  if (endDate && startDate > endDate) {
    throw new AppError(400, "INVALID_DATE_RANGE", "Memory start must not follow end");
  }
}

function requireMeaningfulText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new AppError(400, "VALIDATION_ERROR", "Memory contribution text is required");
  }
  return normalized;
}

export async function recomputeMemoryContentState(
  tx: MemoryTransaction,
  memoryId: string,
  userId: string,
  now = new Date(),
): Promise<void> {
  const [textContributions, mediaCount] = await Promise.all([
    tx.memoryContribution.findMany({
      where: { memoryId, kind: "TEXT" },
      select: { text: true },
    }),
    tx.memoryMedia.count({ where: { memoryId, state: "ACTIVE" } }),
  ]);
  const hasValidText = textContributions.some(({ text }) => Boolean(text?.trim()));
  const hasValidContent = hasValidText || mediaCount > 0;

  if (hasValidContent) {
    await tx.memory.updateMany({
      where: { id: memoryId, status: "CAPTURE_REQUIRED" },
      data: { status: "CONTENT_VALID", resolvedAt: now },
    });
    await tx.memory.update({ where: { id: memoryId }, data: { updatedById: userId } });
    await cancelCaptureReminderIntents(tx, memoryId, now);
    return;
  }

  await tx.memory.update({
    where: { id: memoryId },
    data: {
      status: "CAPTURE_REQUIRED",
      resolvedAt: null,
      updatedById: userId,
    },
  });
}

// Keep same-key retries from opening competing SQLite interactive transactions.
// This is only scheduling; the primary key and replay validation remain the
// durable guard, including requests handled by another server process.
const contributionRequestTails = new Map<string, Promise<void>>();

async function serializeContributionRequest<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  if (!key) return run();
  const previous = contributionRequestTails.get(key) ?? Promise.resolve();
  const result = previous.then(run);
  const tail = result.then(() => {}, () => {});
  contributionRequestTails.set(key, tail);
  try {
    return await result;
  } finally {
    if (contributionRequestTails.get(key) === tail) contributionRequestTails.delete(key);
  }
}

export const memoryService = {
  async list(householdId: string, input: MemoryListQuery = {}, now = new Date()) {
    const memories = await prisma.memory.findMany({
      where: {
        householdId,
        ...(input.captureState ? { status: input.captureState } : {}),
      },
      include: publicMemoryInclude,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
    return memories.map((memory) => serializeMemory(memory, now));
  },

  async get(householdId: string, id: string, now = new Date()) {
    return serializeMemory(await requirePublicMemory(prisma, householdId, id), now);
  },

  async createDraft(
    householdId: string,
    userId: string,
    input: {
      title: string;
      startDate: CalendarDate;
      endDate?: CalendarDate | null;
      sourceIdeaId?: string | null;
      sourceScheduleId?: string | null;
      locationSnapshot?: string | null;
      categorySnapshot?: string | null;
      captureDueAt?: Date | null;
    },
    now = new Date(),
  ) {
    assertDateRange(input.startDate, input.endDate ?? null);
    const memory = await prisma.$transaction(async (tx) => {
      if (input.sourceIdeaId) {
        const idea = await tx.idea.findFirst({ where: { id: input.sourceIdeaId, householdId } });
        if (!idea) throw new AppError(400, "INVALID_IDEA", "Source Idea is not available");
      }
      if (input.sourceScheduleId) {
        const schedule = await tx.schedule.findFirst({
          where: { id: input.sourceScheduleId, householdId },
        });
        if (!schedule) {
          throw new AppError(400, "INVALID_SCHEDULE", "Source Schedule is not available");
        }
      }

      return tx.memory.create({
        data: {
          householdId,
          createdById: userId,
          updatedById: userId,
          status: "CAPTURE_REQUIRED",
          ...input,
        },
        include: publicMemoryInclude,
      });
    });
    return serializeMemory(memory, now);
  },

  async createSpontaneous(
    householdId: string,
    userId: string,
    householdTimeZone: string,
    input: SpontaneousMemoryCreateInput,
    now = new Date(),
  ) {
    const startDate = input.startDate ?? calendarDateInTimeZone(now, householdTimeZone);
    const endDate = input.endDate ?? null;
    assertDateRange(startDate, endDate);
    const initialText =
      input.initialText === undefined ? null : requireMeaningfulText(input.initialText);

    const memory = await prisma.$transaction((tx) =>
      tx.memory.create({
        data: {
          householdId,
          createdById: userId,
          updatedById: userId,
          title: input.title,
          locationSnapshot: input.specificLocation ?? null,
          startDate,
          endDate,
          status: initialText ? "CONTENT_VALID" : "CAPTURE_REQUIRED",
          resolvedAt: initialText ? now : null,
          captureDueAt: null,
          contributions: initialText
            ? {
                create: {
                  authorId: userId,
                  kind: "TEXT",
                  text: initialText,
                },
              }
            : undefined,
        },
        include: publicMemoryInclude,
      }),
    );
    return serializeMemory(memory, now);
  },

  async update(
    householdId: string,
    userId: string,
    memoryId: string,
    input: MemoryUpdateInput,
    now = new Date(),
  ) {
    const existing = await requirePublicMemory(prisma, householdId, memoryId);
    const startDate = input.startDate ?? (existing.startDate as CalendarDate);
    const endDate = input.endDate === undefined
      ? (existing.endDate as CalendarDate | null)
      : input.endDate;
    assertDateRange(startDate, endDate);

    const memory = await prisma.memory.update({
      where: { id: memoryId },
      data: {
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        locationSnapshot: input.specificLocation,
        updatedById: userId,
      },
      include: publicMemoryInclude,
    });
    return serializeMemory(memory, now);
  },

  async addContribution(
    householdId: string,
    userId: string,
    memoryId: string,
    input: MemoryContributionCreateInput,
    now = new Date(),
  ) {
    const text = requireMeaningfulText(input.text);
    const clientRequestId = input.clientRequestId;
    return serializeContributionRequest(clientRequestId, async () => {
      const resolveReplay = async (
        client: Pick<PrismaClient, "memory" | "memoryContribution"> | MemoryTransaction,
      ) => {
        if (!clientRequestId) return null;
        const contribution = await client.memoryContribution.findUnique({
          where: { id: clientRequestId },
          include: { author: { select: { id: true, displayName: true } } },
        });
        if (!contribution) return null;
        if (
          contribution.memoryId !== memoryId ||
          contribution.authorId !== userId ||
          contribution.kind !== "TEXT" ||
          contribution.text !== text
        ) {
          throw new AppError(
            409,
            "CLIENT_REQUEST_ID_CONFLICT",
            "Client request ID has already been used for a different contribution",
          );
        }
        return { contribution, memory: await requirePublicMemory(client, householdId, memoryId) };
      };

      if (clientRequestId) {
        await requirePublicMemory(prisma, householdId, memoryId);
        const replay = await resolveReplay(prisma);
        // A replay is read-only: do not change timestamps, capture state or reminders.
        if (replay) {
          return { contribution: replay.contribution, memory: serializeMemory(replay.memory, now) };
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        // For keyed inserts, write first to avoid SQLite read-to-write lock upgrades
        // when retries race. Household validation below still rolls back the insert.
        if (!clientRequestId) await requirePublicMemory(tx, householdId, memoryId);
        const contribution = await tx.memoryContribution.create({
          data: {
            id: clientRequestId,
            memoryId,
            authorId: userId,
            kind: "TEXT",
            text,
            sortOrder: input.sortOrder,
          },
          include: { author: { select: { id: true, displayName: true } } },
        });
        if (clientRequestId) await requirePublicMemory(tx, householdId, memoryId);
        await recomputeMemoryContentState(tx, memoryId, userId, now);
        return {
          contribution,
          memory: await requirePublicMemory(tx, householdId, memoryId),
        };
      }).catch(async (error: unknown) => {
        if (
          !clientRequestId ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        ) {
          throw error;
        }
        // A concurrent insert won. The failed transaction has rolled back; read
        // and validate the winner in a fresh transaction, never the aborted one.
        const replay = await prisma.$transaction(async (tx) => {
          await requirePublicMemory(tx, householdId, memoryId);
          return resolveReplay(tx);
        });
        if (!replay) throw error;
        return replay;
      });
      return {
        contribution: result.contribution,
        memory: serializeMemory(result.memory, now),
      };
    });
  },

  async updateContribution(
    householdId: string,
    userId: string,
    memoryId: string,
    contributionId: string,
    input: MemoryContributionUpdateInput,
    now = new Date(),
  ) {
    const text = requireMeaningfulText(input.text);
    const memory = await prisma.$transaction(async (tx) => {
      const contribution = await tx.memoryContribution.findFirst({
        where: {
          id: contributionId,
          memoryId,
          kind: "TEXT",
          memory: { householdId },
        },
      });
      if (!contribution) notFound("Memory contribution");
      await tx.memoryContribution.update({
        where: { id: contributionId },
        data: { text },
      });
      await recomputeMemoryContentState(tx, memoryId, userId, now);
      return requirePublicMemory(tx, householdId, memoryId);
    });
    return serializeMemory(memory, now);
  },

  async deleteContribution(
    householdId: string,
    userId: string,
    memoryId: string,
    contributionId: string,
    now = new Date(),
  ) {
    const memory = await prisma.$transaction(async (tx) => {
      const contribution = await tx.memoryContribution.findFirst({
        where: {
          id: contributionId,
          memoryId,
          kind: "TEXT",
          memory: { householdId },
        },
      });
      if (!contribution) notFound("Memory contribution");
      await tx.memoryContribution.delete({ where: { id: contributionId } });
      await recomputeMemoryContentState(tx, memoryId, userId, now);
      return requirePublicMemory(tx, householdId, memoryId);
    });
    return serializeMemory(memory, now);
  },

  async doAgain(householdId: string, memoryId: string) {
    return prisma.$transaction(async (tx) => {
      const memory = await tx.memory.findFirst({
        where: { id: memoryId, householdId },
        select: { id: true, sourceIdeaId: true },
      });
      if (!memory) notFound("Memory");
      if (!memory.sourceIdeaId) {
        throw new AppError(
          409,
          "SOURCE_IDEA_UNAVAILABLE",
          "The original activity is no longer available for Do Again",
        );
      }

      const idea = await tx.idea.findFirst({
        where: { id: memory.sourceIdeaId, householdId, deletedAt: null },
      });
      if (!idea) {
        throw new AppError(
          409,
          "SOURCE_IDEA_UNAVAILABLE",
          "The original activity is no longer available for Do Again",
        );
      }
      if (idea.lifecycle === "ACTIVE") {
        return { memoryId: memory.id, idea, reactivated: false };
      }

      const updated = await tx.idea.updateMany({
        where: {
          id: idea.id,
          householdId,
          deletedAt: null,
          lifecycle: { not: "ACTIVE" },
        },
        data: { lifecycle: "ACTIVE" },
      });
      if (updated.count === 0) {
        const current = await tx.idea.findFirst({
          where: { id: idea.id, householdId, deletedAt: null },
        });
        if (!current) {
          throw new AppError(
            409,
            "SOURCE_IDEA_UNAVAILABLE",
            "The original activity is no longer available for Do Again",
          );
        }
        return { memoryId: memory.id, idea: current, reactivated: false };
      }

      return {
        memoryId: memory.id,
        idea: await tx.idea.findUniqueOrThrow({ where: { id: idea.id } }),
        reactivated: true,
      };
    });
  },
};
