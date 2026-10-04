import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/api';
import { clearPendingNotificationTarget } from '@/lib/notifications/notification-target';
import { clearPrivateMediaCache } from '@/lib/private-media-cache';
import { authClient, type AuthSession } from './auth-client';
import { sessionStore } from './session-store';

export const SESSION_QUERY_KEY = ['auth-session'] as const;

export function useSession() {
  const queryClient = useQueryClient();
  return useQuery<Omit<AuthSession, 'session'> | null>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      const token = await sessionStore.getToken();
      if (!token) return null;

      try {
        return await authClient.current();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearPendingNotificationTarget();
          await sessionStore.clearToken();
          clearPrivateMediaCache();
          await queryClient.cancelQueries({
            predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0],
          });
          queryClient.removeQueries({
            predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0],
          });
          return null;
        }
        throw error;
      }
    },
    retry: 1,
    staleTime: 60_000,
  });
}

export function useInvalidateSession() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.cancelQueries({
      predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0],
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0],
    });
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  };
}
