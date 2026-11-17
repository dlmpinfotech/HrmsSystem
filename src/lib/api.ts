import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the signed-in user's access token (default true when a session exists). */
  auth?: boolean;
  signal?: AbortSignal;
}

/** Calls a Netlify Function under /api. Throws ApiError with a stable `code` for i18n. */
export async function api<T = unknown>(path: string, { method = 'GET', body, auth = true, signal }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch {
    throw new ApiError(0, 'network_error', 'Network error');
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON means the function is not deployed/reachable (e.g. the SPA fallback answered).
    throw new ApiError(res.status, 'service_unavailable', 'Service unavailable');
  }

  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; fields?: { path: string; message: string }[] } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'request_failed', e?.message ?? 'Request failed', e?.fields);
  }
  return data as T;
}

/** i18n key for an error thrown by `api()` or Supabase; falls back to a generic message. */
export function errorKey(err: unknown): string {
  if (err instanceof ApiError) return `errors.${err.code}`;
  if (err instanceof Error && err.message.startsWith('errors.')) return err.message;
  // Database rules raise short snake_case codes (e.g. "leave_overlap") — map them to errors.<code>.
  if (err instanceof Error && /^[a-z][a-z0-9_]{2,40}$/.test(err.message)) return `errors.${err.message}`;
  return 'errors.generic';
}
