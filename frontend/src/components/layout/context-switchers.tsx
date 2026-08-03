"use client";

import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Select } from "@/components/ui/controls";
import { selectOrganization, selectBranch } from "@/server/actions/context";

type Named = { id: string; name: string };

/** Organization selector — only shown when the caller belongs to 2+ orgs. */
export function OrgSwitcher({ orgs, activeId }: { orgs: Named[]; activeId: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  if (orgs.length < 2) return null;
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{t("nav.organization")}</span>
      <Select
        aria-label={t("nav.organization")}
        defaultValue={activeId}
        disabled={pending}
        className="min-w-40"
        onChange={(e) => start(() => selectOrganization(e.target.value))}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * Branch selector. A branch-limited user only ever sees their own assigned
 * branches (the list is server-derived); an org-wide user additionally gets the
 * "All branches" option. Selecting grants no authority — RLS/RPCs re-check.
 */
export function BranchSwitcher({
  branches,
  activeId,
  allowAll,
}: {
  branches: Named[];
  activeId: string | null;
  allowAll: boolean;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  if (branches.length === 0) return null;
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{t("nav.branch")}</span>
      <Select
        aria-label={t("nav.branch")}
        defaultValue={activeId ?? "all"}
        disabled={pending}
        className="min-w-40"
        onChange={(e) => start(() => selectBranch(e.target.value))}
      >
        {allowAll ? <option value="all">{t("nav.allBranches")}</option> : null}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
