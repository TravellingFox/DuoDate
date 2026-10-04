import type { Memory, MemoryMediaKind, MemoryMediaSummary } from './api/duodate';
import type { UploadMemoryMediaInput } from './api/memory-media';

export const memoryMediaLimits: Record<MemoryMediaKind, number> = {
  PHOTO: 20 * 1024 * 1024,
  VIDEO: 250 * 1024 * 1024,
  VOICE_NOTE: 50 * 1024 * 1024,
};

export const memoryMediaMimeTypes: Record<MemoryMediaKind, readonly string[]> = {
  PHOTO: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  VIDEO: ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'],
  VOICE_NOTE: [
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/ogg',
    'audio/webm',
    'audio/wav',
    'audio/x-wav',
    'audio/3gpp',
  ],
};

export function normalizeMemoryMediaMimeType(
  kind: MemoryMediaKind,
  contentType: string | null | undefined,
  fileNameOrUri: string,
): string {
  const declaredType = contentType?.split(';')[0]?.trim().toLowerCase();
  const aliases: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'audio/m4a': 'audio/x-m4a',
  };
  if (declaredType) return aliases[declaredType] ?? declaredType;

  const name = fileNameOrUri.toLowerCase().split(/[?#]/, 1)[0] ?? '';
  if (kind === 'PHOTO') {
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.heic')) return 'image/heic';
    if (name.endsWith('.heif')) return 'image/heif';
    return 'image/jpeg';
  }
  if (kind === 'VIDEO') {
    if (name.endsWith('.mov')) return 'video/quicktime';
    if (name.endsWith('.webm')) return 'video/webm';
    if (name.endsWith('.3gp')) return 'video/3gpp';
    return 'video/mp4';
  }
  if (name.endsWith('.aac')) return 'audio/aac';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.ogg')) return 'audio/ogg';
  if (name.endsWith('.webm')) return 'audio/webm';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.3gp')) return 'audio/3gpp';
  return 'audio/mp4';
}

export function validateMemoryMedia(
  kind: MemoryMediaKind,
  contentType: string | null | undefined,
  byteSize: number | null | undefined,
): string | null {
  const normalizedType = contentType?.split(';')[0]?.trim().toLowerCase();
  if (!normalizedType || !memoryMediaMimeTypes[kind].includes(normalizedType)) {
    return kind === 'PHOTO'
      ? 'Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.'
      : kind === 'VIDEO'
        ? 'Choose an MP4, MOV, WebM, or 3GPP video.'
        : 'Record an M4A, AAC, MP3, Ogg, WebM, WAV, or 3GPP voice note.';
  }
  if (byteSize !== null && byteSize !== undefined && byteSize > memoryMediaLimits[kind]) {
    const limit = memoryMediaLimits[kind] / (1024 * 1024);
    return `This file is larger than the ${limit} MB limit.`;
  }
  if (byteSize === 0) return 'This file is empty.';
  return null;
}

export interface MemoryPickerAsset {
  uri: string;
  file?: Blob;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  width?: number;
  height?: number;
  duration?: number | null;
}

export function prepareMemoryPickerAssets(
  assets: MemoryPickerAsset[],
  kind: Extract<MemoryMediaKind, 'PHOTO' | 'VIDEO'>,
  firstSortOrder: number,
): { inputs: UploadMemoryMediaInput[]; errors: string[] } {
  const inputs: UploadMemoryMediaInput[] = [];
  const errors: string[] = [];
  for (const asset of assets) {
    const contentType = normalizeMemoryMediaMimeType(
      kind,
      asset.mimeType,
      asset.fileName ?? asset.uri,
    );
    const validationError = validateMemoryMedia(kind, contentType, asset.fileSize);
    if (validationError) {
      errors.push(validationError);
      continue;
    }
    inputs.push({
      kind,
      uri: asset.uri,
      file: asset.file,
      fileName: mediaFileName(kind, contentType, asset.fileName),
      contentType,
      sortOrder: firstSortOrder + inputs.length,
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration != null && Number.isFinite(asset.duration) && asset.duration >= 0
        ? Math.round(asset.duration)
        : undefined,
    });
  }
  return { inputs, errors };
}

export function hasMemoryContent(memory: Pick<Memory, 'generalText' | 'contributions' | 'mediaItems'>): boolean {
  return Boolean(memory.generalText?.trim()) ||
    memory.contributions.some((item) => item.kind === 'TEXT' && Boolean(item.text?.trim())) ||
    memory.mediaItems.some((item) => item.byteSize > 0);
}

export function upsertMemoryInList(
  memories: Memory[] | undefined,
  memory: Memory,
): Memory[] | undefined {
  if (!memories) return memories;
  const existingIndex = memories.findIndex((item) => item.id === memory.id);
  if (existingIndex < 0) return [memory, ...memories];
  return memories.map((item, index) => index === existingIndex ? memory : item);
}

export function nextMemoryMediaSortOrder(mediaItems: MemoryMediaSummary[]): number {
  return mediaItems.reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1;
}

export function nextMemoryContributionSortOrder(
  contributions: { sortOrder: number }[],
): number {
  return contributions.reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1;
}

export function mediaFileName(
  kind: MemoryMediaKind,
  contentType: string,
  providedName?: string | null,
): string {
  if (providedName?.trim()) return providedName.trim();
  const extensionByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/3gpp': '3gp',
  };
  const prefix = kind === 'PHOTO' ? 'photo' : kind === 'VIDEO' ? 'video' : 'voice-note';
  return `${prefix}-${Date.now()}.${extensionByMime[contentType] ?? 'bin'}`;
}

export function formatMediaDuration(durationMs: number | null | undefined): string {
  const totalSeconds = Math.max(0, Math.round((durationMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
