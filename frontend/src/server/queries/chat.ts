import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
/* The map key is built by the SAME helper the view model looks up with, so the
   two halves of this seam cannot drift apart again. */
import { conversationSubjectKey } from "@/features/chat/view-model";

/**
 * Read queries for Transactional Chat.
 *
 * AUTHORITY IS THE DATABASE'S, AND IT IS ALREADY DECIDED.
 * `docs/database/chat-core.md` §6-§7: access to a conversation is
 * `conversation.participate` in one of the TWO party organizations the subject
 * row names, enforced by `conversations_select_party`; messages are visible
 * exactly when their parent is; read state is own-rows-only and only while
 * parent access lasts. Every query below therefore runs on the caller-scoped
 * client and adds NO ownership predicate of its own — there is nothing to add
 * that RLS has not already decided, and a duplicated check in TypeScript would
 * only be a second place to get it wrong.
 *
 * NO ORGANIZATION ID IS AN ARGUMENT ANYWHERE IN THIS MODULE, even as UX scope.
 * Notifications can accept an optional `organization_id` because the row itself
 * carries that column; a conversation carries TWO parties and neither is "the"
 * org of the thread. Filtering on either here would re-implement, in application
 * code, half of the database's party test — exactly the divergenceable copy the
 * specification forbids. The active-workspace org id enters only at the VIEW
 * MODEL layer, where it decides which counterparty name to display.
 *
 * UNREAD IS `last_message_at` vs `last_read_at`, NOTHING ELSE (chat-core.md
 * §11). There are no per-message receipts to consult and none may be added.
 */

type DB = SupabaseClient<Database>;

export type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

/** The subset of a conversation row the UI reads. */
export type ConversationSummary = Pick<
  ConversationRow,
  | "id"
  | "subject_type"
  | "subject_id"
  | "requester_org_id"
  | "supplier_org_id"
  | "last_message_at"
  | "created_at"
>;

/** A conversation row with the caller's OWN read position joined in by RLS. */
export type ConversationWithReadState = ConversationSummary & {
  /** Absent when this user has never opened or sent into the conversation. */
  last_read_at: string | null;
};

const CONVERSATION_COLUMNS = `
  id, subject_type, subject_id, requester_org_id, supplier_org_id,
  last_message_at, created_at`;

/**
 * Bounded by construction. The header panel is a RECENT list, not an archive —
 * there is no pagination in this increment and no surface that wants
 * conversation fifty. Like `NOTIFICATION_LIST_LIMIT`, the cap means a runaway
 * inbox degrades into a shorter list rather than into a slower page.
 */
export const CONVERSATION_LIST_LIMIT = 12;

/**
 * The newest page of one thread. Fetched NEWEST-first (the direction
 * `ix_messages_conversation` is built for) and reversed for display, so a long
 * thread shows its most recent messages rather than its oldest ones.
 */
export const MESSAGE_PAGE_LIMIT = 50;

/**
 * How many conversations the unread computation will scan before it stops
 * counting. The badge is an exact count of conversations whose activity postdates
 * the reader's position, and PostgREST cannot express that comparison as a single
 * `count(*)` filter across two tables — so the scan reads two timestamps per
 * conversation and never touches `public.messages` (§11.3: cost grows with
 * conversations, never with messages). Pilot-scale reality is tens per
 * organization; the cap is a runaway guard, not an expected operating point.
 */
export const UNREAD_SCAN_LIMIT = 200;

/**
 * The recent conversation list, most recently active first.
 *
 * Ordering follows the approved model: `last_message_at desc nulls last`, then
 * `created_at desc` for conversations nobody has spoken in yet (the schema keeps
 * `last_message_at` null until `send_message` first runs). Both match the
 * org-scoped indexes' shape, so ordering is free where the planner can use them.
 *
 * The caller's own read state rides along as an RLS-filtered EMBED:
 * `conversation_read_state` is visible to a caller only when it is THEIR row AND
 * they still have live parent access (§7.4), so whatever arrives here is exactly
 * the caller's own position — no user-id filter is needed or permitted.
 */
export async function listConversations(
  supabase: DB,
  { limit = CONVERSATION_LIST_LIMIT }: { limit?: number } = {},
): Promise<ConversationWithReadState[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select(`${CONVERSATION_COLUMNS}, conversation_read_state(last_read_at)`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toConversationWithReadState);
}

/** What PostgREST actually sends back for the embedded read-state join. */
type ConversationRowWithEmbed = ConversationSummary & {
  conversation_read_state?:
    | { last_read_at: string | null }
    | { last_read_at: string | null }[]
    | null;
};

function toConversationWithReadState(
  row: ConversationRowWithEmbed,
): ConversationWithReadState {
  const embedded = Array.isArray(row.conversation_read_state)
    ? (row.conversation_read_state[0] ?? null)
    : (row.conversation_read_state ?? null);
  return {
    id: row.id,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    requester_org_id: row.requester_org_id,
    supplier_org_id: row.supplier_org_id,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
    last_read_at: embedded?.last_read_at ?? null,
  };
}

/**
 * One conversation by id, or NULL when the caller cannot see it.
 *
 * RLS matches on party capability and ignores `id` entirely (§7.6), so "does
 * not exist" and "exists but not yours" are deliberately indistinguishable —
 * both arrive here as null, and both must render the same neutral outcome.
 */
export async function getConversation(
  supabase: DB,
  id: string,
): Promise<ConversationSummary | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * One thread's newest page, CHRONOLOGICAL for display.
 *
 * Reads newest-first — the order the approved index is built for — then
 * reverses, so the bounded page always holds the MOST RECENT messages while
 * rendering oldest-at-top. Message bodies come back exactly as authored; this
 * layer does not touch them.
 */
export async function listMessages(
  supabase: DB,
  conversationId: string,
  { limit = MESSAGE_PAGE_LIMIT }: { limit?: number } = {},
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_user_id, sender_organization_id, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}

/**
 * How many accessible conversations hold something this user has not seen.
 *
 * Drives from `conversations` and left-joins the caller's own read position via
 * the same RLS-gated embed as `listConversations`, so a conversation the caller
 * can no longer reach drops out on its own — the badge can never count a thread
 * the panel cannot open (§11.2). Unread means: activity exists AND is newer than
 * my reading position, with "no row" meaning "never read" rather than "read".
 */
export async function countUnreadConversations(supabase: DB): Promise<number> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, last_message_at, conversation_read_state(last_read_at)")
    .limit(UNREAD_SCAN_LIMIT);
  if (error) throw error;

  let unread = 0;
  for (const raw of data ?? []) {
    const row = toConversationWithReadState(raw as ConversationRowWithEmbed);
    // No message has ever been sent into the conversation — nothing to read.
    if (!row.last_message_at) continue;
    // No read-state row means never opened, which means unread (§5.3).
    if (!row.last_read_at || row.last_read_at < row.last_message_at) unread += 1;
  }
  return unread;
}

/* ---------------------------------------------------------------------------
 * Subject display context — what the LIST ROWS call each conversation.
 *
 * Chat rows carry ids, not names, and the base `organizations`/`users` tables
 * are private beyond one's own membership. The approved presentation path is
 * the same one every commerce list already uses: the security_invoker `_list`
 * projections, which resolve party NAMES through `app.org_display_name` and stay
 * gated by the underlying rfqs/quotations/orders policies — a conversation's
 * participant is exactly those tables' legitimate reader. Three bounded `in()`
 * lookups resolve any mix of subjects; a subject that yields nothing (it was
 * deleted, or RLS disagrees) simply renders without a title rather than
 * inventing one.
 * ------------------------------------------------------------------------- */

export type ConversationDisplayContext = {
  /** The record's own title (RFQ title, quotation's RFQ title, order title). */
  title: string | null;
  requesterName: string | null;
  supplierName: string | null;
};


export async function resolveConversationDisplayContext(
  supabase: DB,
  conversations: ReadonlyArray<{ subject_type: string; subject_id: string }>,
): Promise<Map<string, ConversationDisplayContext>> {
  const out = new Map<string, ConversationDisplayContext>();
  const idsByType: Record<string, string[]> = {};
  for (const c of conversations) {
    (idsByType[c.subject_type] ??= []).push(c.subject_id);
  }

  const collect = (
    subjectType: string,
    rows: ReadonlyArray<{
      id: string | null;
      title?: string | null;
      rfq_title?: string | null;
      requester_name?: string | null;
      supplier_name?: string | null;
    }>,
  ) => {
    for (const row of rows) {
      // A view row's id is typed nullable; a row without one cannot name a
      // conversation and is skipped rather than stored under a made-up key.
      if (!row.id) continue;
      out.set(conversationSubjectKey(subjectType, row.id), {
        title: row.title ?? row.rfq_title ?? null,
        requesterName: row.requester_name ?? null,
        supplierName: row.supplier_name ?? null,
      });
    }
  };

  if (idsByType.rfq?.length) {
    const { data, error } = await supabase
      .from("rfq_list")
      .select("id, title, requester_name, supplier_name")
      .in("id", idsByType.rfq);
    if (error) throw error;
    collect("rfq", data ?? []);
  }
  if (idsByType.quotation?.length) {
    const { data, error } = await supabase
      .from("quotation_list")
      .select("id, rfq_title, requester_name, supplier_name")
      .in("id", idsByType.quotation);
    if (error) throw error;
    collect("quotation", data ?? []);
  }
  if (idsByType.order?.length) {
    const { data, error } = await supabase
      .from("order_list")
      .select("id, title, requester_name, supplier_name")
      .in("id", idsByType.order);
    if (error) throw error;
    collect("order", data ?? []);
  }
  return out;
}
