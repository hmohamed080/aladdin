import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicEngineerPortfolio } from "./public-engineer-portfolio";
import type { PublicProfile } from "@/server/queries/professional-profile";

vi.mock("@/components/layout/switchers", () => ({ LanguageSwitch: () => null, ThemeSwitch: () => null }));
const profile: PublicProfile = {
  id: "11111111-1111-4111-8111-111111111111", displayName: "Public engineer", headline: "Architecture",
  bio: "Published biography", persona: "engineer", languages: ["en"], specialization: null,
  services: [], yearsExperience: null, serviceAreas: [], availableForWork: false,
  availabilityUpdatedAt: null, tradeKeys: [], primaryTradeKey: null,
};

describe("public engineer portfolio boundary", () => {
  it("shows public identity without inventing reviews, work, verification or contact details", () => {
    render(<PublicEngineerPortfolio profile={profile} portfolio={[]} reviews={[]} locale="en" theme="light" />);
    expect(screen.getByRole("heading", { name: "Public engineer" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /reviews|projects|services/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/verified account|120|4\.8|phone|email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
  });
  it("uses only the guarded public media route for portfolio images", () => {
    render(<PublicEngineerPortfolio profile={profile} portfolio={[{ id: "public-item", title: "Published project", description: "A completed interior" }]} reviews={[]} locale="en" theme="dark" />);
    expect(screen.getByRole("img", { name: "Published project" })).toHaveAttribute("src", "/p/media/public-item");
    expect(screen.getByText("Published works")).toBeInTheDocument();
  });
  it("renders profile text literally rather than interpreting user HTML", () => {
    const bio = '<img src=x onerror="alert(1)">';
    const { container } = render(<PublicEngineerPortfolio profile={{ ...profile, bio }} portfolio={[]} reviews={[]} locale="ar" theme="light" />);
    expect(screen.getByText(bio)).toBeInTheDocument();
    expect(container.querySelector('[onerror]')).toBeNull();
  });
});
