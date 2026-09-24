"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card, ProgressMeter } from "@/components/ui/primitives";
import type { ProfileCompletion, ProfileCompletionItem } from "@/server/queries/profile-identity";

/**
 * Where each missing item is completed. Every target must be reachable by
 * every caller `my_profile_completion()` can return that item for:
 *
 *   * identity items → `/settings/profile`, the workspace-independent route
 *     (a business-intent account with zero organizations has neither `/home`
 *     nor `/b2b` settings);
 *   * username → `/onboarding/username`, the only state it is ever missing in
 *     (`username_pending`);
 *   * professional items → `/home/profile/edit` — only returned for a
 *     professional persona, which always has a Personal workspace;
 *   * organization_setup → `/business/new` (any caller with app access);
 *   * organization_activities → `/b2b/settings` — only returned to a caller
 *     holding org.manage, the capability that page's editor requires.
 *
 * `locality` is kept in the type for the RPC's stable vocabulary but is never
 * returned today (no locality write path exists yet).
 */
export const ITEM_HREF: Record<ProfileCompletionItem, string> = {
  username: "/onboarding/username",
  avatar: "/settings/profile#identity",
  phone: "/settings/profile#phone",
  display_name: "/settings/profile#display-name",
  locality: "/settings/profile",
  headline: "/home/profile/edit",
  years_experience: "/home/profile/edit",
  activities: "/home/profile/edit",
  bio: "/home/profile/edit",
  organization_activities: "/b2b/settings",
  organization_setup: "/business/new",
};

/**
 * "أكمل حسابك / Complete your profile" — the persistent, NON-GATING checklist
 * driven by `my_profile_completion()` (the authoritative calculation; nothing
 * here re-derives a percentage). Renders nothing at 100%, never blocks the page
 * it sits on, and collapses to a single line on demand.
 */
export function CompleteProfileCard({ completion }: { completion: ProfileCompletion }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);

  if (completion.percent >= 100 || completion.missing.length === 0) return null;

  return (
    <Card className="flex flex-col gap-sm">
      <div data-testid="complete-profile-card" className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-start justify-between gap-sm">
          <div className="min-w-0">
            <h2 className="text-title text-fg">{t("completeProfile.title")}</h2>
            <p className="text-label text-fg-secondary">{t("completeProfile.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 rounded-sm px-2 py-1 text-label font-medium text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {open ? t("completeProfile.collapse") : t("completeProfile.expand")}
          </button>
        </div>
        <ProgressMeter value={completion.percent} label={t("completeProfile.title")} />
        <p className="text-label text-fg-muted" data-testid="complete-profile-percent">
          {t("completeProfile.percent", { percent: completion.percent })}
        </p>
        {open ? (
          <ul className="flex flex-col gap-1.5" data-testid="complete-profile-missing">
            {completion.missing.map((item) => (
              <li key={item}>
                <Link
                  href={ITEM_HREF[item]}
                  className="inline-flex items-center gap-2 text-body font-medium text-accent hover:underline"
                  data-item={item}
                >
                  {t(`completeProfile.missing.${item}`)}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
