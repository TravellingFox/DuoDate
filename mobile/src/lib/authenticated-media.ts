import { useEffect } from 'react';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionStore } from '@/lib/auth/session-store';
import { useSession } from '@/lib/auth/use-session';
import { privateMediaCacheFile } from '@/lib/private-media-cache';
import { createPrivateMediaUriLifetime } from '@/lib/private-media-uri-lifetime';

const mediaUriLifetime = createPrivateMediaUriLifetime();

function extensionForContentType(contentType: string | undefined) {
  const extensions: Record<string, string> = {
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
  return contentType ? extensions[contentType] ?? 'media' : 'media';
}

export function useAuthenticatedPrivateMediaUri(
  cacheKey: string,
  contentPath: string,
  contentType?: string,
) {
  const session = useSession();
  const queryClient = useQueryClient();
  const content = useQuery({
    queryKey: ['private-media-content', session.data?.user.id, session.dataUpdatedAt, cacheKey, contentPath, contentType],
    enabled: Boolean(session.data?.user),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      if (!baseUrl) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
      const token = await sessionStore.getToken();
      if (!token) throw new Error('Authentication is required');
      const url = `${baseUrl}${contentPath}`;

      if (Platform.OS === 'web') {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        if (!response.ok) throw new Error('Media could not be opened');
        const uri = URL.createObjectURL(await response.blob());
        if (signal.aborted || await sessionStore.getToken() !== token) {
          URL.revokeObjectURL(uri);
          throw new Error('The media session ended');
        }
        return uri;
      }

      const destination = privateMediaCacheFile(
        session.data?.user.id ?? 'session',
        session.dataUpdatedAt,
        cacheKey,
        extensionForContentType(contentType),
      );
      const downloaded = await File.downloadFileAsync(url, destination, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });
      if (signal.aborted || await sessionStore.getToken() !== token) {
        if (downloaded.exists) downloaded.delete();
        throw new Error('The media session ended');
      }
      return downloaded.uri;
    },
  });

  useEffect(() => {
    const uri = content.data;
    if (!uri) return undefined;
    return mediaUriLifetime.retain(queryClient, uri, () => {
      if (Platform.OS === 'web') {
        URL.revokeObjectURL(uri);
        return;
      }
      try {
        const file = new File(uri);
        if (file.exists) file.delete();
      } catch {
        // The OS may already have removed this temporary private file.
      }
    });
  }, [content.data, queryClient]);

  return content;
}

export function useAuthenticatedMediaUri(mediaId: string, contentType?: string) {
  return useAuthenticatedPrivateMediaUri(
    mediaId,
    `/api/media/${encodeURIComponent(mediaId)}/content`,
    contentType,
  );
}
