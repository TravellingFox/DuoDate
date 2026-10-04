import { env } from "../env";
import type { NotificationData } from "../types";

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: NotificationData;
  channelId: string;
}

export type PushSendResult =
  | { status: "accepted"; ticketId: string }
  | { status: "transient" | "permanent"; code: string };

export type PushReceiptResult =
  | { status: "delivered" }
  | { status: "transient" | "permanent"; code: string };

export interface PushProvider {
  send(messages: PushMessage[]): Promise<PushSendResult[]>;
  getReceipts(ticketIds: string[]): Promise<Map<string, PushReceiptResult>>;
}

export class PushProviderRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly transient: boolean,
  ) {
    super(code);
    this.name = "PushProviderRequestError";
  }
}

function providerHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(env.EXPO_PUSH_ACCESS_TOKEN
      ? { Authorization: `Bearer ${env.EXPO_PUSH_ACCESS_TOKEN}` }
      : {}),
  };
}

function requestFailure(status: number): PushProviderRequestError {
  if (status === 429) return new PushProviderRequestError("EXPO_RATE_LIMITED", true);
  if (status >= 500) return new PushProviderRequestError("EXPO_UNAVAILABLE", true);
  if (status === 401 || status === 403) {
    return new PushProviderRequestError("EXPO_UNAUTHORIZED", false);
  }
  return new PushProviderRequestError("EXPO_REQUEST_REJECTED", false);
}

function safeProviderCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value)
    ? value
    : fallback;
}

function classifyItemError(code: string): "transient" | "permanent" {
  return code === "MessageRateExceeded" ? "transient" : "permanent";
}

export class ExpoPushProvider implements PushProvider {
  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    if (messages.length === 0) return [];
    if (messages.length > 100) {
      throw new PushProviderRequestError("EXPO_BATCH_TOO_LARGE", false);
    }

    let response: Response;
    try {
      response = await fetch(EXPO_SEND_URL, {
        method: "POST",
        headers: providerHeaders(),
        body: JSON.stringify(
          messages.map((message) => ({
            to: message.to,
            title: message.title,
            body: message.body,
            data: message.data,
            channelId: message.channelId,
          })),
        ),
      });
    } catch {
      throw new PushProviderRequestError("EXPO_NETWORK_ERROR", true);
    }
    if (!response.ok) throw requestFailure(response.status);

    const payload = await response.json().catch(() => null) as {
      data?: Array<{
        status?: unknown;
        id?: unknown;
        details?: { error?: unknown };
      }>;
    } | null;
    if (!payload?.data || payload.data.length !== messages.length) {
      throw new PushProviderRequestError("EXPO_INVALID_RESPONSE", true);
    }

    return payload.data.map((ticket): PushSendResult => {
      if (ticket.status === "ok" && typeof ticket.id === "string" && ticket.id) {
        return { status: "accepted", ticketId: ticket.id };
      }
      const code = safeProviderCode(ticket.details?.error, "EXPO_TICKET_REJECTED");
      return { status: classifyItemError(code), code };
    });
  }

  async getReceipts(ticketIds: string[]): Promise<Map<string, PushReceiptResult>> {
    if (ticketIds.length === 0) return new Map();
    if (ticketIds.length > 1_000) {
      throw new PushProviderRequestError("EXPO_RECEIPT_BATCH_TOO_LARGE", false);
    }

    let response: Response;
    try {
      response = await fetch(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: providerHeaders(),
        body: JSON.stringify({ ids: ticketIds }),
      });
    } catch {
      throw new PushProviderRequestError("EXPO_RECEIPT_NETWORK_ERROR", true);
    }
    if (!response.ok) throw requestFailure(response.status);

    const payload = await response.json().catch(() => null) as {
      data?: Record<
        string,
        { status?: unknown; details?: { error?: unknown } }
      >;
    } | null;
    if (!payload?.data || typeof payload.data !== "object") {
      throw new PushProviderRequestError("EXPO_INVALID_RECEIPT_RESPONSE", true);
    }

    const results = new Map<string, PushReceiptResult>();
    for (const [ticketId, receipt] of Object.entries(payload.data)) {
      if (receipt.status === "ok") {
        results.set(ticketId, { status: "delivered" });
        continue;
      }
      const code = safeProviderCode(receipt.details?.error, "EXPO_RECEIPT_REJECTED");
      results.set(ticketId, { status: classifyItemError(code), code });
    }
    return results;
  }
}

export class FakePushProvider implements PushProvider {
  readonly sentMessages: PushMessage[] = [];
  readonly receiptRequests: string[][] = [];
  private ticketSequence = 0;
  private sendQueue: Array<PushSendResult | PushProviderRequestError> = [];
  private receiptQueue = new Map<string, PushReceiptResult>();

  queueSendResult(result: PushSendResult | PushProviderRequestError): void {
    this.sendQueue.push(result);
  }

  setReceipt(ticketId: string, result: PushReceiptResult): void {
    this.receiptQueue.set(ticketId, result);
  }

  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    this.sentMessages.push(...messages);
    const results: PushSendResult[] = [];
    for (const _message of messages) {
      const queued = this.sendQueue.shift();
      if (queued instanceof PushProviderRequestError) throw queued;
      this.ticketSequence += 1;
      results.push(queued ?? { status: "accepted", ticketId: `fake-ticket-${this.ticketSequence}` });
    }
    return results;
  }

  async getReceipts(ticketIds: string[]): Promise<Map<string, PushReceiptResult>> {
    this.receiptRequests.push([...ticketIds]);
    const results = new Map<string, PushReceiptResult>();
    for (const ticketId of ticketIds) {
      const result = this.receiptQueue.get(ticketId);
      if (result) results.set(ticketId, result);
    }
    return results;
  }
}

let testProvider: PushProvider | undefined;
let productionProvider: PushProvider | undefined;

export function getPushProvider(): PushProvider {
  if (testProvider) return testProvider;
  productionProvider ??= new ExpoPushProvider();
  return productionProvider;
}

export function setPushProviderForTests(provider: PushProvider | undefined): void {
  if (env.NODE_ENV !== "test" && provider) {
    throw new Error("Push provider overrides are only available in tests");
  }
  testProvider = provider;
}
