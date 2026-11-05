"use client";

import { useEffect, useState, useTransition } from "react";
import { SocialLinksCard, displayLink } from "@/features/onboarding/social-links-card";
import { normalizeSocialLink, socialLinksError, SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/onboarding/social-links";
import { PhoneField } from "@/components/ui/phone-field";
import { splitE164 } from "@/lib/contact/phone";
import { SHOWROOM_ACTIVITIES, showroomIdentityError, businessAddressSchema, businessAddressWords, businessDetailsSchema, type SHOWROOM_ACTIVITIES_TYPE } from "@/lib/onboarding/business-details";
import { useI18n } from "@/lib/i18n/context";
import { Input, Select, Textarea, LabeledField } from "@/components/ui/controls";
import { CountedTextarea } from "@/components/ui/counted-textarea";
import { DESCRIPTION_MAX_CHARS, isWithinDescriptionLimit } from "@/lib/text/description-limit";
import { InlineError } from "@/components/ui/primitives";
import { WizardShell, WizardProgress, ChoiceCard, FlowActions, SavedHint } from "@/features/onboarding/wizard";
import { saveBusiness, submitBusiness, type BusinessInput } from "@/server/actions/business-onboarding";
import type { BusinessAnswers } from "@/server/queries/onboarding";
import { APPLICATION_ORG_TYPES, applicationOrgTypeFrom, type ApplicationOrgType } from "@/lib/onboarding/account-types";
import { GOVERNORATE_OPTIONS, type LocationOption } from "@/lib/installer/location-data";
import { businessCitiesOf, CUSTOM_CITY_MAX, CUSTOM_CITY_MIN } from "@/lib/location/business-location";

/**
 * Business creation — "create my showroom", not "create an organization".
 *
 * One flow serves both entry points (a new registration that chose a business
 * type, and an existing account adding another business) because both write the
 * same draft. Three properties matter:
 *
 *   * THE TYPE IS NEVER ASKED TWICE. When the person already picked "Showroom" at
 *     registration, that type is carried into the draft and its step is dropped
 *     from the wizard entirely.
 *   * THE CREATOR IS THE OWNER. There is no owner/manager confirmation to tick —
 *     owning is the relationship that creating a business produces, and it is
 *     established transactionally alongside the organization and its first branch.
 *   * RETRYING IS SAFE. Every save round-trips a draft id, and submit is keyed on
 *     it, so a slow network or an impatient second click yields ONE business.
 *
 * State lives in the database (hydrated on load), so the wizard resumes across
 * refresh and sign-out.
 */
type Step = "identity" | "type" | "location" | "branch" | "review";

/** The "Other" choice in the city list. A UI control only: it is never sent or stored as a city. */
const OTHER_VALUE = "__other__";

type BState = {
  contactPhone: string | null;
  contactEmail: string;
  activityType: SHOWROOM_ACTIVITIES_TYPE;
  detailedAddress: string;
  legalName: string;
  displayName: string;
  orgType: ApplicationOrgType | null;
  description: string;
  governorate: string | null;
  /** A catalogue city key of `governorate`, or null. */
  city: string | null;
  /** UI state: the person chose "Other" and types their city. "Other" itself is never stored. */
  otherCity: boolean;
  cityCustomName: string;
  primaryBranchName: string;
  /** Showroom links as typed (normalised by the server action on every save). */
  links: Record<SocialPlatform, string>;
};

export function BusinessFlow({
  answers,
  presetOrgType,
  draftId: initialDraftId,
  typeChoices = APPLICATION_ORG_TYPES.filter((k) => k !== "contractor_company"),
}: {
  answers: BusinessAnswers;
  presetOrgType: ApplicationOrgType | null;
  draftId: string | null;
  /** The org types this applicant may apply for (a Contractor: only a contractor organization). */
  typeChoices?: readonly ApplicationOrgType[];
}) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<BState>({
    contactPhone: answers.contactPhone ?? null,
    contactEmail: answers.contactEmail ?? "",
    activityType: answers.activityType ?? null,
    detailedAddress: answers.detailedAddress ?? "",
    legalName: answers.legalName ?? "",
    displayName: answers.displayName ?? "",
    orgType: applicationOrgTypeFrom(answers.orgType) ?? presetOrgType,
    description: answers.description ?? "",
    governorate: answers.governorate,
    city: answers.city,
    // A saved custom city resumes in the "Other" state with its text.
    otherCity: Boolean(answers.cityCustomName),
    cityCustomName: answers.cityCustomName ?? "",
    primaryBranchName: answers.primaryBranchName ?? "",
    links: {
      facebook: answers.facebookUrl ?? "",
      instagram: answers.instagramUrl ?? "",
      tiktok: answers.tiktokUrl ?? "",
      website: answers.websiteUrl ?? "",
    },
  });
  // Set by a Next pressed while the links block the identity step; the card then shows its messages.
  const [showLinkErrors, setShowLinkErrors] = useState(false);
  // A new object per blocked Next, so pressing Next twice moves focus back to the link both times.
  const [linkFocus, setLinkFocus] = useState<{ platform: SocialPlatform } | null>(null);
  useEffect(() => {
    if (linkFocus) document.getElementById(`blinks-${linkFocus.platform}`)?.focus();
  }, [linkFocus]);

  // The type step exists only when the type is still unknown. A person who chose
  // "Showroom" to sign up is never asked what kind of business they are building.
  const typePreselected = Boolean(applicationOrgTypeFrom(answers.orgType) ?? presetOrgType);
  const steps: Step[] = typePreselected
    ? ["identity", "location", "branch", "review"]
    : ["identity", "type", "location", "branch", "review"];

  const showroom = state.orgType === "showroom_dealer";
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const savedPhone = splitE164(state.contactPhone);
  // BOTH names are required to leave the identity step: the business (trading) name and the legal / registered name.
  const identityFieldsDone = (s: BState) => s.displayName.trim().length >= 2 && s.legalName.trim().length >= 2 && s.description.trim().length <= 250 && (!showroom || (!phoneInvalid && !showroomIdentityError(s)));
  // A showroom also needs at least one valid link and no invalid one. Next stays pressable for the links so a
  // press can say what is missing; it never advances past them (see persistAdvance).
  const identityDone = (s: BState) => identityFieldsDone(s) && (!showroom || !socialLinksError(s.links));
  // Every new business needs a governorate, a city (or custom city) and a detailed address.
  const locationDone = (s: BState) =>
    !!s.governorate && businessAddressSchema.safeParse(s.detailedAddress).success &&
    (s.otherCity ? s.cityCustomName.trim().length >= CUSTOM_CITY_MIN : Boolean(s.city));
  const typeDone = (s: BState) => !!s.orgType;

  const [step, setStep] = useState<number>(() => {
    if (!identityDone(state)) return 0;
    if (!typePreselected && !typeDone(state)) return steps.indexOf("type");
    if (!locationDone(state)) return steps.indexOf("location");
    return steps.length - 1;
  });

  const current: Step = steps[step] ?? "review";
  const label = (o: LocationOption) => (locale === "ar" ? o.ar : o.en);
  const collator = new Intl.Collator(locale === "ar" ? "ar" : "en");
  const byLabel = (a: LocationOption, b: LocationOption) => collator.compare(label(a), label(b));
  const governorates = [...GOVERNORATE_OPTIONS].sort(byLabel);
  // The catalogue cities of the chosen governorate; "Other" is appended by the UI, never stored.
  const areaCities = businessCitiesOf(state.governorate).sort(byLabel);

  const locationSummary = (): string => {
    const gov = GOVERNORATE_OPTIONS.find((g) => g.value === state.governorate);
    if (!gov) return t("onboarding.consumer.notSet");
    const city = state.otherCity ? state.cityCustomName.trim() : label(areaCities.find((c) => c.value === state.city) ?? gov);
    return city && city !== label(gov) ? `${label(gov)} - ${city}` : label(gov);
  };

  const set = (patch: Partial<BState>) => setState((s) => ({ ...s, ...patch }));
  const goto = (s: Step) => setStep(Math.max(steps.indexOf(s), 0));

  const toInput = (s: BState): BusinessInput => ({
    draftId,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    activityType: s.activityType,
    detailedAddress: s.detailedAddress,
    legalName: s.legalName.trim() || null,
    displayName: s.displayName.trim() || null,
    orgType: s.orgType,
    description: s.description.trim() || null,
    governorate: s.governorate,
    city: s.otherCity ? null : s.city,
    cityCustomName: s.otherCity ? s.cityCustomName.trim() || null : null,
    primaryBranchName: s.primaryBranchName.trim() || null,
    // v3 saves REPLACE all four links (an omitted one is cleared), so every save sends all four, on every step.
    facebookUrl: s.links.facebook,
    instagramUrl: s.links.instagram,
    tiktokUrl: s.links.tiktok,
    websiteUrl: s.links.website,
  });

  /** Show the card's messages and move focus to the first invalid link, or Instagram when none is valid. */
  const flagLinks = () => {
    setShowLinkErrors(true);
    const invalid = SOCIAL_PLATFORMS.find((p) => !normalizeSocialLink(p, state.links[p]).ok);
    setLinkFocus({ platform: invalid ?? "instagram" });
  };

  const persistAdvance = () => {
    if (current === "identity" && showroom && socialLinksError(state.links)) {
      setError(null);
      flagLinks();
      return;
    }
    // Showroom chosen AFTER step 1 (no preselected type): step 1 never showed its showroom fields, so send the
    // person back there now rather than letting submit fail at the end.
    if (current === "type" && state.orgType === "showroom_dealer" && !identityDone(state)) {
      setError(null);
      goto("identity");
      if (socialLinksError(state.links)) flagLinks();
      return;
    }
    start(async () => {
      setError(null);
      const res = await saveBusiness({ ...toInput(state), step: current === "identity" || current === "location" ? current : undefined });
      if (!res.ok) {
        setError(res.code ?? "onboarding.error.saveFailed");
        return;
      }
      if (res.draftId) setDraftId(res.draftId);
      setStep((x) => Math.min(x + 1, steps.length - 1));
    });
  };

  const back = () => setStep((x) => Math.max(x - 1, 0));

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await submitBusiness(toInput(state));
      // A successful submit redirects; reaching here means it was rejected.
      if (res && !res.ok) setError(res.code ?? "onboarding.error.saveFailed");
    });

  const canContinue =
    current === "identity"
      ? identityFieldsDone(state)
      : current === "type"
        ? typeDone(state)
        : current === "location"
          ? locationDone(state)
          : true;

  const descriptionBlock = (
    <>
      <LabeledField label={t("onboarding.business.identity.descriptionLabel")} htmlFor="bdesc" optional={t("common.optional")}>
        <CountedTextarea
          id="bdesc"
          value={state.description}
          max={DESCRIPTION_MAX_CHARS}
          unitLabel={t("showroomSettings.description.chars")}
          counterTestId="business-description-count"
          placeholder={t("onboarding.business.identity.descriptionPlaceholder")}
          onChange={(e) => set({ description: e.target.value })}
        />
        {isWithinDescriptionLimit(state.description) ? null : (
          <p role="alert" className="mt-1 text-label text-danger">{t("onboarding.error.descriptionTooLong")}</p>
        )}
      </LabeledField>
      <p className="text-label text-fg-secondary text-end" dir="ltr" aria-live="polite">{state.description.length} / 250</p>
      {state.description.trim().length > 250 ? <InlineError>{t("onboarding.error.descriptionTooLong")}</InlineError> : null}
    </>
  );

  // The links the review will save, in platform order, as host + path.
  const addedLinks = SOCIAL_PLATFORMS.flatMap((p) => {
    const r = normalizeSocialLink(p, state.links[p]);
    return r.ok && r.url ? [displayLink(r.url)] : [];
  });

  const progress = (
    <WizardProgress current={step} total={steps.length} label={t(`onboarding.business.step.${current}`)} />
  );

  return (
    <WizardShell
      titleClassName="font-sans text-display-ar"
      progress={progress}
      title={t(`onboarding.business.${current}.title`)}
      subtitle={t(`onboarding.business.${current}.subtitle`)}
    >
      {current === "identity" ? (
        <div className="flex flex-col gap-md">
          <h2 className="text-title text-fg">{t("onboarding.business.identity.informationSection")}</h2>
          <LabeledField label={t("onboarding.business.identity.displayNameLabel")} htmlFor="bname">
            <Input
              id="bname"
              value={state.displayName}
              maxLength={120}
              placeholder={t("onboarding.business.identity.displayNamePlaceholder")}
              onChange={(e) => set({ displayName: e.target.value })}
            />
          </LabeledField>
          <LabeledField
            label={t("onboarding.business.identity.legalNameLabel")}
            htmlFor="blegal"
            hint={t("onboarding.business.identity.legalNameHint")}
          >
            <Input
              id="blegal"
              value={state.legalName}
              maxLength={120}
              placeholder={t("onboarding.business.identity.legalNamePlaceholder")}
              onChange={(e) => set({ legalName: e.target.value })}
            />
          </LabeledField>
          {showroom ? <LabeledField label={t("onboarding.business.identity.activityLabel")} htmlFor="bactivity"><Select id="bactivity" required value={state.activityType ?? ""} onChange={e => set({activityType: e.target.value as SHOWROOM_ACTIVITIES_TYPE})}><option value="">{t("onboarding.business.location.choose")}</option>{SHOWROOM_ACTIVITIES.map(value => <option key={value} value={value}>{t(`onboarding.business.activities.${value}`)}</option>)}</Select></LabeledField> : null}
          {/* Required fields first, optional last: a showroom's optional description moves below its links card. */}
          {showroom ? null : descriptionBlock}
          {showroom ? <section className="flex flex-col gap-md border-t border-strong pt-lg" aria-labelledby="business-contact-heading">
            <h2 id="business-contact-heading" className="text-title text-fg">{t("onboarding.business.identity.contactSection")}</h2>
            <LabeledField label={t("onboarding.business.identity.phoneLabel")} htmlFor="bphone"><PhoneField id="bphone" defaultCountryIso2={savedPhone?.countryIso2} defaultNational={savedPhone?.national} onChange={phone => set({contactPhone: phone?.e164 ?? null})} onInvalidChange={setPhoneInvalid} compact /></LabeledField>
            <LabeledField label={t("onboarding.business.identity.emailLabel")} htmlFor="bemail" optional={t("common.optional")}><Input id="bemail" type="email" dir="ltr" autoComplete="email" maxLength={254} value={state.contactEmail} aria-invalid={!businessDetailsSchema.safeParse(state).success || undefined} onChange={e => set({contactEmail:e.target.value})}/>{!businessDetailsSchema.safeParse(state).success ? <InlineError>{t("onboarding.error.contactInvalid")}</InlineError> : null}</LabeledField>
            <SocialLinksCard
              idPrefix="blinks"
              values={state.links}
              onChange={(p, v) => setState((s) => ({ ...s, links: { ...s.links, [p]: v } }))}
              showErrors={showLinkErrors}
              focusPlatform={linkFocus?.platform ?? null}
            />
          </section> : null}
          {showroom ? descriptionBlock : null}
        </div>
      ) : null}

      {current === "type" ? (
        <LabeledField label={t("onboarding.business.type.label")} htmlFor="btype">
          <div id="btype" className="grid gap-2.5 tablet:grid-cols-2">
            {typeChoices.map((k) => (
              <ChoiceCard
                key={k}
                selected={state.orgType === k}
                title={t(`onboarding.business.orgTypes.${k}`)}
                description={t(`onboarding.business.orgTypeDesc.${k}`)}
                onSelect={() => set({ orgType: k })}
              />
            ))}
          </div>
        </LabeledField>
      ) : null}

      {current === "location" ? (
        <div className="flex flex-col gap-md">
          <LabeledField label={t("onboarding.business.location.governorateLabel")} htmlFor="bgov">
            <Select
              id="bgov"
              required
              value={state.governorate ?? ""}
              // A different governorate invalidates whatever city (catalogue or typed) was chosen under the previous one.
              onChange={(e) => set({ governorate: e.target.value || null, city: null, otherCity: false, cityCustomName: "" })}
            >
              <option value="">{t("onboarding.business.location.choose")}</option>
              {governorates.map((g) => (
                <option key={g.value} value={g.value}>{label(g)}</option>
              ))}
            </Select>
          </LabeledField>
          {state.governorate ? (
            <LabeledField label={t("onboarding.business.location.cityLabel")} htmlFor="bcity">
              <Select
                id="bcity"
                required
                value={state.otherCity ? OTHER_VALUE : (state.city ?? "")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === OTHER_VALUE) set({ city: null, otherCity: true });
                  else set({ city: v || null, otherCity: false, cityCustomName: "" });
                }}
              >
                <option value="">{t("onboarding.business.location.choose")}</option>
                {areaCities.map((c) => (
                  <option key={c.value} value={c.value}>{label(c)}</option>
                ))}
                <option value={OTHER_VALUE}>{t("onboarding.business.location.otherOption")}</option>
              </Select>
            </LabeledField>
          ) : null}
          {state.governorate && state.otherCity ? (
            <LabeledField label={t("onboarding.business.location.customCityLabel")} htmlFor="bcitycustom">
              <Input
                id="bcitycustom"
                value={state.cityCustomName}
                maxLength={CUSTOM_CITY_MAX}
                placeholder={t("onboarding.business.location.customCityPlaceholder")}
                onChange={(e) => set({ cityCustomName: e.target.value })}
              />
            </LabeledField>
          ) : null}
          <LabeledField label={t("onboarding.business.location.addressLabel")} htmlFor="baddress" optional={t("common.optional")} hint={t("onboarding.business.location.addressHint")}><Textarea id="baddress" autoComplete="street-address" maxLength={16384} value={state.detailedAddress} onChange={e => set({detailedAddress:e.target.value})}/><p className="text-label text-fg-secondary text-end" dir="ltr" aria-live="polite">{businessAddressWords(state.detailedAddress)} / 250</p>{!businessAddressSchema.safeParse(state.detailedAddress).success ? <InlineError>{t("onboarding.error.addressTooLong")}</InlineError> : null}</LabeledField>
        </div>
      ) : null}

      {current === "branch" ? (
        <div className="flex flex-col gap-md">
          <LabeledField label={t("onboarding.business.branch.nameLabel")} htmlFor="bbranch" optional={t("common.optional")}>
            <Input
              id="bbranch"
              value={state.primaryBranchName}
              maxLength={120}
              placeholder={t("onboarding.business.branch.namePlaceholder")}
              onChange={(e) => set({ primaryBranchName: e.target.value })}
            />
          </LabeledField>
          <p className="text-label text-fg-muted">{t("onboarding.business.branch.hint")}</p>
        </div>
      ) : null}

      {current === "review" ? (
        <div className="flex flex-col gap-lg">
          <dl className="flex flex-col divide-y divide-strong/60">
            {[
              { label: t("onboarding.business.review.name"), value: state.displayName || t("onboarding.consumer.notSet"), to: "identity" as Step },
              // The legal name is entered on the identity step with the business name, so it is edited there too.
              { label: t("onboarding.business.review.legalName"), value: state.legalName || t("onboarding.consumer.notSet"), to: "identity" as Step },
              {
                label: t("onboarding.business.review.type"),
                value: state.orgType ? t(`onboarding.business.orgTypes.${state.orgType}`) : t("onboarding.consumer.notSet"),
                to: (typePreselected ? "identity" : "type") as Step,
              },
              ...(showroom
                ? [
                    { label: t("onboarding.business.identity.activityLabel"), value: state.activityType ? t(`onboarding.business.activities.${state.activityType}`) : t("onboarding.consumer.notSet"), to: "identity" as Step },
                    { label: t("onboarding.business.identity.phoneLabel"), value: state.contactPhone ?? t("onboarding.consumer.notSet"), to: "identity" as Step, ltr: true },
                    { label: t("onboarding.business.identity.emailLabel"), value: state.contactEmail.trim() || t("onboarding.consumer.notSet"), to: "identity" as Step, ltr: true },
                    { label: t("onboarding.business.review.links"), value: addedLinks.length ? addedLinks : t("onboarding.consumer.notSet"), to: "identity" as Step, ltr: true },
                  ]
                : []),
              ...(state.description.trim()
                ? [{ label: t("onboarding.business.identity.descriptionLabel"), value: state.description.trim(), to: "identity" as Step }]
                : []),
              {
                label: t("onboarding.business.review.location"),
                value: `${locationSummary()} — ${state.detailedAddress}`,
                to: "location" as Step,
              },
              {
                label: t("onboarding.business.review.branch"),
                value: state.primaryBranchName.trim() || state.displayName || t("onboarding.consumer.notSet"),
                to: "branch" as Step,
              },
            ].map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-label text-fg-muted">{r.label}</dt>
                  <dd className="break-words text-body text-fg" dir={"ltr" in r && r.ltr ? "ltr" : undefined}>
                    {Array.isArray(r.value) ? r.value.map((line) => <span key={line} className="block">{line}</span>) : r.value}
                  </dd>
                </div>
                <button
                  type="button"
                  onClick={() => goto(r.to)}
                  className="shrink-0 text-label font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {t("onboarding.edit")}
                </button>
              </div>
            ))}
          </dl>

          {/* The creator IS the owner — stated, never asked. */}
          <p className="rounded-md border border-strong/70 bg-surface-2/40 p-md text-body text-fg-secondary">
            {t("onboarding.business.review.ownerNote")}
          </p>
          <p className="text-label text-fg-secondary">{t("onboarding.business.review.reviewNote")}</p>
        </div>
      ) : null}

      {error ? <InlineError>{t(error)}</InlineError> : null}

      <FlowActions
        onBack={step > 0 ? back : undefined}
        onPrimary={current === "review" ? submit : persistAdvance}
        primaryLabel={current === "review" ? t("onboarding.business.review.submit") : t("onboarding.continue")}
        primaryDisabled={current === "review" ? !typeDone(state) || !identityDone(state) || !locationDone(state) : !canContinue}
        pending={pending}
      />
      <SavedHint />
    </WizardShell>
  );
}
