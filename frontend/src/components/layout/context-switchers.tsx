"use client";

import { useTransition, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Select } from "@/components/ui/controls";
import { selectBranch } from "@/server/actions/context";
import { BuildingIcon, MapPinIcon } from "@/components/ui/icons";

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
  activeDisplayName,
}: {
  branches: Named[];
  activeId: string | null;
  orgWide: boolean;
  /** The single active branch's resolved Arabic/English name — see `WorkspaceSwitcher`'s identical override for why this is narrower than translating every row. */
  activeDisplayName?: string | null;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  if (branches.length === 0) return null;
  if (branches.length === 1) {
    return (
      // Header density: the label reads as the next crumb after the workspace,
      // so it carries the branch NAME and drops the "Branch:" prefix into the
      // accessible name — the row is 48px and a literal field label in it is
      // the kind of chrome-in-the-chrome the reference does without. The pin
      // icon is what visually distinguishes a BRANCH from the organization
      // crumb before it (its own building icon) — the two used to be told
      // apart only by an sr-only label, which a sighted user never reads.
      <span className="flex h-7 min-w-0 items-center gap-1.5 px-1 text-label text-fg-secondary">
        <MapPinIcon size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="sr-only">{t("nav.branch")}: </span>
        <span className="truncate">{activeDisplayName || branches[0]!.name}</span>
      </span>
    );
  }
  return (
    <label className="flex min-w-0 items-center gap-1.5">
      <MapPinIcon size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
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

/**
 * The MOBILE org/branch context block — a labeled two-line replacement for
 * the desktop crumb row, which relies on a `max-w-32` cap that used to end an
 * organization's real name in an ugly partial truncation ("…owroom"). At
 * phone width there is no third control to protect from crowding (the
 * desktop crumbs sit beside a search field and half a dozen icon buttons;
 * this block is the ENTIRE mobile header row), so the fix is to give the
 * name the width it needs and wrap, never clip.
 *
 * Static text, not a second interactive control: `branchSelector` is the one
 * escape hatch, used only when the caller genuinely has more than one
 * branch to choose from — the same `BranchSwitcher` instance the desktop
 * crumb uses, not a duplicate. A single-branch org (Hana's, today) never
 * renders it, so there is exactly one functional branch selector in the
 * whole header, on either surface.
 */
export function WorkspaceContextMobile({
  orgLabel,
  orgName,
  branchLabel,
  branchName,
  branchSelector,
}: {
  orgLabel: string;
  orgName: string;
  branchLabel: string;
  /** Null when `branchSelector` is supplied instead (the multi-branch case). */
  branchName: string | null;
  branchSelector?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 text-label">
      <span className="flex min-w-0 items-start gap-1.5">
        <BuildingIcon size={14} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="min-w-0 break-words text-fg-secondary">
          <span className="text-fg-muted">{orgLabel}: </span>
          <span className="font-medium text-fg">{orgName}</span>
        </span>
      </span>
      <span className="flex min-w-0 items-start gap-1.5">
        <MapPinIcon size={14} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
        {branchSelector ?? (
          <span className="min-w-0 break-words text-fg-secondary">
            <span className="text-fg-muted">{branchLabel}: </span>
            <span className="font-medium text-fg">{branchName}</span>
          </span>
        )}
      </span>
    </div>
  );
}
