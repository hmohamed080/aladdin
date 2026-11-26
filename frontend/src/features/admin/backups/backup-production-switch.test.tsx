import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { createTranslator } from "@/lib/i18n/translate";
import { BackupProductionSwitch } from "./backup-production-switch";
import { BackupRunDialog } from "./backup-run-dialog";

const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/server/actions/admin-backups", () => ({
  setProductionBackupAction: mocks.set,
  requestBackupAction: vi.fn(),
  refreshBackupRunsAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const t = createTranslator("en");
const draw = (node: React.ReactElement) => render(<I18nProvider locale="en" dir="ltr">{node}</I18nProvider>);
const toggle = () => screen.getByRole("switch");
const secretFields = () => document.querySelectorAll('[name="password"], [name="reason"], [name="confirmation"]').length;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.set.mockResolvedValue({ ok: true, code: "backups.done.activated" });
});
afterEach(cleanup);

describe("BackupProductionSwitch", () => {
  it("shows the saved state", () => {
    draw(<BackupProductionSwitch enabled canManage />);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    cleanup();
    draw(<BackupProductionSwitch enabled={false} canManage />);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });
  it("turns on at once, with no dialog and nothing to type", async () => {
    draw(<BackupProductionSwitch enabled={false} canManage />);
    expect(secretFields()).toBe(0);
    fireEvent.click(toggle());
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    expect((mocks.set.mock.calls[0]?.[1] as FormData).get("enabled")).toBe("true");
  });
  it("asks before turning off, and cancelling changes nothing", () => {
    draw(<BackupProductionSwitch enabled canManage />);
    fireEvent.click(toggle());
    const dialog = screen.getByRole("dialog");
    expect(secretFields()).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });
  it("turns off once confirmed", async () => {
    draw(<BackupProductionSwitch enabled canManage />);
    fireEvent.click(toggle());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("backups.activation.turnOff") }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    expect((mocks.set.mock.calls[0]?.[1] as FormData).get("enabled")).toBe("false");
  });
  it("is disabled for someone who can only view", () => {
    draw(<BackupProductionSwitch enabled={false} canManage={false} />);
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle());
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("manual runs", () => {
  it("still ask for the password, the reason and the Production phrase", () => {
    draw(<BackupRunDialog kind="backup" environment="production" productionEnabled canRun />);
    fireEvent.click(screen.getByRole("button", { name: t("backups.run.backup") }));
    for (const name of ["password", "reason", "confirmation"]) expect(document.querySelector(`[name="${name}"]`), name).not.toBeNull();
  });
});
