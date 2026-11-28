"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import { toggleSavedProductAction, type SaveState } from "@/server/actions/saved-products";
import { BookmarkIcon, BookmarkFilledIcon } from "@/components/ui/icons";
import { InlineError } from "@/components/ui/primitives";
import { cn } from "@/lib/ui/cn";

const initial: SaveState = { ok: false };

/**
 * The bookmark button itself: icon, label, pressed state, size. PRESENTATION ONLY, shared by every
 * audience that saves a product (a business's team list and an engineer's personal collection) so
 * the control looks and behaves identically; what happens on press is the caller's concern.
 * Without `onClick` it is a form submit (the business flow); with it, a plain button.
 */
export function SaveToggleButton({
  saved,
  compact,
  pending,
  onClick,
}: {
  saved: boolean;
  compact: boolean;
  pending: boolean;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const label = saved ? t("saved.remove") : t("saved.add");
  const Icon = saved ? BookmarkFilledIcon : BookmarkIcon;
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={pending}
      aria-label={label}
      title={label}
      aria-pressed={saved}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "disabled:cursor-not-allowed disabled:opacity-50",
        compact
          ? "h-9 w-9 border border-strong bg-surface hover:bg-surface-2"
          : "min-h-9 border border-strong bg-surface px-3 py-1.5 text-label font-medium hover:bg-surface-2",
        saved ? "text-accent" : "text-fg-secondary",
      )}
    >
      <Icon size={17} />
      {compact ? null : <span>{label}</span>}
    </button>
  );
}

function Toggle({ saved, compact }: { saved: boolean; compact: boolean }) {
  const { pending } = useFormStatus();
  return <SaveToggleButton saved={saved} compact={compact} pending={pending} />;
}

/**
 * Save / unsave a catalog product for the whole buying team.
 *
 * Deliberately an icon TOGGLE, not an "add to cart": a saved product is a
 * shortlist entry that leads to a quote request. It carries no price, no
 * reservation and no commitment — Aladdin is consultation-first, and a cart
 * affordance here would promise a transaction the product does not offer.
 */
export function SaveProductButton({
  orgId,
  productId,
  saved,
  compact = false,
  onChange,
}: {
  orgId: string;
  productId: string;
  saved: boolean;
  /** Icon-only, for dense product cards. */
  compact?: boolean;
  /** Called once the save/unsave really happened, so a list can react (e.g. drop the card). */
  onChange?: (saved: boolean) => void;
}) {
  const { t } = useI18n();
  // The bookmark flips in place the moment the server confirms, instead of waiting for a page refresh.
  const [current, setCurrent] = useState(saved);
  useEffect(() => setCurrent(saved), [saved]);
  const [state, action] = useActionState(async (prev: SaveState, fd: FormData) => {
    const result = await toggleSavedProductAction(prev, fd);
    if (result.ok) {
      const next = fd.get("saved") !== "1";
      setCurrent(next);
      onChange?.(next);
    }
    return result;
  }, initial);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="saved" value={current ? "1" : "0"} />
      <Toggle saved={current} compact={compact} />
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}
