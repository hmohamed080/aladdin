"use client";

import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/ui/format";
import { viewAsBasePath, type ViewAsKind } from "@/lib/admin/view-as/registry";

/**
 * The persistent "Admin View — Read Only" bar. It names the viewed account, says the Admin is still signed in as an
 * administrator, shows when the audited session ends, and offers the one way out. "Return to admin" is a plain form POST
 * to the exit route handler (not a server action): it ends the session and redirects to the user's admin page.
 */
export function ViewAsBanner({
  subjectUserId,
  subjectName,
  kind,
  expiresAt,
}: {
  subjectUserId: string;
  subjectName: string;
  kind: ViewAsKind;
  expiresAt: string;
}) {
  const { t, locale } = useI18n();
  const name = subjectName || t("admin.users.unnamed");
  return (
    <div
      role="region"
      aria-label={t("admin.viewAs.banner")}
      className="sticky z-20 flex flex-wrap items-center gap-x-md gap-y-1 rounded-md border border-warning/40 bg-warning/10 px-md py-2"
      style={{ top: "var(--app-header-h)" }}
    >
      <span className="text-label font-semibold uppercase tracking-wide text-warning">{t("admin.viewAs.banner")}</span>
      <span className="min-w-0 truncate text-body font-medium text-fg" data-testid="view-as-subject">
        {t("admin.viewAs.viewing", { name })} · {t(`admin.viewAs.kind.${kind}`)}
      </span>
      <span className="text-label text-fg-muted">{t("admin.viewAs.expires", { time: formatDateTime(expiresAt, locale) })}</span>
      <p className="basis-full text-label text-fg-muted">{t("admin.viewAs.notice")}</p>
      <form method="post" action={`${viewAsBasePath(subjectUserId)}/exit`} className="ms-auto">
        <button type="submit" className="min-h-9 rounded-md border px-3 text-body font-medium hover:bg-surface-hover">
          {t("admin.viewAs.returnToAdmin")}
        </button>
      </form>
    </div>
  );
}
