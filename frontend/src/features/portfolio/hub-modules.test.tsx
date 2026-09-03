import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import { CertificatesModule, PortfolioModule } from "./hub-modules";
import type { ProfessionalAssetSummary } from "@/server/queries/portfolio";

const t = createTranslator("en");

const summary = (over: Partial<ProfessionalAssetSummary> = {}): ProfessionalAssetSummary => ({
  portfolioTotal: 0,
  portfolioPublished: 0,
  portfolioPrivate: 0,
  portfolioUnfinished: 0,
  certificateTotal: 0,
  certificatesExpired: 0,
  certificateTitles: [],
  previewItemId: null,
  ...over,
});

describe("PortfolioModule", () => {
  it("reads honest zeros on a new account rather than hiding itself", () => {
    renderWithI18n(<PortfolioModule summary={summary()} publicItemId={null} t={t} />, "en");
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("nothing added yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage my work" })).toBeTruthy();
  });

  it("splits the count into published and private, which is the fact the page is for", () => {
    renderWithI18n(
      <PortfolioModule
        summary={summary({ portfolioTotal: 5, portfolioPublished: 2, portfolioPrivate: 3 })}
        publicItemId={null}
        t={t}
      />,
      "en",
    );
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("2 published · 3 private")).toBeTruthy();
  });

  /**
   * The preview points at `/p/media/<id>`, which serves only PUBLISHED work — so
   * the hub cannot show a private photograph even by accident. It is rendered
   * only when a published item exists, and never falls back to a private one.
   */
  it("shows a preview only for a published item, through the public media route", () => {
    const { container } = renderWithI18n(
      <PortfolioModule summary={summary({ portfolioTotal: 1 })} publicItemId="pub-1" t={t} />,
      "en",
    );
    expect(container.querySelector('img[src="/p/media/pub-1"]')).toBeTruthy();
  });

  it("shows no preview at all when nothing is published", () => {
    const { container } = renderWithI18n(
      <PortfolioModule
        summary={summary({ portfolioTotal: 3, portfolioPrivate: 3 })}
        publicItemId={null}
        t={t}
      />,
      "en",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("surfaces an unfinished upload, since it is the one thing needing attention", () => {
    renderWithI18n(
      <PortfolioModule summary={summary({ portfolioUnfinished: 1 })} publicItemId={null} t={t} />,
      "en",
    );
    expect(screen.getByText("1 upload did not finish")).toBeTruthy();
  });

  it("says nothing about unfinished uploads when there are none", () => {
    renderWithI18n(<PortfolioModule summary={summary()} publicItemId={null} t={t} />, "en");
    expect(screen.queryByText(/did not finish/)).toBeNull();
  });
});

describe("CertificatesModule", () => {
  it("counts what is held and repeats that it is private", () => {
    renderWithI18n(<CertificatesModule summary={summary({ certificateTotal: 3 })} t={t} />, "en");
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(/Never shown on your public profile/)).toBeTruthy();
  });

  /**
   * There is no verified count to show because no such fact exists (S2), and a
   * reassuring number here is exactly how a self-declared list starts reading as
   * a checked one.
   */
  it("shows no verified, approved or pending count", () => {
    const { container } = renderWithI18n(
      <CertificatesModule summary={summary({ certificateTotal: 3 })} t={t} />,
      "en",
    );
    const text = container.textContent ?? "";
    for (const word of ["Verified", "Approved", "Pending", "Under review"]) {
      expect(text).not.toContain(word);
    }
  });

  it("flags expiry, which is arithmetic on the holder's own date", () => {
    renderWithI18n(
      <CertificatesModule summary={summary({ certificateTotal: 3, certificatesExpired: 1 })} t={t} />,
      "en",
    );
    expect(screen.getByText("1 has expired")).toBeTruthy();
  });
});

/**
 * The certificate names on the hub card.
 *
 * The reference account overview fills this card with a row of labels, and these
 * are the honest version of that: the person's own titles. The visual review
 * found the card noticeably emptier than the portfolio card beside it — a real
 * composition problem, since a grid stretches both to the same height.
 */
describe("CertificatesModule labels", () => {
  it("lists the certificate names it was given", () => {
    renderWithI18n(
      <CertificatesModule
        summary={summary({
          certificateTotal: 2,
          certificateTitles: ["Occupational Safety Level 2", "Scaffolding"],
        })}
        t={t}
      />,
      "en",
    );
    expect(screen.getByText("Occupational Safety Level 2")).toBeTruthy();
    expect(screen.getByText("Scaffolding")).toBeTruthy();
  });

  it("renders no label row when there is nothing to label", () => {
    renderWithI18n(<CertificatesModule summary={summary()} t={t} />, "en");
    expect(screen.queryByText("Occupational Safety Level 2")).toBeNull();
  });
});
