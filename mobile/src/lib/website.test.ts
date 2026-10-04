import { normalizeWebsiteUrl } from './website';

describe('Website fields', () => {
  test('normalizes domains and protocol-relative links', () => {
    expect(normalizeWebsiteUrl(' abc.com ')).toBe('https://abc.com/');
    expect(normalizeWebsiteUrl('www.abc.com/tickets?q=two')).toBe('https://www.abc.com/tickets?q=two');
    expect(normalizeWebsiteUrl('//abc.com')).toBe('https://abc.com/');
    expect(normalizeWebsiteUrl('http://abc.com/path')).toBe('http://abc.com/path');
  });
  test('rejects missing domains, malformed addresses, non-web schemes, and credentials', () => {
    for (const value of ['', 'bad domain', 'abc', 'https://.abc.com', 'https://abc..com', 'javascript:alert(1)', 'ftp://abc.com', 'https://user:password@abc.com']) {
      expect(normalizeWebsiteUrl(value)).toBeNull();
    }
  });
});
