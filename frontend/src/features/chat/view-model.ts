import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatDateTime, formatRelativeTime, formatTime } from "@/lib/ui/format";

/**
 * PERSISTED CHAT ROWS -> UI-READY VIEWS. Presentation only.
 *
 * Nothing here decides who may see a conversation — the database already did,
 * and whatever reached this module survived RLS. Nothing here decides what a
 * conversation MEANS either: the two party organizations, the subject anchor and
 * every timestamp were derived by the approved RPCs and read back as facts.
 *
 * The ONLY judgment this layer makes is PRESENTATIONAL: which of two already-
 * visible names is "the counterparty", and which side of the thread a message
 * was spoken from. Both derive from data this caller legitimately holds (the
 * conversation row itself) compared against their own context ids — the same UX
 * class as Notifications' optional `organization_id`. Neither comparison grants
 * anything: RLS has already returned these rows, and flipping the comparison
 * could not reveal a row the database did not send.
 *
 * MESSAGE BODIES ARE NEVER TOUCHED. They render exactly as authored — Arabic,
 * English or mixed, byte-identical — per chat-core.md §17. System labels around
 * them stay localized.
 */

/** The closed allow-list of `ck_conversations_subject_type`. Duplicated deliberately: */
/** the constraint keeps bad rows out of the table; this list decides which rows the UI */
/** has real subject copy for. */
export const CHAT_SUBJECT_TYPES = ["rfq", "quotation", "order"] as const;

/**
 * The ONE neutral access-failure translation key for every Chat surface. A
 * 42501 — membership suspended, capability withdrawn — must read the same
 * whether the conversation is gone or was never reachable (§7.6), so all three
 * write paths and the thread loader collapse onto this single string. It lives
 * here because it is a TRANSLATION KEY (client-safe), not because anything
 * client-side decides access.
 */
export const CHAT_ACCESS_DENIED = "chat.error.access";

export type ChatSubjectType = (typeof CHAT_SUBJECT_TYPES)[number];

/**
 * The one key shared by the query layer's display-context map and the lookup
 * below. Defined here because this module is imported by BOTH the server query
 * layer and the client view — a subject id alone would be ambiguous across the
 * three source tables, and two hand-built keys are exactly how the two halves
 * silently stopped matching once before.
 */
export function conversationSubjectKey(subjectType: string, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

const SUBJECT_TYPES = new Set<string>(CHAT_SUBJECT_TYPES);

export function isChatSubjectType(value: string): value is ChatSubjectType {
  return SUBJECT_TYPES.has(value);
}

/** The subset of the persisted conversation row the view model reads. */
export type ConversationSource = {
  id: string;
  subject_type: string;
  subject_id: string;
  requester_org_id: string;
  supplier_org_id: string;
  last_message_at: string | null;
  created_at: string;
  /** The caller's own reading position, or null before first open/send. */
  last_read_at: string | null;
};

/** Names and titles resolved server-side through the commerce `_list` projections. */
export type ConversationDisplayContext = {
  title: string | null;
  requesterName: string | null;
  supplierName: string | null;
};

export type ConversationView = {
  id: string;
  subjectId: string;
  /** The two parties, exactly as the authorized row carries them — the thread */
  /** needs them to attribute messages to a side. Already RLS-vetted data. */
  requesterOrgId: string;
  supplierOrgId: string;
  /** Translation KEY for the transaction type (`chat.subject.rfq`, …), or null when unknown. */
  subjectLabelKey: string | null;
  /** The record's own title, verbatim from its table. Never invented here. */
  subjectTitle: string | null;
  /**
   * The OTHER organization's display name — resolved only when the active work
   * context is one of the two parties. Null on personal surfaces or when names
   * cannot be honestly attributed; the row still shows its subject.
   */
  counterpartyName: string | null;
  /** Latest activity: last message, else the moment the conversation was opened. */
  activityAt: string;
  /** Relative, localized — "3 hours ago". */
  timeAgo: string;
  /** Machine-readable instant for `<time dateTime>`. */
  timestamp: string;
  /** True when activity postdates this reader's position (§11). */
  unread: boolean;
};

export function toConversationView(
  row: ConversationSource,
  context: ConversationDisplayContext | undefined,
  t: TranslateFn,
  locale: Locale,
  /** Active work context, for counterparty attribution. UX only — see module note. */
  activeOrgId?: string | null,
  now?: Date,
): ConversationView {
  const known = isChatSubjectType(row.subject_type);
  const counterpartyOrgId =
    activeOrgId === row.requester_org_id
      ? row.supplier_org_id
      : activeOrgId === row.supplier_org_id
        ? row.requester_org_id
        : null;
  const counterpartyName =
    counterpartyOrgId === row.requester_org_id
      ? (context?.requesterName ?? null)
      : counterpartyOrgId === row.supplier_org_id
        ? (context?.supplierName ?? null)
        : null;

  // A user with no read-state row has never opened the conversation, and every
  // message in it is unread — coalesce(last_read_at, '-infinity'), §5.3.
  const unread =
    row.last_message_at !== null &&
    (row.last_read_at === null || row.last_read_at < row.last_message_at);

  return {
    id: row.id,
    subjectId: row.subject_id,
    requesterOrgId: row.requester_org_id,
    supplierOrgId: row.supplier_org_id,
    subjectLabelKey: known ? `chat.subject.${row.subject_type}` : null,
    subjectTitle: context?.title ?? null,
    counterpartyName,
    activityAt: row.last_message_at ?? row.created_at,
    timeAgo: formatRelativeTime(row.last_message_at ?? row.created_at, locale, now),
    timestamp: row.last_message_at ?? row.created_at,
    unread,
  };
}

/**
 * Display context is keyed by the SUBJECT a conversation is anchored to, not by
 * the conversation id — the commerce projections that resolve names are queried
 * by subject id and know nothing about conversations. Both sides of the seam
 * build the key through `conversationSubjectKey`, so they cannot drift apart.
 */
export function toConversationViews(
  rows: readonly ConversationSource[],
  contexts: ReadonlyMap<string, ConversationDisplayContext>,
  t: TranslateFn,
  locale: Locale,
  activeOrgId?: string | null,
  now?: Date,
): ConversationView[] {
  return rows.map((row) =>
    toConversationView(
      row,
      contexts.get(conversationSubjectKey(row.subject_type, row.subject_id)),
      t,
      locale,
      activeOrgId,
      now,
    ),
  );
}

/* ---------------------------------------------------------------------------
 * Messages
 * ------------------------------------------------------------------------- */

/** The subset of the persisted message row the view model reads. */
export type MessageSource = {
  id: string;
  sender_user_id: string;
  sender_organization_id: string;
  body: string;
  created_at: string;
};

export type MessageSide = "requester" | "supplier";

export type MessageView = {
  id: string;
  /** Exactly as authored and persisted. Never trimmed further, never translated. */
  body: string;
  timestamp: string;
  /** Compact clock time for today, full stamp otherwise — deterministic on `now`. */
  timeLabel: string;
  /** Which SIDE of the transaction spoke, from the conversation's own parties. */
  side: MessageSide | null;
  /** Spoken for the viewer's ACTIVE organization — presentational alignment cue. */
  fromActiveOrg: boolean;
  /** Typed by the signed-in person themselves. */
  fromCurrentUser: boolean;
};

export function toMessageView(
  row: MessageSource,
  /** Which orgs sit on which side of THIS conversation — from the authorized row. */
  sides: { requesterOrgId: string; supplierOrgId: string },
  /** Viewer context: the signed-in person and their active workspace. UX only. */
  viewer: { userId: string | null; activeOrgId: string | null },
  locale: Locale,
  now?: Date,
): MessageView {
  const side =
    row.sender_organization_id === sides.requesterOrgId
      ? "requester"
      : row.sender_organization_id === sides.supplierOrgId
        ? "supplier"
        : null;

  return {
    id: row.id,
    body: row.body,
    timestamp: row.created_at,
    timeLabel: sameDay(row.created_at, now ?? new Date())
      ? formatTime(row.created_at, locale)
      : formatDateTime(row.created_at, locale),
    side,
    fromActiveOrg:
      viewer.activeOrgId !== null && row.sender_organization_id === viewer.activeOrgId,
    fromCurrentUser: viewer.userId !== null && row.sender_user_id === viewer.userId,
  };
}

function sameDay(iso: string, now: Date): boolean {
  const then = new Date(iso);
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
}
