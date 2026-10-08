import { describe, expect, it } from "vitest";
import {
  ALL_TAB,
  CURRENT_TAB,
  DEFAULT_WORK_STATE,
  WORK_LIST_STATUSES,
  parseWorkBoardParams,
  sanitizeWorkState,
  statesForTab,
  tabFromState,
  toWorkBoardSearch,
} from "./work-board-params";

describe("the My Work board's state is the URL", () => {
  it("opens on 'All your work', the first page, with every filter at its default", () => {
    expect(parseWorkBoardParams({})).toEqual({ state: DEFAULT_WORK_STATE });
  });

  it("reads every parameter", () => {
    expect(
      parseWorkBoardParams({ state: "completed", q: " villa ", company: "Stone Art", from: "2026-10-01", to: "2026-10-31", contact: "available", sort: "last-action" }),
    ).toEqual({
      state: { tab: "completed", q: "villa", company: "Stone Art", from: "2026-10-01", to: "2026-10-31", contact: "available", sort: "last-action" },
    });
  });

  it("falls back to the default for anything this page does not offer", () => {
    const { state } = parseWorkBoardParams({ state: "paused", contact: "maybe", sort: "random", from: "yesterday", to: "2026-02-31" });
    expect(state).toEqual(DEFAULT_WORK_STATE);
  });

  it("reads a reversed date pair as the range it spans", () => {
    const { state } = parseWorkBoardParams({ from: "2026-10-31", to: "2026-10-01" });
    expect([state.from, state.to]).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("accepts a single bound (an open-ended range)", () => {
    expect(parseWorkBoardParams({ from: "2026-10-01" }).state).toMatchObject({ from: "2026-10-01", to: "" });
    expect(parseWorkBoardParams({ to: "2026-10-01" }).state).toMatchObject({ from: "", to: "2026-10-01" });
  });

  it("carries no page position: pages are appended, so the URL names the question and never an offset or a window", () => {
    expect(Object.keys(parseWorkBoardParams({ shown: "150" } as never))).toEqual(["state"]);
    expect(toWorkBoardSearch({ ...DEFAULT_WORK_STATE, q: "villa" })).toBe("q=villa");
    expect(toWorkBoardSearch(DEFAULT_WORK_STATE)).not.toMatch(/shown|offset|page/);
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseWorkBoardParams({ q: ["a", "b"] }).state.q).toBe("a");
  });

  it("round-trips through the URL, omitting every default", () => {
    const parsed = parseWorkBoardParams({ state: "in_progress", q: "villa", company: "Stone Art", from: "2026-10-01", to: "2026-10-31", contact: "none", sort: "oldest-first" });
    const again = parseWorkBoardParams(Object.fromEntries(new URLSearchParams(toWorkBoardSearch(parsed.state))));
    expect(again).toEqual(parsed);
    expect(toWorkBoardSearch(DEFAULT_WORK_STATE)).toBe("");
  });

  it("changing a filter is written without the window, so paging starts again", () => {
    expect(toWorkBoardSearch({ ...DEFAULT_WORK_STATE, sort: "recent-added" })).toBe("sort=recent-added");
  });
});

describe("which statuses a tab asks the database for", () => {
  it("'All your work' is in progress + completed — nothing else", () => {
    expect(statesForTab(ALL_TAB)).toEqual(["in_progress", "completed"]);
    expect(statesForTab(ALL_TAB)).toEqual(WORK_LIST_STATUSES);
  });

  it("'current' is the composite of scheduled + in progress", () => {
    expect(statesForTab(CURRENT_TAB)).toEqual(["scheduled", "in_progress"]);
  });

  it("every real status is its own explicit view, so scheduled and cancelled stay reachable", () => {
    for (const status of ["scheduled", "in_progress", "completed", "cancelled"]) expect(statesForTab(status)).toEqual([status]);
  });

  it("an unknown tab is 'all'", () => {
    expect(tabFromState("nope")).toBe(ALL_TAB);
    expect(tabFromState(undefined)).toBe(ALL_TAB);
    expect(statesForTab("nope")).toEqual(WORK_LIST_STATUSES);
  });
});

describe("sanitizeWorkState — a stored (or hand-edited) state is never trusted as it stands", () => {
  it("drops values the page no longer offers", () => {
    expect(sanitizeWorkState({ tab: "archived", contact: "phone-only", sort: "last-added", q: "x" })).toEqual({ ...DEFAULT_WORK_STATE, q: "x" });
  });
});
