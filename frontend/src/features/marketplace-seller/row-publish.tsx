"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { SendIcon, EyeOffIcon } from "@/components/ui/icons";
import { productReadinessAction, publishProductAction, unpublishProductAction } from "@/server/actions/marketplace-seller";
import { blockerParts } from "./errors";

/**
 * Row action on the seller's product list: publish a draft / unpublished product
 * (after the SAME server readiness check the product page uses — the database
 * refuses anything incomplete anyway), or take a published one off the
 * Marketplace. When publishing is blocked, the reasons are listed under the row.
 */
export function RowPublishToggle({ productId, status }: { productId: string; status: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const published = status === "published";
  if (status === "archived") return null;

  const label = pending ? t("marketplaceSeller.action.checking") : published ? t("marketplaceSeller.action.unpublish") : t("marketplaceSeller.action.publish");

  const run = () => {
    setBlockers(null);
    setMessage(null);
    start(async () => {
      if (published) {
        const r = await unpublishProductAction(productId);
        setMessage(r.ok ? { ok: true, text: t("marketplaceSeller.action.unpublished") } : { ok: false, text: t(`marketplaceSeller.error.${r.code}`) });
        if (r.ok) router.refresh();
        return;
      }
      const ready = await productReadinessAction(productId);
      if (!ready.ok) return setMessage({ ok: false, text: t(`marketplaceSeller.error.${ready.code}`) });
      if (ready.blockers.length) return setBlockers(ready.blockers);
      const r = await publishProductAction(productId);
      setMessage(r.ok ? { ok: true, text: t("marketplaceSeller.action.published") } : { ok: false, text: t(`marketplaceSeller.error.${r.code}`) });
      if (r.ok) router.refresh();
    });
  };

  // one line per kind of blocker, with how many variants it concerns
  const grouped = new Map<string, number>();
  for (const b of blockers ?? []) {
    const { key, detail } = blockerParts(b);
    const field = detail?.split(" · ").pop();
    const text = `${t(key)}${field ? ` (${field})` : ""}`;
    grouped.set(text, (grouped.get(text) ?? 0) + 1);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-label={label}
        title={label}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-sm border transition-colors disabled:cursor-wait disabled:opacity-60",
          published ? "text-fg-secondary hover:bg-surface-2 hover:text-fg" : "border-accent-solid/60 text-accent hover:bg-accent-solid/10",
        )}
      >
        {published ? <EyeOffIcon size={16} /> : <SendIcon size={16} />}
      </button>
      {blockers?.length || message ? (
        <div
          role={message?.ok ? "status" : "alert"}
          className="absolute end-0 top-10 z-10 w-72 rounded-md border bg-surface p-sm text-start text-label shadow-card"
        >
          {message ? (
            <p className={message.ok ? "text-success" : "text-danger"}>{message.text}</p>
          ) : (
            <>
              <p className="mb-1 font-medium text-fg">{t("marketplaceSeller.action.blocked")}</p>
              <ul className="flex flex-col gap-0.5 text-fg-secondary">
                {[...grouped].map(([text, n]) => (
                  <li key={text}>
                    • {text}
                    {n > 1 ? ` ×${n}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            className="mt-1 text-label text-accent hover:underline"
            onClick={() => {
              setBlockers(null);
              setMessage(null);
            }}
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
