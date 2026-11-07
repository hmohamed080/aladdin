/**
 * Support code for the LOCAL-ONLY integration run (service.local-integration.test.ts). Not imported by application code.
 *
 * Safety: refuses anything that is not an explicitly named, isolated local Supabase CLI stack (same contract as
 * supabase/tests/lib/db_target.sh): loopback API, `supabase_db_<project>` container, never the shared default stack and
 * never anything staging/prod-like. Nothing here sends anything: delivery is always the in-memory fake transport.
 */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import type { PhoneVerificationDb } from "./service";

export type LocalTarget = { container: string; api: string; anon: string; service: string };

export function localTarget(env: Record<string, string | undefined>): LocalTarget | null {
  const container = env.B1_DB_CONTAINER;
  if (!container) return null;
  const refuse = (why: string): never => { throw new Error(`REFUSED: ${why}`); };
  if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(container)) refuse("B1_DB_CONTAINER is not a local Supabase CLI database container");
  if (/staging|prod/i.test(container) || container === "supabase_db_aladdin") refuse("B1_DB_CONTAINER is a shared or production-like stack");
  const api = env.B1_API_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) refuse("B1_API_URL must be a loopback http URL");
  if (!env.B1_ANON_KEY || !env.B1_SERVICE_KEY) refuse("B1_ANON_KEY and B1_SERVICE_KEY are required");
  return { container, api, anon: env.B1_ANON_KEY as string, service: env.B1_SERVICE_KEY as string };
}

export function makeSql(container: string) {
  const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"];
  const sql = (text: string): string => execFileSync("docker", args, { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const json = <T = unknown>(text: string): T => JSON.parse(sql(text)) as T;
  return { sql, json };
}

export type HttpResult = { status: number; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function makeHttp(t: LocalTarget) {
  async function call(method: string, path: string, opts: { token?: string; key?: string; body?: unknown } = {}): Promise<HttpResult> {
    const key = opts.key ?? t.anon;
    const res = await fetch(`${t.api}${path}`, {
      method,
      headers: { apikey: key, authorization: `Bearer ${opts.token ?? key}`, "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
    return { status: res.status, data };
  }
  return {
    call,
    createUser: (body: unknown) => call("POST", "/auth/v1/admin/users", { key: t.service, token: t.service, body }),
    deleteUser: (id: string) => call("DELETE", `/auth/v1/admin/users/${id}`, { key: t.service, token: t.service }),
    signIn: (email: string, password: string) => call("POST", "/auth/v1/token?grant_type=password", { body: { email, password } }),
    rpcAs: (fn: string, args: unknown, token: string) => call("POST", `/rest/v1/rpc/${fn}`, { token, body: args }),
    /** The production path for the authority: PostgREST RPC with the service-role key. */
    serviceDb(): PhoneVerificationDb {
      return {
        async rpc(fn, args) {
          const r = await call("POST", `/rest/v1/rpc/${fn}`, { key: t.service, token: t.service, body: args });
          return r.status >= 200 && r.status < 300 ? { data: r.data, error: null } : { data: null, error: { code: String(r.data?.code ?? r.status) } };
        },
      };
    },
  };
}

// ---------------------------------------------------------------- redaction for evidence
const PHONE = /\+\d{8,15}/g;
const ALIAS = /p\d{8,15}@craftsman-login\.aladdin\.invalid/g;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g;
const HEX64 = /\b[0-9a-f]{64}\b/g;
export const mask = (value: string): string =>
  value.replace(JWT, "<jwt>").replace(HEX64, "<mac>").replace(ALIAS, (m) => `p***${m.slice(m.indexOf("@") - 2)}`).replace(PHONE, (m) => `+${"*".repeat(m.length - 3)}${m.slice(-2)}`);
export const shortId = (id: string | null | undefined): string | null => (id ? String(id).slice(0, 8) : null);
export const sha = (v: string): string => createHmac("sha256", "evidence").update(v).digest("hex").slice(0, 10);

// ---------------------------------------------------------------- identity snapshot (same coverage as the A2 suite)
export const SNAPSHOT_SQL = (ids: string[]): string => `
  select coalesce(jsonb_object_agg(u.id, jsonb_build_object(
    'auth', jsonb_build_object('email', u.email, 'phone', u.phone, 'phone_confirmed', u.phone_confirmed_at is not null,
      'email_confirmed', u.email_confirmed_at is not null, 'role', u.role, 'aud', u.aud, 'anon', u.is_anonymous,
      'banned_until', u.banned_until, 'pw_digest', md5(u.encrypted_password),
      'source', u.raw_app_meta_data->>'registration_source', 'providers', u.raw_app_meta_data->'providers'),
    'identities', (select coalesce(jsonb_agg(jsonb_build_object('provider', i.provider, 'id', i.id) order by i.provider, i.id), '[]') from auth.identities i where i.user_id = u.id),
    'mfa_factors', (select count(*) from auth.mfa_factors f where f.user_id = u.id),
    'public_user', (select jsonb_build_object('type', x.primary_account_type, 'status', x.status, 'verified', x.is_verified) from public.users x where x.id = u.id),
    'profile', (select jsonb_build_object('id', p.id, 'username', p.username, 'phone_e164', p.phone_e164, 'country', p.phone_country_iso2,
                  'national', p.phone_national, 'verified_at', p.phone_verified_at, 'display_name', p.display_name) from public.profiles p where p.user_id = u.id),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object('org', m.organization_id, 'status', m.status, 'org_type', o.org_type,
                  'org_contact_phone', o.contact_phone,
                  'caps', (select coalesce(jsonb_agg(c.capability_key order by c.capability_key), '[]') from public.membership_capabilities c where c.membership_id = m.id))
                  order by m.organization_id), '[]')
                from public.memberships m join public.organizations o on o.id = m.organization_id where m.user_id = u.id),
    'platform_roles', (select coalesce(jsonb_agg(g.role order by g.role), '[]') from public.platform_role_grants g where g.user_id = u.id),
    'admin_role_assignments', (select count(*) from public.admin_role_assignments a where a.user_id = u.id and a.is_active),
    'secondary_reservations', (select count(*) from public.secondary_phone_reservations r where r.user_id = u.id),
    'points', (select jsonb_build_object('entries', count(*), 'total', coalesce(sum(l.points_delta), 0)) from public.points_ledger l where l.user_id = u.id),
    'consents', (select count(*) from public.consent_receipts c where c.user_id = u.id)
  )), '{}'::jsonb)
  from auth.users u where u.id = any('{${ids.join(",")}}'::uuid[]);`;
