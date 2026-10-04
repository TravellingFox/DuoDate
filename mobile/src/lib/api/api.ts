import { fetch } from 'expo/fetch';
import { sessionStore } from '@/lib/auth/session-store';
import { withRequestDeadline } from '@/lib/request-deadline';

interface ApiResponse<T> {
  data: T;
}

interface ApiErrorResponse {
  error?: {
    message?: string;
    code?: string;
  };
}

interface RequestOptions {
  method?: string;
  body?: string | FormData;
  authenticated?: boolean;
  timeoutMs?: number;
  nativeTransport?: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

const request = async <T>(url: string, options: RequestOptions = {}): Promise<T> => {
  if (options.timeoutMs) {
    return withRequestDeadline((signal) => performRequest<T>(url, options, signal), options.timeoutMs);
  }
  return performRequest<T>(url, options);
};

const performRequest = async <T>(url: string, options: RequestOptions, signal?: AbortSignal): Promise<T> => {
  if (!baseUrl) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');

  const token = options.authenticated === false ? null : await sessionStore.getToken();
  if (signal?.aborted) throw new Error('Request cancelled');
  // Memory completion can retry a failed Expo stream with the RN transport;
  // other app requests retain their existing transport and behavior.
  const transport = options.nativeTransport ? globalThis.fetch : fetch;
  const response = await transport(`${baseUrl}${url}`, {
    method: options.method,
    body: options.body,
    signal,
    headers: {
      ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    if (!response.ok) throw new ApiError(response.status, 'HTTP_ERROR', 'Request failed');
    return undefined as T;
  }

  const json = (await response.json()) as ApiResponse<T> & ApiErrorResponse;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      json.error?.code ?? 'HTTP_ERROR',
      json.error?.message ?? 'Request failed',
    );
  }
  return json.data;
};

export const api = {
  get: <T>(url: string, options?: Pick<RequestOptions, 'authenticated' | 'timeoutMs' | 'nativeTransport'>) =>
    request<T>(url, options),
  post: <T>(url: string, body?: unknown, options?: Pick<RequestOptions, 'authenticated' | 'timeoutMs' | 'nativeTransport'>) =>
    request<T>(url, {
      ...options,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  postMultipart: <T>(url: string, body: FormData) =>
    request<T>(url, { method: 'POST', body }),
  putMultipart: <T>(url: string, body: FormData) =>
    request<T>(url, { method: 'PUT', body }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown, options?: Pick<RequestOptions, 'timeoutMs' | 'nativeTransport'>) =>
    request<T>(url, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
  raw: async (
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) => {
    if (!baseUrl) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
    const token = await sessionStore.getToken();
    return fetch(`${baseUrl}${url}`, {
      ...options,
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  },
};
