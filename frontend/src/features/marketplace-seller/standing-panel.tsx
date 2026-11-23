import type { ReactNode } from "react";
import { StatePanel } from "@/components/ui/primitives";
import { StorefrontIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";
import type { MarketplaceSellerStanding } from "@/server/queries/marketplace-seller";
import { RequestApprovalButton } from "./request-approval";

type Copy = {
  none: { title: string; body: string };
  pending: { title: string; body: string };
  approved: { title: string; body: string };
  suspended: { title: string; body: string };
  rejected: { title: string; body: string };
  revoked: { title: string; body: string };
  fromTeam: string;
};

/**
 * Where the showroom stands with the Marketplace, in its owner's words: the status, the message the platform team wrote to the
 * owner (never the internal reason), and, for a showroom that has not asked yet, was rejected or had its approval revoked, the request button. The
 * request is only offered to the owner; the database re-checks that and the showroom's eligibility.
 */
export function SellerStandingPanel({
  standing,
  copy,
  locale,
  organizationId,
  canRequest,
  extra,
}: {
  standing: MarketplaceSellerStanding | null;
  copy: Copy;
  locale: Locale;
  organizationId: string;
  canRequest: boolean;
  extra?: ReactNode;
}) {
  const status = standing?.status ?? "none";
  const text = copy[status];
  const message = standing ? (locale === "ar" ? standing.messageAr : standing.messageEn) : null;
  const tone = status === "approved" || status === "pending" || status === "none" ? "neutral" : "warning";
  const askable = canRequest && (status === "none" || status === "rejected" || status === "revoked");
  return (
    <div className="flex flex-col gap-md" data-testid="seller-standing" data-status={status}>
      <StatePanel
        icon={<StorefrontIcon size={20} />}
        tone={tone}
        title={text.title}
        body={text.body}
        action={askable ? <RequestApprovalButton organizationId={organizationId} again={status === "rejected" || status === "revoked"} /> : undefined}
      />
      {message ? (
        <div className="rounded-md border bg-surface px-md py-sm" data-testid="seller-owner-message">
          <p className="text-label text-fg-muted">{copy.fromTeam}</p>
          <p className="text-body text-fg" dir="auto">{message}</p>
        </div>
      ) : null}
      {extra}
    </div>
  );
}
