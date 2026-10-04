export interface NativePathNormalizationInput {
  path: string;
  initial: boolean;
  hostUri: string | null | undefined;
  scheme?: string;
}

function normalizedHostUri(hostUri: string) {
  return hostUri.trim().replace(/^\/+|\/+$/g, '');
}

/**
 * Ignores only the synthetic URL Vibecode uses to open an Expo development
 * bundle. Real app links, including unknown ones, must continue into Router.
 */
export function normalizeExpoBootstrapPath({
  path,
  initial,
  hostUri,
  scheme = 'vibecode',
}: NativePathNormalizationInput) {
  if (!initial || !hostUri) return path;

  const host = normalizedHostUri(hostUri);
  if (!host) return path;

  try {
    const url = new URL(path);
    const expectedPathname = `/${host}`;
    const isBootstrapUrl =
      url.protocol === `${scheme}:` &&
      url.host === '' &&
      (url.pathname === expectedPathname || url.pathname === `${expectedPathname}/`) &&
      url.search === '' &&
      url.hash === '';

    return isBootstrapUrl ? '/' : path;
  } catch {
    return path;
  }
}
