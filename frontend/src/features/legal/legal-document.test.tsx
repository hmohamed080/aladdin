import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render";
import { LegalDocumentView, headingText, sectionSummary } from "./legal-document";
import { PRIVACY_CONTACT_EMAIL, legalDocument } from "./content";

describe("published legal documents", () => {
  it.each(["en", "ar"] as const)("renders the full %s Privacy Policy with the contact email and a link to deletion", (locale) => {
    const doc = legalDocument("privacy", locale);
    renderWithI18n(<LegalDocumentView documentKey="privacy" />, locale);
    expect(screen.getByRole("heading", { level: 1, name: doc.title })).toBeInTheDocument();
    // every section is its own collapsible item, headed by its title (the page adds the 01, 02 … numbering)
    for (const section of doc.sections) expect(screen.getAllByRole("heading", { level: 2, name: (name) => name.includes(headingText(section.heading)) }).length).toBeGreaterThan(0);
    expect(document.querySelectorAll("main details")).toHaveLength(doc.sections.length);
    expect(screen.getAllByText(new RegExp(PRIVACY_CONTACT_EMAIL)).length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/legal/data-deletion"]')).toBeInTheDocument();
    expect(screen.queryByText(/placeholder|مؤقت/)).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it.each(["en", "ar"] as const)("renders the %s Data Deletion Instructions with numbered steps and a link back to privacy", (locale) => {
    const doc = legalDocument("dataDeletion", locale);
    renderWithI18n(<LegalDocumentView documentKey="dataDeletion" />, locale);
    expect(screen.getByRole("heading", { level: 1, name: doc.title })).toBeInTheDocument();
    // the three request steps, then a card for each topic
    const request = doc.sections.find((s) => s.id === "request")!;
    const steps = request.blocks.find((b) => b.kind === "steps");
    expect(steps && steps.kind === "steps" ? steps.items.length : 0).toBe(3);
    expect(document.querySelectorAll("ol li").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(new RegExp(PRIVACY_CONTACT_EMAIL)).length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/legal/privacy"]')).toBeInTheDocument();
    expect(document.querySelectorAll("main details")).toHaveLength(0);
  });

  it.each(["en", "ar"] as const)("renders the %s Terms of Service in the approved layout, with the contact email and a link to privacy", (locale) => {
    const doc = legalDocument("terms", locale);
    renderWithI18n(<LegalDocumentView documentKey="terms" />, locale);
    expect(screen.getByRole("heading", { level: 1, name: doc.title })).toBeInTheDocument();
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(document.querySelectorAll("main details")).toHaveLength(doc.sections.length);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(PRIVACY_CONTACT_EMAIL)).length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/legal/privacy"]')).toBeInTheDocument();
  });

  it("shows the document's own update date", () => {
    renderWithI18n(<LegalDocumentView documentKey="terms" />, "en");
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-10-18");
  });

  it("uses the monitored info inbox", () => {
    expect(PRIVACY_CONTACT_EMAIL).toBe("info@aladdindecore.com");
  });
});

describe("section helpers", () => {
  it("drops the leading number of a heading in either numeral system", () => {
    expect(headingText("1. Who we are")).toBe("Who we are");
    expect(headingText("١٤. تواصل معنا")).toBe("تواصل معنا");
    expect(headingText("Cookies")).toBe("Cookies");
  });

  it("summarizes a section by its own first sentence, never by new text", () => {
    const doc = legalDocument("terms", "en");
    for (const section of doc.sections) {
      const first = section.blocks[0]!;
      const source = first.kind === "p" ? first.text : first.items[0]!;
      expect(source.startsWith(sectionSummary(section).replace(/…$/, ""))).toBe(true);
    }
    const privacy = legalDocument("privacy", "en");
    expect(sectionSummary(privacy.sections[0]!).length).toBeLessThanOrEqual(170);
  });
});
