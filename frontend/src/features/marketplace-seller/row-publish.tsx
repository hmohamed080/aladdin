"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { SendIcon, EyeOffIcon } from "@/components/ui/icons";
import { publishProductAction, unpublishProductAction } from "@/server/actions/marketplace-seller";
import type { ReviewState } from "./products-model";

/**
 * Row action on the seller's product list: publish a draft / unpublished product once the platform team has approved
 * it (no readiness check and no blocker list: until then the button is simply unavailable), or take a published one
 * off the Marketplace. The database refuses an incomplete publication anyway; its answer is shown as a plain message.
 */
export function RowPublishToggle({ productId, status, reviewState }: { productId: string; status: string; reviewState: ReviewState }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const published = status === "published";
  if (status === "archived") return null;

  const approved = reviewState === "approved";
  const unavailable = !published && !approved;
  const label = published ? t("marketplaceSeller.action.unpublish") : unavailable ? t("marketplaceSeller.action.needsApproval") : t("marketplaceSeller.action.publish");

  const run = () => {
    setMessage(null);
    start(async () => {
      const r = published ? await unpublishProductAction(productId) : await publishProductAction(productId);
      if (!r.ok) return setMessage({ ok: false, text: t(`marketplaceSeller.error.${r.code}`) });
      setMessage({ ok: true, text: published ? t("marketplaceSeller.action.unpublished") : t("marketplaceSeller.action.published") });
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={run}
        disabled={pending || unavailable}
        aria-label={label}
        title={label}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          published ? "text-fg-secondary hover:bg-surface-2 hover:text-fg" : "border-accent-solid/60 text-accent hover:bg-accent-solid/10",
        )}
      >
        {published ? <EyeOffIcon size={16} /> : <SendIcon size={16} />}
      </button>
      {message ? (
        <div role={message.ok ? "status" : "alert"} className="absolute end-0 top-10 z-10 w-72 rounded-md border bg-surface p-sm text-start text-label shadow-card">
          <p className={message.ok ? "text-success" : "text-danger"}>{message.text}</p>
          <button type="button" className="mt-1 text-label text-accent hover:underline" onClick={() => setMessage(null)}>
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
