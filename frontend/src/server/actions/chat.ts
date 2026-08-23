"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { getConversation, listMessages } from "@/server/queries/chat";
import { CHAT_ACCESS_DENIED } from "@/features/chat/view-model";

/**
 * The ONLY write paths application code may take into Chat.
 *
 * All three forward the CALLER's JWT to the approved `security definer` RPCs of
 * `docs/database/chat-core.md` §9. Nothing is decided here:
 *
 *   - `open_conversation(p_subject_type, p_subject_id)` derives BOTH party
 *     organizations from the authoritative subject row and rejects a caller who
 *     holds `conversation.participate` in neither. No organization id is ever
 *     accepted from the browser — there is no parameter for one (INV-6/INV-7).
 *   - `send_message(p_conversation_id, p_body)` resolves sender user AND sender
 *     organization from `auth.uid()` plus the conversation's own party columns.
 *     Neither identity is a parameter (INV-4/INV-5).
 *   - `mark_conversation_read(p_conversation_id)` writes the caller's OWN read
 *     pointer, monotonically; it re-checks party authority and raises 42501
 *     otherwise (§9.3). Idempotent, so firing it on open is safe.
 *
 * Direct INSERT/UPDATE against any Chat table is impossible from here anyway:
 * the tables carry SELECT grants only and no write policies exist to relax.
 *
 * ERROR PRESENTATION
 * Authorization lives in the database (ADR-0008); the UI only translates the
 * outcome. A `42501` — membership suspended, capability withdrawn, org context
 * changed between render and interaction — maps to ONE neutral access code that
 * names nothing about whether the conversation exists (§7.6: knowing an id
 * grants nothing, and error text must not either).
 *
 * WHY THERE IS NO `revalidatePath` HERE — same reasoning as notifications:
 * the surfaces are the header panel and the current record page. The caller
 * invokes `router.refresh()`, which refetches exactly the route the reader is on
 * plus its layouts, so the badge, list and thread update together and nothing
 * else expires.
 */

export type ChatActionState = { ok: boolean; code?: string };

type PgLikeError = { code?: string; message?: string };

function mapChatError(error: unknown): string {
  if ((error as PgLikeError)?.code === "42501") return CHAT_ACCESS_DENIED;
  // Invalid subject type / draft subject / empty or oversized body (22023) are
  // lifecycle and validation outcomes the RPCs own; the composer validates the
  // same rules first, so reaching here means state moved under the caller.
  return "states.genericRetry";
}

/**
 * Opens (or returns the existing) conversation for one transactional subject.
 * `subjectType` must be one of the database's allow-list values — `rfq`,
 * `quotation`, `order`; anything else is rejected server-side with 22023 before
 * authorization is even evaluated.
 */
export async function openConversationAction(
  subjectType: string,
  subjectId: string,
): Promise<ChatActionState & { conversationId?: string }> {
  if (!subjectId || !subjectType) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("open_conversation", {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
  });
  if (error) return { ok: false, code: mapChatError(error) };
  return { ok: true, conversationId: data };
}

/**
 * Appends one message. The body is validated here ONLY as a UI boundary —
 * whitespace-only and over-4000-character submissions are refused before the
 * round trip — while the DATABASE remains the final authority (`send_message`
 * trims, raises 22023, and enforces both constraints at rest).
 */
export async function sendMessageAction(
  conversationId: string,
  body: string,
): Promise<ChatActionState & { messageId?: string }> {
  const trimmed = body.trim();
  if (!conversationId || !trimmed || trimmed.length > 4000) {
    return { ok: false, code: "states.genericRetry" };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: conversationId,
    p_body: body,
  });
  if (error) return { ok: false, code: mapChatError(error) };
  return { ok: true, messageId: data };
}

/** Advances the caller's own reading position. Monotonic and idempotent in the database. */
export async function markConversationReadAction(
  conversationId: string,
): Promise<ChatActionState> {
  if (!conversationId) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (error) return { ok: false, code: mapChatError(error) };
  return { ok: true };
}

/**
 * Loads one accessible thread for display inside the panel.
 *
 * This is a READ carried by a server action because its consumer is a CLIENT
 * component that cannot await a Server Component render mid-panel — the same
 * shape the global search already established (`searchWorkspace`). Authorization
 * is unchanged: `getConversation` returns null when RLS hides the row, and this
 * action collapses that outcome into the SAME neutral access code as a denied
 * mutation, so a departed member learns nothing about the conversation they can
 * no longer see — not its existence, not its parties, not its activity.
 */
export async function loadConversationThreadAction(
  conversationId: string,
): Promise<
  | {
      ok: true;
      messages: Awaited<ReturnType<typeof listMessages>>;
    }
  | { ok: false; code: string }
> {
  if (!conversationId) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  try {
    const conversation = await getConversation(supabase, conversationId);
    if (!conversation) return { ok: false, code: CHAT_ACCESS_DENIED };
    const messages = await listMessages(supabase, conversationId);
    return { ok: true, messages };
  } catch (error) {
    return { ok: false, code: mapChatError(error) };
  }
}
