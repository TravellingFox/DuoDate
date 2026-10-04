import type { Memory, Schedule } from './api/duodate';
import { daysUntilSchedule, nextScheduledDate } from './home-state';
import { costLabels } from './format';
import { findMemoryForIdea, groupMemoryAlbum } from './memory-album';

function schedule(
  id: string,
  scheduledDate: string,
  timeZone: string,
  status: Schedule['status'] = 'SCHEDULED',
): Schedule {
  return {
    id,
    householdId: 'household-1',
    ideaId: `idea-${id}`,
    occurrenceId: null,
    createdById: 'user-1',
    scheduledDate,
    startMinute: null,
    endMinute: null,
    startLocalTime: null,
    endLocalTime: null,
    timeZone,
    startsAt: null,
    endsAt: null,
    cleanupDueAt: null,
    status,
    activeSlot: status === 'SCHEDULED' ? `idea-${id}` : null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    idea: { id: `idea-${id}`, title: `Idea ${id}` },
    occurrence: null,
  };
}

function memory(id: string, status: Memory['status'], sourceIdeaId: string | null = null): Memory {
  return {
    id,
    householdId: 'household-1',
    sourceIdeaId,
    sourceScheduleId: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    title: `Memory ${id}`,
    locationSnapshot: null,
    categorySnapshot: null,
    startDate: '2026-09-01',
    endDate: null,
    generalText: null,
    status,
    captureDueAt: null,
    resolvedAt: status === 'CONTENT_VALID' ? '2026-09-01T12:00:00.000Z' : null,
    coverMediaId: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    contributions: [],
    mediaItems: [],
    createdBy: { id: 'user-1', displayName: 'Member One' },
    updatedBy: { id: 'user-1', displayName: 'Member One' },
    contributionCount: 0,
    mediaCount: 0,
    captureOverdue: false,
  };
}

describe('V1 integration state', () => {
  test('uses qualitative cost labels without changing API enum values', () => {
    expect(costLabels).toEqual({
      FREE: 'Free',
      UNDER_20: 'Low',
      FROM_20_TO_50: 'Medium',
      FROM_50_TO_100: 'High',
      FROM_100: 'Splurge',
    });
  });

  test('chooses upcoming schedules using each schedule timezone', () => {
    const now = new Date('2026-09-14T23:30:00.000Z');
    const staleInBerlin = schedule('stale', '2026-09-14', 'Europe/Berlin');
    const stillTodayInBahia = schedule('today', '2026-09-14', 'America/Bahia');
    const future = schedule('future', '2026-09-16', 'Europe/Berlin');

    expect(nextScheduledDate([staleInBerlin, future, stillTodayInBahia], now)?.id).toBe('today');
    expect(daysUntilSchedule(stillTodayInBahia, now)).toBe(0);
  });

  test('does not surface completed schedules as the next date', () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    expect(nextScheduledDate([
      schedule('completed', '2026-09-15', 'Europe/Berlin', 'COMPLETED'),
      schedule('scheduled', '2026-09-16', 'Europe/Berlin'),
    ], now)?.id).toBe('scheduled');
  });

  test('keeps unresolved Memories accessible without duplicating saved Memories', () => {
    const unresolved = memory('unresolved', 'CAPTURE_REQUIRED');
    const saved = memory('saved', 'CONTENT_VALID');
    const groups = groupMemoryAlbum([unresolved, saved]);

    expect(groups.captureRequired.map(({ id }) => id)).toEqual(['unresolved']);
    expect(groups.saved.map(({ id }) => id)).toEqual(['saved']);
  });

  test('resolves a completed Idea to its canonical Memory', () => {
    const other = memory('other', 'CONTENT_VALID', 'idea-other');
    const dated = memory('dated', 'CAPTURE_REQUIRED', 'idea-dated');

    expect(findMemoryForIdea([other, dated], 'idea-dated')?.id).toBe('dated');
    expect(findMemoryForIdea([other, dated], 'missing')).toBeNull();
  });
});
