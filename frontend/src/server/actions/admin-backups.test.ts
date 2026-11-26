import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  status: vi.fn(),
  setProduction: vi.fn(),
  saveSchedule: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/server/queries/admin-backups", () => ({ loadBackupStatus: mocks.status }));
vi.mock("@/server/backups/github", () => ({ dispatchBackupWorkflow: vi.fn() }));
vi.mock("@/server/backups/reconcile", () => ({ reconcileBackupRuns: vi.fn() }));
vi.mock("@/lib/supabase/admin-server", () => ({
  adminBackupSetProduction: mocks.setProduction,
  adminBackupSaveSchedule: mocks.saveSchedule,
  adminBackupRequest: vi.fn(),
  adminBackupMarkDispatched: vi.fn(),
}));

import { saveBackupScheduleAction, setProductionBackupAction } from "./admin-backups";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
};
const pausedUntil = new Date(Date.now() + 23.5 * 3_600_000).toISOString();
const schedule = { acceptance_schedule: "daily", version: "3", schedule_time: "01:30", schedule_weekday: "0", pause_hours: "keep" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "actor-1" });
  mocks.status.mockResolvedValue({ initialized: true, environment: "production", settings: { paused_until: pausedUntil, production_enabled: true } });
  mocks.setProduction.mockResolvedValue({ data: true, code: null, message: null });
  mocks.saveSchedule.mockResolvedValue({ data: 4, code: null, message: null });
});

describe("setProductionBackupAction", () => {
  it("switches with the verified session's actor and no password", async () => {
    expect(await setProductionBackupAction({ ok: false }, form({ enabled: "true" }))).toEqual({ ok: true, code: "backups.done.activated" });
    expect(mocks.setProduction).toHaveBeenCalledWith({ actor: "actor-1", enabled: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports switching off", async () => {
    mocks.setProduction.mockResolvedValue({ data: false, code: null, message: null });
    expect(await setProductionBackupAction({ ok: false }, form({ enabled: "false" }))).toEqual({ ok: true, code: "backups.done.deactivated" });
  });
  it("accepts only an explicit on or off", async () => {
    for (const enabled of ["yes", "", "TRUE"]) {
      expect(await setProductionBackupAction({ ok: false }, form({ enabled }))).toEqual({ ok: false, code: "backups.errors.invalid" });
    }
    expect(mocks.setProduction).not.toHaveBeenCalled();
  });
  it("refuses without a signed-in user", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await setProductionBackupAction({ ok: false }, form({ enabled: "true" }))).toEqual({ ok: false, code: "backups.errors.forbidden" });
    expect(mocks.setProduction).not.toHaveBeenCalled();
  });
  it("shows the database's refusal", async () => {
    mocks.setProduction.mockResolvedValue({ data: null, code: "42501", message: "permission" });
    expect(await setProductionBackupAction({ ok: false }, form({ enabled: "true" }))).toEqual({ ok: false, code: "backups.errors.forbidden" });
  });
});

describe("saveBackupScheduleAction", () => {
  it("saves without a password or reason, and keeps the running pause", async () => {
    expect(await saveBackupScheduleAction({ ok: false }, form(schedule))).toEqual({ ok: true, code: "backups.done.saved" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.saveSchedule).toHaveBeenCalledWith({
      actor: "actor-1", acceptanceSchedule: "daily", productionRestoreScheduleEnabled: false, expectedVersion: 3,
      config: { time: "01:30", weekday: 0, pause_hours: 24 },
    });
  });
  it("passes the restore checkbox on", async () => {
    await saveBackupScheduleAction({ ok: false }, form({ ...schedule, production_restore_schedule_enabled: "on" }));
    expect(mocks.saveSchedule.mock.calls[0]?.[0]).toMatchObject({ productionRestoreScheduleEnabled: true });
  });
  it("says the settings changed when the version is old", async () => {
    mocks.saveSchedule.mockResolvedValue({ data: null, code: "VC001", message: "changed" });
    expect(await saveBackupScheduleAction({ ok: false }, form(schedule))).toEqual({ ok: false, code: "backups.errors.stale" });
  });
});
