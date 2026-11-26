import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { I18nProvider } from "@/lib/i18n/provider";
import type { BackupSettings } from "@/server/queries/admin-backups";
import { BackupScheduleForm } from "./backup-schedule-form";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/admin-backups", () => ({ saveBackupScheduleAction: save }));
const t = createTranslator("en");
beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue({ ok: true, code: "backups.done.saved" });
});

const settings = (over: Partial<BackupSettings> = {}): BackupSettings => ({
  acceptance_schedule: "daily",
  production_enabled: true,
  production_restore_schedule_enabled: true,
  schedule_time: "01:30:00",
  schedule_weekday: 4,
  paused_until: null,
  version: 3,
  updated_at: null,
  updated_by: null,
  ...over,
});

const draw = (value: BackupSettings) =>
  render(
    <I18nProvider locale="en" dir="ltr">
      <BackupScheduleForm environment="production" settings={value} canManage />
    </I18nProvider>,
  );

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;

afterEach(cleanup);

describe("BackupScheduleForm", () => {
  it("hides the weekday for a daily schedule but still submits the saved one", () => {
    draw(settings());
    expect(document.getElementById("backup-weekday")).toBeNull();
    expect(field("schedule_weekday").value).toBe("4");
  });

  it("asks for the weekday on a weekly schedule", () => {
    draw(settings({ acceptance_schedule: "weekly" }));
    expect(document.getElementById("backup-weekday")).not.toBeNull();
  });

  it("keeps a running pause by default", () => {
    draw(settings({ paused_until: new Date(Date.now() + 5 * 3_600_000).toISOString() }));
    expect(field("pause_hours").value).toBe("keep");
  });

  it("offers nothing to keep when there is no running pause", () => {
    draw(settings({ paused_until: "2020-01-01T00:00:00Z" }));
    expect(field("pause_hours").value).toBe("0");
  });

  it("asks for no password, reason or phrase", () => {
    draw(settings());
    expect(document.querySelectorAll('[name="password"], [name="reason"], [name="confirmation"]').length).toBe(0);
  });

  const choose = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
  const saveButton = () => screen.getByRole("button", { name: t("backups.schedule.save") });

  it("saves a time change at once", async () => {
    draw(settings());
    choose("schedule_time", "03:15");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("backup-schedule-confirm-stop")).toBeNull();
  });

  it("asks before switching the schedule off, and cancelling saves nothing and keeps the choice on screen", () => {
    draw(settings());
    choose("acceptance_schedule", "off");
    fireEvent.click(saveButton());
    expect(screen.getByTestId("backup-schedule-confirm-stop")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    expect(screen.queryByTestId("backup-schedule-confirm-stop")).toBeNull();
    expect(field("acceptance_schedule").value).toBe("off");
    expect(save).not.toHaveBeenCalled();
  });

  it("saves once the stop is confirmed", async () => {
    draw(settings());
    choose("pause_hours", "24");
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole("button", { name: t("backups.schedule.confirmStop") }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0]?.[1] as FormData).get("pause_hours")).toBe("24");
  });

  it("never lets the Enter key answer yes: the form's default button asks again", () => {
    draw(settings());
    choose("acceptance_schedule", "off");
    fireEvent.click(saveButton());
    const form = screen.getByTestId("backup-schedule-form") as HTMLFormElement;
    // Enter in a field presses the form's default button: the first submit button in the document.
    const defaultButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(defaultButton.textContent).not.toContain(t("backups.schedule.confirmStop"));
    fireEvent.click(defaultButton);
    expect(screen.getByTestId("backup-schedule-confirm-stop")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("moves focus to the question, not to the yes button, and back to Save on cancel", () => {
    draw(settings());
    choose("acceptance_schedule", "off");
    saveButton().focus();
    fireEvent.click(saveButton());
    expect(document.activeElement).toBe(screen.getByTestId("backup-schedule-confirm-stop"));
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    expect(document.activeElement).toBe(saveButton());
  });

  it("withdraws the question when the form changes, so the answer is about what is on screen", () => {
    draw(settings());
    choose("pause_hours", "24");
    fireEvent.click(saveButton());
    choose("pause_hours", "72");
    expect(screen.queryByTestId("backup-schedule-confirm-stop")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
