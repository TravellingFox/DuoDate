import { Platform } from 'react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';
import { sessionStore } from '@/lib/auth/session-store';
import { ApiError, api } from './api';
import type { IdeaImage } from './duodate';
import { prepareIdeaAttachment } from '@/lib/idea-attachment';

interface UploadResponse<T> {
  data?: T;
  error?: { message?: string; code?: string };
}

export function ideaImageContentType(asset: ImagePickerAsset) {
  return prepareIdeaAttachment(asset).contentType;
}

export async function uploadIdeaImage(ideaId: string, asset: ImagePickerAsset) {
  const { contentType, fileName, kind, error } = prepareIdeaAttachment(asset);
  if (error) throw new Error(error);
  const parameters = {
    kind,
    ...(asset.width ? { width: String(asset.width) } : {}),
    ...(asset.height ? { height: String(asset.height) } : {}),
  };

  if (Platform.OS === 'web') {
    let uploadBlob: Blob;
    if (asset.file) uploadBlob = asset.file;
    else uploadBlob = await fetch(asset.uri).then((response) => response.blob());
    const form = new FormData();
    form.append('file', new Blob([uploadBlob], { type: contentType }), fileName);
    for (const [key, value] of Object.entries(parameters)) form.append(key, value);
    return api.putMultipart<IdeaImage>(`/api/ideas/${encodeURIComponent(ideaId)}/image`, form);
  }

  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!baseUrl) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  const token = await sessionStore.getToken();
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required');

  const task = LegacyFileSystem.createUploadTask(
    `${baseUrl}/api/ideas/${encodeURIComponent(ideaId)}/image`,
    asset.uri,
    {
      httpMethod: 'PUT',
      uploadType: LegacyFileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: contentType,
      parameters,
      headers: { Authorization: `Bearer ${token}` },
      sessionType: LegacyFileSystem.FileSystemSessionType.FOREGROUND,
    },
  );
  const response = await task.uploadAsync();
  if (!response) throw new Error('The upload was cancelled');

  let json: UploadResponse<IdeaImage> = {};
  try {
    json = JSON.parse(response.body) as UploadResponse<IdeaImage>;
  } catch {
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(response.status, 'HTTP_ERROR', 'Image upload failed');
    }
  }
  if (response.status < 200 || response.status >= 300 || !json.data) {
    throw new ApiError(
      response.status,
      json.error?.code ?? 'HTTP_ERROR',
      json.error?.message ?? 'Image upload failed',
    );
  }
  return json.data;
}

export function deleteIdeaImage(ideaId: string) {
  return api.delete<{ imageId: string; deleted: boolean; deletionPending: boolean }>(
    `/api/ideas/${encodeURIComponent(ideaId)}/image`,
  );
}
