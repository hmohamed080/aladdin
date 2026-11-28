import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsSaveBar } from "./settings-save-bar";
import { PersonalDetailsForm } from "./personal-details-form";

const setGenderAction = vi.fn();
vi.mock("@/server/actions/profile-identity", () => ({ setGenderAction: (...args: unknown[]) => setGenderAction(...args) }));

const labels = { gender: "Gender", female: "Female", male: "Male", unspecified: "Prefer not to say", saved: "Saved.", error: "Couldn't save." };

function renderSettings() {
  render(
    <>
      <PersonalDetailsForm gender={null} labels={labels} />
      <SettingsSaveBar label="Save changes" hint="You have unsaved changes." />
    </>,
  );
}

const save = () => act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
const female = () => screen.getByRole<HTMLInputElement>("radio", { name: "Female" });

describe("engineer settings save bar", () => {
  beforeEach(() => setGenderAction.mockReset());

  it("stays unsaved, keeping the choice, when the save fails", async () => {
    setGenderAction.mockResolvedValue({ ok: false, code: "error" });
    renderSettings();
    fireEvent.click(female());
    await save();
    await waitFor(() => expect(screen.getByText("Couldn't save.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(female().checked).toBe(true);
  });

  it("clears only after the form reports success, and the saved choice is the new baseline", async () => {
    setGenderAction.mockResolvedValue({ ok: true });
    renderSettings();
    fireEvent.click(female());
    await save();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull());
    expect(female().checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    fireEvent.click(female());
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});
