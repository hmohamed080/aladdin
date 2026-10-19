import "server-only";
import type { getServerSupabase } from "@/lib/supabase/server";
import { isBvStatus, type BvStatus } from "@/lib/business-verification/contract";
import type { Database } from "@/types/database.types";

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;
type OrgType = Database["public"]["Enums"]["organization_type"];

export type BvDocument = {
  id: string;
  docType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  createdAt: string;
};
export type BvSubmission = { id: string; round: number; note: string | null; submittedAt: string; submittedBy?: string | null; documents: BvDocument[] };
export type BvRequest = {
  id: string;
  status: BvStatus;
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
  lastSubmittedAt: string | null;
  submissions: BvSubmission[];
};
export type MyBusinessVerification = {
  organizationStatus: string;
  status: BvStatus;
  verifiedAt: string | null;
  reason: string | null;
  canUpload: boolean;
  canSubmit: boolean;
  isResubmission: boolean;
  drafts: BvDocument[];
  requests: BvRequest[];
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const status = (v: unknown): BvStatus => (isBvStatus(v) ? v : "none");

export function parseDocuments(v: unknown): BvDocument[] {
  return arr(v).map((raw) => {
    const d = obj(raw);
    return {
      id: str(d.id), docType: str(d.doc_type), fileName: str(d.file_name), contentType: str(d.content_type),
      sizeBytes: num(d.size_bytes), objectKey: str(d.object_key), createdAt: str(d.created_at),
    };
  });
}

export function parseSubmissions(v: unknown): BvSubmission[] {
  return arr(v).map((raw) => {
    const s = obj(raw);
    return {
      id: str(s.id), round: num(s.round), note: strOrNull(s.note), submittedAt: str(s.submitted_at),
      submittedBy: strOrNull(s.submitted_by), documents: parseDocuments(s.documents),
    };
  });
}

export function parseRequests(v: unknown): BvRequest[] {
  return arr(v).map((raw) => {
    const r = obj(raw);
    return {
      id: str(r.id), status: status(r.status), reason: strOrNull(r.reason), submittedAt: str(r.submitted_at),
      decidedAt: strOrNull(r.decided_at), lastSubmittedAt: strOrNull(r.last_submitted_at), submissions: parseSubmissions(r.submissions),
    };
  });
}

export function parseMyBusinessVerification(raw: unknown): MyBusinessVerification {
  const r = obj(raw);
  return {
    organizationStatus: str(r.organization_status),
    status: status(r.status),
    verifiedAt: strOrNull(r.verified_at),
    reason: strOrNull(r.reason),
    canUpload: r.can_upload === true,
    canSubmit: r.can_submit === true,
    isResubmission: r.is_resubmission === true,
    drafts: parseDocuments(r.drafts),
    requests: parseRequests(r.requests),
  };
}

/** The owner-facing state. Null when the caller does not manage this organization (the RPC refuses). */
export async function loadMyBusinessVerification(supabase: Supabase, orgId: string): Promise<MyBusinessVerification | null> {
  const { data, error } = await supabase.rpc("my_business_verification", { p_org_id: orgId });
  if (error || !data) return null;
  return parseMyBusinessVerification(data);
}

export type BvQueueRow = {
  id: string;
  status: BvStatus;
  reviewerName: string | null;
  submittedAt: string;
  lastSubmittedAt: string | null;
  decidedAt: string | null;
  rounds: number;
  documents: number;
  organizationId: string;
  name: string;
  nameAr: string | null;
  nameEn: string | null;
  legalName: string | null;
  orgType: OrgType;
};

export type BvQueueFilters = { status?: BvStatus[]; orgType?: OrgType; search?: string; limit?: number; offset?: number };

export async function loadBusinessVerificationQueue(supabase: Supabase, f: BvQueueFilters): Promise<{ total: number; rows: BvQueueRow[] } | null> {
  const { data, error } = await supabase.rpc("business_verification_queue", {
    p_status: f.status && f.status.length ? f.status : undefined,
    p_org_type: f.orgType,
    p_search: f.search || undefined,
    p_limit: f.limit ?? 25,
    p_offset: f.offset ?? 0,
  });
  if (error || !data) return null;
  const r = obj(data);
  return {
    total: num(r.total),
    rows: arr(r.rows).map((raw) => {
      const q = obj(raw);
      return {
        id: str(q.id), status: status(q.status), reviewerName: strOrNull(q.reviewer_name), submittedAt: str(q.submitted_at),
        lastSubmittedAt: strOrNull(q.last_submitted_at), decidedAt: strOrNull(q.decided_at), rounds: num(q.rounds),
        documents: num(q.documents), organizationId: str(q.organization_id), name: str(q.name), nameAr: strOrNull(q.name_ar),
        nameEn: strOrNull(q.name_en), legalName: strOrNull(q.legal_name), orgType: str(q.org_type) as OrgType,
      };
    }),
  };
}

export type BvDetail = {
  id: string;
  status: BvStatus;
  reason: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  submittedAt: string;
  decidedAt: string | null;
  isOwnOrganization: boolean;
  canReview: boolean;
  canDecide: boolean;
  organization: {
    id: string; name: string; nameAr: string | null; nameEn: string | null; legalName: string | null; orgType: OrgType;
    status: string; isVerified: boolean; businessVerifiedAt: string | null; createdAt: string;
    contactPhone: string | null; contactEmail: string | null;
    owner: { id: string; displayName: string | null; email: string | null } | null;
  };
  submissions: BvSubmission[];
  previous: { id: string; status: BvStatus; reason: string | null; submittedAt: string; decidedAt: string | null }[];
  application: { status: string; decidedAt: string | null } | null;
};

/** Null when the request does not exist or the caller may not review evidence. */
export async function loadBusinessVerificationDetail(supabase: Supabase, id: string): Promise<BvDetail | null> {
  const { data, error } = await supabase.rpc("business_verification_detail", { p_verification_id: id });
  if (error || !data) return null;
  const r = obj(data);
  const o = obj(r.organization);
  const owner = r.organization && o.owner ? obj(o.owner) : null;
  const app = r.application ? obj(r.application) : null;
  return {
    id: str(r.id), status: status(r.status), reason: strOrNull(r.reason), reviewerId: strOrNull(r.reviewer_id),
    reviewerName: strOrNull(r.reviewer_name), submittedAt: str(r.submitted_at), decidedAt: strOrNull(r.decided_at),
    isOwnOrganization: r.is_own_organization === true, canReview: r.can_review === true, canDecide: r.can_decide === true,
    organization: {
      id: str(o.id), name: str(o.name), nameAr: strOrNull(o.name_ar), nameEn: strOrNull(o.name_en), legalName: strOrNull(o.legal_name),
      orgType: str(o.org_type) as OrgType, status: str(o.status), isVerified: o.is_verified === true,
      businessVerifiedAt: strOrNull(o.business_verified_at), createdAt: str(o.created_at),
      contactPhone: strOrNull(o.contact_phone), contactEmail: strOrNull(o.contact_email),
      owner: owner ? { id: str(owner.id), displayName: strOrNull(owner.display_name), email: strOrNull(owner.email) } : null,
    },
    submissions: parseSubmissions(r.submissions),
    previous: arr(r.previous).map((raw) => {
      const h = obj(raw);
      return { id: str(h.id), status: status(h.status), reason: strOrNull(h.reason), submittedAt: str(h.submitted_at), decidedAt: strOrNull(h.decided_at) };
    }),
    application: app ? { status: str(app.status), decidedAt: strOrNull(app.decided_at) } : null,
  };
}
