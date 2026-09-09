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
    // Singular, not "1 pending join requests" — the grammatical error the
    // plural-forms pass below exists to fix.
    expect(screen.getByText("1 pending join request")).toBeInTheDocument();
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
    // `s?`/`ns?` here because count=1 below is deliberately the SINGULAR
    // case ("1 overdue follow-up", not "-ups") — the deep-link assertion
    // should hold regardless of which plural form rendered.
    expect(screen.getByRole("link", { name: /overdue follow-ups?/ })).toHaveAttribute("href", "/b2b/follow-ups");
    expect(screen.getByRole("link", { name: /quotations? awaiting review/ })).toHaveAttribute(
      "href",
      "/b2b/quotations?view=received",
    );
    expect(screen.getByRole("link", { name: /pending join requests?/ })).toHaveAttribute("href", "/b2b/organization");
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
    // 5 falls in Arabic's "few" (3–10) category, hence the plural noun
    // "متابعات" and plural possessive "مواعيدها" — see the plural-forms
    // block below for the full one/two/few sweep.
    expect(screen.getByText(/٥ متابعات تجاوزت مواعيدها/)).toBeInTheDocument();
  });

  describe("plural-aware count wording (English one/other, Arabic zero/one/two/few/many/other)", () => {
    it("English distinguishes singular from plural for all three categories", () => {
      const { rerender } = render(
        <NeedsAttentionSection
          {...baseProps()}
          overdueFollowUpsCount={1}
          quotationsAwaitingDecisionCount={1}
          pendingJoinRequestsCount={1}
        />,
      );
      expect(screen.getByText("1 overdue follow-up")).toBeInTheDocument();
      expect(screen.getByText("1 quotation awaiting review")).toBeInTheDocument();
      expect(screen.getByText("1 pending join request")).toBeInTheDocument();

      rerender(
        <NeedsAttentionSection
          {...baseProps()}
          overdueFollowUpsCount={2}
          quotationsAwaitingDecisionCount={2}
          pendingJoinRequestsCount={2}
        />,
      );
      expect(screen.getByText("2 overdue follow-ups")).toBeInTheDocument();
      expect(screen.getByText("2 quotations awaiting review")).toBeInTheDocument();
      expect(screen.getByText("2 pending join requests")).toBeInTheDocument();
    });

    it("Arabic overdue follow-ups: one → dual → few agree grammatically, never a bare number glued to one plural noun", () => {
      const { rerender } = render(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} overdueFollowUpsCount={1} />);
      expect(screen.getByText("متابعة واحدة تجاوزت موعدها")).toBeInTheDocument();

      rerender(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} overdueFollowUpsCount={2} />);
      expect(screen.getByText("متابعتان تجاوزتا موعدهما")).toBeInTheDocument();

      rerender(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} overdueFollowUpsCount={3} />);
      expect(screen.getByText(/٣ متابعات تجاوزت مواعيدها/)).toBeInTheDocument();
    });

    it("Arabic quotations awaiting review: one → dual → few", () => {
      const { rerender } = render(
        <NeedsAttentionSection {...baseProps()} locale="ar" m={ar} quotationsAwaitingDecisionCount={1} />,
      );
      expect(screen.getByText("عرض سعر واحد ينتظر المراجعة")).toBeInTheDocument();

      rerender(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} quotationsAwaitingDecisionCount={2} />);
      expect(screen.getByText("عرضا سعر ينتظران المراجعة")).toBeInTheDocument();

      rerender(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} quotationsAwaitingDecisionCount={3} />);
      expect(screen.getByText(/٣ عروض أسعار تنتظر المراجعة/)).toBeInTheDocument();
    });

    it("Arabic pending join requests: one → dual → few", () => {
      const { rerender } = render(
        <NeedsAttentionSection {...baseProps()} locale="ar" m={ar} pendingJoinRequestsCount={1} />,
      );
      expect(screen.getByText("طلب انضمام واحد ينتظر قرارك")).toBeInTheDocument();

      rerender(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} pendingJoinRequestsCount={2} />);
      expect(screen.getByText("طلبا انضمام ينتظران قرارك")).toBeInTheDocument();

      rerender(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} pendingJoinRequestsCount={3} />);
      expect(screen.getByText(/٣ طلبات انضمام تنتظر قرارك/)).toBeInTheDocument();
    });

    it("Arabic 'many' (11–99) uses the singular counted noun, not the few-range plural", () => {
      render(<NeedsAttentionSection {...baseProps()} locale="ar" m={ar} overdueFollowUpsCount={12} />);
      expect(screen.getByText(/١٢ متابعة تجاوزت مواعيدها/)).toBeInTheDocument();
    });
  });
});
