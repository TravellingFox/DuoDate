import {
  clearPendingNotificationTarget,
  parseNotificationTarget,
  peekPendingNotificationTarget,
  setPendingNotificationTarget,
  takePendingNotificationTarget,
} from './notification-target';

describe('notification target validation', () => {
  beforeEach(() => clearPendingNotificationTarget());

  test('accepts only known Memory notification payloads', () => {
    expect(parseNotificationTarget({
      type: 'MEMORY_CONTRIBUTION_INVITE',
      memoryId: 'memory_safe-123',
    })).toEqual({
      type: 'MEMORY_CONTRIBUTION_INVITE',
      memoryId: 'memory_safe-123',
    });
    expect(parseNotificationTarget({
      type: 'MEMORY_CAPTURE_REMINDER',
      memoryId: 'memory-456',
    })).toEqual({
      type: 'MEMORY_CAPTURE_REMINDER',
      memoryId: 'memory-456',
    });
  });

  test('rejects arbitrary routes and extra private data', () => {
    expect(parseNotificationTarget({
      type: 'MEMORY_CONTRIBUTION_INVITE',
      memoryId: 'memory-123',
      href: 'https://example.com',
    })).toBeNull();
    expect(parseNotificationTarget({
      type: 'MEMORY_CAPTURE_REMINDER',
      memoryId: 'memory-123',
      title: 'Private title',
    })).toBeNull();
  });

  test('rejects unknown event types and malformed Memory IDs', () => {
    expect(parseNotificationTarget({ type: 'OPEN_URL', memoryId: 'memory-123' })).toBeNull();
    expect(parseNotificationTarget({
      type: 'MEMORY_CAPTURE_REMINDER',
      memoryId: '../settings',
    })).toBeNull();
    expect(parseNotificationTarget(null)).toBeNull();
  });

  test('keeps one current-launch target until authenticated navigation consumes it', () => {
    const target = {
      type: 'MEMORY_CAPTURE_REMINDER' as const,
      memoryId: 'memory-123',
    };
    setPendingNotificationTarget(target);
    expect(peekPendingNotificationTarget()).toEqual(target);
    expect(takePendingNotificationTarget()).toEqual(target);
    expect(takePendingNotificationTarget()).toBeNull();
  });
});
