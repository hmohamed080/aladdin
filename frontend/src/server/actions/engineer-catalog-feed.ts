"use server";

import { requireEngineer } from "@/server/queries/engineer";
import { loadEngineerCatalogBatch } from "@/features/engineer/catalog-data";
import type { CatalogBatch } from "@/features/showroom-shell/catalog/catalog-data";
import { parseShowroomCatalogParams } from "@/features/showroom-shell/catalog/catalog-params";
import { PAGE_BATCH } from "@/lib/pagination/batches";

const MAX_OFFSET = 10_000;

export type EngineerCatalogBatchResult = ({ ok: true } & CatalogBatch) | { ok: false };

/**
 * "Show more" for the engineer's product browser — the engineer twin of `loadCatalogBatchAction`.
 * Who is asking comes from the session (`requireEngineer`), never from the client, and the filters
 * go through the same parser the URL does.
 */
export async function loadEngineerCatalogBatchAction(
  raw: { q?: string; category?: string; supplier?: string },
  offset: number,
): Promise<EngineerCatalogBatchResult> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) return { ok: false };
  try {
    const { supabase } = await requireEngineer();
    const params = parseShowroomCatalogParams(raw);
    return { ok: true, ...(await loadEngineerCatalogBatch(supabase, params, offset, PAGE_BATCH)) };
  } catch {
    return { ok: false };
  }
}
