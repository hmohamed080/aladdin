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
/* Admin Core Phase 1B-A retired the contact, city, duplicate-flag and     */
/* follow-up fixtures: the Users / Organizations directories and details  */
/* now read real data (admin_users_list & co.). What remains below is used */
/* only by Preview areas not yet promoted (the dashboard's incomplete-     */
/* profile counts), each listed in ADMIN_USERS_ORGS_READ_AUDIT.md §6.       */
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

/**
 * Deterministic fixture profile-completeness percentage — now used ONLY by the
 * not-yet-promoted Preview dashboard's "incomplete profiles" counts. The Users
 * directory and details show the real value (app.profile_completion).
 */
export function previewCompletenessFor(userId: string): number {
  return 40 + (hashOf(userId) % 61); // 40-100, never a misleadingly-empty 0%
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
      firstSeen: new Date(Date.UTC(2026, 8, 1 + (n % 18), n % 24, (n >>> 3) % 60, (n >>> 6) % 60)).toISOString(),
      lastActive: new Date(Date.UTC(2026, 8, 19 + (n % 10), (n >>> 2) % 24, (n >>> 5) % 60, (n >>> 9) % 60)).toISOString(),
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
  /** The outcome / internal note recorded for this contact attempt. */
  note: string;
  /** Next follow-up date AND time (ISO), or null when none was set. */
  followUpDate: string | null;
  actor: string;
  /** Staff member the next follow-up is assigned to. */
  assignedTo: string | null;
  createdAt: string;
  /** Recorded state; "overdue" is DERIVED at render time (open + date in the past), never stored. */
  done: boolean;
};

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

/* ---------------------------------------------------------------------- */
/* Phase 0D — Points fixture. Used ONLY when the environment has no real    */
/* ledger row anywhere. Never written to the database: the shared local DB  */
/* already carries leftover state that breaks order-dependent pgTAP, so no  */
/* referral/points record is created just to make this page look populated. */
/* A true Points E2E belongs to an isolated/clean DB during backend         */
/* acceptance.                                                             */
/* ---------------------------------------------------------------------- */

export type PreviewPointsFixtureEntry = {
  id: string;
  eventType: string;
  pointsDelta: number;
  sourceType: string;
  sourceId: string;
  reasonCode: string | null;
  awardedByUserId: string | null;
  reversesEntryId: string | null;
  createdAt: string;
  /** Display name of the manual actor (fixture). */
  actorName: string | null;
};

/** Newest first, exactly like the real ledger read. */
export const PREVIEW_POINTS_FIXTURE: PreviewPointsFixtureEntry[] = [
  { id: "fx-6", eventType: "points.reversed", pointsDelta: 20, sourceType: "points_ledger", sourceId: "fx-4aaa0000", reasonCode: "entered_in_error", awardedByUserId: "fixture-admin", reversesEntryId: "fx-4", createdAt: "2026-09-28T13:05:09.000Z", actorName: "Preview finance admin" },
  { id: "fx-5", eventType: "referral.organization_approved", pointsDelta: 100, sourceType: "network_referral", sourceId: "fx-5bbb0000", reasonCode: null, awardedByUserId: null, reversesEntryId: null, createdAt: "2026-09-27T10:41:52.000Z", actorName: null },
  { id: "fx-4", eventType: "points.adjusted", pointsDelta: -20, sourceType: "manual_adjustment", sourceId: "fx-4aaa0000", reasonCode: "support_correction", awardedByUserId: "fixture-admin", reversesEntryId: null, createdAt: "2026-09-25T15:22:30.000Z", actorName: "Preview finance admin" },
  { id: "fx-3", eventType: "review.published", pointsDelta: 30, sourceType: "review", sourceId: "fx-3ccc0000", reasonCode: null, awardedByUserId: null, reversesEntryId: null, createdAt: "2026-09-20T08:10:00.000Z", actorName: null },
  { id: "fx-2", eventType: "profile.completed", pointsDelta: 50, sourceType: "profile", sourceId: "fx-2ddd0000", reasonCode: null, awardedByUserId: null, reversesEntryId: null, createdAt: "2026-09-12T17:45:12.000Z", actorName: null },
  { id: "fx-1", eventType: "welcome.bonus", pointsDelta: 25, sourceType: "signup", sourceId: "fx-1eee0000", reasonCode: null, awardedByUserId: null, reversesEntryId: null, createdAt: "2026-09-01T09:00:00.000Z", actorName: null },
];

/* ---------------------------------------------------------------------- */
/* Phase 0D — Organization Requests (PD-015). No record, table or          */
/* lifecycle exists for "add MY organization to Aladdin" yet (BL-023), so  */
/* every request below is a clearly-labelled fixture. It is deliberately   */
/* NOT shaped like a referral: there is no referrer and no Points context. */
/* ---------------------------------------------------------------------- */

export type PreviewOrgRequest = {
  id: string;
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string;
  orgName: string;
  orgType: "showroom_dealer" | "supplier" | "manufacturer" | "importer" | "contractor_company" | "design_office";
  governorate: string;
  city: string;
  status: "submitted" | "underReview";
  requestedAt: string;
  submittedData: string;
  notes: { at: string; by: string; text: string }[];
};

export const PREVIEW_ORG_REQUESTS: PreviewOrgRequest[] = [
  {
    id: "org-request-1",
    requesterName: "Tamer Hassan",
    requesterPhone: "01012345678",
    requesterEmail: "tamer@nilehome.example",
    orgName: "Nile Home Showroom",
    orgType: "showroom_dealer",
    governorate: "Cairo",
    city: "New Cairo",
    status: "submitted",
    requestedAt: "2026-09-27T09:12:00.000Z",
    submittedData: "Ceramics and sanitary-ware showroom, 2 branches, commercial registration attached.",
    notes: [],
  },
  {
    id: "org-request-2",
    requesterName: "Mona Ibrahim",
    requesterPhone: "01123456789",
    requesterEmail: "mona@deltabuild.example",
    orgName: "Delta Build Contracting",
    orgType: "contractor_company",
    governorate: "Giza",
    city: "Sheikh Zayed",
    status: "underReview",
    requestedAt: "2026-09-25T14:40:00.000Z",
    submittedData: "Finishing contractor, 40 staff, references from three completed compounds.",
    notes: [{ at: "2026-09-26T10:05:00.000Z", by: "Preview reviewer", text: "Asked the requester for a tax card copy." }],
  },
  {
    id: "org-request-3",
    requesterName: "Karim Adel",
    requesterPhone: "01234567890",
    requesterEmail: "karim@alexglass.example",
    orgName: "Alex Glass & Aluminium",
    orgType: "manufacturer",
    governorate: "Alexandria",
    city: "Borg El Arab",
    status: "submitted",
    requestedAt: "2026-09-28T16:25:00.000Z",
    submittedData: "Glass and aluminium fabrication plant; ISO 9001 certificate attached.",
    notes: [],
  },
];

/* ---------------------------------------------------------------------- */
/* Phase 0D — Analytics range fixtures. Still NO tracking table anywhere    */
/* (see the note at the top of the Analytics section): every number below   */
/* is deterministic fixture data keyed by the bucket's own label, never     */
/* collected. The chart built on it must never claim to be "Live".          */
/* ---------------------------------------------------------------------- */

export type PreviewTrafficBucket = {
  /** ISO timestamp of the bucket start (a day, or an hour when the range is a single day). */
  at: string;
  landingPageViews: number;
  signups: number;
  logins: number;
  /** Average engaged seconds per session in this bucket. */
  engagementSeconds: number;
};

/**
 * Traffic for an inclusive [from, to] range. One day (Today, or a custom
 * single day) is bucketed hourly; longer ranges daily. Capped at 90 days.
 */
export function previewTrafficForRange(from: Date, to: Date): PreviewTrafficBucket[] {
  const DAY = 86_400_000;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const days = Math.min(90, Math.max(1, Math.round((end - start) / DAY) + 1));
  const out: PreviewTrafficBucket[] = [];
  const bucket = (at: Date, scale: number) => {
    const n = hashOf(at.toISOString());
    out.push({
      at: at.toISOString(),
      landingPageViews: Math.round((60 + (n % 200)) * scale),
      signups: Math.max(0, Math.round((1 + (n % 9)) * scale)),
      logins: Math.round((15 + (n % 60)) * scale),
      engagementSeconds: 35 + (n % 70),
    });
  };
  if (days === 1) {
    for (let h = 0; h < 24; h++) bucket(new Date(start + h * 3_600_000), 0.18);
  } else {
    for (let i = 0; i < days; i++) bucket(new Date(start + i * DAY), 1);
  }
  return out;
}

/**
 * Raw page hits as a tracker would record them — concrete URLs, one per entity.
 * Top Pages groups these by canonical route (`canonicalRoute`), so
 * `/profile/1204` and `/profile/88` count as ONE page: `/profile/[id]`.
 */
export const PREVIEW_PAGE_HITS: { path: string; views: number; clicks: number; avgTimeSeconds: number }[] = [
  { path: "/", views: 4210, clicks: 1320, avgTimeSeconds: 41 },
  { path: "/explore", views: 2210, clicks: 640, avgTimeSeconds: 71 },
  { path: "/profile/1204", views: 480, clicks: 120, avgTimeSeconds: 58 },
  { path: "/profile/88", views: 390, clicks: 96, avgTimeSeconds: 61 },
  { path: "/profile/3391", views: 310, clicks: 74, avgTimeSeconds: 52 },
  { path: "/p/9c1e8f2a-1b2c-4d3e-8f90-123456789abc", views: 260, clicks: 60, avgTimeSeconds: 66 },
  { path: "/p/77ab4d10-0c11-4f6e-9a55-abcdefabcdef", views: 240, clicks: 52, avgTimeSeconds: 63 },
  { path: "/home/network", views: 1480, clicks: 320, avgTimeSeconds: 48 },
  { path: "/home/jobs", views: 1105, clicks: 410, avgTimeSeconds: 96 },
  { path: "/home/jobs/501", views: 330, clicks: 140, avgTimeSeconds: 88 },
  { path: "/home/jobs/502", views: 290, clicks: 121, avgTimeSeconds: 91 },
  { path: "/b2b", views: 940, clicks: 210, avgTimeSeconds: 63 },
];
