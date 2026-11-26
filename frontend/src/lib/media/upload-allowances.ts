/** The shape of `admin_upload_limits_get` (ADR-0032), read defensively: the database is the authority. */
export type UploadSubjectType = "user" | "organization";
export type UploadExemption = { id: string; subjectType: UploadSubjectType; label: string; reason: string; createdAt: string };
export type UploadLimits = { hourlyUploads: number; hourlyAttempts: number; storageQuotaMb: number; exemptions: UploadExemption[] };
export type UploadSubject = { type: UploadSubjectType; id: string; label: string; detail: string };

export function parseUploadLimits(data: unknown): UploadLimits | null {
  const root = data as { settings?: Record<string, unknown>; exemptions?: Record<string, unknown>[] } | null;
  const s = root?.settings;
  if (!s || typeof s.hourly_uploads !== "number" || typeof s.hourly_attempts !== "number" || typeof s.storage_quota_mb !== "number") return null;
  return {
    hourlyUploads: s.hourly_uploads,
    hourlyAttempts: s.hourly_attempts,
    storageQuotaMb: s.storage_quota_mb,
    exemptions: (root?.exemptions ?? []).map((e) => ({
      id: String(e.id),
      subjectType: e.subject_type === "organization" ? "organization" : "user",
      label: String(e.label ?? ""),
      reason: String(e.reason ?? ""),
      createdAt: String(e.created_at ?? ""),
    })),
  };
}
