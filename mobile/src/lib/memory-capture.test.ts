import {
  formatMediaDuration,
  hasMemoryContent,
  mediaFileName,
  nextMemoryContributionSortOrder,
  nextMemoryMediaSortOrder,
  normalizeMemoryMediaMimeType,
  prepareMemoryPickerAssets,
  upsertMemoryInList,
  validateMemoryMedia,
} from './memory-capture';
import type { Memory, MemoryMediaSummary } from './api/duodate';

function media(sortOrder: number): MemoryMediaSummary {
  return {
    id: `media-${sortOrder}`,
    memoryId: 'memory-1',
    kind: 'PHOTO',
    contentType: 'image/jpeg',
    byteSize: 100,
    caption: null,
    width: 100,
    height: 100,
    durationMs: null,
    sortOrder,
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
    uploader: { id: 'user-1', displayName: 'Pablo' },
  };
}

function memory(id: string, status: Memory['status'] = 'CAPTURE_REQUIRED'): Memory {
  return {
    id,
    householdId: 'household-1',
    sourceIdeaId: null,
    sourceScheduleId: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    title: `Memory ${id}`,
    locationSnapshot: null,
    categorySnapshot: null,
    startDate: '2026-09-14',
    endDate: null,
    generalText: null,
    status,
    captureDueAt: null,
    resolvedAt: status === 'CONTENT_VALID' ? '2026-09-14T12:00:00.000Z' : null,
    coverMediaId: null,
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
    contributions: [],
    mediaItems: [],
    createdBy: { id: 'user-1', displayName: 'Pablo' },
    updatedBy: { id: 'user-1', displayName: 'Pablo' },
    contributionCount: 0,
    mediaCount: 0,
    captureOverdue: false,
  };
}

describe('Memory capture media validation', () => {
  test('accepts supported media and normalizes MIME parameters', () => {
    expect(validateMemoryMedia('PHOTO', 'image/jpeg; charset=binary', 1024)).toBeNull();
    expect(validateMemoryMedia('VIDEO', 'video/quicktime', 1024)).toBeNull();
    expect(validateMemoryMedia('VOICE_NOTE', 'audio/webm', 1024)).toBeNull();
  });

  test('rejects unsupported, empty, and oversized files before upload', () => {
    expect(validateMemoryMedia('PHOTO', 'image/gif', 1024)).toContain('JPEG');
    expect(validateMemoryMedia('VOICE_NOTE', 'audio/webm', 0)).toBe('This file is empty.');
    expect(validateMemoryMedia('PHOTO', 'image/jpeg', 20 * 1024 * 1024 + 1)).toBe(
      'This file is larger than the 20 MB limit.',
    );
  });

  test('appends new content after the highest existing sort order', () => {
    expect(nextMemoryMediaSortOrder([media(4), media(1)])).toBe(5);
    expect(nextMemoryMediaSortOrder([])).toBe(0);
    expect(nextMemoryContributionSortOrder([{ sortOrder: 3 }, { sortOrder: 9 }])).toBe(10);
  });

  test('creates safe fallback names and readable durations', () => {
    expect(mediaFileName('VOICE_NOTE', 'audio/x-m4a', null)).toMatch(/^voice-note-\d+\.m4a$/);
    expect(mediaFileName('PHOTO', 'image/jpeg', ' our-photo.jpg ')).toBe('our-photo.jpg');
    expect(formatMediaDuration(65_400)).toBe('1:05');
  });

  test('normalizes picker MIME aliases and infers missing types from the selected asset', () => {
    expect(normalizeMemoryMediaMimeType('PHOTO', 'image/jpg', 'photo.jpg')).toBe('image/jpeg');
    expect(normalizeMemoryMediaMimeType('PHOTO', null, 'file:///photo.heic?edited=1')).toBe('image/heic');
    expect(normalizeMemoryMediaMimeType('VIDEO', undefined, 'holiday.mov')).toBe('video/quicktime');
  });

  test('turns valid picker results into ordered uploads while reporting rejected assets', () => {
    const result = prepareMemoryPickerAssets([
      {
        uri: 'file:///first.jpg',
        fileName: 'first.jpg',
        mimeType: 'image/jpg',
        fileSize: 1024,
        width: 1200,
        height: 900,
      },
      {
        uri: 'file:///bad.gif',
        fileName: 'bad.gif',
        mimeType: 'image/gif',
        fileSize: 1024,
      },
      {
        uri: 'file:///second.png',
        fileName: 'second.png',
        mimeType: null,
        fileSize: 2048,
      },
    ], 'PHOTO', 7);

    expect(result.errors).toEqual(['Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.']);
    expect(result.inputs.map(({ contentType, sortOrder, fileName }) => ({
      contentType,
      sortOrder,
      fileName,
    }))).toEqual([
      { contentType: 'image/jpeg', sortOrder: 7, fileName: 'first.jpg' },
      { contentType: 'image/png', sortOrder: 8, fileName: 'second.png' },
    ]);
  });

  test('rounds fractional picker video duration to valid integer milliseconds', () => {
    const result = prepareMemoryPickerAssets([
      { uri: 'file:///clip.mov', duration: 1034.4827586, mimeType: 'video/quicktime' },
      { uri: 'file:///clip.mp4', duration: Number.NaN, mimeType: 'video/mp4' },
    ], 'VIDEO', 0);
    expect(result.errors).toEqual([]);
    expect(result.inputs[0]?.durationMs).toBe(1034);
    expect(result.inputs[1]?.durationMs).toBeUndefined();
  });

  test('any one persisted text, photo, video or voice contribution is content-valid', () => {
    const empty = memory('empty');
    expect(hasMemoryContent(empty)).toBe(false);
    const staleStatus: Memory = { ...empty, status: 'CONTENT_VALID' };
    expect(hasMemoryContent(staleStatus)).toBe(false);
    expect(hasMemoryContent({ ...empty, generalText: '   ' })).toBe(false);
    expect(hasMemoryContent({ ...empty, generalText: 'One moment' })).toBe(true);
    expect(hasMemoryContent({ ...empty, contributions: [{ id: 'text', memoryId: empty.id, authorId: 'user-1', kind: 'TEXT', text: 'A note', sortOrder: 0, createdAt: empty.createdAt, updatedAt: empty.updatedAt, author: empty.createdBy }] })).toBe(true);
    for (const kind of ['PHOTO', 'VIDEO', 'VOICE_NOTE'] as const) {
      expect(hasMemoryContent({ ...empty, mediaItems: [{ ...media(0), kind }] })).toBe(true);
      expect(hasMemoryContent({ ...empty, mediaItems: [{ ...media(0), kind, byteSize: 0 }] })).toBe(false);
    }
  });

  test('updates an already loaded Memory list immediately after a contribution', () => {
    const first = memory('memory-1');
    const second = memory('memory-2');
    const resolved = { ...first, status: 'CONTENT_VALID' as const, resolvedAt: '2026-09-15T09:00:00.000Z' };

    expect(upsertMemoryInList([first, second], resolved)).toEqual([resolved, second]);
    expect(upsertMemoryInList([second], resolved)).toEqual([resolved, second]);
    expect(upsertMemoryInList(undefined, resolved)).toBeUndefined();
  });
});
