"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { requestSellerApprovalAction } from "@/server/actions/marketplace-seller";

const KNOWN = new Set(["not_permitted", "transition_refused"]);

/**
 * "Request approval" for the showroom owner (first time, or again after a rejection). Presentation only: the database decides
 * whether the caller owns the organization and whether it is an eligible, active showroom.
 */
export function RequestApprovalButton({ organizationId, again }: { organizationId: string; again: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function submit() {
    setError(null);
    start(async () => {
      const r = await requestSellerApprovalAction(organizationId);
      if (!r.ok) {
        setError(t(`marketplaceSeller.approval.errors.${KNOWN.has(r.code) ? r.code : "unexpected"}`));
        return;
      }
      setSent(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-sm">
      {sent ? <InlineSuccess>{t("marketplaceSeller.approval.sent")}</InlineSuccess> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <Button variant="accent" disabled={pending || sent} onClick={submit}>
        {pending ? t("marketplaceSeller.approval.sending") : t(again ? "marketplaceSeller.approval.requestAgain" : "marketplaceSeller.approval.request")}
      </Button>
    </div>
  );
}
