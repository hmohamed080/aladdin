import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import type { BusinessAnswers } from "@/server/queries/onboarding";

/**
 * Deterministic UI proof of the business-creation contract:
 *  1. the identity step gates Continue on a business name and persists first;
 *  2. the draft id returned by the first save is carried into every later call —
 *     this is what makes a retry idempotent, so it must not be lost client-side;
 *  3. a business type chosen at registration is NEVER asked again;
 *  4. creating is not gated on an owner/manager confirmation — the creator IS the
 *     owner, so no such question exists.
 * The server RPCs enforce the same rules (pgTAP 27); this pins the client contract.
 */
type Input = { draftId?: string | null };
const saveBusiness = vi.fn(async (input: Input) => ({ ok: true as const, draftId: input.draftId ?? "draft-1" }));
const submitBusiness = vi.fn(async (input: Input) => ({ ok: true as const, draftId: input.draftId }));

vi.mock("@/server/actions/business-onboarding", () => ({
  saveBusiness: (input: Input) => saveBusiness(input),
  submitBusiness: (input: Input) => submitBusiness(input),
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
  organizationId: null,
  completedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("BusinessFlow — acceptance gates", () => {
  it("gates Continue on a business name, then persists and advances", async () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType={null} draftId={null} />, "en");

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

  it("carries the draft id returned by the first save into later calls", async () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType={null} draftId={null} />, "en");

    fireEvent.change(screen.getByLabelText(en.onboarding.business.identity.displayNameLabel), {
      target: { value: "Al-Noor Supply" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onboarding.continue }));
    });
    // First call had no id (the draft did not exist yet)...
    expect(saveBusiness.mock.calls[0]![0]).toMatchObject({ draftId: null });

    // ...pick a type and continue; the id from the first save must be sent back,
    // otherwise a retry could not be recognised as the same business.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.onboarding.business.orgTypes.supplier) }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onboarding.continue }));
    });
    expect(saveBusiness.mock.calls[1]![0]).toMatchObject({ draftId: "draft-1" });
  });

  it("never asks for the business type when it was chosen at registration", async () => {
    renderWithI18n(
      <BusinessFlow answers={emptyAnswers} presetOrgType="showroom_dealer" draftId="draft-1" />,
      "en",
    );

    fireEvent.change(screen.getByLabelText(en.onboarding.business.identity.displayNameLabel), {
      target: { value: "Cairo Ceramics" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onboarding.continue }));
    });

    // The type step is absent entirely — the next step is location, not type.
    await waitFor(() =>
      expect(screen.getByText(en.onboarding.business.location.title)).toBeInTheDocument(),
    );
    expect(screen.queryByText(en.onboarding.business.type.title)).not.toBeInTheDocument();
  });

  it("creates without an owner/manager confirmation — the creator is the owner", async () => {
    // Pre-filled so the wizard lands on the review step.
    const ready: BusinessAnswers = { ...emptyAnswers, displayName: "Al-Noor Supply", orgType: "supplier" };
    renderWithI18n(<BusinessFlow answers={ready} presetOrgType={null} draftId="draft-1" />, "en");

    // There is no owner checkbox to tick, and submit is immediately available.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: en.onboarding.business.review.submit });
    expect(submitBtn).toBeEnabled();

    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(submitBusiness).toHaveBeenCalledTimes(1);
    expect(submitBusiness.mock.calls[0]![0]).toMatchObject({ draftId: "draft-1" });
  });
});
