import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  mapCases,
  mapDuplicates,
  mapFollowUps,
  mapNotes,
  mapPeople,
  mapSuspension,
  mapTimeline,
} from "@/features/admin-preview/operations-mappers";

/**
 * Admin Core Phase 1B-B — reads for the operational workflows. Each loader is
 * one self-guarding RPC (parent read + its own permission, platform scope).
 * A refused or failed read returns `null` so the page shows its locked /
 * error state; it never shows partial or fabricated records.
 */

type Client = SupabaseClient<Database>;
export type SubjectType = "user" | "organization";

function fail(scope: string, error: unknown): null {
  console.error(`[admin-operations] ${scope} failed`, error);
  return null;
}

export async function loadSuspension(supabase: Client, subject: SubjectType, id: string) {
  const { data, error } = await supabase.rpc("admin_subject_suspension", { p_subject_type: subject, p_subject_id: id });
  if (error) return fail("admin_subject_suspension", error);
  return data === null ? null : mapSuspension(data);
}

export async function loadNotes(supabase: Client, subject: SubjectType, id: string) {
  const { data, error } = await supabase.rpc("admin_notes_list", { p_subject_type: subject, p_subject_id: id });
  return error ? fail("admin_notes_list", error) : mapNotes(data);
}

export async function loadFollowUps(supabase: Client, subject: SubjectType, id: string) {
  const { data, error } = await supabase.rpc("admin_follow_ups_list", { p_subject_type: subject, p_subject_id: id });
  return error ? fail("admin_follow_ups_list", error) : mapFollowUps(data);
}

export async function loadFollowUpAssignees(supabase: Client) {
  const { data, error } = await supabase.rpc("admin_follow_up_assignees");
  return error ? fail("admin_follow_up_assignees", error) : mapPeople(data);
}

export async function loadCases(supabase: Client, subject: SubjectType, id: string) {
  const { data, error } = await supabase.rpc("admin_cases_list", { p_subject_type: subject, p_subject_id: id });
  return error ? fail("admin_cases_list", error) : mapCases(data);
}

export async function loadTimeline(supabase: Client, subject: SubjectType, id: string) {
  const { data, error } = await supabase.rpc("admin_entity_timeline", { p_subject_type: subject, p_subject_id: id });
  return error ? fail("admin_entity_timeline", error) : mapTimeline(data);
}

export async function loadOrganizationDuplicates(supabase: Client, orgId: string) {
  const { data, error } = await supabase.rpc("admin_organization_duplicates", { p_organization_id: orgId });
  return error ? fail("admin_organization_duplicates", error) : mapDuplicates(data);
}
