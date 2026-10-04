import type { Memory, MemoryContribution, MemoryMediaSummary } from './api/duodate';
import {
  groupMemoryAlbum,
  memoryAlbumCardRhythm,
  memoryExcerpt,
  memoryMatchesSearch,
  resolveMemoryCover,
} from './memory-album';

function contribution(overrides: Partial<MemoryContribution> = {}): MemoryContribution {
  return {
    id: 'contribution-1',
    memoryId: 'memory-1',
    authorId: 'user-1',
    kind: 'TEXT',
    text: 'We stayed until the lights came on.',
    sortOrder: 0,
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
    author: { id: 'user-1', displayName: 'Pablo' },
    ...overrides,
  };
}

function media(
  id: string,
  kind: MemoryMediaSummary['kind'],
  sortOrder: number,
  createdAt = '2026-09-14T12:00:00.000Z',
): MemoryMediaSummary {
  return {
    id,
    memoryId: 'memory-1',
    kind,
    contentType: kind === 'PHOTO' ? 'image/jpeg' : kind === 'VIDEO' ? 'video/mp4' : 'audio/mp4',
    byteSize: 100,
    caption: null,
    width: kind === 'PHOTO' ? 100 : null,
    height: kind === 'PHOTO' ? 100 : null,
    durationMs: null,
    sortOrder,
    createdAt,
    updatedAt: createdAt,
    uploader: { id: 'user-1', displayName: 'Pablo' },
  };
}

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'memory-1',
    householdId: 'household-1',
    sourceIdeaId: null,
    sourceScheduleId: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    title: 'Late-night gelato',
    locationSnapshot: 'Rome',
    categorySnapshot: 'Food',
    startDate: '2026-09-14',
    endDate: null,
    generalText: 'The pistachio was worth the walk.',
    status: 'CONTENT_VALID',
    captureDueAt: null,
    resolvedAt: '2026-09-14T12:00:00.000Z',
    coverMediaId: null,
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
    contributions: [contribution()],
    mediaItems: [],
    createdBy: { id: 'user-1', displayName: 'Pablo' },
    updatedBy: { id: 'user-1', displayName: 'Pablo' },
    contributionCount: 1,
    mediaCount: 0,
    captureOverdue: false,
    ...overrides,
  };
}

describe('Memory album', () => {
  test('uses an existing selected photo as the cover', () => {
    const first = media('first-photo', 'PHOTO', 0);
    const selected = media('selected-photo', 'PHOTO', 5);

    expect(resolveMemoryCover(memory({ coverMediaId: selected.id, mediaItems: [first, selected] }))?.id)
      .toBe('selected-photo');
  });

  test('falls back to the first ordered photo when the selected cover is missing or not a photo', () => {
    const later = media('later-photo', 'PHOTO', 2, '2026-09-14T12:00:00.000Z');
    const earlierCreated = media('earlier-created-photo', 'PHOTO', 1, '2026-09-14T11:00:00.000Z');
    const laterCreated = media('later-created-photo', 'PHOTO', 1, '2026-09-14T13:00:00.000Z');
    const video = media('selected-video', 'VIDEO', 0);

    expect(resolveMemoryCover(memory({
      coverMediaId: video.id,
      mediaItems: [later, laterCreated, video, earlierCreated],
    }))?.id).toBe('earlier-created-photo');
    expect(resolveMemoryCover(memory({ coverMediaId: 'removed-photo', mediaItems: [video] }))).toBeNull();
  });

  test('uses general text, then the first written contribution, for album excerpts', () => {
    expect(memoryExcerpt(memory({ generalText: '  Kept from the original date.  ' }))).toBe(
      'Kept from the original date.',
    );
    expect(memoryExcerpt(memory({ generalText: null }))).toBe('We stayed until the lights came on.');
    expect(memoryExcerpt(memory({
      generalText: null,
      contributions: [contribution({ kind: 'PHOTO', text: null })],
    }))).toBeNull();
  });

  test('searches titles, general text, and text contributions only', () => {
    const value = memory({
      title: 'Moonlit walk',
      generalText: 'We heard a nightingale.',
      locationSnapshot: 'Hidden Courtyard',
      categorySnapshot: 'Secret Category',
      contributions: [
        contribution({ text: 'The blue door was still open.' }),
        contribution({ id: 'photo-contribution', kind: 'PHOTO', text: 'private media metadata' }),
      ],
      mediaItems: [media('photo', 'PHOTO', 0)],
    });
    value.mediaItems[0].caption = 'Caption should not be indexed';

    expect(memoryMatchesSearch(value, 'moonlit')).toBe(true);
    expect(memoryMatchesSearch(value, 'nightingale')).toBe(true);
    expect(memoryMatchesSearch(value, 'BLUE DOOR')).toBe(true);
    expect(memoryMatchesSearch(value, 'courtyard')).toBe(false);
    expect(memoryMatchesSearch(value, 'category')).toBe(false);
    expect(memoryMatchesSearch(value, 'metadata')).toBe(false);
    expect(memoryMatchesSearch(value, 'caption')).toBe(false);
  });

  test('groups content-valid memories first and unresolved captures second in newest-first order', () => {
    const unresolved = memory({ id: 'unresolved', status: 'CAPTURE_REQUIRED', startDate: '2026-09-13' });
    const olderSaved = memory({ id: 'older-saved', startDate: '2026-09-10' });
    const newerSaved = memory({ id: 'newer-saved', startDate: '2026-09-14' });
    const groups = groupMemoryAlbum([unresolved, olderSaved, newerSaved]);

    expect(groups.saved.map(({ id }) => id)).toEqual(['newer-saved', 'older-saved']);
    expect(groups.captureRequired.map(({ id }) => id)).toEqual(['unresolved']);
  });

  test('uses a restrained repeating layout rhythm', () => {
    expect([0, 1, 2, 3, 4, 5].map(memoryAlbumCardRhythm)).toEqual([
      { span: 'full', imageHeight: 252 },
      { span: 'half', imageHeight: 184 },
      { span: 'half', imageHeight: 148 },
      { span: 'half', imageHeight: 184 },
      { span: 'half', imageHeight: 148 },
      { span: 'full', imageHeight: 252 },
    ]);
  });
});
