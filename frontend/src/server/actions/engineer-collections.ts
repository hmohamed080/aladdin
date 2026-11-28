"use server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { collectionChangeSchema } from "@/features/engineer/collection-model";

/** The database re-derives the actor and validates ownership and current public visibility. */
export async function changeEngineerCollection(
  input: unknown,
): Promise<{ ok: boolean; code?: string }> {
  const parsed = collectionChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "states.genericRetry" };
  const x = parsed.data;
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("engineer_collection_change", {
    p_action: x.action,
    p_collection_id: x.collectionId,
    p_name: x.name,
    p_entity_type: x.entityType,
    p_entity_id: x.entityId,
  });
  if (error) return { ok: false, code: "states.genericRetry" };
  revalidatePath("/home", "layout");
  return { ok: true };
}
