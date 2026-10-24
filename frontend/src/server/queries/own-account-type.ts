import "server-only";
import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type PrimaryAccountType = Database["public"]["Tables"]["users"]["Row"]["primary_account_type"];

/**
 * The caller's own `users.primary_account_type`, read once per server render.
 *
 * The personal home and the sales-persona check both need it on the same render.
 * Next.js on Node happens to collapse the duplicate GET through its fetch
 * memoization; the Cloudflare Workers build does not (ADR-0021), so the sharing
 * is explicit here instead of relying on either runtime. Errors read as "unknown"
 * (`null`), exactly as both callers treated them before.
 */
export const loadOwnPrimaryAccountType = cache(async function loadOwnPrimaryAccountType(userId: string): Promise<PrimaryAccountType | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.from("users").select("primary_account_type").eq("id", userId).maybeSingle();
  return data?.primary_account_type ?? null;
});
