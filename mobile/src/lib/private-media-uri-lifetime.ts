import type { QueryClient } from '@tanstack/react-query';

// Query observers subscribe before passive effects register their URI references.
// Give a replacement screen a task to acquire the cached URI before disposing it.
export function createPrivateMediaUriLifetime() {
  const references = new Map<string, number>();
  const disposals = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    retain(queryClient: QueryClient, uri: string, dispose: () => void): () => void {
      const pending = disposals.get(uri);
      if (pending !== undefined) {
        clearTimeout(pending);
        disposals.delete(uri);
      }
      references.set(uri, (references.get(uri) ?? 0) + 1);
      let released = false;

      return () => {
        if (released) return;
        released = true;
        const remaining = (references.get(uri) ?? 1) - 1;
        if (remaining > 0) {
          references.set(uri, remaining);
          return;
        }
        references.delete(uri);
        disposals.set(uri, setTimeout(() => {
          disposals.delete(uri);
          if (references.has(uri)) return;
          const cache = queryClient.getQueryCache();
          const queries = cache.findAll({
            queryKey: ['private-media-content'],
            predicate: (query) => query.state.data === uri,
          });
          if (queries.some((query) => query.getObserversCount() > 0)) return;
          // Never leave a disposed URI available for an infinite-stale cache hit.
          for (const query of queries) cache.remove(query);
          dispose();
        }, 0));
      };
    },
  };
}
