import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import { PointsBalance } from "./points-balance";
import { PointsHistory } from "./points-history";
import { toPointsEntryViews, type PointsEntrySource } from "./view-model";

const en = createTranslator("en");
const ar = createTranslator("ar");

const entry = (over: Partial<PointsEntrySource> = {}): PointsEntrySource => ({
  id: "e1",
  event_type: "referral.organization_approved",
  points_delta: 100,
  reverses_entry_id: null,
  reason_code: null,
  organization_id: null,
  created_at: "2026-08-30T10:00:00Z",
  ...over,
});

describe("the balance", () => {
  it("shows a positive total with its unit spelled out", () => {
    renderWithI18n(<PointsBalance balance={100} locale="en" t={en} />, "en");
    expect(screen.getByRole("heading", { name: "Your Points" })).toBeTruthy();
    expect(screen.getByLabelText("100 Points")).toBeTruthy();
  });

  it("shows a NEGATIVE total faithfully, with an explanation and no clamping", () => {
    renderWithI18n(<PointsBalance balance={-40} locale="en" t={en} />, "en");
    // The accessible name carries the sign, so the state is not colour-only.
    expect(screen.getByLabelText(/[-−]40 Points/)).toBeTruthy();
    expect(screen.getByText(/below zero/i)).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("shows zero as zero, with no negative explanation", () => {
    renderWithI18n(<PointsBalance balance={0} locale="en" t={en} />, "en");
    expect(screen.getByLabelText("0 Points")).toBeTruthy();
    expect(screen.queryByText(/below zero/i)).toBeNull();
  });

  it("never calls Points money, a wallet, cash or earnings", () => {
    const { container } = renderWithI18n(<PointsBalance balance={1250} locale="en" t={en} />, "en");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/wallet|cash|money|earnings|balance due|withdraw|redeem/i);
    expect(text).not.toMatch(/EGP|\$|£|€/);
  });

  it("renders the balance in Arabic with Arabic numerals", () => {
    renderWithI18n(<PointsBalance balance={100} locale="ar" t={ar} />, "ar");
    expect(screen.getByRole("heading", { name: "نقاطك" })).toBeTruthy();
    const { container } = renderWithI18n(<PointsBalance balance={100} locale="ar" t={ar} />, "ar");
    expect(container.textContent ?? "").toMatch(/[٠-٩]/);
  });

  /* Arabic is the DEFAULT locale, so these are the renderings most Pilot users
     actually get — and until the personal Points route made this component the
     one an org-less installer reads, only the positive Arabic case was pinned. */
  it("shows a NEGATIVE total in Arabic, signed, explained and unclamped", () => {
    const { container } = renderWithI18n(<PointsBalance balance={-40} locale="ar" t={ar} />, "ar");
    const text = container.textContent ?? "";
    expect(text).toMatch(/[٠-٩]/);
    // The sign survives Arabic-Indic digits: a minus that formatted away would
    // turn a corrected balance into a credit on the reader's screen.
    expect(text).toMatch(/[-−؜]/);
    // The same explanation the English case gets, not a silent difference.
    expect(text).toContain(ar("points.balance.negativeHint"));
    expect(screen.queryByText("—")).toBeNull();
  });

  it("shows ZERO in Arabic with no negative explanation", () => {
    const { container } = renderWithI18n(<PointsBalance balance={0} locale="ar" t={ar} />, "ar");
    const text = container.textContent ?? "";
    expect(text).toMatch(/[٠-٩]/);
    expect(text).not.toContain(ar("points.balance.negativeHint"));
  });

  it("never calls Points money in Arabic either", () => {
    const { container } = renderWithI18n(<PointsBalance balance={1250} locale="ar" t={ar} />, "ar");
    const text = container.textContent ?? "";
    // محفظة (wallet) · رصيد (balance-as-money) · جنيه (pound) · استبدال (redeem)
    expect(text).not.toMatch(/محفظة|جنيه|استبدال|سحب/);
    expect(text).not.toMatch(/EGP|\$|£|€/);
  });
});

describe("the history", () => {
  it("renders an empty state with no fabricated sample activity", () => {
    const { container } = renderWithI18n(<PointsHistory entries={[]} t={en} />, "en");
    expect(screen.getByText("No Points activity yet")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.textContent ?? "").not.toMatch(/\+100/);
  });

  it("renders a referral award with its signed amount and a screen-reader sentence", () => {
    const views = toPointsEntryViews([entry()], en, "en");
    renderWithI18n(<PointsHistory entries={views} t={en} />, "en");
    expect(screen.getByText("Referral approved")).toBeTruthy();
    expect(screen.getByText("+100")).toBeTruthy();
    expect(screen.getByText("earned 100 Points")).toBeTruthy();
  });

  it("shows an award and its correction as two rows, original intact", () => {
    const views = toPointsEntryViews(
      [
        entry({ id: "rev", points_delta: -100, reverses_entry_id: "orig", reason_code: "support_correction" }),
        entry({ id: "orig" }),
      ],
      en,
      "en",
    );
    const { container } = renderWithI18n(<PointsHistory entries={views} t={en} />, "en");
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("Points correction")).toBeTruthy();
    // The original award is still there, unmodified.
    expect(within(rows[1] as HTMLElement).getByText("Referral approved")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("+100")).toBeTruthy();
  });

  it("renders an unknown future event neutrally rather than dropping it", () => {
    const views = toPointsEntryViews([entry({ event_type: "future.event" })], en, "en");
    const { container } = renderWithI18n(<PointsHistory entries={views} t={en} />, "en");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByText("Points activity")).toBeTruthy();
    expect(container.textContent ?? "").not.toContain("future.event");
  });

  it("leaks no internal identifiers into the markup", () => {
    const views = toPointsEntryViews(
      [
        entry({
          id: "11111111-1111-4111-8111-111111111111",
          event_type: "admin.adjustment",
          points_delta: -40,
          reverses_entry_id: "22222222-2222-4222-8222-222222222222",
          reason_code: "event_invalidated",
          organization_id: "33333333-3333-4333-8333-333333333333",
        }),
      ],
      en,
      "en",
    );
    const { container } = renderWithI18n(<PointsHistory entries={views} t={en} />, "en");
    const html = container.innerHTML;
    expect(html).not.toContain("22222222");
    expect(html).not.toContain("33333333");
    expect(html).not.toContain("event_invalidated");
    expect(html).not.toContain("admin.adjustment");
  });

  it("shows organization context when a name resolved, and omits it otherwise", () => {
    const withName = toPointsEntryViews(
      [entry({ organization_id: "o9" })],
      en,
      "en",
      new Map([["o9", "Zayed Tiles"]]),
    );
    renderWithI18n(<PointsHistory entries={withName} t={en} />, "en");
    expect(screen.getByText("Zayed Tiles")).toBeTruthy();
  });

  it("offers show-more only when one is passed, as a real link", () => {
    const views = toPointsEntryViews([entry()], en, "en");
    const { container } = renderWithI18n(
      <PointsHistory entries={views} t={en} moreHref="/b2b/points?show=40" />,
      "en",
    );
    const link = container.querySelector('a[href="/b2b/points?show=40"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toBe("Show more activity");
  });

  it("renders history in Arabic with no stray English", () => {
    const views = toPointsEntryViews([entry()], ar, "ar");
    const { container } = renderWithI18n(<PointsHistory entries={views} t={ar} />, "ar");
    expect(screen.getByText("تم اعتماد إحالتك")).toBeTruthy();
    expect(container.textContent ?? "").toMatch(/[٠-٩]/);
  });
});
