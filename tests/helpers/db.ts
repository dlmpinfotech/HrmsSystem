/**
 * Boots an in-process Postgres (PGlite) with a minimal Supabase-compatible shim
 * (auth schema, auth.uid(), storage schema, anon/authenticated/service_role roles)
 * and applies the real migrations from supabase/migrations. This lets the test
 * suite exercise the actual RLS policies, triggers and functions.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
`;

export type Role = 'anon' | 'authenticated' | 'service_role';

export interface TestDb {
  pg: PGlite;
  /** Run SQL as the superuser (setup/assertions). */
  admin: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Run SQL the way PostgREST would for a given JWT role + user id. */
  as: <T = Record<string, unknown>>(role: Role, userId: string | null, sql: string, params?: unknown[]) => Promise<T[]>;
  createUser: (email: string, roles?: string[], meta?: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(SHIM);

  const dir = path.resolve(process.cwd(), 'supabase/migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await pg.exec(readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  const admin: TestDb['admin'] = async (sql, params = []) => {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    const res = await pg.query(sql, params as never[]);
    return res.rows as never[];
  };

  const as: TestDb['as'] = async (role, userId, sql, params = []) => {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false); set role ${role};`);
    try {
      const res = await pg.query(sql, params as never[]);
      return res.rows as never[];
    } finally {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  };

  const createUser: TestDb['createUser'] = async (email, roles = [], meta = {}) => {
    const id = randomUUID();
    await admin(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [
      id,
      email,
      JSON.stringify({ full_name: email.split('@')[0], ...meta }),
    ]);
    for (const role of roles) {
      await admin(`insert into public.user_roles (user_id, role_key) values ($1, $2)`, [id, role]);
    }
    return id;
  };

  return { pg, admin, as, createUser, close: () => pg.close() };
}

/** Creates a tenant with one customer admin; returns ids. */
export async function createTenant(db: TestDb, name: string, adminEmail: string) {
  const userId = await db.createUser(adminEmail);
  const rows = await db.as<{ id: string }>(
    'service_role',
    null,
    `select public.provision_trial($1, $2, $3, $4, $5, 'Tirunelveli', 'manufacturing', 40, 'business', 'en', true) as id`,
    [userId, name, 'Owner ' + name, '9876500000', adminEmail],
  );
  return { companyId: rows[0].id, adminId: userId };
}
