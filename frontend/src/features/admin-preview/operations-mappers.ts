/**
 * Admin Core Phase 1B-B — typed read models for the operational workflows
 * (suspension, Admin Notes, Follow-ups, Cases, Entity Timeline, organization
 * duplicates), mapped from the JSON their RPCs return. Pure and fail-closed:
 * malformed elements are dropped, never guessed at.
 */

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function mapAll<T>(v: unknown, map: (raw: unknown) => T | null): T[] {
  return list(v).flatMap((raw) => {
    const mapped = map(raw);
    return mapped ? [mapped] : [];
  });
}

export type PersonRef = { userId: string; displayName: string };

function person(v: unknown): PersonRef | null {
  const o = obj(v);
  const userId = str(o?.user_id);
  return o && userId ? { userId, displayName: str(o.display_name) ?? "" } : null;
}

/* ---------------------------------------------------------------- suspension */

export type Suspension = { id: string; reason: string; suspendedAt: string; suspendedBy: PersonRef | null };

export function mapSuspension(raw: unknown): Suspension | null {
  const o = obj(raw);
  const id = str(o?.id);
  const suspendedAt = str(o?.suspended_at);
  if (!o || !id || !suspendedAt) return null;
  return { id, reason: str(o.reason) ?? "", suspendedAt, suspendedBy: person(o.suspended_by) };
}

/* --------------------------------------------------------------------- notes */

export type AdminNote = { id: string; body: string; createdAt: string; author: PersonRef | null };

export function mapNotes(raw: unknown): AdminNote[] {
  return mapAll(raw, (r) => {
    const o = obj(r);
    const id = str(o?.id);
    const body = str(o?.body);
    const createdAt = str(o?.created_at);
    if (!o || !id || body === null || !createdAt) return null;
    return { id, body, createdAt, author: person(o.author) };
  });
}

/* ---------------------------------------------------------------- follow-ups */

export const FOLLOW_UP_TYPES = ["call", "whatsapp", "email", "verification_follow_up", "other"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];
export type FollowUpStatus = "open" | "done" | "overdue";

export type AdminFollowUp = {
  id: string;
  actionType: FollowUpType;
  outcome: string;
  loggedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  /** Derived by the database from completion and due time; never stored. */
  status: FollowUpStatus;
  loggedBy: PersonRef | null;
  assignedTo: PersonRef | null;
};

export function mapFollowUps(raw: unknown): AdminFollowUp[] {
  return mapAll(raw, (r) => {
    const o = obj(r);
    const id = str(o?.id);
    const loggedAt = str(o?.logged_at);
    const type = str(o?.action_type);
    const status = str(o?.status);
    if (!o || !id || !loggedAt || !type || !(FOLLOW_UP_TYPES as readonly string[]).includes(type)) return null;
    if (status !== "open" && status !== "done" && status !== "overdue") return null;
    return {
      id,
      actionType: type as FollowUpType,
      outcome: str(o.outcome) ?? "",
      loggedAt,
      dueAt: str(o.due_at),
      completedAt: str(o.completed_at),
      status,
      loggedBy: person(o.logged_by),
      assignedTo: person(o.assigned_to),
    };
  });
}

export function mapPeople(raw: unknown): PersonRef[] {
  return mapAll(raw, person);
}

/* --------------------------------------------------------------------- cases */

export type AdminCase = {
  id: string;
  title: string;
  details: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
  createdBy: PersonRef | null;
};

export function mapCases(raw: unknown): AdminCase[] {
  return mapAll(raw, (r) => {
    const o = obj(r);
    const id = str(o?.id);
    const title = str(o?.title);
    const createdAt = str(o?.created_at);
    if (!o || !id || !title || !createdAt) return null;
    return {
      id,
      title,
      details: str(o.details) ?? "",
      contactName: str(o.contact_name),
      contactPhone: str(o.contact_phone),
      contactEmail: str(o.contact_email),
      createdAt,
      createdBy: person(o.created_by),
    };
  });
}

/* ------------------------------------------------------------------ timeline */

export const TIMELINE_KINDS = [
  "registered",
  "verification_submitted",
  "verification_decided",
  "membership_joined",
  "member_joined",
  "suspended",
  "restored",
  "follow_up_logged",
  "follow_up_completed",
  "note_added",
  "case_opened",
  "duplicate_linked",
  "duplicate_dismissed",
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineEvent = { kind: TimelineKind; at: string; actor: PersonRef | null; data: Record<string, string> };

export function mapTimeline(raw: unknown): TimelineEvent[] {
  return mapAll(raw, (r) => {
    const o = obj(r);
    const kind = str(o?.kind);
    const at = str(o?.at);
    if (!o || !kind || !at || !(TIMELINE_KINDS as readonly string[]).includes(kind)) return null;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(o.data) ?? {})) if (typeof v === "string") data[k] = v;
    return { kind: kind as TimelineKind, at, actor: person(o.actor), data };
  });
}

/* ---------------------------------------------------------------- duplicates */

export type NamedOrg = { id: string; name: string; nameAr: string | null; nameEn: string | null };

export type DuplicateCandidate = NamedOrg & {
  orgType: string;
  status: string;
  createdAt: string | null;
  /** same_name = identical normalized name; similar_name = same type, close name. */
  signal: "same_name" | "similar_name";
  similarity: number;
};

export type DuplicateResolution = {
  id: string;
  resolution: "linked" | "not_duplicate";
  /** Whether THIS organization is the linked duplicate or the existing (canonical) record. */
  role: "duplicate" | "canonical";
  reason: string;
  resolvedAt: string;
  other: NamedOrg;
  resolvedBy: PersonRef | null;
};

function named(v: unknown): NamedOrg | null {
  const o = obj(v);
  const id = str(o?.id);
  return o && id ? { id, name: str(o.name) ?? "", nameAr: str(o.name_ar), nameEn: str(o.name_en) } : null;
}

export function mapDuplicates(raw: unknown): { candidates: DuplicateCandidate[]; resolutions: DuplicateResolution[] } | null {
  const o = obj(raw);
  if (!o) return null;
  return {
    candidates: mapAll(o.candidates, (r) => {
      const c = obj(r);
      const base = named(c);
      const signal = str(c?.signal);
      if (!c || !base || (signal !== "same_name" && signal !== "similar_name")) return null;
      return {
        ...base,
        orgType: str(c.org_type) ?? "",
        status: str(c.status) ?? "",
        createdAt: str(c.created_at),
        signal,
        similarity: num(c.similarity) ?? 0,
      };
    }),
    resolutions: mapAll(o.resolutions, (r) => {
      const x = obj(r);
      const id = str(x?.id);
      const resolution = str(x?.resolution);
      const role = str(x?.role);
      const resolvedAt = str(x?.resolved_at);
      const other = named(x?.other);
      if (!x || !id || !resolvedAt || !other) return null;
      if ((resolution !== "linked" && resolution !== "not_duplicate") || (role !== "duplicate" && role !== "canonical")) return null;
      return { id, resolution, role, reason: str(x.reason) ?? "", resolvedAt, other, resolvedBy: person(x.resolved_by) };
    }),
  };
}
