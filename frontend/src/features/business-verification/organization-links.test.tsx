import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import { OrganizationLinks } from "./organization-links";

const t = createTranslator("en");
const none = { facebookUrl: null, instagramUrl: null, tiktokUrl: null, websiteUrl: null };

describe("OrganizationLinks", () => {
  it("renders each valid https link as a safe anchor with an unverified label", () => {
    renderWithI18n(
      <OrganizationLinks
        links={{ ...none, facebookUrl: "https://www.facebook.com/showroom1", websiteUrl: "https://show.example.com" }}
      t={t} />,
      "en",
    );
    const a = screen.getByRole("link", { name: "https://show.example.com" });
    expect(a.getAttribute("href")).toBe("https://show.example.com");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(a.getAttribute("dir")).toBe("ltr");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByText("Unverified").length).toBeGreaterThan(0);
    // The website label is translated; brand names are not.
    expect(screen.getByText("Website")).toBeTruthy();
    expect(screen.queryByText("Web")).toBeNull();
    expect(screen.getByText("Facebook")).toBeTruthy();
  });

  it("labels the website link in Arabic", () => {
    renderWithI18n(<OrganizationLinks links={{ ...none, websiteUrl: "https://show.example.com" }} t={createTranslator("ar")} />, "ar");
    expect(screen.getByText("الموقع الإلكتروني")).toBeTruthy();
  });

  it("renders nothing when there are no links", () => {
    const { container } = renderWithI18n(<OrganizationLinks links={none} t={t} />, "en");
    expect(container.textContent).toBe("");
  });

  it("renders a non-https or invalid stored value as inert text", () => {
    renderWithI18n(<OrganizationLinks links={{ ...none, websiteUrl: "javascript:alert(1)", instagramUrl: "http://www.instagram.com/x" }} t={t} />, "en");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
  });
});
