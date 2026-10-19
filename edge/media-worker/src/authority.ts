import postgres from "postgres";
import type { MediaAuthority } from "./types";

/**
 * Postgres through Hyperdrive. One short-lived client per request (Hyperdrive
 * pools the real connections). The database role may EXECUTE only the two
 * Worker functions; every decision is made there, never in this file.
 */
export function postgresAuthority(connectionString: string): MediaAuthority {
  const sql = postgres(connectionString, {
    max: 1, fetch_types: false, connect_timeout: 5, idle_timeout: 2, max_lifetime: 60,
  });
  return {
    async authorizePrivate(r) {
      const rows = await sql`select public.media_edge_authorize(${r.namespace}, ${r.key}, ${r.variant},
        ${r.viewer}::uuid, ${r.session}::uuid, ${r.workspace}::uuid, to_timestamp(${r.expiresAt}::double precision)) as g`;
      return rows[0]?.g ?? null;
    },
    async authorizePublic(r) {
      const rows = await sql`select public.media_edge_public(${r.namespace}, ${r.id}::uuid, ${r.variant}) as g`;
      return rows[0]?.g ?? null;
    },
    async close() { await sql.end({ timeout: 1 }); },
  };
}
