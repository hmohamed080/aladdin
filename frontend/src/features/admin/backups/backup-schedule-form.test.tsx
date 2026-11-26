import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { BackupSettings } from "@/server/queries/admin-backups";
import { BackupScheduleForm } from "./backup-schedule-form";

vi.mock("@/server/actions/admin-backups", () => ({ saveBackupScheduleAction: vi.fn() }));

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

  it("gives a password manager its own login field instead of the confirmation phrase", () => {
    draw(settings());
    expect(field("username").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByPlaceholderText("change production schedule").getAttribute("autocomplete")).toBe("off");
  });
});
