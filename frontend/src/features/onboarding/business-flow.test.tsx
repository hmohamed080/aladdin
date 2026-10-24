import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import { GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import { businessCitiesOf } from "@/lib/location/business-location";
import type { BusinessAnswers } from "@/server/queries/onboarding";

/**
 * Deterministic UI proof of the business-creation contract:
 *  1. the identity step gates Continue on BOTH names (business name + legal / registered name) and persists first;
 *  2. the draft id returned by the first save is carried into every later call —
 *     this is what makes a retry idempotent, so it must not be lost client-side;
 *  3. a business type chosen at registration is NEVER asked again;
 *  4. creating is not gated on an owner/manager confirmation — the creator IS the
 *     owner, so no such question exists;
 *  5. the location step offers all 27 governorates, only the chosen governorate's cities plus "Other", a typed city for
 *     Other, and never lets a stale city survive a governorate change.
 * The server RPCs enforce the same rules (pgTAP 27 / 87); this pins the client contract.
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
  cityCustomName: null,
  primaryBranchName: null,
  organizationId: null,
  completedAt: null,
};

const names = (overrides: Partial<BusinessAnswers> = {}): BusinessAnswers => ({
  ...emptyAnswers,
  governorate: "cairo", city: "maadi", detailedAddress: "10 Test Street",
  contactPhone: "+201012345678", activityType: "decor_showroom",
  displayName: "Al-Noor Supply",
  legalName: "Al-Noor Supply Trading LLC",
  ...overrides,
});

const label = en.onboarding.business.identity;
/** A field's label may carry an "Optional" marker, so match by prefix. */
const starts = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
const continueBtn = () => screen.getByRole("button", { name: en.onboarding.continue });
const fillNames = (display = "Al-Noor Supply", legal = "Al-Noor Supply Trading LLC") => {
  fireEvent.change(screen.getByLabelText(label.displayNameLabel), { target: { value: display } });
  fireEvent.change(screen.getByLabelText(label.legalNameLabel), { target: { value: legal } });
};

beforeEach(() => vi.clearAllMocks());

describe("BusinessFlow — acceptance gates", () => {
  it("offers Engineer as design_office in the existing add-business flow", async () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType={null} draftId={null} />, "en");
    fillNames("Engineering", "Engineering Consultants LLC");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.onboarding.continue })); });
    fireEvent.click(screen.getByRole("button", { name: /Engineer/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.onboarding.continue })); });
    expect(saveBusiness).toHaveBeenLastCalledWith(expect.objectContaining({ orgType: "design_office", draftId: "draft-1" }));
  });

  it("gates Continue on BOTH the business name and the legal name, then persists and advances", async () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType={null} draftId={null} />, "en");

    expect(continueBtn()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(label.displayNameLabel), { target: { value: "Al-Noor Supply" } });
    // The business name alone is no longer enough.
    expect(continueBtn()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(label.legalNameLabel), { target: { value: "A" } });
    expect(continueBtn()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(label.legalNameLabel), { target: { value: "Al-Noor Supply Trading LLC" } });
    expect(continueBtn()).toBeEnabled();

    await act(async () => {
      fireEvent.click(continueBtn());
    });
    expect(saveBusiness).toHaveBeenCalledTimes(1);
    expect(saveBusiness.mock.calls[0]![0]).toMatchObject({
      displayName: "Al-Noor Supply",
      legalName: "Al-Noor Supply Trading LLC",
    });
    await waitFor(() => expect(screen.getByText(en.onboarding.business.type.title)).toBeInTheDocument());
  });

  it("marks the legal name as required (no Optional marker) while the description stays optional", () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType={null} draftId={null} />, "en");
    const labelText = (labelMatcher: string) =>
      (screen.getByLabelText(starts(labelMatcher)) as HTMLInputElement).labels?.[0]?.textContent ?? "";
    expect(labelText(label.legalNameLabel)).not.toMatch(/optional/i);
    expect(labelText(label.displayNameLabel)).not.toMatch(/optional/i);
    expect(labelText(label.descriptionLabel)).toMatch(/optional/i);
  });

  it("labels the two names distinctly in English and Arabic", () => {
    expect(en.onboarding.business.identity.displayNameLabel).toBe("Business name");
    expect(en.onboarding.business.identity.legalNameLabel).toBe("Legal / registered name");
    expect(ar.onboarding.business.identity.displayNameLabel).toBe("اسم النشاط التجاري");
    expect(ar.onboarding.business.identity.legalNameLabel).toBe("الاسم القانوني / الرسمي");
  });

  it("carries the draft id returned by the first save into later calls", async () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType={null} draftId={null} />, "en");

    fillNames();
    await act(async () => {
      fireEvent.click(continueBtn());
    });
    expect(saveBusiness.mock.calls[0]![0]).toMatchObject({ draftId: null });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.onboarding.business.orgTypes.supplier) }));
    await act(async () => {
      fireEvent.click(continueBtn());
    });
    expect(saveBusiness.mock.calls[1]![0]).toMatchObject({ draftId: "draft-1" });
  });

  it("never asks for the business type when it was chosen at registration", async () => {
    renderWithI18n(<BusinessFlow answers={emptyAnswers} presetOrgType="showroom_dealer" draftId="draft-1" />, "en");

    fillNames("Cairo Ceramics", "Cairo Ceramics Trading LLC");
    fireEvent.change(screen.getByLabelText(en.onboarding.business.identity.activityLabel), { target: { value: "decor_showroom" } });
    fireEvent.change(screen.getByLabelText(en.onboarding.business.identity.phoneLabel), { target: { value: "01012345678" } });
    await act(async () => {
      fireEvent.click(continueBtn());
    });

    await waitFor(() => expect(screen.getByText(en.onboarding.business.location.title)).toBeInTheDocument());
    expect(screen.queryByText(en.onboarding.business.type.title)).not.toBeInTheDocument();
  });

  it("creates without an owner/manager confirmation — the creator is the owner", async () => {
    const ready = names({ orgType: "supplier" });
    renderWithI18n(<BusinessFlow answers={ready} presetOrgType={null} draftId="draft-1" />, "en");

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: en.onboarding.business.review.submit });
    expect(submitBtn).toBeEnabled();

    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(submitBusiness).toHaveBeenCalledTimes(1);
    expect(submitBusiness.mock.calls[0]![0]).toMatchObject({ draftId: "draft-1", legalName: "Al-Noor Supply Trading LLC" });
  });

  it("an old draft that has no legal name yet resumes on the identity step, not the review", () => {
    renderWithI18n(
      <BusinessFlow answers={{ ...emptyAnswers, displayName: "Old Draft Co", orgType: "supplier" }} presetOrgType={null} draftId="draft-9" />,
      "en",
    );
    expect(screen.getByLabelText(label.legalNameLabel)).toBeInTheDocument();
    expect(screen.queryByText(en.onboarding.business.review.title)).not.toBeInTheDocument();
  });
});

describe("BusinessFlow — review summary", () => {
  const rowOf = (text: string) => screen.getByText(text).closest("div")!.parentElement!;

  it("shows the saved legal / registered name right after the business name and before the type", () => {
    renderWithI18n(<BusinessFlow answers={names({ orgType: "supplier" })} presetOrgType={null} draftId="draft-1" />, "en");
    const r = en.onboarding.business.review;
    const labels = [...document.querySelectorAll("dt")].map((d) => d.textContent);
    expect(labels).toEqual([r.name, r.legalName, r.type, r.location, r.branch]);
    expect(within(rowOf(r.legalName)).getByText("Al-Noor Supply Trading LLC")).toBeInTheDocument();
    // the other rows still render their values
    expect(within(rowOf(r.name)).getByText("Al-Noor Supply")).toBeInTheDocument();
    expect(within(rowOf(r.type)).getByText(en.onboarding.business.orgTypes.supplier)).toBeInTheDocument();
  });

  it("has the specified English and Arabic labels, and the Arabic review renders the same value", () => {
    expect(en.onboarding.business.review.legalName).toBe("Legal / registered name");
    expect(ar.onboarding.business.review.legalName).toBe("الاسم القانوني / الرسمي");
    renderWithI18n(<BusinessFlow answers={names({ orgType: "supplier", legalName: "شركة النور للتوريدات" })} presetOrgType={null} draftId="draft-1" />, "ar");
    expect(within(rowOf(ar.onboarding.business.review.legalName)).getByText("شركة النور للتوريدات")).toBeInTheDocument();
  });

  it("Edit on the legal-name row returns to the identity step with the saved values", async () => {
    renderWithI18n(<BusinessFlow answers={names({ orgType: "supplier" })} presetOrgType={null} draftId="draft-1" />, "en");
    await act(async () => {
      fireEvent.click(within(rowOf(en.onboarding.business.review.legalName)).getByRole("button", { name: en.onboarding.edit }));
    });
    expect((screen.getByLabelText(label.legalNameLabel) as HTMLInputElement).value).toBe("Al-Noor Supply Trading LLC");
    expect((screen.getByLabelText(label.displayNameLabel) as HTMLInputElement).value).toBe("Al-Noor Supply");
  });

  it("submitting from the review sends the same payload as before (the new row changes nothing)", async () => {
    submitBusiness.mockClear();
    renderWithI18n(<BusinessFlow answers={names({ orgType: "supplier" })} presetOrgType={null} draftId="draft-1" />, "en");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onboarding.business.review.submit }));
    });
    expect(submitBusiness).toHaveBeenCalledTimes(1);
    expect(submitBusiness.mock.calls[0]![0]).toMatchObject({ draftId: "draft-1", displayName: "Al-Noor Supply", legalName: "Al-Noor Supply Trading LLC", orgType: "supplier" });
  });
});

describe("BusinessFlow — location step", () => {
  /** Resume at the location step: a fully-answered draft opens on review, so go back to the location row. */
  async function atLocation(answers: BusinessAnswers = names({ governorate: null, city: null }), locale: "en" | "ar" = "en") {
    renderWithI18n(<BusinessFlow answers={answers} presetOrgType="supplier" draftId="draft-1" />, locale);
    if (screen.queryByRole("heading", {name: locale === "en" ? en.onboarding.business.location.title : ar.onboarding.business.location.title})) return;
    const loc = locale === "en" ? en.onboarding.business.review.location : ar.onboarding.business.review.location;
    const row = screen.getByText(loc).closest("div")!.parentElement!;
    await act(async () => {
      fireEvent.click(within(row).getByRole("button"));
    });
  }
  const gov = () => screen.getByLabelText(starts(en.onboarding.business.location.governorateLabel)) as HTMLSelectElement;
  const city = () => screen.getByLabelText(starts(en.onboarding.business.location.cityLabel)) as HTMLSelectElement;
  const optionValues = (select: HTMLSelectElement) => [...select.options].map((o) => o.value).filter(Boolean);

  it("offers exactly the 27 Egyptian governorates", async () => {
    await atLocation();
    expect(optionValues(gov())).toHaveLength(27);
    expect(new Set(optionValues(gov()))).toEqual(new Set(GOVERNORATE_OPTIONS.map((g) => g.value)));
  });

  it("shows no city control until a governorate is chosen, then only THAT governorate's cities plus Other", async () => {
    await atLocation();
    expect(screen.queryByLabelText(starts(en.onboarding.business.location.cityLabel))).not.toBeInTheDocument();

    fireEvent.change(gov(), { target: { value: "dakahlia" } });
    const dakahlia = optionValues(city());
    expect(dakahlia.filter((v) => v !== "__other__").sort()).toEqual(businessCitiesOf("dakahlia").map((c) => c.value).sort());
    expect(dakahlia).toContain("mansoura");
    expect(dakahlia.at(-1)).toBe("__other__");
    expect(city().options[city().options.length - 1]!.textContent).toBe(en.onboarding.business.location.otherOption);

    fireEvent.change(gov(), { target: { value: "cairo" } });
    const cairo = optionValues(city());
    expect(cairo).not.toContain("mansoura");
    expect(cairo).toContain("new-cairo");
  });

  it("changing the governorate clears the previous city (no Cairo + Mansoura from stale state)", async () => {
    await atLocation();
    fireEvent.change(gov(), { target: { value: "dakahlia" } });
    fireEvent.change(city(), { target: { value: "mansoura" } });
    expect(city().value).toBe("mansoura");
    fireEvent.change(gov(), { target: { value: "cairo" } });
    expect(city().value).toBe("");
    expect(continueBtn()).toBeDisabled();
  });

  it("governorate and city are mandatory before Continue", async () => {
    await atLocation();
    expect(continueBtn()).toBeDisabled(); // location is required
    fireEvent.change(gov(), { target: { value: "giza" } });
    expect(continueBtn()).toBeDisabled();
    fireEvent.change(city(), { target: { value: "dokki" } });
    expect(continueBtn()).toBeEnabled();
  });

  it("Other reveals a city text field; a blank value blocks Continue; the typed city is what is saved", async () => {
    await atLocation();
    fireEvent.change(gov(), { target: { value: "dakahlia" } });
    expect(screen.queryByLabelText(en.onboarding.business.location.customCityLabel)).not.toBeInTheDocument();

    fireEvent.change(city(), { target: { value: "__other__" } });
    const custom = screen.getByLabelText(en.onboarding.business.location.customCityLabel);
    expect(custom).toBeInTheDocument();
    expect(continueBtn()).toBeDisabled();
    fireEvent.change(custom, { target: { value: "   " } });
    expect(continueBtn()).toBeDisabled();
    fireEvent.change(custom, { target: { value: "Kafr Test" } });
    expect(continueBtn()).toBeEnabled();

    await act(async () => {
      fireEvent.click(continueBtn());
    });
    const sent = saveBusiness.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ governorate: "dakahlia", city: null, cityCustomName: "Kafr Test" });
    // "Other" is a UI state: the sentinel is never sent as a city.
    expect(JSON.stringify(sent)).not.toMatch(/__other__|"other"/i);
  });

  it("switching from Other back to a catalogue city drops the typed city", async () => {
    await atLocation();
    fireEvent.change(gov(), { target: { value: "dakahlia" } });
    fireEvent.change(city(), { target: { value: "__other__" } });
    fireEvent.change(screen.getByLabelText(en.onboarding.business.location.customCityLabel), { target: { value: "Kafr Test" } });
    fireEvent.change(city(), { target: { value: "mansoura" } });
    expect(screen.queryByLabelText(en.onboarding.business.location.customCityLabel)).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(continueBtn());
    });
    expect(saveBusiness.mock.calls.at(-1)![0]).toMatchObject({ city: "mansoura", cityCustomName: null });
  });

  it("resumes a saved custom city in the Other state with its text", async () => {
    await atLocation(names({ governorate: "dakahlia", city: null, cityCustomName: "Kafr Test" }));
    expect(gov().value).toBe("dakahlia");
    expect(city().value).toBe("__other__");
    expect(screen.getByLabelText(en.onboarding.business.location.customCityLabel)).toHaveValue("Kafr Test");
  });

  it("resumes a saved catalogue city", async () => {
    await atLocation(names({ governorate: "cairo", city: "maadi" }));
    expect(gov().value).toBe("cairo");
    expect(city().value).toBe("maadi");
  });

  it("renders Arabic governorate and city labels and an Arabic Other / custom-city label", async () => {
    await atLocation(names(), "ar");
    const g = screen.getByLabelText(starts(ar.onboarding.business.location.governorateLabel)) as HTMLSelectElement;
    const labels = [...g.options].map((o) => o.textContent);
    expect(labels).toContain("القاهرة");
    expect(labels).toContain("الدقهلية");
    fireEvent.change(g, { target: { value: "dakahlia" } });
    const c = screen.getByLabelText(starts(ar.onboarding.business.location.cityLabel)) as HTMLSelectElement;
    expect([...c.options].map((o) => o.textContent)).toContain("المنصورة");
    expect(c.options[c.options.length - 1]!.textContent).toBe("أخرى");
    fireEvent.change(c, { target: { value: "__other__" } });
    expect(screen.getByLabelText("اكتب اسم المدينة")).toBeInTheDocument();
  });

  it("English and Arabic copy for the Other flow is as specified", () => {
    expect(en.onboarding.business.location.otherOption).toBe("Other");
    expect(en.onboarding.business.location.customCityLabel).toBe("Enter city name");
    expect(ar.onboarding.business.location.otherOption).toBe("أخرى");
    expect(ar.onboarding.business.location.customCityLabel).toBe("اكتب اسم المدينة");
  });
});

describe("BusinessFlow — review shows everything that will be saved", () => {
  it("lists the activity, phone, e-mail and description of a showroom before it is submitted", () => {
    renderWithI18n(
      <BusinessFlow
        answers={names({ orgType: "showroom_dealer", contactEmail: "owner@alnoor.example", description: "Tiles and paint for homes" })}
        presetOrgType="showroom_dealer"
        draftId="draft-1"
      />,
      "en",
    );
    const review = screen.getByText(en.onboarding.business.review.name).closest("dl") as HTMLElement;
    expect(within(review).getByText(en.onboarding.business.activities.decor_showroom)).toBeTruthy();
    expect(within(review).getByText("+201012345678")).toBeTruthy();
    expect(within(review).getByText("owner@alnoor.example")).toBeTruthy();
    expect(within(review).getByText("Tiles and paint for homes")).toBeTruthy();
    expect(within(review).getByText(/10 Test Street/)).toBeTruthy();
  });

  it("does not ask a supplier to review a showroom phone or activity", () => {
    renderWithI18n(<BusinessFlow answers={names({ orgType: "supplier" })} presetOrgType="supplier" draftId="draft-1" />, "en");
    const review = screen.getByText(en.onboarding.business.review.name).closest("dl") as HTMLElement;
    expect(within(review).queryByText(en.onboarding.business.identity.phoneLabel)).toBeNull();
    expect(within(review).queryByText(en.onboarding.business.identity.activityLabel)).toBeNull();
  });
});
