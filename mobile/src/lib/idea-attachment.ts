import type { ImagePickerAsset } from 'expo-image-picker';
import { mediaFileName, normalizeMemoryMediaMimeType, validateMemoryMedia } from './memory-capture';

export function prepareIdeaAttachment(asset: ImagePickerAsset) {
  const kind = 'PHOTO' as const;
  const contentType = normalizeMemoryMediaMimeType(kind, asset.mimeType, asset.fileName ?? asset.uri);
  // Pending Android results can contain an old video selection. Reject those
  // before a missing MIME type could fall back to image/jpeg.
  const isNotPhoto = Boolean(
    (asset.type && asset.type !== 'image') ||
    contentType.startsWith('video/') ||
    [asset.fileName, asset.uri].some((name) => /\.(mp4|mov|m4v|webm|3gp|3gpp|avi|mkv)(?:[?#]|$)/i.test(name ?? '')),
  );
  return {
    kind,
    contentType,
    fileName: mediaFileName(kind, contentType, asset.fileName),
    error: isNotPhoto
      ? 'Choose a photo or flyer image. Videos are not supported for ideas.'
      : validateMemoryMedia(kind, contentType, asset.fileSize),
  };
}
