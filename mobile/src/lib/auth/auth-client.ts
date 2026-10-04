import { api } from '@/lib/api/api';
import { clearPendingNotificationTarget } from '@/lib/notifications/notification-target';
import { revokeCurrentInstallation } from '@/lib/notifications/notifications';
import { clearPrivateMediaCache } from '@/lib/private-media-cache';
import { sessionStore } from './session-store';

export interface AuthSession {
  session: { id: string; expiresAt: string };
  user: { id: string; displayName: string; loginHandle: string };
  household: { id: string; defaultTimeZone: string };
}

export type DevAuthProfile = 'ONE' | 'TWO';

export interface DevAuthProfileSummary {
  profile: DevAuthProfile;
  displayName: string;
}

export interface DevAuthAvailability {
  profiles: DevAuthProfileSummary[];
}

export interface DevAuthSessionInput {
  profile: DevAuthProfile;
  deviceLabel?: string;
}

type AuthSessionResponse = AuthSession & { token: string };

async function persistSession(result: AuthSessionResponse): Promise<AuthSession> {
  await sessionStore.setToken(result.token);
  clearPrivateMediaCache();
  return result;
}

export const authClient = {
  async signIn(input: {
    handle: string;
    passphrase: string;
    deviceLabel?: string;
  }): Promise<AuthSession> {
    const result = await api.post<AuthSessionResponse>('/api/auth/session', input, {
      authenticated: false,
    });
    return persistSession(result);
  },

  developmentAvailability(): Promise<DevAuthAvailability> {
    return api.get<DevAuthAvailability>('/api/dev/auth/session', { authenticated: false });
  },

  async signInDevelopment(input: DevAuthSessionInput): Promise<AuthSession> {
    const result = await api.post<AuthSessionResponse>('/api/dev/auth/session', input, {
      authenticated: false,
    });
    return persistSession(result);
  },

  current(): Promise<Omit<AuthSession, 'session'>> {
    return api.get<Omit<AuthSession, 'session'>>('/api/auth/session/current');
  },

  async signOut(): Promise<void> {
    try {
      try {
        await revokeCurrentInstallation();
      } catch {
        // Session revocation remains authoritative if device cleanup cannot reach the server.
      }
      await api.post<void>('/api/auth/session/revoke');
    } finally {
      clearPendingNotificationTarget();
      await sessionStore.clearToken();
      clearPrivateMediaCache();
    }
  },
};
