"use client";

import type { ComponentProps } from "react";
import { useI18n } from "@/lib/i18n/context";
import { InstallerTopbarCore } from "./installer-topbar-core";
import { PROFILE, mockOpportunities, pick } from "./mock-data";

/**
 * The PREVIEW topbar: the shared `InstallerTopbarCore` with the preview persona
 * and the preview's mock search list injected. This is the only topbar module
 * that imports `mock-data`; the production shell renders the core directly with
 * the caller's real name and opportunities, so no fixture can reach `/home`.
 */
export function InstallerTopbar(props: Omit<ComponentProps<typeof InstallerTopbarCore>, "production" | "displayName" | "searchJobs">) {
  const { locale } = useI18n();
  return <InstallerTopbarCore {...props} displayName={pick(locale, PROFILE.name)} searchJobs={mockOpportunities()} />;
}
