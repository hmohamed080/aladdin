import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import type { BusinessAnswers } from "@/server/queries/onboarding";

/**
 * Sprint 8 — deterministic UI proof of the two acceptance gates of the shared
 * business onboarding flow: (1) the identity step gates Continue on an organization
 * name and persists the draft before advancing; (2) the review step gates the
 * "Create organization" submit on the explicit owner/manager confirmation, so an
 * org is never created through the trusted path without a confirmed owner. The
 * server RPCs enforce the same rules (pgTAP 22); this pins the client contract.
 */
const saveBusiness = vi.fn(async () => ({ ok: true as const }));
const submitBusiness = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/server/actions/business-onboarding", () => ({
  saveBusiness: (...a: unknown[]) => saveBusiness(...(a as [])),
  submitBusiness: (...a: unknown[]) => submitBusiness(...(a as [])),
}));

import { BusinessFlow } from "./business-flow";

const emptyAnswers: BusinessAnswers = {
  legalName: null,
  displayName: null,
  orgType: null,
  description: null,
  governorate: null,
  city: null,
  primaryBranchName: null,
  ownerConfirmed: false,
  organizationId: null,
  completedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("BusinessFlow — acceptance gates", () => {
  it("gates Continue on an organization name, then persists and advances", async () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType={null} />, "en");

    const continueBtn = () => screen.getByRole("button", { name: en.onboarding.continue });
    // No name yet → Continue is disabled and nothing is persisted.
    expect(continueBtn()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(en.onboarding.business.identity.displayNameLabel), {
      target: { value: "Al-Noor Supply" },
    });
    expect(continueBtn()).toBeEnabled();

    await act(async () => {
      fireEvent.click(continueBtn());
    });
    // The draft is persisted before advancing, and the type step is shown.
    expect(saveBusiness).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(en.onboarding.business.type.title)).toBeInTheDocument());
  });

  it("gates the org-creation submit on the owner confirmation", async () => {
    // Pre-filled so the wizard lands on the review step.
    const ready: BusinessAnswers = {
      ...emptyAnswers,
      displayName: "Al-Noor Supply",
      orgType: "supplier",
    };
    renderWithI18n(<BusinessFlow answers={ready} presetOrgType={null} />, "en");

    const submitBtn = () => screen.getByRole("button", { name: en.onboarding.business.review.submit });
    // Landed on review, but the owner has not confirmed → submit is disabled.
    expect(submitBtn()).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(submitBtn()).toBeEnabled();

    await act(async () => {
      fireEvent.click(submitBtn());
    });
    expect(submitBusiness).toHaveBeenCalledTimes(1);
  });
});
