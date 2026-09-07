"use client";

import { useState } from "react";
import type { OrgMember } from "@/server/queries/sales";

/**
 * Drives a branch + assignee `<select>` pair against a precomputed per-branch
 * candidate map (`membersByBranch`, keyed by branch id with `""` as the
 * org-wide bucket — see `listOrgMembersByBranch`). Switching branches
 * re-filters the assignee options locally, with no client round trip, and
 * never silently drops or submits an assignee that is no longer compatible
 * with the newly chosen branch: the stale selection stays selected (as an
 * extra, clearly-labelled option, so the native `<select>` can't silently
 * fall back to its first real option once its `value` matches nothing) and
 * `isStale` tells the caller to block submission until an explicit new
 * choice is made.
 */
export function useBranchAssignees(
  membersByBranch: Record<string, OrgMember[]>,
  initialBranch: string,
  initialAssignee: string,
) {
  const [branch, setBranchState] = useState(initialBranch);
  const [assignee, setAssigneeState] = useState(initialAssignee);
  const [staleLabel, setStaleLabel] = useState<string | null>(null);

  const candidates = membersByBranch[branch] ?? [];
  const branchKnown = Object.prototype.hasOwnProperty.call(membersByBranch, branch);
  const isStale = assignee !== "" && !candidates.some((cm) => cm.membershipId === assignee);

  function onBranchChange(next: string) {
    // Capture the OUTGOING branch's candidates (not yet re-rendered) so a
    // currently-selected name can still be shown after the branch switches
    // and it drops out of the new candidate list.
    if (assignee !== "") {
      const outgoing = membersByBranch[branch] ?? [];
      const current = outgoing.find((cm) => cm.membershipId === assignee);
      if (current) setStaleLabel(current.displayName);
    }
    setBranchState(next);
  }

  function onAssigneeChange(next: string) {
    setAssigneeState(next);
    setStaleLabel(null);
  }

  return {
    branch,
    assignee,
    candidates,
    branchKnown,
    isStale,
    staleLabel,
    onBranchChange,
    onAssigneeChange,
    setAssignee: setAssigneeState,
  };
}
