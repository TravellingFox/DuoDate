import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

const PRIVATE_MEDIA_PREFIX = 'duodate-private-media-';

function safeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function privateMediaCacheFile(
  userId: string,
  sessionVersion: number,
  mediaId: string,
  extension: string,
) {
  return new File(
    Paths.cache,
    `${PRIVATE_MEDIA_PREFIX}${safeSegment(userId)}-${sessionVersion}-${safeSegment(mediaId)}.${safeSegment(extension)}`,
  );
}

export function clearPrivateMediaCache(): void {
  if (Platform.OS === 'web') return;
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && entry.name.startsWith(PRIVATE_MEDIA_PREFIX)) entry.delete();
    }
  } catch {
    // The OS may have already purged cache entries.
  }
}
