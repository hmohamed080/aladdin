"use client";

import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Select } from "@/components/ui/controls";
import { selectBranch } from "@/server/actions/context";

type Named = { id: string; name: string };

// The organization dropdown that used to live here is superseded by
// WorkspaceSwitcher: organizations are no longer a separate axis from the
// Personal context, they are two kinds of the same thing — a work context.

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
      // Header density: the label reads as the next crumb after the workspace,
      // so it carries the branch NAME and drops the "Branch:" prefix into the
      // accessible name — the row is 48px and a literal field label in it is
      // the kind of chrome-in-the-chrome the reference does without.
      <span className="flex h-7 min-w-0 items-center px-1 text-label text-fg-secondary">
        <span className="sr-only">{t("nav.branch")}: </span>
        <span className="truncate">{branches[0]!.name}</span>
      </span>
    );
  }
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="sr-only">{t("nav.branch")}</span>
      <Select
        aria-label={t("nav.branch")}
        defaultValue={activeId ?? "all"}
        disabled={pending}
        size="compact"
        className="min-w-32 max-w-44"
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
