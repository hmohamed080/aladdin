import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";

const setOpen = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/admin-marketplace", () => ({ setMarketplaceOpenAction: (...a: unknown[]) => setOpen(...a) }));

import { PlatformSwitch, type PlatformStatus } from "./platform-switch";

beforeEach(() => vi.clearAllMocks());

const view = (status: PlatformStatus, locale: "ar" | "en" = "en") =>
  render(
    <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <PlatformSwitch status={status} />
    </I18nProvider>,
  );

describe("PlatformSwitch", () => {
  it("closes the Marketplace only with a reason, and shows who changed it last", async () => {
    setOpen.mockResolvedValue({ ok: true, open: false });
    view({ open: true, canManage: true, lastChange: { action: "marketplace_opened", at: "2026-11-23T10:00:00Z", reason: "launch", actorName: "Dina Admin" } });
    expect(screen.getByText(/Dina Admin/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Close the Marketplace" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "maintenance" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false, "maintenance"));
    expect(refresh).toHaveBeenCalled();
  });

  it("offers reopening when closed, in Arabic", () => {
    view({ open: false, canManage: true, lastChange: null }, "ar");
    expect(screen.getByRole("button", { name: "فتح الماركت" })).toBeTruthy();
  });

  it("is read-only without the permission", () => {
    view({ open: true, canManage: false, lastChange: null });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Only a Super Admin/)).toBeTruthy();
  });

  it("shows a refusal as a message", async () => {
    setOpen.mockResolvedValue({ ok: false, code: "not_permitted" });
    view({ open: true, canManage: true, lastChange: null });
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "because" } });
    fireEvent.click(screen.getByRole("button", { name: "Close the Marketplace" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/permission/));
  });
});
