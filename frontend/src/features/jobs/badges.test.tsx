import { describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render";
import { JobStatusBadge, ApplicationStatusBadge, AssignmentStatusBadge } from "./badges";

/**
 * The status layer, pinned in both locales.
 *
 * §16's whole requirement is that a lifecycle value never reaches a reader as
 * itself. That fails in two different ways and both are checked: printing the
 * raw enum (`draft`, `in_progress`), and printing the message PATH when a key is
 * missing — which is what `t()` returns and what shipped to a public page one
 * increment ago.
 */

const JOB = ["draft", "open", "awarded", "completed", "closed", "cancelled"] as const;
const APPLICATION = ["submitted", "accepted", "rejected", "withdrawn"] as const;
const ASSIGNMENT = ["scheduled", "in_progress", "completed", "cancelled"] as const;

describe("Jobs status badges", () => {
  it("labels every job status in both locales, with no key path", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const s of JOB) {
        const { container, unmount } = renderWithI18n(<JobStatusBadge status={s} />, locale);
        expect(container.textContent, `${s} ${locale}`).not.toMatch(/^jobs\./);
        expect(container.textContent?.trim().length).toBeGreaterThan(0);
        unmount();
      }
    }
  });

  it("labels every application status in both locales", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const s of APPLICATION) {
        const { container, unmount } = renderWithI18n(
          <ApplicationStatusBadge status={s} />,
          locale,
        );
        expect(container.textContent, `${s} ${locale}`).not.toMatch(/^jobs\./);
        unmount();
      }
    }
  });

  it("labels every assignment status in both locales", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const s of ASSIGNMENT) {
        const { container, unmount } = renderWithI18n(<AssignmentStatusBadge status={s} />, locale);
        expect(container.textContent, `${s} ${locale}`).not.toMatch(/^jobs\./);
        unmount();
      }
    }
  });

  /**
   * `in_progress` is the one value whose raw form would read as almost-English
   * and therefore survive review. It must not appear.
   */
  it("never prints a raw snake_case enum", () => {
    const { container } = renderWithI18n(<AssignmentStatusBadge status="in_progress" />, "en");
    expect(container.textContent).toBe("In progress");
    expect(container.textContent).not.toContain("in_progress");
  });

  it("gives Arabic its own words rather than falling through to English", () => {
    const en = renderWithI18n(<JobStatusBadge status="awarded" />, "en");
    const enText = en.container.textContent;
    en.unmount();
    const ar = renderWithI18n(<JobStatusBadge status="awarded" />, "ar");
    expect(ar.container.textContent).not.toBe(enText);
    expect(ar.container.textContent).toBe("تم الإسناد");
  });

  /** An unknown value still renders, and still never shows a path. */
  it("degrades safely on a status the enum does not have", () => {
    const { container } = renderWithI18n(<JobStatusBadge status="not_a_status" />, "en");
    expect(container.textContent).not.toBe("");
  });
});
