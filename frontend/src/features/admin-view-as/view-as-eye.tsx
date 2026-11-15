"use client";

import { EyeIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { viewAsBasePath } from "@/lib/admin/view-as/registry";

/**
 * The eye on an eligible account: opens the audited, read-only "view as account".
 *
 * It is a plain form POST to `/admin/users/[id]/view/start` (the ONLY place a session opens; same-origin only), never a
 * link, so a cross-site page cannot start a view and a prefetch never writes the audit row. Drawn only for a craftsman the
 * admin may view (`canViewAsUser`) while the feature is switched on; otherwise the page keeps its ordinary eye.
 */
export function ViewAsEye({ userId, variant = "icon" }: { userId: string; variant?: "icon" | "button" }) {
  const { t } = useI18n();
  const label = t("admin.viewAs.eyeLabel");
  return (
    <form method="post" action={`${viewAsBasePath(userId)}/start`} className="inline-flex">
      {variant === "icon" ? (
        <button
          type="submit"
          title={label}
          aria-label={label}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-accent transition-colors hover:bg-accent-solid/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        >
          <EyeIcon size={16} />
        </button>
      ) : (
        <button
          type="submit"
          title={label}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-strong px-3.5 text-body font-medium text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <EyeIcon size={16} />
          {label}
        </button>
      )}
    </form>
  );
}
