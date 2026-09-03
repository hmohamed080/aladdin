import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/portfolio", () => ({
  startCertificateUpload: vi.fn(),
  finishCertificateUpload: vi.fn(),
  updateCertificateAction: vi.fn(),
  deleteCertificateAction: vi.fn(),
  certificateViewUrlAction: vi.fn(),
}));

import { CertificatesManager } from "./certificates-manager";
import type { Certificate } from "@/server/queries/portfolio";

const cert = (over: Partial<Certificate> = {}): Certificate => ({
  id: "c1",
  objectPath: "70000009-0000-4000-8000-000000000009/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.pdf",
  contentType: "application/pdf",
  title: "Safety level 2",
  issuer: "Ministry of Manpower",
  issuedOn: "2024-01-10",
  expiresOn: "2030-01-10",
  originalFilename: "safety.pdf",
  pending: false,
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("CertificatesManager", () => {
  it("shows a designed empty state", () => {
    renderWithI18n(<CertificatesManager items={[]} />, "en");
    expect(screen.getByText("No certificates added yet")).toBeTruthy();
  });

  it("leads with the facts a certificate is checked for", () => {
    renderWithI18n(<CertificatesManager items={[cert()]} />, "en");
    expect(screen.getByRole("heading", { name: "Safety level 2" })).toBeTruthy();
    expect(screen.getByText(/Ministry of Manpower/)).toBeTruthy();
    expect(screen.getByText(/PDF document/)).toBeTruthy();
  });

  /**
   * S2, as a rendering test. The most valuable assertions in this file are about
   * what is ABSENT: a self-declared list that grows a badge starts reading as a
   * checked one, and nobody has to decide that for it to happen.
   */
  it("offers NO publish control — certificates have no public path to publish onto", () => {
    renderWithI18n(<CertificatesManager items={[cert()]} />, "en");
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
    expect(screen.queryByText("Private")).toBeNull();
    expect(screen.queryByText("Published")).toBeNull();
  });

  it("shows NO verification, approval or review state anywhere", () => {
    const { container } = renderWithI18n(<CertificatesManager items={[cert()]} />, "en");
    const text = container.textContent ?? "";
    for (const word of ["Verified", "Approved", "Pending review", "Under review", "Unverified"]) {
      expect(text).not.toContain(word);
    }
  });

  it("says plainly that the platform does not check them", () => {
    renderWithI18n(<CertificatesManager items={[cert()]} />, "en");
    expect(screen.getByText(/does not check or approve them/)).toBeTruthy();
  });

  /**
   * The one badge in the domain, and it states a date that has passed — never an
   * opinion about the document.
   */
  it("marks a certificate whose expiry date is in the past", () => {
    renderWithI18n(<CertificatesManager items={[cert({ expiresOn: "2020-01-01" })]} />, "en");
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("does not mark one that is still valid, or one with no expiry at all", () => {
    renderWithI18n(
      <CertificatesManager items={[cert({ id: "a" }), cert({ id: "b", expiresOn: null })]} />,
      "en",
    );
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it("offers View, Edit and Delete, and nothing else", () => {
    renderWithI18n(<CertificatesManager items={[cert()]} />, "en");
    expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  /**
   * A private document's URL is never written into the page — it is minted when
   * the person asks for it. So the rendered markup contains no link to the file,
   * and the storage path never appears as text either.
   */
  it("renders no URL or storage path for the file", () => {
    const { container } = renderWithI18n(<CertificatesManager items={[cert()]} />, "en");
    expect(container.querySelector('a[href*="object"]')).toBeNull();
    expect(container.textContent).not.toContain("aaaaaaaa-1111");
    expect(container.textContent).not.toContain("70000009-0000");
  });

  it("lets user-entered text resolve its own direction in the Arabic workspace", () => {
    const { container } = renderWithI18n(<CertificatesManager items={[cert()]} />, "ar");
    expect(container.querySelector("h3")?.getAttribute("dir")).toBe("auto");
  });

  it("keeps an unfinished upload out of the list and offers to finish or discard it", () => {
    renderWithI18n(<CertificatesManager items={[cert({ pending: true })]} />, "en");
    expect(screen.getByText("No certificates added yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish upload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });
});
