"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { MailIcon } from "@/components/ui/icons";

/**
 * Resend — a REAL share action, not a disabled placeholder (revisit §14).
 *
 * Aladdin has no outbound invitation-delivery backend for a referral (it is
 * a database record the platform never sends anywhere), so "Resend" cannot
 * mean "the platform sent it again". What it CAN honestly mean is "hand the
 * referrer their own device's share sheet, with the message and the real
 * public registration route already filled in" — the exact shape the
 * existing WhatsApp/copy invite pattern (`InviteLink` in
 * `features/organization/people-manager.tsx`) already uses for a link that
 * was never actually dispatched either.
 *
 * `/auth/sign-up` is the real, existing public registration route — not an
 * invented one. There is no `NEXT_PUBLIC_APP_URL`/site-URL config anywhere in
 * this app (`lib/env`), so the absolute URL is built from
 * `window.location.origin` at click time, the same technique `InviteLink`
 * already uses for the same reason.
 *
 * Web Share API when the browser supports it; otherwise the message is
 * copied to the clipboard, with copy-specific wording ("Invitation copied"),
 * never "sent" — Aladdin itself never sent anything either way. Cancelling
 * the native share sheet is left alone rather than silently falling back to
 * a clipboard copy the person never asked for.
 */
export function ResendButton({
  name,
  variant = "full",
}: {
  /** The showroom's own display name, for the share message. */
  name: string;
  /** `icon` for a compact icon-only trigger (the rail preview); `full` for a labelled action (a directory row). */
  variant?: "full" | "icon";
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const resend = async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/auth/sign-up`;
    const message = t("network.pending.shareMessage", { name, url });

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text: message });
      } catch {
        // Cancelled, or unsupported for these arguments at call time — no
        // further action; falling back to a clipboard copy here would be a
        // surprise second attempt at something the person just dismissed.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can be refused (no secure context / permission) —
      // the message is still selectable in the share text itself elsewhere,
      // and there is nothing more honest to report here.
    }
  };

  const label = copied ? t("network.pending.resendCopied") : t("network.pending.resend");

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={resend}
        title={label}
        aria-label={label}
        data-testid="resend-button"
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-caption transition-colors",
          "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          copied ? "text-success" : "text-fg-muted hover:text-fg",
        )}
      >
        <MailIcon size={12} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={resend}
      data-testid="resend-button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-label font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        copied ? "border-success/40 text-success" : "border-strong text-fg-secondary hover:bg-surface-2",
      )}
    >
      <MailIcon size={14} />
      {label}
    </button>
  );
}
