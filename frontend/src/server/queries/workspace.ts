import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  resolveWorkContext,
  personalEntry,
  businessEntries,
  ORG_COOKIE,
  type WorkContext,
  type WorkspaceEntry,
  type Relationship,
} from "@/lib/workspace/model";

/**
 * The caller's derived work contexts, read through the trusted `my_workspaces()`
 * RPC. One round trip, `auth.uid()`-derived, and it emits the Personal context ONLY
 * when a personal persona was explicitly claimed — so a business-only identity is
 * never offered an empty Personal workspace, and an organization whose membership
 * was suspended or revoked simply stops appearing.
 *
 * This is presentation data. It is NOT an authorization source: the selected
 * workspace grants nothing, and every read/write re-checks membership, capability,
 * branch scope and RLS server-side.
 */
export type Workspaces = {
  entries: WorkspaceEntry[];
  /** The selected context, resolved against what the caller actually has. */
  context: WorkContext | null;
};

const RELATIONSHIPS: readonly string[] = ["owner", "manager", "member"];

function toRelationship(value: string | null): Relationship {
  return RELATIONSHIPS.includes(value ?? "") ? (value as Relationship) : "member";
}

/**
 * `cache()`d for the duration of ONE server render. `my_workspaces()` is a POST
 * RPC, so Next.js request memoization (which only covers GET) cannot dedupe it,
 * and the B2B shell resolves the caller's workspaces twice per navigation — once
 * for the layout, once for the page. This collapses that to a single round trip
 * without caching anything across requests or across callers.
 */
export const loadWorkspaces = cache(async function loadWorkspaces(
  supabase: SupabaseClient<Database>,
): Promise<Workspaces> {
  const { data, error } = await supabase.rpc("my_workspaces");
  if (error) throw error;

  // A Personal row reports a `persona` and a Business row an `org_type`; since
  // Sprint 13 those are two different columns of two different types, and each row
  // populates only its own. Reading one for the other is no longer possible.
  const entries: WorkspaceEntry[] = (data ?? []).map((row) =>
    row.kind === "personal"
      ? { kind: "personal" as const, name: row.name ?? "", persona: row.persona ?? null }
      : {
          kind: "business" as const,
          organizationId: row.organization_id!,
          name: row.name ?? "",
          orgType: row.org_type ?? null,
          relationship: toRelationship(row.relationship),
        },
  );

  const store = await cookies();
  return { entries, context: resolveWorkContext(entries, store.get(ORG_COOKIE)?.value) };
});

/** Convenience for route handlers / pages that own their own client. */
export async function getWorkspaces(): Promise<Workspaces> {
  return loadWorkspaces(await getServerSupabase());
}

export { personalEntry, businessEntries };
