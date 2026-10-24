"use client";

import { useI18n } from "@/lib/i18n/context";
import { AccountHubBody, type AccountHubData } from "@/features/installer-account-preview/installer-account-preview";

/**
 * `/home/profile` for an Installer: the approved "My account" design on real data (built by the route). The cover set on
 * "Complete your profile" is shown here and on the public profile. The design's "Learning & training" card has no
 * product behind it yet and is not drawn; every other card opens its real page.
 */
export function InstallerAccountHub({ data }: { data: AccountHubData }) {
  const { locale, dir } = useI18n();
  return (
    <div dir={dir} className="flex w-full min-w-0 flex-col gap-lg" data-installer-account>
      <AccountHubBody locale={locale} data={data} />
    </div>
  );
}
