import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EngineerProfileCompletion } from "./profile-completion";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useI18n: () => ({ locale: "en" }) }));

function renderWorkspace(completion: { percent: number; missing: [] } | null = { percent: 40, missing: [] }) {
  render(<EngineerProfileCompletion name="Nadia Salem" avatar={null} completion={completion} panels={[
    <input key="name" aria-label="Display name" defaultValue="Nadia" />,
    <p key="experience">Experience editor</p>, <p key="availability">Availability editor</p>, <p key="portfolio">Portfolio editor</p>,
  ]} />);
}

describe("engineer profile completion", () => {
  beforeEach(() => window.history.replaceState(null, "", "/home/profile/complete"));
  it("restores the selected step after remount", () => {
    window.history.replaceState(null, "", "/home/profile/complete?step=2");
    renderWorkspace();
    expect(screen.getByText("Availability editor")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Display name" })).toBeNull();
  });
  it("shows one step and keeps unfinished edits while moving between steps", () => {
    renderWorkspace();
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), { target: { value: "Nadia Salem" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Experience editor")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Display name" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue("Nadia Salem");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });
  it("allows direct access to work history without marking the profile complete", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /4 Work history/ }));
    expect(screen.getByText("Portfolio editor")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to my profile" })).toHaveAttribute("href", "/home/profile");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });
  it("keeps editing available when the completion read is unavailable", () => {
    renderWorkspace(null);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Display name" })).toBeVisible();
    expect(screen.getByText(/Completion is unavailable/)).toBeVisible();
  });
});
