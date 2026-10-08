import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ImgHTMLAttributes } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import type { MatchedOpportunityRow } from "./installer-dashboard-data";
import type { InstallerOpportunityVM } from "@/features/installer-dashboard-preview/view-model";
import { dashboardChoiceFor, dashboardModeFor } from "@/lib/installer/dashboard-opportunities";
import { toOpportunityVM } from "./installer-dashboard-data";
import { ProfessionalHome } from "./professional-home";

const action = vi.hoisted(() => ({ load: vi.fn() }));
const saved = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/server/actions/dashboard-opportunities", () => ({ loadDashboardOpportunitiesAction: action.load }));
vi.mock("@/server/actions/saved-jobs", () => ({ setJobSavedAction: saved.set }));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill; void _priority; void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

const data = (): PersonalHomeData =>
  ({
    variant: "professional",
    displayName: "Sayed Abdel-Rahman",
    accountType: "installer_technician",
    isSalesperson: false,
    phone: null,
    completeness: { percent: 100, completed: 8, total: 8, missing: [] },
    verification: { state: "verified", reason: null, decidedAt: null },
    availability: { available: false, updatedAt: null, state: "unknown" },
    consumer: { intent: null, interests: [], governorate: null, city: null, budget: null },
    professional: {
      concreteType: "installer_technician", headline: null, yearsExperience: 5, specialization: null, bio: null, services: [],
      additionalServices: [], languages: ["ar"], availability: "within_week", serviceAreas: [], offersRemote: false,
      governorate: "cairo", city: "new-cairo", maxTravelKm: null,
    },
    sales: null,
  }) as PersonalHomeData;

/** A row as the paging function returns it: the discovery columns, the saved flag and the canonical Overall Match breakdown. */
const row = (n: number, over: Partial<MatchedOpportunityRow> = {}) =>
  ({
    id: `op-${n}`, title: `Opportunity ${n}`, description: null, poster_org_id: "org-1", poster_org_name: "Horizon Contracting",
    trade_key: "tiling", governorate: "Cairo", city: "Maadi", offered_amount: 4500, offered_currency: "EGP", expected_duration_days: 3,
    starts_on: null, ends_by: null, published_at: "2026-09-01T00:00:00Z", has_applied: false, is_saved: false,
    overall_percent: 100, trade_points: 50, specialty_points: 20, location_points: 15, availability_points: 15,
    trade_reason: "trade_matches", specialty_reason: "no_specialty_required", location_reason: "same_city", availability_reason: "available_no_dates",
    ...over,
  }) as OpportunityRow;

const props = (locale: "en" | "ar" = "en", opportunities: readonly OpportunityRow[] = [row(1), row(2), row(3)]) => ({
  data: data(),
  currentWork: null,
  opportunities,
  pointsBalance: 640,
  recentPointsEntry: null,
  reviewsAverage: 4.8,
  reviewsTotal: 12,
  networkCount: 0,
  completedJobsCount: 7,
  completion: { percent: 62, missing: ["bio" as const] },
  locale,
  t: createTranslator(locale),
});

const vm = (n: number, over: Partial<InstallerOpportunityVM> = {}): InstallerOpportunityVM => ({
  ...toOpportunityVM(row(n) as never, createTranslator("en"), "en")!,
  ...over,
});

const titles = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

beforeEach(() => {
  action.load.mockReset();
});

describe("installer dashboard — SECTION ORDER is the approved preview's, top to bottom", () => {
  /** The JSX tags of a component, in the order they appear. */
  const order = (text: string, tags: readonly string[]) =>
    tags
      .map((tag) => ({ tag, at: text.indexOf(`<${tag}`) }))
      .filter((entry) => entry.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.tag);

  it("production lists the same modules in the same order as /preview/installer-dashboard", () => {
    const preview = order(read("features/installer-dashboard-preview/installer-dashboard-preview.tsx"), [
      "ProfileCompletionBanner", "InstallerWelcome", "JobOpportunitiesSection", "RewardsCard", "LearningSection", "BrandEcosystemSection", "NeedsAttentionSection",
    ]);
    const production = order(read("features/home/installer-home.tsx"), [
      "ProfileCompletionBanner", "InstallerWelcome", "InstallerHomeOpportunities", "RewardsCard", "LearningSection", "BrandEcosystemSection", "NeedsAttentionSection",
    ]).map((tag) => (tag === "InstallerHomeOpportunities" ? "JobOpportunitiesSection" : tag));
    expect(preview).toEqual(["ProfileCompletionBanner", "InstallerWelcome", "JobOpportunitiesSection", "RewardsCard", "LearningSection", "BrandEcosystemSection", "NeedsAttentionSection"]);
    expect(production).toEqual(preview);
  });

  it("and the lower module row has the preview's own column proportions", () => {
    const grid = /className="(grid min-h-0 items-stretch gap-4[^"]*)"/;
    const preview = read("features/installer-dashboard-preview/installer-dashboard-preview.tsx").match(grid)?.[1];
    const production = read("features/home/installer-home.tsx").match(grid)?.[1];
    expect(preview).toContain("desktop:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.55fr)_minmax(0,0.95fr)]");
    expect(production).toBe(preview);
  });

  it("renders the sections in that order: banner, welcome, opportunities, then points & rewards first in the lower row", () => {
    const { container } = renderWithI18n(<ProfessionalHome {...props()} />, "en");
    const at = (node: Element | null) => Array.from(container.querySelectorAll("*")).indexOf(node as Element);
    const banner = screen.getByText("Complete your profile to appear more to showrooms").closest("section, div");
    const welcome = screen.getByRole("heading", { level: 1 });
    const opportunities = container.querySelector("#opportunities");
    const lower = Array.from(container.querySelectorAll("[data-lower-module-grid] h2")).map((h) => h.textContent);
    expect(at(banner)).toBeLessThan(at(welcome));
    expect(at(welcome)).toBeLessThan(at(opportunities));
    expect(at(opportunities)).toBeLessThan(at(container.querySelector("[data-lower-module-grid]")));
    expect(lower).toEqual(["My points & rewards", "Learn & train", "From factories & brands", "Needs your action"]);
  });

  it("is the same in Arabic: نقاطي ومكافآتي leads the lower modules", () => {
    const { container } = renderWithI18n(<ProfessionalHome {...props("ar")} />, "ar");
    const lower = Array.from(container.querySelectorAll("[data-lower-module-grid] h2")).map((h) => h.textContent);
    expect(lower[0]).toBe("نقاطي ومكافآتي");
    expect(lower).toEqual(["نقاطي ومكافآتي", "تعلم وتدريب", "من المصانع والعلامات التجارية", "أعمال تحتاج إجراء"]);
  });
});

describe("installer dashboard — the card has TWO separate actions", () => {
  it("shows Details and Apply now side by side, both real links into the opening's own flow", () => {
    renderWithI18n(<ProfessionalHome {...props("en", [row(1)])} />, "en");
    const card = screen.getByText("Opportunity 1").closest("li")!;
    const details = within(card).getByRole("link", { name: "Details" });
    const apply = within(card).getByRole("link", { name: "Apply now" });
    expect(details.getAttribute("href")).toBe("/home/jobs/op-1");
    expect(apply.getAttribute("href")).toBe("/home/jobs/op-1?apply=1");
    expect(details.parentElement).toBe(apply.parentElement); // beside each other, not one merged button
    expect(within(card).queryByText(/View details and apply|عرض التفاصيل والتقديم/)).toBeNull();
  });

  it("is worded in Arabic as تفاصيل and قدّم الآن", () => {
    renderWithI18n(<ProfessionalHome {...props("ar", [row(1)])} />, "ar");
    const card = screen.getByText("Opportunity 1").closest("li")!;
    expect(within(card).getByRole("link", { name: "تفاصيل" })).toHaveAttribute("href", "/home/jobs/op-1");
    expect(within(card).getByRole("link", { name: "قدّم الآن" })).toHaveAttribute("href", "/home/jobs/op-1?apply=1");
    expect(within(card).queryByText("عرض التفاصيل والتقديم")).toBeNull();
  });

  it("never applies by itself: no Apply button exists, and following the link is what opens the real confirmation", () => {
    renderWithI18n(<ProfessionalHome {...props("en", [row(1)])} />, "en");
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Apply now" }));
    expect(screen.getByRole("link", { name: "Apply now" })).toBeTruthy(); // still a link; nothing flipped to "Applied"
    expect(screen.queryByText("Applied")).toBeNull();
  });

  it("an opening already applied to shows the honest applied state and Details — never another active Apply", () => {
    renderWithI18n(<ProfessionalHome {...props("en", [row(1, { has_applied: true })])} />, "en");
    const card = screen.getByText("Opportunity 1").closest("li")!;
    expect(within(card).getByText("You applied")).toBeTruthy();
    expect(within(card).queryByRole("link", { name: "Apply now" })).toBeNull();
    expect(within(card).getByRole("link", { name: "Details" })).toBeTruthy();
  });

  it("a NOT DECLARED availability reads 'Not specified' with a link to add it — never 0/15, never 'unavailable'", () => {
    renderWithI18n(<ProfessionalHome {...props("en", [row(1, { overall_percent: 85, availability_points: null, availability_reason: "availability_not_declared" })])} />, "en");
    fireEvent.click(screen.getByTestId("match-badge"));
    const panel = screen.getByTestId("match-breakdown");
    const line = within(panel).getByTestId("match-line-availability");
    expect(line).toHaveTextContent("Not specified");
    expect(line).not.toHaveTextContent("0/15");
    expect(line).not.toHaveTextContent(/not taking work|unavailable/i);
    expect(within(line).getByTestId("match-not-specified")).toHaveTextContent("Not specified");
    expect(within(line).getByTestId("match-add-availability")).toHaveAttribute("href", "/home/settings");
    expect(panel).toHaveTextContent(/counts only the points earned so far/);
  });

  it("shows the database's Overall Match, plain at 0 — and a 0 never hides or disables the card", () => {
    renderWithI18n(<ProfessionalHome {...props("en", [row(1, { overall_percent: 90 }), row(2, { overall_percent: 0, trade_points: 0, specialty_points: 0, location_points: 0, availability_points: 0, trade_reason: "trade_mismatch", specialty_reason: "trade_mismatch", location_reason: "outside_service_area", availability_reason: "not_available_for_work" })])} />, "en");
    const [ninety, zero] = screen.getAllByTestId("match-badge");
    expect(ninety!.textContent).toBe("Overall Match 90%");
    expect(zero!.textContent).toBe("Overall Match 0%");
    const zeroCard = screen.getByText("Opportunity 2").closest("li")!;
    expect(within(zeroCard).getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/home/jobs/op-2?apply=1");
  });

  it("shows no badge for a row that carries no match — never a guess", () => {
    const bare = { ...row(1) } as Record<string, unknown>;
    for (const key of ["overall_percent", "trade_points", "specialty_points", "location_points", "availability_points", "trade_reason", "specialty_reason", "location_reason", "availability_reason"]) delete bare[key];
    renderWithI18n(<ProfessionalHome {...props("en", [bare as unknown as OpportunityRow])} />, "en");
    expect(screen.queryByTestId("match-badge")).toBeNull();
  });

  it("the badge opens an accessible breakdown built from the database's own points and reason codes — nothing is recomputed", () => {
    renderWithI18n(
      <ProfessionalHome {...props("en", [row(1, { overall_percent: 85, trade_points: 50, specialty_points: 20, location_points: 15, availability_points: 0, availability_reason: "window_not_covering" })])} />,
      "en",
    );
    const badge = screen.getByTestId("match-badge");
    expect(badge).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(badge);
    expect(badge).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByTestId("match-breakdown");
    expect(within(panel).getByText(/Strong match/)).toBeTruthy(); // 85 -> 75..89
    expect(within(panel).getByTestId("match-line-trade")).toHaveTextContent("Trade matches");
    expect(within(panel).getByTestId("match-line-trade")).toHaveTextContent("50/50");
    expect(within(panel).getByTestId("match-line-location")).toHaveTextContent("In your city");
    expect(within(panel).getByTestId("match-line-availability")).toHaveTextContent("Your availability doesn't cover the job period");
    expect(within(panel).getByTestId("match-line-availability")).toHaveTextContent("0/15");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("match-breakdown")).toBeNull();
    expect(badge).toHaveAttribute("aria-expanded", "false");
  });

  it("is worded in Arabic: the title, the level and every reason", () => {
    renderWithI18n(<ProfessionalHome {...props("ar", [row(1, { overall_percent: 92 })])} />, "ar");
    const badge = screen.getByTestId("match-badge");
    expect(badge.textContent).toContain("نسبة التوافق");
    fireEvent.click(badge);
    const panel = screen.getByTestId("match-breakdown");
    expect(panel.textContent).toContain("توافق ممتاز");
    expect(within(panel).getByTestId("match-line-trade")).toHaveTextContent("الحرفة مناسبة");
  });
});

describe("installer dashboard — the saved heart is the REAL saved-jobs state", () => {
  beforeEach(() => {
    saved.set.mockReset();
  });

  it("is drawn on every card, pressed exactly where the database says the opening is saved", () => {
    renderWithI18n(<ProfessionalHome {...props("en", [row(1, { is_saved: true }), row(2)])} />, "en");
    const [first, second] = screen.getAllByTestId("dashboard-save");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAccessibleName("Remove from saved jobs");
    expect(second).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAccessibleName("Save opportunity");
  });

  it("saving shows the new state at once and persists it through the shared action", async () => {
    saved.set.mockResolvedValue({ ok: true });
    renderWithI18n(<ProfessionalHome {...props("en", [row(1)])} />, "en");
    fireEvent.click(screen.getByTestId("dashboard-save"));
    expect(screen.getByTestId("dashboard-save")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(saved.set).toHaveBeenCalledWith("op-1", true));
    fireEvent.click(screen.getByTestId("dashboard-save"));
    expect(screen.getByTestId("dashboard-save")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(saved.set).toHaveBeenLastCalledWith("op-1", false));
  });

  it("a failed save puts the heart back and says so — there is no dashboard-only state", async () => {
    saved.set.mockResolvedValue({ ok: false });
    renderWithI18n(<ProfessionalHome {...props("en", [row(1)])} />, "en");
    fireEvent.click(screen.getByTestId("dashboard-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not update your saved opportunities/i);
    expect(screen.getByTestId("dashboard-save")).toHaveAttribute("aria-pressed", "false");
  });

  it("a job saved here stays saved when the strip is reordered (the viewer's own tap is kept)", async () => {
    saved.set.mockResolvedValue({ ok: true });
    action.load.mockResolvedValue({ ok: true, opportunities: [vm(1, { isSaved: false }), vm(4)] });
    renderWithI18n(<ProfessionalHome {...props("en", [row(1), row(2), row(3)])} />, "en");
    fireEvent.click(screen.getAllByTestId("dashboard-save")[0]!);
    await waitFor(() => expect(saved.set).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Nearest to me" }));
    await waitFor(() => expect(titles()).toEqual(["Opportunity 1", "Opportunity 4"]));
    expect(screen.getAllByTestId("dashboard-save")[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("dashboard-save")[1]).toHaveAttribute("aria-pressed", "false");
  });
});

describe("installer dashboard — the quick filters are real database orderings", () => {
  it("offers Nearest to me, Best match and a Newest menu, with Best match active on arrival (as in the preview)", () => {
    renderWithI18n(<ProfessionalHome {...props()} />, "en");
    const group = screen.getByRole("group", { name: "Sort opportunities" });
    expect(within(group).getByRole("button", { name: "Best match" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Nearest to me" })).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: "Sort by date" })).toHaveTextContent("Newest");
  });

  it("is labelled قريب مني / مناسب لمهاراتي / الأحدث in Arabic", () => {
    renderWithI18n(<ProfessionalHome {...props("ar")} />, "ar");
    const group = screen.getByRole("group", { name: "ترتيب الفرص" });
    expect(within(group).getByRole("button", { name: "قريب مني" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "مناسب لمهاراتي" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "ترتيب حسب التاريخ" })).toHaveTextContent("الأحدث");
    expect(screen.getByRole("heading", { name: "فرص مناسبة لي" })).toBeTruthy();
  });

  it("Near me asks the SERVER for the nearest ordering and swaps the cards in; nothing is sorted in the browser", async () => {
    action.load.mockResolvedValue({ ok: true, opportunities: [vm(9), vm(8), vm(7)] });
    renderWithI18n(<ProfessionalHome {...props()} />, "en");
    expect(titles()).toEqual(["Opportunity 1", "Opportunity 2", "Opportunity 3"]);
    fireEvent.click(screen.getByRole("button", { name: "Nearest to me" }));
    expect(screen.getByRole("button", { name: "Nearest to me" })).toHaveAttribute("aria-pressed", "true"); // answers the tap at once
    await waitFor(() => expect(titles()).toEqual(["Opportunity 9", "Opportunity 8", "Opportunity 7"]));
    expect(action.load).toHaveBeenCalledWith("distance", "newest");
    expect(screen.getByRole("button", { name: "Best match" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Best match goes back to the matching ordering", async () => {
    action.load.mockResolvedValue({ ok: true, opportunities: [vm(5)] });
    renderWithI18n(<ProfessionalHome {...props()} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Nearest to me" }));
    await waitFor(() => expect(titles()).toEqual(["Opportunity 5"]));
    fireEvent.click(screen.getByRole("button", { name: "Best match" }));
    await waitFor(() => expect(action.load).toHaveBeenLastCalledWith("match", "newest")); // the UI choice; the server maps it to the `best` ordering
  });

  it("the date menu offers the two real publication orders — Newest and Oldest — and asks for them", async () => {
    action.load.mockResolvedValue({ ok: true, opportunities: [vm(3), vm(2), vm(1)] });
    renderWithI18n(<ProfessionalHome {...props()} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Sort by date" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest" }));
    await waitFor(() => expect(action.load).toHaveBeenCalledWith("recent", "oldest"));
    await waitFor(() => expect(titles()).toEqual(["Opportunity 3", "Opportunity 2", "Opportunity 1"]));
    expect(screen.getByRole("button", { name: "Sort by date" })).toHaveTextContent("Oldest");
    expect(screen.getByRole("button", { name: "Sort by date" })).toHaveClass("bg-primary");
  });

  it("choosing the filter that is already active asks for nothing", () => {
    renderWithI18n(<ProfessionalHome {...props()} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Best match" }));
    expect(action.load).not.toHaveBeenCalled();
  });

  it("a failed load keeps the cards and the previous filter, and says so", async () => {
    action.load.mockResolvedValue({ ok: false });
    renderWithI18n(<ProfessionalHome {...props()} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Nearest to me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not update the opportunities/i);
    expect(titles()).toEqual(["Opportunity 1", "Opportunity 2", "Opportunity 3"]);
    expect(screen.getByRole("button", { name: "Best match" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Nearest to me" })).toHaveAttribute("aria-pressed", "false");
  });

  it("a reply that arrives after a newer tap is ignored", async () => {
    let releaseFirst!: (value: unknown) => void;
    action.load.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }));
    action.load.mockResolvedValueOnce({ ok: true, opportunities: [vm(6)] });
    renderWithI18n(<ProfessionalHome {...props()} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Nearest to me" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by date" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest" }));
    await waitFor(() => expect(titles()).toEqual(["Opportunity 6"]));
    releaseFirst({ ok: true, opportunities: [vm(99)] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titles()).toEqual(["Opportunity 6"]);
  });

  it("the filters never remove a listed opening: every ordering lists the same discoverable set", () => {
    // The mode mapping is a pure ordering choice: all four modes read the one paging function with no filter.
    // Near me = LOCATION only, Best match = TRADE + SPECIALTY only, Newest = publication date.
    expect(["match", "distance", "recent"].map((s) => dashboardModeFor(s as never, "newest"))).toEqual(["best", "nearest", "newest"]);
    expect(dashboardModeFor("recent", "oldest")).toBe("oldest");
    expect(dashboardChoiceFor("best")).toEqual({ sort: "match", dateOrder: "newest" });
    expect(dashboardChoiceFor("nearest")).toEqual({ sort: "distance", dateOrder: "newest" });
    expect(dashboardChoiceFor("oldest")).toEqual({ sort: "recent", dateOrder: "oldest" });
  });
});
