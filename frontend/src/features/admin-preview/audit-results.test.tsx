import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { AuditResults, type AuditRow } from "./audit-results";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/preview/audit",
  useSearchParams: () => new URLSearchParams(""),
}));

/**
 * Audit page-level horizontal overflow regression guard.
 *
 * Root cause: the desktop table lives in an `overflow-x-auto` box and contains `sr-only` labels (the caption and the
 * expand column header). `sr-only` is `position:absolute`; an absolutely positioned box is clipped by a scroll
 * container only when that container is its containing block. Without `relative` on the scroller the 1px labels
 * escaped the clip at the scrolled-out edge and widened the whole document (~52px in Preview).
 *
 * jsdom does not load Tailwind, so the guard is structural: every scroll container that holds an `sr-only` descendant
 * must itself be a positioned box. Direction-agnostic, so it runs for LTR and RTL.
 */
const row: AuditRow = {
  id: "a1",
  actor: "Actor",
  role: "Admin",
  action: "Suspended user",
  entity: "User",
  summary: "Reason",
  context: null,
  dateTime: "2026-10-01 10:00",
  detail: { target: "t", reference: null, reason: null, before: null, after: null, organization: null, rest: [] },
};

const POSITIONED = /(^|\s)(relative|absolute|fixed|sticky)(\s|$)/;

afterEach(cleanup);

describe.each([
  ["en", "ltr"],
  ["ar", "rtl"],
] as const)("AuditResults overflow containment (%s / %s)", (locale, dir) => {
  it("positions every horizontal scroll container that holds sr-only content", () => {
    const { container } = render(
      <I18nProvider locale={locale} dir={dir}>
        <AuditResults rows={[row]} />
      </I18nProvider>,
    );
    const scrollers = Array.from(container.querySelectorAll<HTMLElement>(".overflow-x-auto"));
    expect(scrollers.length).toBeGreaterThan(0);
    const withSrOnly = scrollers.filter((el) => el.querySelector(".sr-only"));
    expect(withSrOnly.length).toBeGreaterThan(0);
    for (const el of withSrOnly) {
      expect(el.className, "scroll container with sr-only descendants must be position:relative").toMatch(POSITIONED);
    }
  });

  it("keeps the wide table inside its own scroll box, never as a page-level scroller", () => {
    const { container } = render(
      <I18nProvider locale={locale} dir={dir}>
        <AuditResults rows={[row]} />
      </I18nProvider>,
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.closest(".overflow-x-auto")).not.toBeNull();
    expect(table!.closest(".overflow-hidden")).not.toBeNull();
  });
});
