import { normalizeExpoBootstrapPath } from './native-path';

describe('native bootstrap path normalization', () => {
  test('maps the initial Vibecode Expo bootstrap URL to home', () => {
    expect(normalizeExpoBootstrapPath({
      path: 'vibecode:///localhost:8081/',
      initial: true,
      hostUri: 'localhost:8081',
    })).toBe('/');
  });

  test('uses the configured Expo host instead of matching any host-looking path', () => {
    expect(normalizeExpoBootstrapPath({
      path: 'vibecode:///preview.example.test:8081/',
      initial: true,
      hostUri: 'preview.example.test:8081',
    })).toBe('/');
    expect(normalizeExpoBootstrapPath({
      path: 'vibecode:///other.example.test:8081/',
      initial: true,
      hostUri: 'preview.example.test:8081',
    })).toBe('vibecode:///other.example.test:8081/');
  });

  test('leaves valid and genuinely unknown routes unchanged', () => {
    const inputs = [
      '/calendar',
      'vibecode:///localhost:8081/calendar',
      'vibecode:///not-a-real-route',
      'not even a url',
    ];

    for (const path of inputs) {
      expect(normalizeExpoBootstrapPath({ path, initial: true, hostUri: 'localhost:8081' })).toBe(path);
    }
  });

  test('never rewrites a non-initial navigation', () => {
    const path = 'vibecode:///localhost:8081/';
    expect(normalizeExpoBootstrapPath({ path, initial: false, hostUri: 'localhost:8081' })).toBe(path);
  });

  test('does not discard query strings or fragments', () => {
    for (const path of [
      'vibecode:///localhost:8081/?source=notification',
      'vibecode:///localhost:8081/#saved',
    ]) {
      expect(normalizeExpoBootstrapPath({ path, initial: true, hostUri: 'localhost:8081' })).toBe(path);
    }
  });
});
