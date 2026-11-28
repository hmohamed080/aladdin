import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render";
import { LegalDocumentView } from "./legal-document";
import { PRIVACY_CONTACT_EMAIL, legalDocument } from "./content";

describe("published legal documents", () => {
  it.each(["en", "ar"] as const)("renders the full %s Privacy Policy with the contact email and a link to deletion", (locale) => {
    const doc = legalDocument("privacy", locale);
    renderWithI18n(<LegalDocumentView documentKey="privacy" />, locale);
    expect(screen.getByRole("heading", { level: 1, name: doc.title })).toBeInTheDocument();
    for (const section of doc.sections) expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(PRIVACY_CONTACT_EMAIL)).length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/legal/data-deletion"]')).toBeInTheDocument();
    expect(screen.queryByText(/placeholder|مؤقت/)).not.toBeInTheDocument();
  });

  it.each(["en", "ar"] as const)("renders the %s Data Deletion Instructions with numbered steps and a link back to privacy", (locale) => {
    const doc = legalDocument("dataDeletion", locale);
    renderWithI18n(<LegalDocumentView documentKey="dataDeletion" />, locale);
    expect(screen.getByRole("heading", { level: 1, name: doc.title })).toBeInTheDocument();
    expect(document.querySelectorAll("ol.list-decimal li").length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(PRIVACY_CONTACT_EMAIL)).length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/legal/privacy"]')).toBeInTheDocument();
  });

  it.each(["en", "ar"] as const)("renders the full %s Terms of Service with the contact email and a link to privacy", (locale) => {
    const doc = legalDocument("terms", locale);
    renderWithI18n(<LegalDocumentView documentKey="terms" />, locale);
    expect(screen.getByRole("heading", { level: 1, name: doc.title })).toBeInTheDocument();
    for (const section of doc.sections) expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(PRIVACY_CONTACT_EMAIL)).length).toBeGreaterThan(0);
    expect(document.querySelector('time[datetime="2026-11-10"]')).toBeInTheDocument();
    expect(document.querySelector('a[href="/legal/privacy"]')).toBeInTheDocument();
  });

  it("uses the monitored info inbox", () => {
    expect(PRIVACY_CONTACT_EMAIL).toBe("info@aladdindecore.com");
  });
});
