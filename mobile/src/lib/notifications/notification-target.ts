export type NotificationEventType =
  | 'MEMORY_CONTRIBUTION_INVITE'
  | 'MEMORY_CAPTURE_REMINDER';

export interface MemoryNotificationTarget {
  type: NotificationEventType;
  memoryId: string;
}

let pendingTarget: MemoryNotificationTarget | null = null;

export function parseNotificationTarget(value: unknown): MemoryNotificationTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'MEMORY_CONTRIBUTION_INVITE' &&
    record.type !== 'MEMORY_CAPTURE_REMINDER'
  ) {
    return null;
  }
  if (
    typeof record.memoryId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(record.memoryId)
  ) {
    return null;
  }
  if (Object.keys(record).some((key) => key !== 'type' && key !== 'memoryId')) return null;
  return { type: record.type, memoryId: record.memoryId };
}

export function setPendingNotificationTarget(target: MemoryNotificationTarget): void {
  pendingTarget = target;
}

export function takePendingNotificationTarget(): MemoryNotificationTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

export function peekPendingNotificationTarget(): MemoryNotificationTarget | null {
  return pendingTarget;
}

export function clearPendingNotificationTarget(): void {
  pendingTarget = null;
}
