import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { SavedWorkSearch, WorkSearchState } from "@/features/installer-my-work-preview/view-model";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import { countAssignmentsByStatus } from "@/lib/work/assignment-state";
import { DEFAULT_WORK_STATE, WORK_PAGE_STEP, statesForTab, toWorkBoardSearch } from "@/lib/installer/work-board-params";
import { InstallerWorkBoard } from "./installer-work-board";
import { InstallerWorkRail } from "./installer-work-rail";
import { toActiveWorkVM, toWorkRowVMs, toWorkTabs } from "./installer-work-data";

/**
 * The PRODUCTION My Work board (`/home/work`): "All your work" means in progress + completed, scheduled and cancelled are
 * explicit views, the contact is the released snapshot only, saved searches persist, and paging is by keyset cursor.
 * (The Jobs board has its own file: `installer-jobs-production.test.tsx`.)
 */

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), path: "/home/work" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: nav.refresh }),
}));
const actions = vi.hoisted(() => ({
  loadMoreWork: vi.fn(),
  createSearch: vi.fn(),
  updateSearch: vi.fn(),
  deleteSearch: vi.fn(),
}));
vi.mock("@/server/actions/work-board", () => ({ loadMoreWorkAction: actions.loadMoreWork }));
vi.mock("@/server/actions/saved-searches", () => ({
  createSavedSearchAction: actions.createSearch,
  updateSavedSearchAction: actions.updateSearch,
  deleteSavedSearchAction: actions.deleteSearch,
}));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill; void _priority; void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

const t = createTranslator("en");

beforeEach(() => {
  nav.replace.mockClear();
  nav.refresh.mockClear();
  nav.path = "/home/work";
  actions.loadMoreWork.mockReset();
  actions.createSearch.mockReset().mockResolvedValue({ ok: true, id: "s-new" });
  actions.updateSearch.mockReset().mockResolvedValue({ ok: true, id: "s1" });
  actions.deleteSearch.mockReset().mockResolvedValue({ ok: true, id: "s1" });
});

function assignment(over: Partial<MyAssignmentRow> = {}): MyAssignmentRow {
  return {
    id: "a1", job_id: "j1", application_id: "ap1", job_title: "Interior painting", job_description: null,
    job_status: "awarded" as never, trade_key: "painting", poster_org_name: "Al Alwan Showroom", governorate: "Cairo",
    city: "Madinaty", site_address: null, agreed_amount: 3200, agreed_currency: "EGP", expected_duration_days: 4,
    starts_on: "2026-10-01", ends_by: "2026-10-10", status: "in_progress", latest_progress_percent: 60,
    last_progress_at: "2026-10-05T09:00:00Z", created_at: "2026-09-28T09:00:00Z", started_at: "2026-10-01T09:00:00Z",
    completed_at: null, cancelled_at: null, cancellation_reason: null, published_at: "2026-09-20T09:00:00Z",
    trade_is_active: true, version: 1, ...over,
  };
}

const NOW = new Date("2026-10-05T12:00:00Z");

type WorkOpts = {
  state?: Partial<WorkSearchState>;
  stage?: string | null;
  saved?: SavedWorkSearch[];
  contacts?: Parameters<typeof toWorkRowVMs>[5];
  reviews?: Parameters<typeof toWorkRowVMs>[4];
  companies?: string[];
};

/**
 * What the route hands the board: the DATABASE's answer. This helper stands in for
 * `my_work_page` only for the one thing the presentation cannot do without — the
 * status a tab asks for — and for slicing pages: the FIRST page is the board's props and
 * `loadMoreWorkAction` is answered with the following slices. Searching, company, date,
 * contact and sort are the database's and are proven by `71_my_work_paging_test.sql`.
 */
function work(all: MyAssignmentRow[], o: WorkOpts = {}) {
  const state = { ...DEFAULT_WORK_STATE, ...o.state };
  const wanted = statesForTab(state.tab);
  const matching = all.filter((r) => r.status && wanted.includes(r.status));
  const page = matching.slice(0, WORK_PAGE_STEP);
  // The cursor is OPAQUE to the board (`c<position>` here); the board hands back whatever the previous page returned.
  actions.loadMoreWork.mockImplementation(async (_search: string, cursor: string) => {
    const from = Number(cursor.slice(1));
    return {
      ok: true,
      rows: toWorkRowVMs(matching.slice(from, from + WORK_PAGE_STEP), t, "en", NOW, o.reviews ?? new Map(), o.contacts ?? new Map()),
      total: matching.length,
      nextCursor: from + WORK_PAGE_STEP < matching.length ? `c${from + WORK_PAGE_STEP}` : null,
    };
  });
  const counts = countAssignmentsByStatus(all);
  const featured = all.find((r) => r.status === "in_progress") ?? all[0] ?? null;
  const stage = o.stage === undefined ? "Floor installation" : o.stage;
  return (
    <InstallerWorkBoard
      activeWork={featured ? toActiveWorkVM(featured, stage, t, "en", NOW) : null}
      rows={toWorkRowVMs(page, t, "en", NOW, o.reviews ?? new Map(), o.contacts ?? new Map())}
      tabs={toWorkTabs(counts, t)}
      state={state}
      search={toWorkBoardSearch(state)}
      total={matching.length}
      nextCursor={matching.length > page.length ? `c${page.length}` : null}
      companies={o.companies ?? Array.from(new Set(all.map((r) => r.poster_org_name).filter((c): c is string => Boolean(c))))}
      rail={<InstallerWorkRail counts={counts} locale="en" t={t} />}
      subtitle="Track your work."
      headerAction={<Link href="/home/jobs">Browse jobs</Link>}
      savedSearches={o.saved ?? []}
    />
  );
}

describe("production My Work — one approved presentation, only real capabilities", () => {
  const rows = [
    assignment(),
    assignment({ id: "a2", job_title: "Marble bathroom", status: "scheduled", latest_progress_percent: null, last_progress_at: null, poster_org_name: "Marble Pro", starts_on: "2026-11-01", ends_by: "2026-11-05" }),
    assignment({ id: "a3", job_title: "Gypsum ceiling", status: "completed", poster_org_name: "Elegant Decor", starts_on: "2026-06-01", ends_by: "2026-06-20" }),
    assignment({ id: "a4", job_title: "Old villa job", status: "completed", poster_org_name: "Stone Art", starts_on: null, ends_by: null }),
    assignment({ id: "a5", job_title: "Dropped kitchen job", status: "cancelled", poster_org_name: "Kitchen Co", starts_on: "2026-09-01", ends_by: "2026-09-10" }),
  ];

  beforeEach(() => {
    nav.path = "/home/work";
  });

  it("exposes no fake documents, tools or export — only what has real backend authority", () => {
    renderWithI18n(work(rows), "en");
    expect(screen.queryByRole("heading", { name: "Documents and files" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Quick tools" })).toBeNull();
    expect(screen.queryByText(/upload current-work photos|request materials|message the showroom|deadline extension/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Export report" })).toBeNull();
    expect(screen.queryByRole("button", { name: /show full (phone|email)/i })).toBeNull(); // nothing released in this fixture
  });

  describe("'All your work' is the work being done or done", () => {
    it("shows only in-progress and completed assignments, and counts them as such", () => {
      renderWithI18n(work(rows), "en");
      const table = screen.getAllByRole("table")[0]!;
      for (const shown of ["Interior painting", "Gypsum ceiling", "Old villa job"]) expect(within(table).getByText(shown)).toBeTruthy();
      expect(within(table).queryByText("Marble bathroom")).toBeNull(); // scheduled
      expect(within(table).queryByText("Dropped kitchen job")).toBeNull(); // cancelled
      expect(screen.getByRole("heading", { name: "All your work" })).toBeTruthy();
      expect(screen.getByText("3 items")).toBeTruthy();
    });

    it("scheduled and cancelled stay reachable as their own titled views — never mixed into the list", () => {
      renderWithI18n(work(rows, { state: { tab: "scheduled" } }), "en");
      const table = screen.getAllByRole("table")[0]!;
      expect(within(table).getByText("Marble bathroom")).toBeTruthy();
      expect(within(table).queryByText("Interior painting")).toBeNull();
      expect(screen.getByRole("heading", { name: `Your work — ${t("jobs.assignmentStatus.scheduled" as never)}` })).toBeTruthy();
    });

    it("the rail still counts and links every real status, so scheduled and cancelled are one tap away", () => {
      renderWithI18n(work(rows), "en");
      const rail = screen.getByRole("complementary", { name: t("work.summary.title") });
      expect(within(rail).getByRole("link", { name: new RegExp(t("work.summary.scheduled")) })).toHaveAttribute("href", "/home/work?state=scheduled");
      expect(within(rail).getByRole("link", { name: new RegExp(t("work.summary.cancelled")) })).toHaveAttribute("href", "/home/work?state=cancelled");
    });
  });

  describe("REAL paged append — the next page of the same question, loaded and appended", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => assignment({ id: `m${i}`, job_title: `Job ${i}`, status: "completed" }));
    const rowCount = () => within(screen.getAllByRole("table")[0]!).getAllByRole("row").length - 1;

    it("states the exact total of a set far larger than the old 100-row cap, with no cap note", () => {
      renderWithI18n(work(many(340)), "en");
      expect(screen.getByText("340 items")).toBeTruthy();
      expect(screen.getByText("Showing 6 of 340 results")).toBeTruthy();
      expect(screen.queryByText(/latest 100|up to 100|100 assignments/i)).toBeNull();
      expect(screen.getByRole("button", { name: "Show more" })).toBeEnabled();
    });

    it("Show more loads the next page and appends it — not a navigation", async () => {
      renderWithI18n(work(many(14)), "en");
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(rowCount()).toBe(12));
      expect(actions.loadMoreWork).toHaveBeenCalledWith("", "c6");
      expect(nav.replace).not.toHaveBeenCalled();
      expect(screen.getByText("Showing 12 of 14 results")).toBeTruthy();
      expect(screen.getAllByText("Job 0").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Job 11").length).toBeGreaterThan(0);
    });

    it("asks the next page of the SAME question: every filter and the sort travel with it", async () => {
      renderWithI18n(work(many(40), { state: { tab: "completed", q: "villa", company: "Stone Art", contact: "available", sort: "last-action", from: "2026-10-01", to: "2026-10-31" } }), "en");
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(actions.loadMoreWork).toHaveBeenCalled());
      const [search, cursor] = actions.loadMoreWork.mock.calls[0]!;
      expect(Object.fromEntries(new URLSearchParams(search as string))).toEqual({ state: "completed", q: "villa", company: "Stone Art", from: "2026-10-01", to: "2026-10-31", contact: "available", sort: "last-action" });
      expect(cursor).toBe("c6");
    });

    it("keeps loading past 300 rows — there is no ceiling in the flow", async () => {
      renderWithI18n(work(many(400)), "en");
      for (let n = 12; n <= 336; n += 6) {
        fireEvent.click(screen.getByRole("button", { name: "Show more" }));
        await waitFor(() => expect(rowCount()).toBe(n));
      }
      expect(rowCount()).toBe(336);
      expect(actions.loadMoreWork).toHaveBeenLastCalledWith("", "c330");
      expect(screen.getByRole("button", { name: "Show more" })).toBeEnabled();
      expect(screen.getByText("Showing 336 of 400 results")).toBeTruthy();
    }, 120_000);

    it("Show less drops the last appended page, and is absent at the first page", async () => {
      renderWithI18n(work(many(30)), "en");
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(rowCount()).toBe(12));
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(rowCount()).toBe(18));
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(rowCount()).toBe(12);
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(rowCount()).toBe(6);
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
    });

    it("the exact total is re-stated by each page", async () => {
      renderWithI18n(work(many(14)), "en");
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(rowCount()).toBe(12));
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(rowCount()).toBe(14));
      expect(screen.getByText("14 items")).toBeTruthy();
      expect(screen.getByRole("button", { name: "All work shown" })).toBeDisabled();
    });

    it("Show less then Show more keeps the cursor chain consistent, and re-fetches the dropped page from its own cursor", async () => {
      renderWithI18n(work(many(40)), "en");
      for (const n of [12, 18]) {
        fireEvent.click(screen.getByRole("button", { name: "Show more" }));
        await waitFor(() => expect(rowCount()).toBe(n));
      }
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(rowCount()).toBe(6);
      for (const n of [12, 18, 24]) {
        fireEvent.click(screen.getByRole("button", { name: "Show more" }));
        await waitFor(() => expect(rowCount()).toBe(n));
      }
      expect(actions.loadMoreWork.mock.calls.map((c) => c[1])).toEqual(["c6", "c12", "c6", "c12", "c18"]);
    });

    it("a failed load keeps what is shown, says so, and can be retried", async () => {
      renderWithI18n(work(many(14)), "en");
      const ok = actions.loadMoreWork.getMockImplementation()!;
      actions.loadMoreWork.mockResolvedValueOnce({ ok: false });
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      expect(await screen.findByText(/could not load more/i)).toBeTruthy();
      expect(rowCount()).toBe(6);
      actions.loadMoreWork.mockImplementation(ok);
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(rowCount()).toBe(12));
    });

    it("says everything is shown only when the database has no more", () => {
      renderWithI18n(work(many(4)), "en");
      expect(screen.getByRole("button", { name: "All work shown" })).toBeDisabled();
    });

    it("changing a filter or the sort navigates and starts again from the first page", () => {
      renderWithI18n(work(many(40)), "en");
      fireEvent.click(screen.getByRole("button", { name: "Sort" }));
      fireEvent.click(screen.getByRole("option", { name: "Recently added" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/work?sort=recent-added", { scroll: false });
    });
  });

  describe("search is the database's — typing waits for a pause, then asks for the new result", () => {
    it("navigates to the URL carrying the query once typing pauses", async () => {
      renderWithI18n(work(rows), "en");
      fireEvent.change(screen.getByRole("searchbox", { name: "Search work" }), { target: { value: "gypsum" } });
      expect(nav.replace).not.toHaveBeenCalled(); // not on every keystroke
      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/home/work?q=gypsum", { scroll: false }), { timeout: 2000 });
    });

    it("shows the URL's query in the box on arrival", () => {
      renderWithI18n(work(rows, { state: { q: "villa" } }), "en");
      expect((screen.getByRole("searchbox", { name: "Search work" }) as HTMLInputElement).value).toBe("villa");
    });

    it("does not filter the rows on screen itself", () => {
      renderWithI18n(work(rows), "en");
      fireEvent.change(screen.getByRole("searchbox", { name: "Search work" }), { target: { value: "no-such-work" } });
      expect(within(screen.getAllByRole("table")[0]!).getByText("Interior painting")).toBeTruthy();
    });
  });

  describe("contact — real data only", () => {
    const contacts = new Map([["a1", { org_name: "Horizon", contact_name: "Mostafa Bakr", phone: "+201000000001", email: "mostafa@example.test" }]]);

    it("draws a Contact column with the released phone, e-mail and name — and nothing for rows with none", () => {
      renderWithI18n(work(rows, { stage: null, contacts }), "en");
      const table = screen.getAllByRole("table")[0]!;
      expect(within(table).getByRole("columnheader", { name: "Contact" })).toBeTruthy();
      expect(within(table).getByText("Mostafa Bakr")).toBeTruthy();
      expect(within(table).getByRole("button", { name: "Show full phone number" }).textContent).toBe("+201000000001");
      expect(within(table).getByRole("button", { name: "Show full email address" }).textContent).toBe("mostafa@example.test");
      // a3 / a4 have no contact row: no placeholder phone or e-mail is invented — an honest dash instead.
      expect(within(table).getAllByRole("button", { name: "Show full phone number" })).toHaveLength(1);
      expect(within(table).getAllByTitle("No contact data")).toHaveLength(2);
    });

    it("the Contact filter offers the real states and asks the database for the chosen one", () => {
      renderWithI18n(work(rows, { stage: null, contacts }), "en");
      fireEvent.click(screen.getByRole("button", { name: "All filters" }));
      const trigger = screen.getByRole("button", { name: "Contact details" });
      expect(trigger.textContent).toBe("All contact states");
      fireEvent.click(trigger);
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All contact states", "Contact available", "No contact data"]);
      fireEvent.click(screen.getByRole("option", { name: "Contact available" }));
      fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/work?contact=available", { scroll: false });
    });

    it("'No contact data' is the other real state", () => {
      renderWithI18n(work(rows, { stage: null, contacts }), "en");
      fireEvent.click(screen.getByRole("button", { name: "All filters" }));
      fireEvent.click(screen.getByRole("button", { name: "Contact details" }));
      fireEvent.click(screen.getByRole("option", { name: "No contact data" }));
      fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/work?contact=none", { scroll: false });
    });
  });

  it("the Company filter lists the organizations the DATABASE reports — not only those on screen", () => {
    renderWithI18n(work(rows, { companies: ["Al Alwan Showroom", "Elegant Decor", "Horizon Contracting", "Stone Art"] }), "en");
    fireEvent.click(screen.getByRole("button", { name: "All filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Company / client" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Al Alwan Showroom", "Elegant Decor", "Horizon Contracting", "Stone Art"]);
    fireEvent.click(screen.getByRole("option", { name: "Horizon Contracting" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(nav.replace).toHaveBeenCalledWith("/home/work?company=Horizon+Contracting", { scroll: false });
  });

  describe("saved searches — persisted through the real actions", () => {
    const finished: SavedWorkSearch = { id: "s1", name: "Finished work", state: { tab: "completed", q: "", company: "", from: "", to: "", contact: "all", sort: "default" } };

    it("lists the user's persisted searches and applying one restores its stored filters", () => {
      renderWithI18n(work(rows, { saved: [finished] }), "en");
      fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
      fireEvent.click(screen.getByRole("option", { name: "Finished work" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/work?state=completed", { scroll: false });
    });

    it("applying a stored query asks the database for it", () => {
      const byText: SavedWorkSearch = { id: "s2", name: "Gypsum", state: { ...finished.state, tab: "all", q: "gypsum" } };
      renderWithI18n(work(rows, { saved: [byText] }), "en");
      fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
      fireEvent.click(screen.getByRole("option", { name: "Gypsum" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/work?q=gypsum", { scroll: false });
    });

    it("saving stores the CURRENT meaningful filters under the chosen name, and the new search appears", async () => {
      renderWithI18n(work(rows), "en");
      fireEvent.change(screen.getByRole("searchbox", { name: "Search work" }), { target: { value: "villa" } });
      fireEvent.click(screen.getByRole("button", { name: "Save search" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Villas" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Save search" }));
      await waitFor(() => expect(actions.createSearch).toHaveBeenCalled());
      expect(actions.createSearch).toHaveBeenCalledWith("work", "Villas", { tab: "all", q: "villa", contact: "all", sort: "default" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(nav.refresh).toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
      expect(screen.getByRole("option", { name: "Villas" })).toBeTruthy();
    });

    it("a refused save (duplicate name) is explained in the dialog, which stays open — nothing is pretended", async () => {
      actions.createSearch.mockResolvedValue({ ok: false, code: "duplicate" });
      renderWithI18n(work(rows), "en");
      fireEvent.click(screen.getByRole("button", { name: "Save search" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save search" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("You already have a saved search with that name.");
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("transient UI state (an open filter drawer) is never part of what is saved", async () => {
      renderWithI18n(work(rows), "en");
      fireEvent.click(screen.getByRole("button", { name: "All filters" })); // drawer open
      fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
      fireEvent.click(screen.getByRole("button", { name: "Save search" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save search" }));
      await waitFor(() => expect(actions.createSearch).toHaveBeenCalled());
      expect(Object.keys(actions.createSearch.mock.calls[0]![2]).sort()).toEqual(["contact", "sort", "tab"]);
    });

    it("deleting a saved search calls the real action", async () => {
      renderWithI18n(work(rows, { saved: [finished] }), "en");
      fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
      fireEvent.click(within(screen.getByRole("listbox", { name: "Saved searches" })).getByRole("button", { name: /delete/i }));
      await waitFor(() => expect(actions.deleteSearch).toHaveBeenCalledWith("s1"));
    });
  });

  it("the results area is its own scroll region on desktop (capped height, scrolls inside the card)", () => {
    renderWithI18n(work(rows), "en");
    const wrapper = screen.getByRole("heading", { name: "All your work" }).closest("section")!.parentElement!;
    expect(wrapper.className).toMatch(/desktop:max-h-\[min\(48rem/);
    expect(document.getElementById("work-history-results")!.closest("div")!.className).toContain("desktop:overflow-y-auto");
  });

  it("the three-dot menu is real and contextual: in progress offers View details + Update progress; completed offers View details", () => {
    renderWithI18n(work(rows), "en");
    const table = screen.getAllByRole("table")[0]!;
    // a1 in progress, a3 + a4 completed (no review): every row in this list has a menu.
    expect(within(table).getAllByRole("button", { name: "More actions" })).toHaveLength(3);
    fireEvent.click(within(table).getAllByRole("button", { name: "More actions" })[0]!);
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["View details", "Update progress"]);
    expect(within(menu).getByRole("menuitem", { name: "Update progress" })).toHaveAttribute("href", "/home/work/a1");
    expect(screen.queryByText(/upload|request materials|message/i)).toBeNull();
  });

  it("a completed assignment with a real review offers View rating, and the rating is never invented", () => {
    const completed = assignment({ id: "a9", status: "completed", job_title: "Reviewed job" });
    renderWithI18n(work([completed], { reviews: new Map([["a9", { rating: 5 }]]) }), "en");
    const table = screen.getAllByRole("table")[0]!;
    fireEvent.click(within(table).getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "View rating" })).toHaveAttribute("href", "/home/work/a9");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["View details", "View rating"]);
  });

  it("shows the real status summary in the rail, linked to the real tabs", () => {
    renderWithI18n(work(rows), "en");
    const rail = screen.getByRole("complementary", { name: t("work.summary.title") });
    expect(within(rail).getByRole("link", { name: new RegExp(t("work.summary.scheduled")) })).toHaveAttribute("href", "/home/work?state=scheduled");
    expect(within(rail).getByRole("link", { name: new RegExp(t("work.summary.completed")) })).toHaveAttribute("href", "/home/work?state=completed");
    expect(within(rail).queryByText(/this month/i)).toBeNull();
  });

  it("featured panel: real progress, current stage from a real update, no next stage, no +10% button", () => {
    renderWithI18n(work(rows), "en");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText("Floor installation")).toBeTruthy();
    expect(screen.queryByText("Next stage")).toBeNull();
    const panel = document.querySelector('section[aria-labelledby="active-work-title"]') as HTMLElement;
    const update = within(panel).getByRole("link", { name: "Update progress" });
    expect(update).toHaveAttribute("href", "/home/work/a1");
    // Clicking it navigates; it never changes the percentage locally.
    fireEvent.click(update);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
  });

  it("without a stage there is no stage block", () => {
    renderWithI18n(work(rows, { stage: null }), "en");
    expect(screen.queryByText("Current stage")).toBeNull();
  });

  it("an empty book of work keeps its structure with a designed empty state", () => {
    renderWithI18n(work([]), "en");
    expect(screen.getByText("No current work")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "All your work" })).toBeTruthy();
    const card = screen.getByText("No current work").closest("div")!.parentElement!;
    expect(within(card).getByRole("link", { name: "Browse job opportunities" })).toHaveAttribute("href", "/home/jobs");
  });

  it("rows offer Update progress only for in progress; completed rows just View; Start work lives on the scheduled view", () => {
    renderWithI18n(work(rows), "en");
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).queryByRole("link", { name: "Start work" })).toBeNull();
    expect(within(table).getAllByRole("link", { name: "Update progress" }).map((l) => l.getAttribute("href"))).toEqual(["/home/work/a1"]);
    expect(within(table).getAllByRole("link", { name: "View" }).map((l) => l.getAttribute("href")).sort()).toEqual(["/home/work/a3", "/home/work/a4"]);
  });

  it("on the scheduled view, Start work (canStart) is offered through the real detail page", () => {
    renderWithI18n(work(rows, { state: { tab: "scheduled" } }), "en");
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getAllByRole("link", { name: "Start work" }).map((l) => l.getAttribute("href"))).toEqual(["/home/work/a2"]);
  });

  it("the status filter offers only the real vocabulary", () => {
    renderWithI18n(work(rows), "en");
    fireEvent.click(screen.getByRole("button", { name: "All filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      t("jobs.assignmentStatus.in_progress" as never),
      t("jobs.assignmentStatus.completed" as never),
    ]);
    expect(options.join("|")).not.toMatch(/paused|review|archiv|accepted/i);
  });

  it("the tab narrows the list by real status", () => {
    renderWithI18n(work(rows, { state: { tab: "completed" } }), "en");
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByText("Gypsum ceiling")).toBeTruthy();
    expect(within(table).queryByText("Interior painting")).toBeNull();
  });

  it("the planned-period control asks the database for the range — it filters nothing itself", () => {
    renderWithI18n(work(rows), "en");
    fireEvent.click(screen.getByRole("button", { name: "Planned period" }));
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(nav.replace).toHaveBeenCalledWith("/home/work?from=2026-10-08&to=2026-10-31", { scroll: false });
  });

  it("changing the tab navigates to the real ?state= URL", () => {
    renderWithI18n(work(rows), "en");
    fireEvent.click(screen.getByRole("button", { name: "All filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: t("jobs.assignmentStatus.completed" as never) }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(nav.replace).toHaveBeenCalledWith("/home/work?state=completed", { scroll: false });
  });

  it("'New search' clears every filter back to the default list", () => {
    renderWithI18n(work(rows, { state: { tab: "completed", q: "villa", contact: "none", sort: "last-action" } }), "en");
    fireEvent.click(screen.getByRole("button", { name: "New search" }));
    expect(nav.replace).toHaveBeenCalledWith("/home/work", { scroll: false });
  });

  it("formats an exact fractional agreed amount", () => {
    renderWithI18n(work([assignment({ agreed_amount: 4500.5 })]), "en");
    expect(screen.getAllByText("4,500.50 EGP").length).toBeGreaterThan(0);
  });
});

describe("GRID is the default view on My Work", () => {
  it("My Work opens in Grid view too, and the grid of cards is what is drawn", () => {
    const { container } = renderWithI18n(work([assignment(), assignment({ id: "a2", job_title: "Bathroom tiling" })]), "en");
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector("#work-history-results-grid")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(container.querySelector("#work-history-results-grid")).toBeNull();
  });

  it("names the views عرض الشبكة / عرض القائمة in Arabic, Grid first", () => {
    renderWithI18n(work([assignment(), assignment({ id: "a2", job_title: "Bathroom tiling" })]), "ar");
    const buttons = screen.getAllByRole("button").filter((b) => /^(عرض الشبكة|عرض القائمة)$/.test(b.textContent ?? ""));
    expect(buttons.map((b) => b.textContent)).toEqual(["عرض الشبكة", "عرض القائمة"]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  });
});
