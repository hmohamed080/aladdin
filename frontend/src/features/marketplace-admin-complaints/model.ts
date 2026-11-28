/** Shapes and small pure helpers for the payment-complaint admin queue (PR 14). The database is the authority; this is presentation. */

export const COMPLAINT_STATES = ["open", "under_review", "resolved", "dismissed"] as const;
export type ComplaintState = (typeof COMPLAINT_STATES)[number];

export const COMPLAINT_REASONS = ["transfer_made", "amount_mismatch", "receipt_unreadable", "other"] as const;
export type ComplaintReason = (typeof COMPLAINT_REASONS)[number];

export const COMPLAINT_DECISIONS = ["payment_valid", "payment_not_received", "dismissed"] as const;
export type ComplaintDecision = (typeof COMPLAINT_DECISIONS)[number];

export type ComplaintListItem = {
  id: string;
  order_id: string;
  order_number: string;
  state: ComplaintState;
  reason: ComplaintReason;
  filed_by_role: "buyer" | "seller";
  seller_name: string | null;
  buyer_name: string | null;
  total_egp: number;
  paid_now_egp: number | null;
  filed_at: string;
  receipts_count: number;
};

export type ComplaintList = {
  total: number;
  counts: Record<ComplaintState, number>;
  items: ComplaintListItem[];
};

export type ComplaintReceipt = { id: string; object_key: string; status: string; purpose: string; created_at: string };

export type ComplaintDetail = {
  complaint: {
    id: string;
    order_id: string;
    state: ComplaintState;
    reason: ComplaintReason;
    note: string | null;
    filed_by_role: "buyer" | "seller";
    decision: ComplaintDecision | null;
    decision_note: string | null;
    decided_at: string | null;
    taken: boolean;
    taken_by_me: boolean;
    created_at: string;
  };
  order: {
    order_number: string;
    status: string;
    payment_method: string;
    payment_status: string;
    seller: { name: string };
    recipient: { name: string };
    totals: { total_egp: number; paid_now_egp: number | null; balance_due_egp: number | null };
    payment: { receipts: ComplaintReceipt[]; dispute: { flagged_at: string | null; resubmit_due_at: string | null } | null };
  };
  events: { action: string; actor_role: string; note: string | null; at: string }[];
};

const KNOWN_ERRORS = [
  "not_permitted", "not_found", "reason_required", "invalid_payload", "invalid_transition", "invalid_status",
  "complaint_exists", "complaint_not_allowed", "legacy_order", "auth_required",
];

/** Maps an RPC refusal (`mp:<code>` message, Postgres code) to a stable code the page translates; anything else is "unexpected". */
export function complaintErrorCode(error: { message?: string; code?: string }): string {
  const m = /mp:([a-z_]+)/.exec(error.message ?? "");
  if (m && KNOWN_ERRORS.includes(m[1]!)) return m[1]!;
  return error.code === "42501" ? "not_permitted" : "unexpected";
}

export const isComplaintState = (v: string | undefined): v is ComplaintState => COMPLAINT_STATES.includes(v as ComplaintState);

/** The note the decision form requires: 3 to 500 characters once trimmed. */
export const noteIsValid = (note: string) => {
  const n = note.trim().length;
  return n >= 3 && n <= 500;
};
