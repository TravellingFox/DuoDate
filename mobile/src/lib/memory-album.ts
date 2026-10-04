import type { Memory, MemoryMediaSummary } from './api/duodate';

export interface MemoryAlbumGroups {
  saved: Memory[];
  captureRequired: Memory[];
}

export interface MemoryAlbumCardRhythm {
  span: 'full' | 'half';
  imageHeight: number;
}

function newestMemoryFirst(left: Memory, right: Memory): number {
  return right.startDate.localeCompare(left.startDate)
    || right.createdAt.localeCompare(left.createdAt);
}

export function findMemoryForIdea(memories: Memory[], ideaId: string): Memory | null {
  return memories.find((memory) => memory.sourceIdeaId === ideaId) ?? null;
}

export function groupMemoryAlbum(memories: Memory[]): MemoryAlbumGroups {
  const sorted = [...memories].sort(newestMemoryFirst);
  return sorted.reduce<MemoryAlbumGroups>(
    (groups, memory) => {
      if (memory.status === 'CONTENT_VALID') groups.saved.push(memory);
      else groups.captureRequired.push(memory);
      return groups;
    },
    { saved: [], captureRequired: [] },
  );
}

export function memoryExcerpt(memory: Memory): string | null {
  const generalText = memory.generalText?.trim();
  if (generalText) return generalText;

  return memory.contributions
    .find((contribution) => contribution.kind === 'TEXT' && contribution.text?.trim())
    ?.text?.trim() ?? null;
}

export function memoryMatchesSearch(memory: Memory, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  const searchableText = [
    memory.title,
    memory.generalText,
    ...memory.contributions
      .filter((contribution) => contribution.kind === 'TEXT')
      .map((contribution) => contribution.text),
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .toLocaleLowerCase();

  return searchableText.includes(normalizedQuery);
}

export function resolveMemoryCover(memory: Memory): MemoryMediaSummary | null {
  const selectedCover = memory.coverMediaId
    ? memory.mediaItems.find((item) => item.id === memory.coverMediaId && item.kind === 'PHOTO')
    : null;
  if (selectedCover) return selectedCover;

  return [...memory.mediaItems]
    .filter((item) => item.kind === 'PHOTO')
    .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt))[0]
    ?? null;
}

export function memoryAlbumCardRhythm(index: number): MemoryAlbumCardRhythm {
  const position = ((index % 5) + 5) % 5;
  if (position === 0) return { span: 'full', imageHeight: 252 };
  return {
    span: 'half',
    imageHeight: position % 2 === 1 ? 184 : 148,
  };
}
