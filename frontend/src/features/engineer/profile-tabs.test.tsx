import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProfileTabs } from "./profile-tabs";

const panels = [
  { id: "overview", label: "Overview", content: <p>About the engineer</p> },
  { id: "projects", label: "Projects", content: <p>Project collection</p> },
  { id: "reviews", label: "Reviews", content: <p>Customer feedback</p> },
];

describe("profile tabs", () => {
  it("shows only the chosen section and updates the active tab", () => {
    render(<ProfileTabs locale="en" panels={panels} />);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByText("Project collection")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Project collection");
    expect(screen.queryByText("About the engineer")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
  });
  it.each(["en", "ar"] as const)("supports directional keyboard selection in %s", (locale) => {
    render(<ProfileTabs locale={locale} panels={panels} />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    fireEvent.keyDown(overview, { key: locale === "ar" ? "ArrowLeft" : "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Project collection");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Projects" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Reviews" })).toHaveFocus();
  });
});
