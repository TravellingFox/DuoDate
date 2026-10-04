// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createPrivateMediaUriLifetime } from './private-media-uri-lifetime';

const flushDisposal = () => new Promise((resolve) => setTimeout(resolve, 15));
const key = ['private-media-content', 'user', 1, 'photo'] as const;

function fixture(uri: string) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity } } });
  client.setQueryData(key, uri);
  const lifetime = createPrivateMediaUriLifetime();
  let disposed = 0;
  const dispose = () => { disposed += 1; };
  return { client, lifetime, dispose, disposed: () => disposed };
}

for (const uri of ['blob:private-photo', 'file:///cache/private-photo.jpg']) {
  describe(`private media URI lifetime (${uri.split(':')[0]})`, () => {
    test('keeps a cached URI alive during screen handoff and disposes after the final release', async () => {
      const f = fixture(uri);
      const releaseCapture = f.lifetime.retain(f.client, uri, f.dispose);
      releaseCapture();
      expect(f.disposed()).toBe(0);
      const releaseAlbum = f.lifetime.retain(f.client, uri, f.dispose);
      await flushDisposal();
      expect(f.disposed()).toBe(0);
      expect(f.client.getQueryData(key)).toBe(uri);
      releaseAlbum();
      await flushDisposal();
      expect(f.disposed()).toBe(1);
      expect(f.client.getQueryData(key)).toBeUndefined();
      f.client.clear();
    });

    test('protects an incoming query observer before its passive effect registers', async () => {
      const f = fixture(uri);
      const releaseCapture = f.lifetime.retain(f.client, uri, f.dispose);
      releaseCapture();
      const observer = new QueryObserver(f.client, { queryKey: key, enabled: false });
      const unsubscribe = observer.subscribe(() => {});
      await flushDisposal();
      expect(f.disposed()).toBe(0);
      expect(observer.getCurrentResult().data).toBe(uri);
      const releaseAlbum = f.lifetime.retain(f.client, uri, f.dispose);
      unsubscribe();
      releaseAlbum();
      await flushDisposal();
      expect(f.disposed()).toBe(1);
      expect(f.client.getQueryData(key)).toBeUndefined();
      f.client.clear();
    });

    test('preserves shared consumers and evicts only stale entries holding the disposed URI', async () => {
      const f = fixture(uri);
      const sameUriKey = [...key, 'other-consumer'];
      const unrelatedKey = ['private-media-content', 'different-photo'];
      f.client.setQueryData(sameUriKey, uri);
      f.client.setQueryData(unrelatedKey, 'other-uri');
      const releaseOne = f.lifetime.retain(f.client, uri, () => {
        expect(f.client.getQueryData(key)).toBeUndefined();
        expect(f.client.getQueryData(sameUriKey)).toBeUndefined();
        f.dispose();
      });
      const releaseTwo = f.lifetime.retain(f.client, uri, () => {
        expect(f.client.getQueryData(key)).toBeUndefined();
        expect(f.client.getQueryData(sameUriKey)).toBeUndefined();
        f.dispose();
      });
      releaseOne();
      await flushDisposal();
      expect(f.disposed()).toBe(0);
      releaseTwo();
      releaseTwo();
      await flushDisposal();
      expect(f.disposed()).toBe(1);
      expect(f.client.getQueryData(unrelatedKey)).toBe('other-uri');
      f.client.clear();
    });

    test('still disposes after signout removes private query entries', async () => {
      const f = fixture(uri);
      const release = f.lifetime.retain(f.client, uri, f.dispose);
      f.client.removeQueries({ queryKey: ['private-media-content'] });
      release();
      await flushDisposal();
      expect(f.disposed()).toBe(1);
      expect(f.client.getQueryData(key)).toBeUndefined();
      f.client.clear();
    });
  });
}
