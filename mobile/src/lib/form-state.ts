export type PickerResultLike<T> =
  | { canceled: true; assets: null }
  | { canceled: false; assets: T[] }
  | { code: string; message: string };

export function hasRequiredText(value: string): boolean {
  return value.trim().length > 0;
}

export function selectedPickerAsset<T>(result: PickerResultLike<T> | null): T | null {
  if (!result || 'code' in result || result.canceled) return null;
  return result.assets[0] ?? null;
}
