export function normalizeWebsiteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000 || /\s/.test(trimmed)) return null;
  const address = trimmed.startsWith('//')
    ? `https:${trimmed}`
    : /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!url.hostname.includes('.') || url.hostname.startsWith('.') || url.hostname.endsWith('.')) return null;
    if (url.hostname.split('.').some((part) => !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part))) return null;
    return url.toString().length <= 2000 ? url.toString() : null;
  } catch {
    return null;
  }
}

export const websiteValidationMessage = 'Enter a website such as abc.com or https://abc.com.';
