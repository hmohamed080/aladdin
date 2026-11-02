import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ar } from "@/lib/i18n/messages/ar";

vi.mock("@/server/actions/context", () => ({ selectWorkspace: vi.fn() }));

const entries = [
  { kind: "business" as const, organizationId: "org-1", name: "Cairo Ceramics Showroom", orgType: "showroom_dealer", relationship: "owner" as never },
];

/**
 * The trigger is a TOGGLE and `aria-expanded` is its state. The end-to-end journeys rely on exactly this contract
 * (e2e/account-workspace-model.spec.ts `openToggleMenu`): they press once, after the trigger hydrated, and read
 * `aria-expanded`. A second press MUST close the menu — which is why a "press until visible" retry loop flaked
 * (a replayed pre-hydration press plus a retry press opened and then closed the menu again).
 */
describe("workspace switcher toggle contract", () => {
  it("one press opens, a second press closes, and aria-expanded follows the real state", () => {
    renderWithI18n(<WorkspaceSwitcher entries={entries} activeKey="org-1" />, "ar");
    const trigger = screen.getByRole("button", { name: ar.workspace.switch });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("workspace-menu")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("workspace-menu")).toBeTruthy();
    // The Arabic heading the Arabic RTL journey asserts on.
    expect(screen.getByText(ar.workspace.title)).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("workspace-menu")).toBeNull();
  });
});
