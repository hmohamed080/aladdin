import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeedsAttentionSection } from "./needs-attention";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * `NeedsAttentionSection` is now a category-level SUMMARY (three counts, up
 * to three cards) rather than a record-level list — see the component's own
 * doc comment for why the props are plain numbers, never arrays of records.
 * No `dir="auto"`/`line-clamp` coverage here anymore: this component no
 * longer renders any user-generated text (a title, a name) at all, so the
 * bidi fix from the previous pass has nothing left to protect INSIDE this
 * component — it stays relevant wherever such content is still shown
 * (verified separately, unaffected by this change).
 */
function baseProps() {
  return {
    overdueFollowUpsCount: 0,
    quotationsAwaitingDecisionCount: 0,
    pendingJoinRequestsCount: 0,
    canSeeOverdueFollowUps: true,
    canSeeQuotations: true,
    canSeeJoinRequests: true,
    locale: "en" as const,
    m: en,
  };
}

describe("NeedsAttentionSection", () => {
  it("shows the shared empty state when every authorized category is zero", () => {
    render(<NeedsAttentionSection {...baseProps()} />);
    expect(screen.getByText(en.home.needsAttention.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("renders all three cards with real counts and action-oriented titles when every category is authorized and non-zero", () => {
    render(
      <NeedsAttentionSection
        {...baseProps()}
        overdueFollowUpsCount={5}
        quotationsAwaitingDecisionCount={3}
        pendingJoinRequestsCount={1}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByText("5 overdue follow-ups")).toBeInTheDocument();
    expect(screen.getByText("3 quotations awaiting review")).toBeInTheDocument();
    expect(screen.getByText("1 pending join requests")).toBeInTheDocument();
    // The body/explanatory line survives beside the title.
    expect(screen.getByText(en.home.needsAttention.overdueFollowUpsBody)).toBeInTheDocument();
  });

  it("never shows a category the caller is unauthorized for, even with a nonzero count — omission, not a zero", () => {
    render(
      <NeedsAttentionSection
        {...baseProps()}
        pendingJoinRequestsCount={4}
        canSeeJoinRequests={false}
        overdueFollowUpsCount={2}
      />,
    );
    expect(screen.queryByText(/join request/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("an authorized category with a zero count is omitted, not shown as a hollow card", () => {
    render(<NeedsAttentionSection {...baseProps()} overdueFollowUpsCount={2} quotationsAwaitingDecisionCount={0} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText(/quotation/i)).not.toBeInTheDocument();
  });

  it("reflows to two cards when exactly two categories are authorized and non-zero", () => {
    render(
      <NeedsAttentionSection
        {...baseProps()}
        overdueFollowUpsCount={2}
        quotationsAwaitingDecisionCount={3}
        pendingJoinRequestsCount={0}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("reflows to a single card when only one category is authorized and non-zero", () => {
    render(<NeedsAttentionSection {...baseProps()} quotationsAwaitingDecisionCount={7} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(screen.getByText("7 quotations awaiting review")).toBeInTheDocument();
  });

  it("deep-links each category to its own real, supported destination", () => {
    render(
      <NeedsAttentionSection
        {...baseProps()}
        overdueFollowUpsCount={1}
        quotationsAwaitingDecisionCount={1}
        pendingJoinRequestsCount={1}
      />,
    );
    expect(screen.getByRole("link", { name: /overdue follow-ups/ })).toHaveAttribute("href", "/b2b/follow-ups");
    expect(screen.getByRole("link", { name: /quotations awaiting review/ })).toHaveAttribute(
      "href",
      "/b2b/quotations?view=received",
    );
    expect(screen.getByRole("link", { name: /pending join requests/ })).toHaveAttribute("href", "/b2b/organization");
  });

  it("never renders a mutation control — every card is a plain deep-link, not a form", () => {
    render(
      <NeedsAttentionSection
        {...baseProps()}
        overdueFollowUpsCount={1}
        quotationsAwaitingDecisionCount={1}
        pendingJoinRequestsCount={1}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
  });

  it("renders the real Arabic catalog with the count formatted for that locale", () => {
    render(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} overdueFollowUpsCount={5} />);
    // formatCount renders Arabic-Indic digits for locale="ar" — proves the
    // count is genuinely locale-aware, not hardcoded to Latin digits — and
    // the surrounding label comes from the real ar.ts catalog, not en.ts.
    expect(screen.getByText(/٥ متابعات تجاوزت موعدها/)).toBeInTheDocument();
  });
});
