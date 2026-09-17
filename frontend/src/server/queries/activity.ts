import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dayAfter,
  normalizeActivityFilters,
  type ActivityFilterInput,
} from "@/lib/activity";
import type { Database } from "@/types/database.types";

export const ORGANIZATION_ACTIVITY_PAGE_SIZE = 50;

export type OrganizationActivityEvent = Pick<
  Database["public"]["Tables"]["organization_activity_events"]["Row"],
  | "id"
  | "actor_user_id"
  | "event_type"
  | "subject_type"
  | "subject_id"
  | "params"
  | "created_at"
>;

export type OrganizationActivityPage = {
  events: OrganizationActivityEvent[];
  nextBefore: string | null;
};

type ActivityCursor = {
  createdAt: string;
  id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|(?:[+-](?:0\d|1[0-3]):[0-5]\d)|(?:[+-]14:00))$/;

function isSafeIsoInstant(value: string): boolean {
  if (value.length < 20 || value.length > 35) return false;

  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function encodeCursor(event: OrganizationActivityEvent): string {
  return Buffer.from(JSON.stringify([event.created_at, event.id]), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): ActivityCursor | null {
  if (!value || value.length > 512) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [createdAt, id] = decoded;
    if (
      typeof createdAt !== "string" ||
      typeof id !== "string" ||
      !isSafeIsoInstant(createdAt) ||
      !UUID_PATTERN.test(id)
    ) {
      return null;
    }

    return { createdAt, id: id.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Read the newest organization-visible activity page.
 *
 * The explicit organization predicate is defense in depth and keeps the query
 * honest at every call site; RLS is still the actual tenant boundary and checks
 * `activity.read`/`org.manage`. One look-ahead row determines whether an older
 * opaque keyset cursor should be offered without moving pagination into client
 * state. The cursor carries both sort columns so simultaneous transaction-time
 * events cannot fall through a page boundary.
 */
export async function organizationActivity(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  before?: string,
  filterInput: ActivityFilterInput = {},
): Promise<OrganizationActivityPage> {
  let query = supabase
    .from("organization_activity_events")
    .select("id, actor_user_id, event_type, subject_type, subject_id, params, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ORGANIZATION_ACTIVITY_PAGE_SIZE + 1);

  const filters = normalizeActivityFilters(filterInput);
  if (filters.family) query = query.like("event_type", `${filters.family}.%`);
  if (filters.from) {
    query = query.gte("created_at", `${filters.from}T00:00:00.000000+00:00`);
  }
  if (filters.to) {
    query = query.lt("created_at", `${dayAfter(filters.to)}T00:00:00.000000+00:00`);
  }

  const cursor = decodeCursor(before);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},` +
        `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const hasOlder = data.length > ORGANIZATION_ACTIVITY_PAGE_SIZE;
  const events = data.slice(0, ORGANIZATION_ACTIVITY_PAGE_SIZE);

  return {
    events,
    nextBefore: hasOlder && events.length > 0 ? encodeCursor(events.at(-1)!) : null,
  };
}
