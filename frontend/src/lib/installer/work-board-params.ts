import type { WorkSearchState } from "@/features/installer-my-work-preview/view-model";
import { ASSIGNMENT_STATUSES, CURRENT_STATUSES, type JobAssignmentStatus } from "@/lib/work/assignment-state";

/**
 * THE MY WORK BOARD'S STATE IS THE URL.
 *
 * `/home/work?state=&q=&company=&from=&to=&contact=&sort=` is the one authority
 * for what the page shows. The server reads it, asks the database for exactly that
 * range of exactly those rows (`my_work_page`), and the (controlled) View only ever
 * reports a change back as a new URL. Nothing here fetches, and nothing here reads
 * a row: filtering, ordering, counting and paging all live in SQL.
 *
 * `state` stays the status tab's name so the summary rail and the dashboard keep
 * deep-linking to it. Pure, so the client container can use it too.
 */

export const ALL_TAB = "all";
export const CURRENT_TAB = "current";

/** How many assignments the page opens with, and how many one "Show more" appends (one page of the database). */
export const WORK_PAGE_STEP = 6;

/**
 * "All your work" is the work being DONE or already DONE. Scheduled and cancelled
 * assignments are real records that stay reachable through their own views, the
 * summary rail and the detail page, but they are not part of this list.
 */
export const WORK_LIST_STATUSES: readonly JobAssignmentStatus[] = ["in_progress", "completed"];

/** The orderings the database applies to assignments. */
export const WORK_SORTS = ["default", "recent-added", "oldest-first", "last-action"] as const;
/** Contact availability, as the database reads it: a released work contact exists, or it does not. */
export const WORK_CONTACTS = ["all", "available", "none"] as const;

export type WorkBoardParams = Partial<Record<"state" | "q" | "company" | "from" | "to" | "contact" | "sort", string | string[]>>;

export const DEFAULT_WORK_STATE: WorkSearchState = {
  tab: ALL_TAB,
  q: "",
  company: "",
  from: "",
  to: "",
  contact: "all",
  sort: "default",
};

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/** `?state=` -> a tab key. Anything that is not a real tab is "all". */
export function tabFromState(state: string | undefined): string {
  if (state === CURRENT_TAB) return CURRENT_TAB;
  return state && (ASSIGNMENT_STATUSES as readonly string[]).includes(state) ? state : ALL_TAB;
}

/** The assignment statuses a tab asks the database for. */
export function statesForTab(tab: string): readonly JobAssignmentStatus[] {
  if (tab === CURRENT_TAB) return CURRENT_STATUSES;
  if ((ASSIGNMENT_STATUSES as readonly string[]).includes(tab)) return [tab as JobAssignmentStatus];
  return WORK_LIST_STATUSES;
}

/** An ISO calendar day, or "". A malformed or impossible date (2027-02-31) is not a date. */
function isoDay(value: string | string[] | undefined): string {
  const text = one(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : "";
}

/** Normalises a (possibly saved, possibly hand-edited) state: every value is one the page offers, or its default. */
export function sanitizeWorkState(state: Partial<WorkSearchState>): WorkSearchState {
  let from = isoDay(state.from);
  let to = isoDay(state.to);
  // A reversed pair can only come from a hand-edited URL; read it as the range it spans.
  if (from && to && from > to) [from, to] = [to, from];
  return {
    tab: tabFromState(state.tab),
    q: (state.q ?? "").trim().slice(0, 120),
    company: (state.company ?? "").trim().slice(0, 200),
    from,
    to,
    contact: (WORK_CONTACTS as readonly string[]).includes(state.contact ?? "") ? (state.contact as string) : "all",
    sort: (WORK_SORTS as readonly string[]).includes(state.sort ?? "") ? (state.sort as string) : "default",
  };
}

export function parseWorkBoardParams(sp: WorkBoardParams): { state: WorkSearchState } {
  return {
    state: sanitizeWorkState({
      tab: one(sp.state),
      q: one(sp.q),
      company: one(sp.company),
      from: one(sp.from),
      to: one(sp.to),
      contact: one(sp.contact),
      sort: one(sp.sort),
    }),
  };
}

/**
 * The canonical URL query string for a board state; defaults are omitted. It carries NO page position:
 * pages are loaded and appended, so the URL names the question, never how far down the list the viewer is.
 */
export function toWorkBoardSearch(state: WorkSearchState): string {
  const s = sanitizeWorkState(state);
  const p = new URLSearchParams();
  if (s.tab !== ALL_TAB) p.set("state", s.tab);
  if (s.q) p.set("q", s.q);
  if (s.company) p.set("company", s.company);
  if (s.from) p.set("from", s.from);
  if (s.to) p.set("to", s.to);
  if (s.contact !== "all") p.set("contact", s.contact);
  if (s.sort !== "default") p.set("sort", s.sort);
  return p.toString();
}
