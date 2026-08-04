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
 * Branch selector. The value shown ALWAYS matches the data scope:
 *  - a single in-scope branch renders as a read-only label (nothing to switch,
 *    and the server has auto-selected it) — never a dropdown implying a choice;
 *  - multiple branches render a dropdown whose "all" option is labelled
 *    "All branches" for an org-wide caller and "All my branches" for a
 *    branch-limited caller (whose "all" means the union of their assigned
 *    branches). Selecting grants no authority — RLS/RPCs re-check.
 */
export function BranchSwitcher({
  branches,
  activeId,
  orgWide,
}: {
  branches: Named[];
  activeId: string | null;
  orgWide: boolean;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  if (branches.length === 0) return null;
  if (branches.length === 1) {
    return (
      <span className="flex items-center gap-1 text-label text-fg-secondary">
        <span className="text-fg-muted">{t("nav.branch")}:</span>
        {branches[0]!.name}
      </span>
    );
  }
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
        <option value="all">{orgWide ? t("nav.allBranches") : t("nav.allAssignedBranches")}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
