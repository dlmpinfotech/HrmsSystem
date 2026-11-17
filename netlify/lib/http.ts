import type { Context } from '@netlify/functions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { RoleKey } from '../../shared/constants';
import { can, type Permission } from '../../shared/permissions';
import { getAdminClient } from './supabase';
import { authenticate, type AuthUser } from './auth';
import { checkRateLimit } from './rateLimit';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

const MAX_BODY_BYTES = 100 * 1024;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Origins allowed to call the API from a browser: the site itself plus ALLOWED_ORIGINS. */
export function allowedOrigins(requestUrl: URL): Set<string> {
  const list = new Set<string>([requestUrl.origin]);
  for (const key of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL']) {
    const v = process.env[key];
    if (v) list.add(v.replace(/\/$/, ''));
  }
  for (const o of (process.env.ALLOWED_ORIGINS ?? '').split(',')) {
    const v = o.trim().replace(/\/$/, '');
    if (v) list.add(v);
  }
  return list;
}

export function corsHeaders(origin: string | null, requestUrl: URL): Record<string, string> {
  if (!origin || !allowedOrigins(requestUrl).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function clientIp(req: Request, context?: Context): string {
  return (
    context?.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** One-way hash so raw IP addresses are never stored. */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? process.env.SUPABASE_URL ?? 'hrms-sales';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export function siteUrl(requestUrl: URL): string {
  return (process.env.URL ?? requestUrl.origin).replace(/\/$/, '');
}

export interface HandlerCtx<TBody> {
  req: Request;
  url: URL;
  body: TBody;
  raw: string;
  ipHash: string;
  db: SupabaseClient;
  user: AuthUser | null;
  roles: RoleKey[];
  siteUrl: string;
}

export interface HandlerOptions<S extends ZodTypeAny | undefined> {
  name: string;
  methods: string[];
  /** 'user' requires a valid Supabase session; 'none' is for public endpoints and webhooks. */
  auth?: 'none' | 'user';
  /** Caller must hold this permission (implies auth: 'user'). */
  permission?: Permission;
  /** Zod schema for the JSON body of non-GET requests. */
  schema?: S;
  rateLimit?: { max: number; windowSec: number };
  /** Webhooks are server-to-server: no CORS/origin enforcement, raw body preserved. */
  webhook?: boolean;
  /** Skip creating a database client (pure functions like health checks). */
  noDb?: boolean;
}

type BodyOf<S> = S extends ZodTypeAny ? z.output<S> : unknown;

/**
 * Wraps a function with: method check, CORS, origin enforcement for browser writes,
 * rate limiting, authentication, permission check, body validation and safe errors.
 */
export function defineHandler<S extends ZodTypeAny | undefined = undefined>(
  opts: HandlerOptions<S>,
  fn: (ctx: HandlerCtx<BodyOf<S>>) => Promise<Response | unknown>,
) {
  return async (req: Request, context?: Context): Promise<Response> => {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors = opts.webhook ? {} : corsHeaders(origin, url);

    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (!opts.methods.includes(req.method)) throw new HttpError(405, 'method_not_allowed');

      // Browsers always send Origin on cross-site and on same-site non-GET requests.
      if (!opts.webhook && origin && !allowedOrigins(url).has(origin)) {
        throw new HttpError(403, 'origin_not_allowed');
      }

      let raw = '';
      let body: unknown = undefined;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        raw = await req.text();
        if (Buffer.byteLength(raw, 'utf8') > (opts.webhook ? 1024 * 1024 : MAX_BODY_BYTES)) {
          throw new HttpError(413, 'payload_too_large');
        }
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            throw new HttpError(400, 'invalid_json');
          }
        }
      }

      const ipHash = hashIp(clientIp(req, context));
      const db = opts.noDb ? (undefined as unknown as SupabaseClient) : getAdminClient();

      if (opts.rateLimit && db) {
        const ok = await checkRateLimit(db, `${opts.name}:${ipHash}`, opts.rateLimit.max, opts.rateLimit.windowSec);
        if (!ok) throw new HttpError(429, 'rate_limited', 'Too many requests. Please try again later.');
      }

      let user: AuthUser | null = null;
      if (opts.auth === 'user' || opts.permission) {
        user = await authenticate(req, db);
        if (opts.permission && !can(user.roles, opts.permission)) throw new HttpError(403, 'forbidden');
      }

      if (opts.schema && req.method !== 'GET') body = opts.schema.parse(body ?? {});

      const result = await fn({
        req,
        url,
        body: body as BodyOf<S>,
        raw,
        ipHash,
        db,
        user,
        roles: user?.roles ?? [],
        siteUrl: siteUrl(url),
      });
      if (result instanceof Response) {
        for (const [k, v] of Object.entries(cors)) result.headers.set(k, v);
        return result;
      }
      return json(result ?? { ok: true }, 200, cors);
    } catch (err) {
      if (err instanceof ZodError) {
        return json(
          {
            error: {
              code: 'validation_failed',
              message: 'Please check the highlighted fields.',
              fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            },
          },
          422,
          cors,
        );
      }
      if (err instanceof HttpError) {
        return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status, cors);
      }
      // Never leak internals to the client; full detail goes to the function log only.
      console.error(`[${opts.name}] unhandled error`, err);
      return json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } }, 500, cors);
    }
  };
}

/** Throws a safe HttpError for a failed Supabase call, logging the real cause. */
export function assertDb<T>(result: { data: T; error: { message: string; code?: string } | null }, label: string): NonNullable<T> {
  if (result.error) {
    console.error(`[db] ${label}:`, result.error.code, result.error.message);
    if (result.error.code === '23505') throw new HttpError(409, 'conflict', 'This record already exists.');
    if (result.error.code === '42501') throw new HttpError(403, 'forbidden');
    throw new HttpError(500, 'database_error', 'A database error occurred.');
  }
  return result.data as NonNullable<T>;
}
