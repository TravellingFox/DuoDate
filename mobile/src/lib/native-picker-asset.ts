import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import { pickerFileMetadata } from './picker-file-metadata';

export function nativePickerAsset(asset: ImagePickerAsset): ImagePickerAsset {
  if (Platform.OS === 'web') return asset;
  return pickerFileMetadata(asset, (uri) => {
    try {
      const file = new File(uri);
      return file.exists ? file.size : null;
    } catch {
      return null;
    }
  });
}
