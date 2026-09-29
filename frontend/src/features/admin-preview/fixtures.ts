/**
 * PREVIEW FIXTURES — Phase 0 Admin Frontend Blueprint only.
 *
 * Everything in this file is either (a) illustrative fake content for a
 * capability with NO backend yet (Admin Notes, BL-008), or (b) a taxonomy
 * that has been product-approved (PD-005's rejection reason codes) but has
 * no database column yet. Nothing here is read by, or leaks into, any
 * production Admin page (`/admin/**`) — this module is imported only from
 * `app/admin/preview/**`. Do not import it from outside the preview feature.
 */

export type PreviewNoteFixture = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

/**
 * Admin Notes has no backend (BL-008 is planning-only). This fixture exists
 * purely so the "Admin Notes" tab in the preview can show what the feature
 * will look like once built — every note here is fake, deterministic (keyed
 * by subject id) rather than random, and labelled in the UI as a preview
 * fixture (`adminPreview.notes.fixtureNotice`).
 */
const NOTE_FIXTURE_POOL: PreviewNoteFixture[] = [
  {
    id: "fixture-note-1",
    author: "Preview reviewer",
    body: "Called to confirm the phone number on file — reachable, matches the submitted documents.",
    createdAt: "2026-09-10T09:15:00.000Z",
  },
  {
    id: "fixture-note-2",
    author: "Preview reviewer",
    body: "Flagged for a follow-up check next quarter — nothing concerning found so far.",
    createdAt: "2026-09-15T13:40:00.000Z",
  },
];

/** Deterministic per-subject fixture set — same subject always shows the same fake notes. */
export function previewNotesFor(subjectId: string): PreviewNoteFixture[] {
  // A short hash of the id decides how many fixture notes to show (0-2), so
  // different subjects in the preview don't all look identical.
  const hash = Array.from(subjectId).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const count = hash % 3;
  return NOTE_FIXTURE_POOL.slice(0, count);
}

/**
 * PD-005's approved rejection-reason taxonomy. Product-decided (2026-09-19),
 * not yet backed by a `reason_code` database column anywhere (BL-010 is
 * planning-only) — shown here so the Review Center reject dialog can preview
 * the real, approved option list rather than an invented one.
 */
export const PREVIEW_REASON_CODES = [
  "duplicate",
  "invalid_information",
  "unable_to_verify",
  "incomplete_information",
  "not_eligible",
  "other",
] as const;

export type PreviewReasonCode = (typeof PREVIEW_REASON_CODES)[number];

/* ---------------------------------------------------------------------- */
/* Phase 0B additions.                                                     */
/*                                                                         */
/* Investigated before adding any of these (not guessed): `contacts`      */
/* (email/phone) is self-select-only RLS, no platform-read policy;        */
/* `profiles.locality_id` / `organizations.locality_id` are both orphaned */
/* FKs (no `localities` table has ever shipped); `individual_onboarding`  */
/* (which DOES hold real governorate/city) is also self-select-only.      */
/* There is genuinely no safe admin read path for email, phone, or        */
/* city/location anywhere in the current schema — building one is backend */
/* work (a new RLS policy or RPC), explicitly out of scope for Phase 0B.  */
/* Every function below is therefore a deterministic, clearly-labelled    */
/* fixture — never a guess dressed up as data.                            */
/* ---------------------------------------------------------------------- */

/**
 * FNV-1a over 32-bit integers (`Math.imul` keeps every step exact -- no
 * accumulator ever leaves the safe-integer range). A naive `acc * 31 + code`
 * accumulator looked fine on real (36-char, high-entropy) UUIDs but silently
 * collapsed every `preview-visitor-0`..`preview-visitor-9` id (Analytics'
 * own fixture) to the SAME float once the running total exceeded 2^53: those
 * ids share an 18-character prefix and differ only in one low-order digit,
 * and at that magnitude a difference of "9" is far smaller than one float
 * ULP, so it was rounded away and every visitor row rendered identically.
 */
function hashOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic fixture email/phone — no safe admin read path exists for either (see note above). */
export function previewContactFor(userId: string): { email: string; phone: string } {
  const n = hashOf(userId);
  return {
    email: `user${n % 9000}@preview.example`,
    phone: `010${String(1000000 + (n % 8999999)).padStart(8, "0")}`,
  };
}

export const PREVIEW_CITIES = [
  "Cairo · Nasr City",
  "Cairo · New Cairo",
  "Giza · Sheikh Zayed",
  "Giza · 6th of October",
  "Alexandria · Smouha",
  "Alexandria · Miami",
] as const;

/** Deterministic fixture city — Aladdin has no shipped locality table yet (see note above). */
export function previewCityFor(id: string): string {
  return PREVIEW_CITIES[hashOf(id) % PREVIEW_CITIES.length]!;
}

/**
 * Deterministic fixture profile-completeness percentage. Aladdin DOES have a
 * real completeness engine (`lib/profile/completeness.ts`), but it scores
 * fields on `individual_onboarding`, which — like contacts — is self-select
 * RLS only, so an admin cannot read another user's onboarding answers to
 * compute it for real without new backend access. Fixture until that read
 * path exists.
 */
export function previewCompletenessFor(userId: string): number {
  return 40 + (hashOf(userId) % 61); // 40-100, never a misleadingly-empty 0%
}

/** Deterministic, low-frequency fixture duplicate flag for the Users directory — Aladdin has no real user-level duplicate signal (unlike organizations, which have a real one; see `previewOrgDuplicateCandidates`). */
export function previewUserDuplicateFlag(userId: string): boolean {
  return hashOf(userId) % 11 === 0;
}

/* ---------------------------------------------------------------------- */
/* Analytics / User Activity fixtures.                                     */
/*                                                                         */
/* Investigated first: grepped every migration for `user_events`,          */
/* `click_event`, `page_view`, `last_active_at` — ZERO matches. Aladdin    */
/* has no product-usage tracking of any kind today (unlike Talent, whose   */
/* `/admin/user-activity` reads a real `user_events` table). This entire   */
/* page is therefore fixture data, and says so prominently in its own UI   */
/* banner — it previews the INTENDED shape of a future Analytics surface,  */
/* not a claim that any of these numbers are real.                        */
/* ---------------------------------------------------------------------- */

export type PreviewTrafficPoint = { date: string; pageViews: number; signups: number; logins: number };

export function previewTrafficSeries(days = 14): PreviewTrafficPoint[] {
  const out: PreviewTrafficPoint[] = [];
  const base = new Date("2026-09-06T00:00:00.000Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const n = hashOf(d.toISOString().slice(0, 10));
    out.push({
      date: d.toISOString().slice(0, 10),
      pageViews: 180 + (n % 260),
      signups: 2 + (n % 9),
      logins: 30 + (n % 70),
    });
  }
  return out;
}

export type PreviewTopPage = { path: string; views: number };

export const PREVIEW_TOP_PAGES: PreviewTopPage[] = [
  { path: "/home", views: 3120 },
  { path: "/explore", views: 2210 },
  { path: "/home/network", views: 1480 },
  { path: "/home/jobs", views: 1105 },
  { path: "/b2b", views: 940 },
  { path: "/home/points", views: 640 },
];

export type PreviewTopEvent = { event: string; count: number };

export const PREVIEW_TOP_EVENTS: PreviewTopEvent[] = [
  { event: "search", count: 2680 },
  { event: "job_application", count: 410 },
  { event: "rfq_submitted", count: 265 },
  { event: "network_referral_submitted", count: 58 },
];

export type PreviewVisitorRow = {
  id: string;
  label: string;
  personaType: string | null;
  firstSeen: string;
  lastActive: string;
  totalEvents: number;
};

export function previewVisitorRows(): PreviewVisitorRow[] {
  const personas = ["installer_technician", "engineer", "interior_designer", "end_consumer", null] as const;
  return Array.from({ length: 10 }).map((_, i) => {
    const id = `preview-visitor-${i}`;
    const n = hashOf(id);
    return {
      id,
      label: `Visitor ${1000 + n % 8999}`,
      personaType: personas[n % personas.length] ?? null,
      firstSeen: new Date(Date.UTC(2026, 8, 1 + (n % 18))).toISOString(),
      lastActive: new Date(Date.UTC(2026, 8, 5 + (n % 14))).toISOString(),
      totalEvents: 3 + (n % 120),
    };
  });
}

/* ---------------------------------------------------------------------- */
/* Phase 0C additions.                                                     */
/* ---------------------------------------------------------------------- */

export type PreviewFollowUpType = "call" | "whatsapp" | "email" | "verificationFollowUp" | "other";

export type PreviewFollowUp = {
  id: string;
  type: PreviewFollowUpType;
  note: string;
  followUpDate: string | null;
  actor: string;
  createdAt: string;
};

/**
 * Admin Follow-up / Interaction history -- a DIFFERENT concept from Admin
 * Notes (freeform internal context) and from Audit (system/admin change
 * history): an operational event (a call made, a WhatsApp sent, a
 * verification chased) with its own outcome and optional next-follow-up
 * date. No backend exists yet (new in Phase 0C, inspired by the reference
 * implementation's "Log a new action" pattern) -- deterministic per
 * subject, like every other fixture in this file.
 */
const FOLLOW_UP_POOL: Omit<PreviewFollowUp, "id">[] = [
  { type: "call", note: "Called to confirm phone number -- reachable.", followUpDate: null, actor: "Preview reviewer", createdAt: "2026-09-12T10:00:00.000Z" },
  { type: "whatsapp", note: "Sent a WhatsApp reminder about the pending verification documents.", followUpDate: "2026-09-25T00:00:00.000Z", actor: "Preview reviewer", createdAt: "2026-09-16T14:30:00.000Z" },
];

export function previewFollowUpsFor(subjectId: string): PreviewFollowUp[] {
  const count = hashOf(subjectId) % 3; // 0-2
  return FOLLOW_UP_POOL.slice(0, count).map((f, i) => ({ ...f, id: `${subjectId}-followup-${i}` }));
}

/** Multi-series traffic point -- Phase 0C's Analytics chart needs more than page views alone. */
export type PreviewTrafficPointMulti = { date: string; pageViews: number; signups: number; clicks: number; profileViews: number };

export function previewTrafficSeriesMulti(days = 14): PreviewTrafficPointMulti[] {
  const out: PreviewTrafficPointMulti[] = [];
  const base = new Date("2026-09-06T00:00:00.000Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const n = hashOf(d.toISOString().slice(0, 10));
    out.push({
      date: d.toISOString().slice(0, 10),
      pageViews: 180 + (n % 260),
      signups: 2 + (n % 9),
      clicks: 40 + (n % 140),
      profileViews: 60 + (n % 180),
    });
  }
  return out;
}

export type PreviewTopPageDetailed = { path: string; views: number; clicks: number; avgTimeSeconds: number };

export const PREVIEW_TOP_PAGES_DETAILED: PreviewTopPageDetailed[] = [
  { path: "/home", views: 3120, clicks: 890, avgTimeSeconds: 54 },
  { path: "/explore", views: 2210, clicks: 640, avgTimeSeconds: 71 },
  { path: "/home/network", views: 1480, clicks: 320, avgTimeSeconds: 48 },
  { path: "/home/jobs", views: 1105, clicks: 410, avgTimeSeconds: 96 },
  { path: "/b2b", views: 940, clicks: 210, avgTimeSeconds: 63 },
  { path: "/home/points", views: 640, clicks: 150, avgTimeSeconds: 39 },
];
