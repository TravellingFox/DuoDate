import { Platform } from 'react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { sessionStore } from '@/lib/auth/session-store';
import { ApiError, api } from './api';
import type { Memory, MemoryMediaKind, MemoryMediaSummary } from './duodate';
import { memorySaveRequest } from '@/lib/memory-save-request';

export type MemoryMediaItem = MemoryMediaSummary & {
  isCover?: boolean;
  contentPath?: string;
};

export interface MemoryMediaMutationResult {
  media: MemoryMediaItem;
  memory: Memory;
}

export interface UploadMemoryMediaInput {
  kind: MemoryMediaKind;
  clientRequestId?: string;
  uri: string;
  file?: Blob;
  fileName: string;
  contentType: string;
  caption?: string;
  sortOrder?: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

interface UploadResponse<T> {
  data?: T;
  error?: { message?: string; code?: string };
}

function uploadParameters(input: UploadMemoryMediaInput): Record<string, string> {
  return {
    kind: input.kind,
    ...(input.clientRequestId === undefined ? {} : { clientRequestId: input.clientRequestId }),
    ...(input.caption === undefined ? {} : { caption: input.caption }),
    ...(input.sortOrder === undefined ? {} : { sortOrder: String(input.sortOrder) }),
    ...(input.width === undefined ? {} : { width: String(input.width) }),
    ...(input.height === undefined ? {} : { height: String(input.height) }),
    ...(input.durationMs === undefined ? {} : { durationMs: String(input.durationMs) }),
  };
}

async function uploadMemoryMediaBlob(
  memoryId: string,
  input: UploadMemoryMediaInput,
): Promise<MemoryMediaMutationResult> {
  let file = input.file;
  if (!file) {
    const response = await fetch(input.uri);
    file = await response.blob();
  }

  const form = new FormData();
  form.append('kind', input.kind);
  form.append('file', file, input.fileName);
  const parameters = uploadParameters(input);
  for (const [key, value] of Object.entries(parameters)) {
    if (key !== 'kind') form.append(key, value);
  }
  return api.postMultipart<MemoryMediaMutationResult>(
    `/api/memories/${encodeURIComponent(memoryId)}/media`,
    form,
  );
}

export async function uploadMemoryMedia(
  memoryId: string,
  input: UploadMemoryMediaInput,
  onProgress?: (fraction: number) => void,
): Promise<MemoryMediaMutationResult> {
  if (Platform.OS === 'web') return uploadMemoryMediaBlob(memoryId, input);

  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!baseUrl) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  const token = await sessionStore.getToken();
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required');

  const task = LegacyFileSystem.createUploadTask(
    `${baseUrl}/api/memories/${encodeURIComponent(memoryId)}/media`,
    input.uri,
    {
      httpMethod: 'POST',
      uploadType: LegacyFileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: input.contentType,
      parameters: uploadParameters(input),
      headers: { Authorization: `Bearer ${token}` },
      sessionType: LegacyFileSystem.FileSystemSessionType.FOREGROUND,
    },
    ({ totalBytesSent, totalBytesExpectedToSend }) => {
      if (totalBytesExpectedToSend > 0) {
        onProgress?.(Math.min(1, totalBytesSent / totalBytesExpectedToSend));
      }
    },
  );
  const response = await task.uploadAsync();
  if (!response) throw new Error('The upload was cancelled');

  let json: UploadResponse<MemoryMediaMutationResult> = {};
  try {
    json = JSON.parse(response.body) as UploadResponse<MemoryMediaMutationResult>;
  } catch {
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(response.status, 'HTTP_ERROR', 'Upload failed');
    }
  }
  if (response.status < 200 || response.status >= 300 || !json.data) {
    throw new ApiError(
      response.status,
      json.error?.code ?? 'HTTP_ERROR',
      json.error?.message ?? 'Upload failed',
    );
  }
  return json.data;
}

export function getMemoryMediaContent(mediaId: string) {
  return api.raw(`/api/media/${encodeURIComponent(mediaId)}/content`);
}

export function updateMemoryMediaCaption(
  memoryId: string,
  mediaId: string,
  caption: string | null,
) {
  return memorySaveRequest('caption', memoryId, (nativeTransport) => api.patch<MemoryMediaItem>(
    `/api/memories/${encodeURIComponent(memoryId)}/media/${encodeURIComponent(mediaId)}`,
    { caption }, { timeoutMs: 15000, nativeTransport },
  ), (error) => !(error instanceof ApiError));
}

export function reorderMemoryMedia(memoryId: string, mediaIds: string[]) {
  return api.put<Memory>(`/api/memories/${encodeURIComponent(memoryId)}/media-order`, { mediaIds });
}

export function setMemoryCover(memoryId: string, mediaId: string | null) {
  return api.put<Memory>(`/api/memories/${encodeURIComponent(memoryId)}/cover`, { mediaId });
}

export function deleteMemoryMedia(memoryId: string, mediaId: string) {
  return api.delete<{ mediaId: string; deleted: boolean; deletionPending: boolean }>(
    `/api/memories/${encodeURIComponent(memoryId)}/media/${encodeURIComponent(mediaId)}`,
  );
}
