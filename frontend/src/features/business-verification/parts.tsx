import type { ReactNode } from "react";
import { Badge } from "@/components/ui/primitives";
import { BadgeCheckIcon, FileTextIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatDate } from "@/lib/ui/format";
import type { BvStatus } from "@/lib/business-verification/contract";
import type { BvDocument, BvSubmission } from "@/server/queries/business-verification";

/** Presentation shared by the Showroom page and the Admin review. No data access, no decisions. */

const TONE: Record<BvStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  none: "neutral",
  pending: "info",
  under_review: "info",
  needs_info: "warning",
  verified: "success",
  rejected: "danger",
};

export function BvStatusBadge({ status, t }: { status: BvStatus; t: TranslateFn }) {
  return (
    <Badge tone={TONE[status]}>
      {status === "verified" ? <BadgeCheckIcon size={13} /> : null}
      {t(`businessVerification.status.${status}`)}
    </Badge>
  );
}

export const bvDocumentHref = (d: BvDocument) => `/business-verification/file/${d.objectKey}`;

function formatSize(bytes: number, locale: Locale): string {
  const mb = bytes / (1024 * 1024);
  const n = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 1 });
  return mb >= 1 ? `${n.format(mb)} MB` : `${n.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export function BvDocumentRow({ d, t, locale, action }: { d: BvDocument; t: TranslateFn; locale: Locale; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-sm rounded-sm bg-surface-2/50 px-3 py-2" data-testid="bv-document">
      <a href={bvDocumentHref(d)} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-body text-fg hover:text-accent">
        <FileTextIcon size={16} />
        <span className="min-w-0">
          <span className="block truncate font-medium" dir="auto">{d.fileName}</span>
          <span className="block text-label text-fg-muted">
            {t(`businessVerification.docType.${d.docType}`)} · {formatSize(d.sizeBytes, locale)}
          </span>
        </span>
      </a>
      {action}
    </li>
  );
}

export function BvSubmissionList({ submissions, t, locale }: { submissions: BvSubmission[]; t: TranslateFn; locale: Locale }) {
  if (submissions.length === 0) return null;
  return (
    <ol className="flex flex-col gap-md">
      {submissions.map((s) => (
        <li key={s.id} className="flex flex-col gap-sm border-s-2 border-strong ps-md">
          <p className="text-label font-medium text-fg-secondary">
            {t("businessVerification.round", { round: s.round })} · {formatDate(s.submittedAt, locale)}
          </p>
          {s.note ? <p className="whitespace-pre-line text-body text-fg" dir="auto">{s.note}</p> : null}
          {s.documents.length > 0 ? (
            <ul className="flex flex-col gap-1.5">{s.documents.map((d) => <BvDocumentRow key={d.id} d={d} t={t} locale={locale} />)}</ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
