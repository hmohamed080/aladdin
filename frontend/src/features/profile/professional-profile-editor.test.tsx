import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import type { ProfessionalAnswers } from "@/server/queries/onboarding";

/**
 * The editor's client contract, and above all the REGRESSION it exists to hold.
 *
 * The editor shipped with a read-only fallback: when the caller had no
 * `onboarding_progress.selected_track = 'professional'`, it rendered an
 * explanation instead of a form, because `individual_save_professional` would
 * have refused the write. No seeded or Admin-upgraded professional has that
 * track — which is every professional in the Pilot — so the fallback WAS the
 * experience, not the edge case.
 *
 * `20260831090003` made the database ask about the professional IDENTITY instead
 * (canonical or declared, proven by pgTAP 39), and the fallback was removed. These
 * tests pin what replaced it: one guard, on the page, and a form for every
 * professional who reaches it.
 */
type Input = Record<string, unknown>;
type ActionState = { ok: boolean; code?: string };
const saveProfessional = vi.fn<(input: Input) => Promise<ActionState>>();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("@/server/actions/individual-onboarding", () => ({
  saveProfessional: (input: Input) => saveProfessional(input),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { ProfessionalProfileEditor } from "./professional-profile-editor";

/** A seeded Pilot installer: canonical persona, and NO onboarding track. */
const answers: ProfessionalAnswers = {
  concreteType: "installer_technician",
  headline: "Finishing specialist",
  yearsExperience: 12,
  specialization: "gypsum_paint",
  bio: "Twelve years of interior finishing.",
  services: ["finishing"],
  additionalServices: [],
  languages: ["arabic"],
  availability: "flexible",
  serviceAreas: ["nasr_city"],
  offersRemote: false,
  governorate: "cairo",
  city: "nasr_city",
  maxTravelKm: null,
  completedAt: null,
};

beforeEach(() => {
  saveProfessional.mockClear();
  saveProfessional.mockResolvedValue({ ok: true });
  push.mockClear();
  refresh.mockClear();
});

describe("ProfessionalProfileEditor", () => {
  it("renders an editable form — the read-only fallback is gone", () => {
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "en",
    );
    expect(screen.getByTestId("profile-editor")).toBeTruthy();
    // The locked panel had its own testid; nothing may render it any more.
    expect(screen.queryByTestId("profile-editor-locked")).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("hydrates from the stored profile rather than starting empty", () => {
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "en",
    );
    expect((screen.getByLabelText(/headline/i) as HTMLInputElement).value).toBe("Finishing specialist");
    expect((screen.getByLabelText(/years of experience/i) as HTMLInputElement).value).toBe("12");
  });

  it("shows the persona as a fixed badge, never as an editable field", () => {
    // Changing what kind of professional you are is the upgrade workflow's
    // decision; a select here would let someone rewrite a reviewed claim.
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "en",
    );
    expect(screen.getByText("Installer / Technician")).toBeTruthy();
    expect(screen.queryByLabelText(/profession/i)).toBeNull();
  });

  it("saves the edits and sends NO user id", async () => {
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "en",
    );

    fireEvent.change(screen.getByLabelText(/headline/i), { target: { value: "Gypsum and paint expert" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => expect(saveProfessional).toHaveBeenCalledTimes(1));
    const sent = saveProfessional.mock.calls[0]![0]!;
    expect(sent.headline).toBe("Gypsum and paint expert");
    expect(sent.concreteType).toBe("installer_technician");
    // Ownership is the database's, derived from auth.uid(). A user id in this
    // payload would be the beginning of a way to edit someone else's profile.
    for (const key of ["userId", "user_id", "p_user_id", "id"]) {
      expect(sent[key]).toBeUndefined();
    }
  });

  it("carries the untouched city through instead of erasing it", () => {
    // The professional flow never collects a base city, but the column exists and
    // may hold one. An edit of the headline must not silently clear it.
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "en",
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    return waitFor(() => {
      expect(saveProfessional.mock.calls[0]![0]!.city).toBe("nasr_city");
    });
  });

  it("returns to the hub on success, so what is shown is what was stored", async () => {
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "en",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/home/profile"));
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces a failed save instead of pretending it worked", async () => {
    saveProfessional.mockResolvedValueOnce({ ok: false, code: "onboarding.error.saveFailed" });
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "en",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // And it does NOT navigate away from the unsaved work.
    expect(push).not.toHaveBeenCalled();
  });

  it("renders in Arabic under the default locale", () => {
    renderWithI18n(
      <ProfessionalProfileEditor answers={answers} concreteType="installer_technician" />,
      "ar",
    );
    expect(screen.getByRole("button", { name: "حفظ التغييرات" })).toBeTruthy();
  });
});
