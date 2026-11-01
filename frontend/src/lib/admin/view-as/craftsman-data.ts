/**
 * Typed shapes + defensive parsers for the six Admin View-As craftsman sections
 * (`admin_view_craftsman_*`, 20261101090003). Pure and client-safe.
 *
 * The database already projects an explicit allow-list; these parsers are the second wall. They COPY only the fields the
 * read-only components render (so an unexpected new column can never reach the page), coerce types, and never throw: a
 * malformed payload degrades to empty values rather than rendering raw JSON.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number => num(v) ?? 0;
const bool = (v: unknown): boolean => v === true;

export type Completion = { percent: number; missing: string[] };
const completion = (v: unknown): Completion => {
  const o = obj(v);
  return { percent: Math.max(0, Math.min(100, int(o.percent))), missing: arr(o.missing).filter((x): x is string => typeof x === "string") };
};

const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v))) out[k] = int(n);
  return out;
};

export type DashboardData = {
  displayName: string | null;
  accountStatus: string | null;
  publicProfileStatus: string | null;
  completion: Completion;
  workCounts: Record<string, number>;
  pointsBalance: number;
  pointsMonthEarned: number;
  reviewsTotal: number;
  reviewsAverage: number | null;
  verification: { type: string; status: string; submittedAt: string | null } | null;
};
export function parseDashboard(raw: unknown): DashboardData {
  const o = obj(raw);
  const v = o.verification ? obj(o.verification) : null;
  return {
    displayName: str(o.display_name),
    accountStatus: str(o.account_status),
    publicProfileStatus: str(o.public_profile_status),
    completion: completion(o.completion),
    workCounts: counts(o.work_counts),
    pointsBalance: int(obj(o.points).balance),
    pointsMonthEarned: int(obj(o.points).month_earned),
    reviewsTotal: int(obj(o.reviews).total),
    reviewsAverage: num(obj(o.reviews).average),
    verification: v && str(v.status) ? { type: str(v.type) ?? "", status: str(v.status) ?? "", submittedAt: str(v.submitted_at) } : null,
  };
}

export type ProfileData = {
  displayName: string | null;
  username: string | null;
  headline: string | null;
  bio: string | null;
  phone: string | null;
  phoneVerified: boolean;
  secondaryPhoneMasked: string | null;
  hasAvatar: boolean;
  hasCover: boolean;
  publicProfileStatus: string | null;
  accountStatus: string | null;
  isVerified: boolean;
  memberSince: string | null;
  yearsExperience: number | null;
  availability: string | null;
  trades: { key: string; isPrimary: boolean }[];
  serviceAreas: { governorate: string; city: string | null; isPrimary: boolean }[];
  completion: Completion;
};
export function parseProfile(raw: unknown): ProfileData {
  const o = obj(raw);
  return {
    displayName: str(o.display_name),
    username: str(o.username),
    headline: str(o.headline),
    bio: str(o.bio),
    phone: str(o.phone),
    phoneVerified: bool(o.phone_verified),
    secondaryPhoneMasked: str(o.secondary_phone_masked),
    hasAvatar: bool(o.has_avatar),
    hasCover: bool(o.has_cover),
    publicProfileStatus: str(o.public_profile_status),
    accountStatus: str(o.account_status),
    isVerified: bool(o.is_verified),
    memberSince: str(o.member_since),
    yearsExperience: num(o.years_experience),
    availability: str(o.availability),
    trades: arr(o.trades).map(obj).flatMap((t) => (str(t.key) ? [{ key: str(t.key)!, isPrimary: bool(t.is_primary) }] : [])),
    serviceAreas: arr(o.service_areas).map(obj).flatMap((a) =>
      str(a.governorate) ? [{ governorate: str(a.governorate)!, city: str(a.city), isPrimary: bool(a.is_primary) }] : [],
    ),
    completion: completion(o.completion),
  };
}

export type PortfolioData = {
  projects: {
    id: string;
    title: string;
    location: string | null;
    description: string | null;
    visibility: string | null;
    items: { id: string; title: string | null; kind: "image" | "video"; visibility: string | null; state: string | null }[];
  }[];
  certificates: { id: string; title: string; issuer: string | null; issuedOn: string | null; expiresOn: string | null; kind: "pdf" | "image"; state: string | null }[];
};
export function parsePortfolio(raw: unknown): PortfolioData {
  const o = obj(raw);
  return {
    projects: arr(o.projects).map(obj).flatMap((p) =>
      str(p.id)
        ? [{
            id: str(p.id)!,
            title: str(p.title) ?? "",
            location: str(p.location),
            description: str(p.description),
            visibility: str(p.visibility),
            items: arr(p.items).map(obj).flatMap((i) =>
              str(i.id)
                ? [{ id: str(i.id)!, title: str(i.title), kind: i.kind === "video" ? ("video" as const) : ("image" as const), visibility: str(i.visibility), state: str(i.state) }]
                : [],
            ),
          }]
        : [],
    ),
    certificates: arr(o.certificates).map(obj).flatMap((c) =>
      str(c.id)
        ? [{ id: str(c.id)!, title: str(c.title) ?? "", issuer: str(c.issuer), issuedOn: str(c.issued_on), expiresOn: str(c.expires_on), kind: c.kind === "pdf" ? ("pdf" as const) : ("image" as const), state: str(c.state) }]
        : [],
    ),
  };
}

export type WorkData = {
  counts: Record<string, number>;
  items: {
    id: string;
    status: string;
    jobTitle: string;
    tradeKey: string | null;
    company: string | null;
    governorate: string | null;
    city: string | null;
    agreedAmount: number | null;
    agreedCurrency: string | null;
    progressPercent: number | null;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
  }[];
};
export function parseWork(raw: unknown): WorkData {
  const o = obj(raw);
  return {
    counts: counts(o.counts),
    items: arr(o.items).map(obj).flatMap((a) =>
      str(a.id)
        ? [{
            id: str(a.id)!,
            status: str(a.status) ?? "",
            jobTitle: str(a.job_title) ?? "",
            tradeKey: str(a.trade_key),
            company: str(a.company),
            governorate: str(a.governorate),
            city: str(a.city),
            agreedAmount: num(a.agreed_amount),
            agreedCurrency: str(a.agreed_currency),
            progressPercent: num(a.progress_percent),
            startedAt: str(a.started_at),
            completedAt: str(a.completed_at),
            cancelledAt: str(a.cancelled_at),
          }]
        : [],
    ),
  };
}

export type PointsData = {
  balance: number;
  monthEarned: number;
  monthDeducted: number;
  entryCount: number;
  entries: { id: string; eventType: string; delta: number; reasonCode: string | null; createdAt: string | null }[];
};
export function parsePoints(raw: unknown): PointsData {
  const o = obj(raw);
  return {
    balance: int(o.balance),
    monthEarned: int(o.month_earned),
    monthDeducted: int(o.month_deducted),
    entryCount: int(o.entry_count),
    entries: arr(o.entries).map(obj).flatMap((e) =>
      str(e.id) ? [{ id: str(e.id)!, eventType: str(e.event_type) ?? "", delta: int(e.points_delta), reasonCode: str(e.reason_code), createdAt: str(e.created_at) }] : [],
    ),
  };
}

export type ReviewsData = {
  total: number;
  average: number | null;
  monthly: { month: string; reviews: number; average: number | null }[];
  items: { id: string; rating: number; comment: string | null; company: string | null; jobTitle: string | null; tradeKey: string | null; createdAt: string | null }[];
};
export function parseReviews(raw: unknown): ReviewsData {
  const o = obj(raw);
  return {
    total: int(o.total),
    average: num(o.average),
    monthly: arr(o.monthly).map(obj).flatMap((m) => (str(m.month) ? [{ month: str(m.month)!, reviews: int(m.reviews), average: num(m.average) }] : [])),
    items: arr(o.items).map(obj).flatMap((r) =>
      str(r.id)
        ? [{ id: str(r.id)!, rating: int(r.rating), comment: str(r.comment), company: str(r.company), jobTitle: str(r.job_title), tradeKey: str(r.trade_key), createdAt: str(r.created_at) }]
        : [],
    ),
  };
}
