/**
 * Marketplace returns and exchanges (PR 15): the shapes the return RPCs answer
 * (20261125130002_marketplace_returns_rpcs.sql) and the pure rules the screens derive from them.
 *
 * The database is the authority for every transition and every window: these helpers only decide which
 * buttons to show and how to word a deadline. The window functions mirror
 * app.marketplace_return_window_end (calendar days counted from delivery in Africa/Cairo, ending 23:59:59 of
 * the last day) so the wizard can explain a deadline before the server is asked.
 */

export const RETURN_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "in_transit",
  "received",
  "refunded",
  "exchanged",
  "closed",
  "cancelled",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export type ReturnKind = "return" | "exchange";
export type ClaimType = "general" | "defect";
export type ReturnRemedy = "refund" | "exchange";
export type RefundState = "pending" | "sent" | "confirmed" | "disputed";

/** The groups the lists filter by. `open` = a return that still needs somebody. */
export const RETURN_FILTERS = ["open", ...RETURN_STATUSES] as const;
export type ReturnFilter = (typeof RETURN_FILTERS)[number];

export const ACTIVE_STATUSES: readonly ReturnStatus[] = ["requested", "approved", "in_transit", "received"];
export const TERMINAL_STATUSES: readonly ReturnStatus[] = ["rejected", "refunded", "exchanged", "closed", "cancelled"];

export const MAX_EVIDENCE = 6;
export const SELLER_RESPONSE_HOURS = 72;
export const TRANSIT_DAMAGE_HOURS = 48;
export const REFUND_DEADLINE_DAYS = 7;
export const GENERAL_DAYS_FLOOR = 14;
export const DEFECT_DAYS_FLOOR = 30;

export type ReturnSummary = {
  id: string;
  request_number: string;
  order_id: string;
  order_number: string;
  status: ReturnStatus;
  kind: ReturnKind;
  claim_type: ClaimType;
  remedy: ReturnRemedy;
  created_at: string;
  seller_due_at: string;
  in_admin_queue: boolean;
  escalated_reason: "seller_silent" | "complaint" | null;
  seller_name: string;
  buyer_name?: string | null;
  item_count: number;
  value_egp: number;
  action_needed: boolean;
};

export type ReturnItem = {
  item_id: string;
  name_ar: string;
  name_en: string;
  sku: string;
  variant_label: { ar?: string; en?: string } | null;
  image_id: string | null;
  quantity: number;
  unit_price_egp: number;
  line_total_egp: number;
  sellable: boolean | null;
};

export type ReturnEvent = {
  id: string;
  action: string;
  to_status: string | null;
  actor_role: "buyer" | "seller" | "admin" | "system";
  note: string | null;
  at: string;
};

export type ReturnAction =
  | "cancel"
  | "mark_shipped"
  | "confirm_refund"
  | "file_complaint"
  | "approve"
  | "reject"
  | "propose_partial"
  | "receive"
  | "record_refund"
  | "fulfil_exchange"
  | "remind_seller";

export type ReturnDocument = {
  id: string;
  request_number: string;
  order_id: string;
  order_number: string;
  kind: ReturnKind;
  claim_type: ClaimType;
  status: ReturnStatus;
  remedy: ReturnRemedy;
  viewer: "buyer" | "seller" | "admin";
  payment_method: string;
  seller: { name: string };
  buyer?: { name: string } | null;
  reason: { label_ar: string; label_en: string; transit_damage: boolean };
  buyer_note: string | null;
  partial_refund_egp: number | null;
  max_refund_egp: number;
  return_shipping_payer: "seller" | "buyer";
  return_tracking: string | null;
  in_admin_queue: boolean;
  escalated_reason: "seller_silent" | "complaint" | null;
  decision: {
    by: "seller" | "admin";
    message_ar: string | null;
    message_en: string | null;
    internal_note?: string | null;
  } | null;
  timestamps: {
    created_at: string;
    seller_due_at: string;
    shipped_at: string | null;
    received_at: string | null;
    refund_due_at: string | null;
    closed_at: string | null;
    escalated_at: string | null;
  };
  items: ReturnItem[];
  refund: {
    amount_egp: number;
    method: string;
    state: RefundState;
    sent_at: string | null;
    confirmed_at: string | null;
    reference_note: string | null;
  } | null;
  evidence: { id: string; object_key: string; created_at: string }[];
  events: ReturnEvent[];
  actions: ReturnAction[];
};

export type EligibilityLine = {
  item_id: string;
  name_ar: string;
  name_en: string;
  sku: string;
  variant_label: { ar?: string; en?: string } | null;
  image_id: string | null;
  unit_price_egp: number;
  quantity: number;
  returnable_quantity: number;
  non_returnable: boolean;
};

export type ReturnReason = {
  id: string;
  label_ar: string;
  label_en: string;
  claim_type: ClaimType;
  requires_evidence: boolean;
  transit_damage: boolean;
  shipping_payer: "seller" | "buyer";
};

export type Eligibility = {
  eligible: boolean;
  window: { general_ends_at: string; defect_ends_at: string; transit_ends_at: string } | null;
  active_return_id: string | null;
  lines: EligibilityLine[];
  reasons: ReturnReason[];
};

export type ReturnSettings = { general_days: number; defect_days: number; min_general_days: number; min_defect_days: number };

export type SellerReturnsPage = { total: number; counts: Partial<Record<ReturnStatus, number>>; items: ReturnSummary[] };
export type AdminReturnsPage = { total: number; counts: { escalated: number; all: number }; items: ReturnSummary[] };

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------
const CAIRO = "Africa/Cairo";

/** Cairo offset (minutes east of UTC) at an instant. */
function cairoOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CAIRO,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The calendar date (Cairo) of an instant as [year, month, day]. */
function cairoDate(ms: number): [number, number, number] {
  const d = new Date(ms + cairoOffsetMinutes(ms) * 60000);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

/** Last instant of a return window: 23:59:59 Cairo of the day `days` calendar days after delivery. */
export function windowEnd(deliveredAt: string | Date, days: number): Date {
  const delivered = new Date(deliveredAt).getTime();
  const [y, m, d] = cairoDate(delivered);
  // local midnight of the day AFTER the last day, expressed in UTC using the offset valid at that day
  const localMidnight = Date.UTC(y, m, d + days + 1);
  const guess = localMidnight - cairoOffsetMinutes(localMidnight) * 60000;
  const corrected = localMidnight - cairoOffsetMinutes(guess) * 60000;
  return new Date(corrected - 1000);
}

export type WindowInput = { deliveredAt: string; generalDays?: number; defectDays?: number };

/** The three deadlines of a delivered order (a showroom may offer more days than the floor, never fewer). */
export function returnDeadlines({ deliveredAt, generalDays = GENERAL_DAYS_FLOOR, defectDays = DEFECT_DAYS_FLOOR }: WindowInput) {
  return {
    general: windowEnd(deliveredAt, Math.max(generalDays, GENERAL_DAYS_FLOOR)),
    defect: windowEnd(deliveredAt, Math.max(defectDays, DEFECT_DAYS_FLOOR)),
    transit: new Date(new Date(deliveredAt).getTime() + TRANSIT_DAMAGE_HOURS * 3600_000),
  };
}

/** Whether a claim can still be opened `now`. Visible transit damage also needs to be reported within 48 hours. */
export function claimWindowOpen(
  claim: ClaimType,
  transitDamage: boolean,
  d: { general: Date; defect: Date; transit: Date },
  now: Date = new Date(),
): boolean {
  if (transitDamage && now.getTime() > d.transit.getTime()) return false;
  return now.getTime() <= (claim === "defect" ? d.defect : d.general).getTime();
}

/** A made-to-order line accepts only a defect claim. */
export function lineAcceptsClaim(line: Pick<EligibilityLine, "non_returnable" | "returnable_quantity">, claim: ClaimType): boolean {
  return line.returnable_quantity > 0 && (!line.non_returnable || claim === "defect");
}

/** Reasons the buyer may pick: those whose window is still open. */
export function openReasons(reasons: ReturnReason[], d: { general: Date; defect: Date; transit: Date }, now: Date = new Date()): ReturnReason[] {
  return reasons.filter((r) => claimWindowOpen(r.claim_type, r.transit_damage, d, now));
}

export type DraftLine = { item_id: string; quantity: number };

/** Why a draft cannot be sent yet (null = ready). Mirrors the checks marketplace_buyer_return_create makes. */
export function draftProblem(args: {
  lines: DraftLine[];
  eligibility: Eligibility;
  reason: ReturnReason | null;
  evidenceCount: number;
}): "no_lines" | "no_reason" | "evidence_required" | "quantity" | "not_returnable" | null {
  const { lines, eligibility, reason, evidenceCount } = args;
  const chosen = lines.filter((l) => l.quantity > 0);
  if (chosen.length === 0) return "no_lines";
  if (!reason) return "no_reason";
  for (const l of chosen) {
    const line = eligibility.lines.find((x) => x.item_id === l.item_id);
    if (!line || l.quantity > line.returnable_quantity) return "quantity";
    if (!lineAcceptsClaim(line, reason.claim_type)) return "not_returnable";
  }
  if (reason.requires_evidence && evidenceCount === 0) return "evidence_required";
  return null;
}

/** Hours left until a deadline, never negative. */
export function hoursLeft(deadline: string | null | undefined, now: Date = new Date()): number {
  if (!deadline) return 0;
  return Math.max(Math.ceil((new Date(deadline).getTime() - now.getTime()) / 3600_000), 0);
}

export const isActive = (s: ReturnStatus): boolean => ACTIVE_STATUSES.includes(s);

/** The refund the seller must record: the value of the returned units, or the partial amount he proposed. */
export function refundCap(items: Pick<ReturnItem, "line_total_egp">[], partial: number | null): number {
  const value = items.reduce((n, i) => n + Number(i.line_total_egp), 0);
  return partial !== null && partial > 0 ? Math.min(value, partial) : value;
}

/** Only the actions the database listed are shown. Unknown names are ignored so a newer database never breaks an older page. */
export function visibleActions(doc: Pick<ReturnDocument, "actions">, known: readonly ReturnAction[]): ReturnAction[] {
  return doc.actions.filter((a) => known.includes(a));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export const RETURN_ERROR_CODES = new Set([
  "unexpected",
  "auth_required",
  "account_inactive",
  "not_permitted",
  "not_found",
  "invalid_payload",
  "invalid_transition",
  "idempotency_conflict",
  "legacy_order",
  "preset_invalid",
  "reason_required",
  "return_window_closed",
  "return_not_eligible",
  "evidence_required",
  "return_exists",
  "quantity_exceeds_order",
  "insufficient_stock",
  "image_type_invalid",
  "too_many_images",
  "upload_rate_limited",
  "upload_not_found",
  "upload_failed",
  "file_too_large",
  "image_content_invalid",
]);

export function returnErrorCode(code: string): string {
  return RETURN_ERROR_CODES.has(code) ? code : "unexpected";
}
