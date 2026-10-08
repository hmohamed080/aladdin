"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { JobOpportunitiesSection } from "@/features/installer-dashboard-preview/job-opportunities-section";
import type { InstallerOpportunityVM } from "@/features/installer-dashboard-preview/view-model";
import {
  DEFAULT_DASHBOARD_DATE_ORDER,
  DEFAULT_DASHBOARD_SORT,
  type DashboardDateOrder,
  type DashboardSort,
} from "@/lib/installer/dashboard-opportunities";
import { loadDashboardOpportunitiesAction } from "@/server/actions/dashboard-opportunities";
import { setJobSavedAction } from "@/server/actions/saved-jobs";

/**
 * The REAL "Opportunities for you" strip of the installer dashboard: the approved shared section, its quick filters
 * wired to the database.
 *
 * The server renders the strip for the default filter (Matching my skills). Choosing another filter —
 * Near me, Matching my skills, Newest / Oldest — asks the server for that ordering (`loadDashboardOpportunitiesAction`)
 * and swaps the cards in place; nothing is sorted in the browser, and nothing here invents a figure. The filter shown as
 * active is the one the cards on screen belong to: it moves at once when tapped, and goes back (with a message, the old
 * cards untouched) if the new ordering cannot be loaded. A reply that arrives after a newer tap is ignored.
 *
 * SAVING. Each card's heart is the REAL saved-jobs state (`saved_jobs`, the same authority as /home/jobs): the server
 * says which cards are saved, a tap shows the new state at once and persists it through `setJobSavedAction`, and a
 * failed save puts the heart back and says so. The viewer's own taps are kept across a change of ordering, so a job
 * saved here stays saved when the strip is reordered, and it is saved on /home/jobs and after a reload because the
 * database says so — there is no dashboard-only state.
 */
export function InstallerHomeOpportunities({
  initial,
  emptyTitle,
  emptyBody,
  viewAllHref,
}: {
  /** The strip for the default filter, as the server rendered it. */
  initial: readonly InstallerOpportunityVM[];
  emptyTitle: string;
  emptyBody: string;
  viewAllHref: string;
}) {
  const { locale } = useI18n();
  type Choice = { sort: DashboardSort; dateOrder: DashboardDateOrder };
  const key = initial.map((card) => card.id).join(",");
  const [state, setState] = useState<{ key: string; choice: Choice; cards: readonly InstallerOpportunityVM[]; pending: boolean; failed: boolean }>({
    key,
    choice: { sort: DEFAULT_DASHBOARD_SORT, dateOrder: DEFAULT_DASHBOARD_DATE_ORDER },
    cards: initial,
    pending: false,
    failed: false,
  });
  // A new server render (a different first strip) starts again from the default filter.
  const current = state.key === key ? state : { key, choice: { sort: DEFAULT_DASHBOARD_SORT, dateOrder: DEFAULT_DASHBOARD_DATE_ORDER }, cards: initial, pending: false, failed: false };
  const ticket = useRef(0);
  const shown = useRef(current);
  shown.current = current;

  // The viewer's own taps, layered over what the server reported until it catches up or a save fails.
  const [taps, setTaps] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [saveFailed, setSaveFailed] = useState(false);
  const flagged = new Map<string, boolean>();
  for (const card of current.cards) flagged.set(card.id, card.isSaved);
  const isSaved = (id: string) => (taps.has(id) ? Boolean(taps.get(id)) : Boolean(flagged.get(id)));
  const toggleSaved = (id: string) => {
    const next = !isSaved(id);
    setSaveFailed(false);
    setTaps((existing) => new Map(existing).set(id, next));
    void setJobSavedAction(id, next)
      .then((result) => {
        if (result.ok) return;
        setTaps((existing) => {
          const reverted = new Map(existing);
          reverted.delete(id);
          return reverted;
        });
        setSaveFailed(true);
      })
      .catch(() => {
        setTaps((existing) => {
          const reverted = new Map(existing);
          reverted.delete(id);
          return reverted;
        });
        setSaveFailed(true);
      });
  };

  const choose = async (sort: DashboardSort, dateOrder: DashboardDateOrder) => {
    const before = shown.current;
    if (before.choice.sort === sort && before.choice.dateOrder === dateOrder && !before.failed) return;
    const mine = ++ticket.current;
    setState({ ...before, key, choice: { sort, dateOrder }, pending: true, failed: false });
    let result: Awaited<ReturnType<typeof loadDashboardOpportunitiesAction>>;
    try {
      result = await loadDashboardOpportunitiesAction(sort, dateOrder);
    } catch {
      result = { ok: false };
    }
    if (mine !== ticket.current) return; // a newer tap owns the strip now
    setState(
      result.ok
        ? { key, choice: { sort, dateOrder }, cards: result.opportunities, pending: false, failed: false }
        : { key, choice: before.choice, cards: before.cards, pending: false, failed: true },
    );
  };

  return (
    <>
    {saveFailed ? (
      <p role="alert" className="mb-2 text-label font-medium text-danger">
        {locale === "ar" ? "تعذّر تحديث الفرص المحفوظة. حاول مرة أخرى." : "Could not update your saved opportunities. Please try again."}
      </p>
    ) : null}
    <JobOpportunitiesSection
      opportunities={current.cards}
      emptyTitle={emptyTitle}
      emptyBody={emptyBody}
      viewAllHref={viewAllHref}
      sortable={false}
      variant="production"
      save={{ isSaved, onToggle: toggleSaved }}
      remoteSort={{
        sort: current.choice.sort,
        dateOrder: current.choice.dateOrder,
        onChange: (sort, dateOrder) => void choose(sort, dateOrder),
        pending: current.pending,
        failed: current.failed,
      }}
    />
    </>
  );
}
