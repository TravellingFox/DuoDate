// Android camera providers can report zero/unknown size for a populated output
// file. Validate the returned local file, not the provider's pre-capture metadata.
export function pickerFileMetadata<T extends { uri: string; fileSize?: number | null }>(
  asset: T,
  readSize: (uri: string) => number | null,
): T {
  const size = readSize(asset.uri);
  return size !== null && Number.isFinite(size) && size >= 0
    ? { ...asset, fileSize: size }
    : asset;
}
