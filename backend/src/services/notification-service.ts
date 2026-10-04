import type {
  NotificationDelivery,
  NotificationIntent,
  Prisma,
} from "@prisma/client";
import { prisma } from "../prisma";
import type { NotificationData, NotificationType } from "../types";
import {
  getPushProvider,
  PushProviderRequestError,
  type PushMessage,
  type PushReceiptResult,
  type PushSendResult,
} from "../notifications/push-provider";

const CLAIM_LEASE_MS = 5 * 60 * 1000;
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_MAX_AGE_MS = 23 * 60 * 60 * 1000;
const MAX_INTENT_ATTEMPTS = 5;
const MAX_DELIVERY_ATTEMPTS = 5;
const MAX_RECEIPT_ATTEMPTS = 6;
const SWEEP_LIMIT = 100;
const NOTIFICATION_CHANNEL_ID = "memory-prompts";

function retryAt(now: Date, attemptCount: number): Date {
  const minutes = Math.min(15 * 2 ** Math.max(0, attemptCount - 1), 6 * 60);
  return new Date(now.getTime() + minutes * 60 * 1000);
}

function staleClaimBefore(now: Date): Date {
  return new Date(now.getTime() - CLAIM_LEASE_MS);
}

function contributionInviteKey(memoryId: string, recipientUserId: string): string {
  return `memory-contribution-invite:${memoryId}:${recipientUserId}`;
}

function captureReminderKey(memoryId: string, recipientUserId: string): string {
  return `memory-capture-reminder:${memoryId}:${recipientUserId}`;
}

async function createIntent(
  tx: Prisma.TransactionClient,
  input: {
    householdId: string;
    recipientUserId: string;
    actorUserId?: string;
    memoryId: string;
    type: NotificationType;
    dedupeKey: string;
    earliestAt: Date;
  },
): Promise<NotificationIntent> {
  return tx.notificationIntent.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      ...input,
      actorUserId: input.actorUserId ?? null,
      nextAttemptAt: input.earliestAt,
    },
    update: {},
  });
}

export async function createDatedNotificationIntents(
  tx: Prisma.TransactionClient,
  input: {
    householdId: string;
    actorUserId: string;
    memoryId: string;
    captureDueAt: Date;
    now: Date;
  },
): Promise<void> {
  const members = await tx.householdMember.findMany({
    where: { householdId: input.householdId, user: { disabledAt: null } },
    select: { userId: true },
    orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
  });
  const recipient = members.find(({ userId }) => userId !== input.actorUserId);
  if (!recipient) throw new Error("Dated notification recipient is unavailable");

  await createIntent(tx, {
    householdId: input.householdId,
    recipientUserId: recipient.userId,
    actorUserId: input.actorUserId,
    memoryId: input.memoryId,
    type: "MEMORY_CONTRIBUTION_INVITE",
    dedupeKey: contributionInviteKey(input.memoryId, recipient.userId),
    earliestAt: input.now,
  });

  for (const member of members) {
    await createIntent(tx, {
      householdId: input.householdId,
      recipientUserId: member.userId,
      memoryId: input.memoryId,
      type: "MEMORY_CAPTURE_REMINDER",
      dedupeKey: captureReminderKey(input.memoryId, member.userId),
      earliestAt: input.captureDueAt,
    });
  }
}

export async function cancelCaptureReminderIntents(
  tx: Prisma.TransactionClient,
  memoryId: string,
  now = new Date(),
): Promise<void> {
  await tx.notificationDelivery.updateMany({
    where: {
      intent: {
        memoryId,
        type: "MEMORY_CAPTURE_REMINDER",
        status: "PENDING",
      },
      status: { in: ["PENDING", "RECEIPT_PENDING"] },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      claimedAt: null,
      receiptNextAt: null,
      lastErrorCode: "MEMORY_CONTENT_VALID",
    },
  });
  await tx.notificationIntent.updateMany({
    where: {
      memoryId,
      type: "MEMORY_CAPTURE_REMINDER",
      status: "PENDING",
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      claimedAt: null,
      lastErrorCode: "MEMORY_CONTENT_VALID",
    },
  });
}

async function eligibleDevices(intent: NotificationIntent, now: Date) {
  const devices = await prisma.device.findMany({
    where: {
      householdId: intent.householdId,
      userId: intent.recipientUserId,
      pushToken: { not: null },
      disabledAt: null,
      revokedAt: null,
      authSessionId: { not: null },
    },
    include: {
      authSession: true,
      user: {
        include: {
          credential: true,
          memberships: { select: { householdId: true } },
        },
      },
    },
  });

  return devices.filter((device) => {
    const session = device.authSession;
    return Boolean(
      session &&
        session.userId === device.userId &&
        session.revokedAt === null &&
        session.expiresAt > now &&
        device.user.disabledAt === null &&
        device.user.credential &&
        session.credentialVersion === device.user.credential.credentialVersion &&
        device.user.memberships.length === 1 &&
        device.user.memberships[0]?.householdId === intent.householdId,
    );
  });
}

function notificationMessage(intent: NotificationIntent & {
  actor: { displayName: string } | null;
  memory: { householdId: string; status: "CAPTURE_REQUIRED" | "CONTENT_VALID" };
}, pushToken: string): PushMessage {
  const data: NotificationData = { type: intent.type, memoryId: intent.memoryId };
  if (intent.type === "MEMORY_CONTRIBUTION_INVITE") {
    const actorName = intent.actor?.displayName ?? "Your partner";
    return {
      to: pushToken,
      title: "DuoDate",
      body: `${actorName} added a date to your memories. Add something from your side ♡`,
      data,
      channelId: NOTIFICATION_CHANNEL_ID,
    };
  }
  return {
    to: pushToken,
    title: "DuoDate",
    body: "There's still a shared memory waiting for something from you two. ♡",
    data,
    channelId: NOTIFICATION_CHANNEL_ID,
  };
}

async function disableDevice(deviceId: string, now: Date): Promise<void> {
  await prisma.device.updateMany({
    where: { id: deviceId, disabledAt: null },
    data: { disabledAt: now, pushToken: null },
  });
}

async function failOrRetryDelivery(
  delivery: NotificationDelivery,
  result: Exclude<PushSendResult, { status: "accepted" }>,
  now: Date,
): Promise<void> {
  const exhausted = delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS;
  if (result.status === "transient" && !exhausted) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "PENDING",
        nextAttemptAt: retryAt(now, delivery.attemptCount),
        claimedAt: null,
        lastErrorCode: result.code,
      },
    });
    return;
  }

  await prisma.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "FAILED",
      failedAt: now,
      claimedAt: null,
      lastErrorCode: result.code,
    },
  });
  if (result.code === "DeviceNotRegistered") await disableDevice(delivery.deviceId, now);
}

async function processDelivery(deliveryId: string, now: Date): Promise<void> {
  const claimed = await prisma.notificationDelivery.updateMany({
    where: {
      id: deliveryId,
      status: "PENDING",
      nextAttemptAt: { lte: now },
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaimBefore(now) } }],
    },
    data: { claimedAt: now, attemptCount: { increment: 1 } },
  });
  if (claimed.count === 0) return;

  const delivery = await prisma.notificationDelivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: {
      device: {
        include: {
          authSession: true,
          user: { include: { credential: true, memberships: true } },
        },
      },
      intent: {
        include: {
          actor: { select: { displayName: true } },
          memory: { select: { householdId: true, status: true } },
        },
      },
    },
  });
  const { device, intent } = delivery;
  const session = device.authSession;
  const validDevice = Boolean(
    intent.status === "PENDING" &&
      device.pushToken &&
      device.disabledAt === null &&
      device.revokedAt === null &&
      device.householdId === intent.householdId &&
      device.userId === intent.recipientUserId &&
      session &&
      session.userId === device.userId &&
      session.revokedAt === null &&
      session.expiresAt > now &&
      device.user.disabledAt === null &&
      device.user.credential &&
      session.credentialVersion === device.user.credential.credentialVersion &&
      device.user.memberships.length === 1 &&
      device.user.memberships[0]?.householdId === intent.householdId &&
      intent.memory.householdId === intent.householdId &&
      (intent.type !== "MEMORY_CAPTURE_REMINDER" || intent.memory.status === "CAPTURE_REQUIRED"),
  );
  if (!validDevice || !device.pushToken) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        claimedAt: null,
        lastErrorCode: "DELIVERY_INELIGIBLE",
      },
    });
    return;
  }

  let result: PushSendResult | undefined;
  try {
    const results = await getPushProvider().send([
      notificationMessage(intent, device.pushToken),
    ]);
    result = results[0];
  } catch (error) {
    const failure = error instanceof PushProviderRequestError
      ? {
          status: error.transient ? "transient" as const : "permanent" as const,
          code: error.code,
        }
      : { status: "transient" as const, code: "EXPO_UNKNOWN_ERROR" };
    await failOrRetryDelivery(delivery, failure, now);
    return;
  }

  if (!result) {
    await failOrRetryDelivery(
      delivery,
      { status: "transient", code: "EXPO_EMPTY_RESULT" },
      now,
    );
    return;
  }
  if (result.status !== "accepted") {
    await failOrRetryDelivery(delivery, result, now);
    return;
  }

  await prisma.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "RECEIPT_PENDING",
      expoTicketId: result.ticketId,
      receiptNextAt: new Date(now.getTime() + RECEIPT_DELAY_MS),
      claimedAt: null,
      lastErrorCode: null,
    },
  });
}

async function finalizeIntent(intentId: string, now: Date): Promise<void> {
  const [intent, deliveries] = await Promise.all([
    prisma.notificationIntent.findUniqueOrThrow({ where: { id: intentId } }),
    prisma.notificationDelivery.findMany({ where: { intentId } }),
  ]);
  if (intent.status !== "PENDING") return;

  const active = deliveries.filter(
    ({ status }) => status === "PENDING" || status === "RECEIPT_PENDING",
  );
  if (active.length > 0) {
    const dueTimes = active.map((delivery) =>
      delivery.status === "RECEIPT_PENDING"
        ? delivery.receiptNextAt ?? retryAt(now, 1)
        : delivery.nextAttemptAt,
    );
    await prisma.notificationIntent.update({
      where: { id: intentId },
      data: {
        nextAttemptAt: new Date(Math.min(...dueTimes.map((date) => date.getTime()))),
        claimedAt: null,
      },
    });
    return;
  }

  if (deliveries.some(({ status }) => status === "SENT")) {
    await prisma.notificationIntent.update({
      where: { id: intentId },
      data: { status: "SENT", sentAt: now, claimedAt: null, lastErrorCode: null },
    });
    return;
  }
  if (deliveries.some(({ status }) => status === "FAILED")) {
    await prisma.notificationIntent.update({
      where: { id: intentId },
      data: { status: "FAILED", failedAt: now, claimedAt: null },
    });
    return;
  }
  if (deliveries.length > 0) {
    await prisma.notificationIntent.update({
      where: { id: intentId },
      data: { status: "CANCELLED", cancelledAt: now, claimedAt: null },
    });
  }
}

async function scheduleNoDeviceRetry(intent: NotificationIntent, now: Date): Promise<void> {
  const attemptCount = intent.attemptCount + 1;
  const exhausted = attemptCount >= MAX_INTENT_ATTEMPTS;
  await prisma.notificationIntent.update({
    where: { id: intent.id },
    data: exhausted
      ? {
          status: "FAILED",
          failedAt: now,
          claimedAt: null,
          attemptCount,
          lastErrorCode: "NO_ELIGIBLE_DEVICE",
        }
      : {
          attemptCount,
          nextAttemptAt: retryAt(now, attemptCount),
          claimedAt: null,
          lastErrorCode: "NO_ELIGIBLE_DEVICE",
        },
  });
}

export async function processNotificationIntent(intentId: string, now = new Date()): Promise<void> {
  const claimed = await prisma.notificationIntent.updateMany({
    where: {
      id: intentId,
      status: "PENDING",
      earliestAt: { lte: now },
      nextAttemptAt: { lte: now },
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaimBefore(now) } }],
    },
    data: { claimedAt: now },
  });
  if (claimed.count === 0) return;

  const intent = await prisma.notificationIntent.findUniqueOrThrow({
    where: { id: intentId },
    include: { memory: { select: { householdId: true, status: true } } },
  });
  const recipientStillValid = await prisma.householdMember.count({
    where: {
      householdId: intent.householdId,
      userId: intent.recipientUserId,
      user: { disabledAt: null },
    },
  });
  if (
    intent.memory.householdId !== intent.householdId ||
    recipientStillValid !== 1 ||
    (intent.type === "MEMORY_CAPTURE_REMINDER" && intent.memory.status !== "CAPTURE_REQUIRED")
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.updateMany({
        where: {
          intentId,
          status: { in: ["PENDING", "RECEIPT_PENDING"] },
        },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          claimedAt: null,
          receiptNextAt: null,
          lastErrorCode: "INTENT_NO_LONGER_VALID",
        },
      });
      await tx.notificationIntent.update({
        where: { id: intentId },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          claimedAt: null,
          lastErrorCode: "INTENT_NO_LONGER_VALID",
        },
      });
    });
    return;
  }

  const devices = await eligibleDevices(intent, now);
  const deviceIds = new Set(devices.map(({ id }) => id));
  await prisma.notificationDelivery.updateMany({
    where: {
      intentId,
      status: "PENDING",
      ...(deviceIds.size > 0 ? { deviceId: { notIn: [...deviceIds] } } : {}),
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      claimedAt: null,
      lastErrorCode: "DEVICE_NO_LONGER_ELIGIBLE",
    },
  });

  if (devices.length === 0) {
    await scheduleNoDeviceRetry(intent, now);
    return;
  }

  for (const device of devices) {
    await prisma.notificationDelivery.upsert({
      where: { intentId_deviceId: { intentId, deviceId: device.id } },
      create: { intentId, deviceId: device.id, nextAttemptAt: now },
      update: {},
    });
    await prisma.notificationDelivery.updateMany({
      where: {
        intentId,
        deviceId: device.id,
        status: "CANCELLED",
        lastErrorCode: { in: ["DEVICE_NO_LONGER_ELIGIBLE", "DELIVERY_INELIGIBLE"] },
      },
      data: {
        status: "PENDING",
        nextAttemptAt: now,
        claimedAt: null,
        cancelledAt: null,
        lastErrorCode: null,
      },
    });
  }

  const dueDeliveries = await prisma.notificationDelivery.findMany({
    where: { intentId, status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const delivery of dueDeliveries) await processDelivery(delivery.id, now);
  await finalizeIntent(intentId, now);
}

async function applyReceiptResult(
  delivery: NotificationDelivery,
  result: PushReceiptResult | undefined,
  now: Date,
): Promise<void> {
  const nextReceiptAttempt = delivery.receiptAttemptCount + 1;
  const receiptExpired = now.getTime() - delivery.updatedAt.getTime() >= RECEIPT_MAX_AGE_MS;

  if (!result) {
    if (nextReceiptAttempt >= MAX_RECEIPT_ATTEMPTS || receiptExpired) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SENT",
          sentAt: now,
          claimedAt: null,
          receiptAttemptCount: nextReceiptAttempt,
          receiptNextAt: null,
          lastErrorCode: "EXPO_RECEIPT_UNAVAILABLE",
        },
      });
      return;
    }
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        receiptAttemptCount: nextReceiptAttempt,
        receiptNextAt: retryAt(now, nextReceiptAttempt),
        claimedAt: null,
        lastErrorCode: "EXPO_RECEIPT_PENDING",
      },
    });
    return;
  }

  if (result.status === "delivered") {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        sentAt: now,
        claimedAt: null,
        receiptAttemptCount: nextReceiptAttempt,
        receiptNextAt: null,
        lastErrorCode: null,
      },
    });
    return;
  }

  if (
    result.status === "transient" &&
    delivery.attemptCount < MAX_DELIVERY_ATTEMPTS
  ) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "PENDING",
        nextAttemptAt: retryAt(now, delivery.attemptCount),
        claimedAt: null,
        expoTicketId: null,
        receiptAttemptCount: nextReceiptAttempt,
        receiptNextAt: null,
        lastErrorCode: result.code,
      },
    });
    return;
  }

  await prisma.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "FAILED",
      failedAt: now,
      claimedAt: null,
      receiptAttemptCount: nextReceiptAttempt,
      receiptNextAt: null,
      lastErrorCode: result.code,
    },
  });
  if (result.code === "DeviceNotRegistered") await disableDevice(delivery.deviceId, now);
}

async function processDueReceipts(now: Date): Promise<void> {
  const candidates = await prisma.notificationDelivery.findMany({
    where: {
      status: "RECEIPT_PENDING",
      receiptNextAt: { lte: now },
      expoTicketId: { not: null },
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaimBefore(now) } }],
    },
    orderBy: [{ receiptNextAt: "asc" }, { id: "asc" }],
    take: 1_000,
  });
  const claimed: NotificationDelivery[] = [];
  for (const candidate of candidates) {
    const result = await prisma.notificationDelivery.updateMany({
      where: {
        id: candidate.id,
        status: "RECEIPT_PENDING",
        receiptNextAt: { lte: now },
        OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaimBefore(now) } }],
      },
      data: { claimedAt: now },
    });
    if (result.count === 1) {
      claimed.push(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: candidate.id } }));
    }
  }
  if (claimed.length === 0) return;

  let receipts: Map<string, PushReceiptResult>;
  try {
    receipts = await getPushProvider().getReceipts(
      claimed.flatMap(({ expoTicketId }) => expoTicketId ? [expoTicketId] : []),
    );
  } catch (error) {
    const code = error instanceof PushProviderRequestError
      ? error.code
      : "EXPO_RECEIPT_UNKNOWN_ERROR";
    const touchedIntentIds = new Set<string>();
    for (const delivery of claimed) {
      touchedIntentIds.add(delivery.intentId);
      await applyReceiptResult(
        delivery,
        error instanceof PushProviderRequestError && !error.transient
          ? { status: "permanent", code }
          : undefined,
        now,
      );
    }
    for (const intentId of touchedIntentIds) await finalizeIntent(intentId, now);
    return;
  }

  const touchedIntentIds = new Set<string>();
  for (const delivery of claimed) {
    touchedIntentIds.add(delivery.intentId);
    await applyReceiptResult(
      delivery,
      delivery.expoTicketId ? receipts.get(delivery.expoTicketId) : undefined,
      now,
    );
  }
  for (const intentId of touchedIntentIds) await finalizeIntent(intentId, now);
}

export async function dispatchContributionInvite(
  memoryId: string,
  now = new Date(),
): Promise<void> {
  const intent = await prisma.notificationIntent.findFirst({
    where: {
      memoryId,
      type: "MEMORY_CONTRIBUTION_INVITE",
      status: "PENDING",
    },
    select: { id: true },
  });
  if (intent) await processNotificationIntent(intent.id, now);
}

export async function runNotificationSweep(now = new Date()): Promise<{
  receiptsChecked: number;
  intentsProcessed: number;
}> {
  const receiptCount = await prisma.notificationDelivery.count({
    where: { status: "RECEIPT_PENDING", receiptNextAt: { lte: now } },
  });
  await processDueReceipts(now);

  const intents = await prisma.notificationIntent.findMany({
    where: {
      status: "PENDING",
      earliestAt: { lte: now },
      nextAttemptAt: { lte: now },
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaimBefore(now) } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: SWEEP_LIMIT,
    select: { id: true },
  });
  for (const intent of intents) await processNotificationIntent(intent.id, now);

  return { receiptsChecked: Math.min(receiptCount, 1_000), intentsProcessed: intents.length };
}
