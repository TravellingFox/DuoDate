import { Platform } from 'react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';
import { sessionStore } from '@/lib/auth/session-store';
import { ApiError, api } from './api';
import type { TripHeroImage } from './duodate';

interface UploadResponse<T> {
  data?: T;
  error?: { message?: string; code?: string };
}

export function tripHeroContentType(asset: ImagePickerAsset) {
  if (asset.mimeType?.startsWith('image/')) return asset.mimeType;
  const extension = (asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'image/jpeg';
}

function tripHeroFileName(asset: ImagePickerAsset, contentType: string) {
  if (asset.fileName) return asset.fileName;
  const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  return `trip-hero-${Date.now()}.${extension}`;
}

export async function uploadTripHero(tripId: string, asset: ImagePickerAsset) {
  const contentType = tripHeroContentType(asset);
  const fileName = tripHeroFileName(asset, contentType);
  const parameters = {
    ...(asset.width ? { width: String(asset.width) } : {}),
    ...(asset.height ? { height: String(asset.height) } : {}),
  };
  const path = `/api/trips/${encodeURIComponent(tripId)}/hero`;

  if (Platform.OS === 'web') {
    let uploadBlob: Blob;
    if (asset.file) uploadBlob = asset.file;
    else uploadBlob = await fetch(asset.uri).then((response) => response.blob());
    const form = new FormData();
    form.append('file', uploadBlob, fileName);
    for (const [key, value] of Object.entries(parameters)) form.append(key, value);
    return api.putMultipart<TripHeroImage>(path, form);
  }

  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!baseUrl) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  const token = await sessionStore.getToken();
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required');

  const task = LegacyFileSystem.createUploadTask(`${baseUrl}${path}`, asset.uri, {
    httpMethod: 'PUT',
    uploadType: LegacyFileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType: contentType,
    parameters,
    headers: { Authorization: `Bearer ${token}` },
  });
  const response = await task.uploadAsync();
  if (!response) throw new Error('The upload was cancelled');

  let json: UploadResponse<TripHeroImage> = {};
  try {
    json = JSON.parse(response.body) as UploadResponse<TripHeroImage>;
  } catch {
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(response.status, 'HTTP_ERROR', 'Hero photo upload failed');
    }
  }
  if (response.status < 200 || response.status >= 300 || !json.data) {
    throw new ApiError(
      response.status,
      json.error?.code ?? 'HTTP_ERROR',
      json.error?.message ?? 'Hero photo upload failed',
    );
  }
  return json.data;
}
