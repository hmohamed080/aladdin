import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField, Select, Textarea } from "@/components/ui/controls";
import { ShieldIcon } from "@/components/ui/icons";
import { submitShowroomReferral } from "@/server/actions/affiliation";
import type { ReferralDraft } from "@/server/queries/affiliation";
import { GOVERNORATES, CITIES_BY_GOVERNORATE, type Governorate } from "@/lib/onboarding/persona-fields";
import type { TranslateFn } from "@/lib/i18n/translate";
import { HomeHeader } from "@/features/home/parts";
import { readableColumnClass } from "@/components/layout/content-column";

/**
 * Refer a showroom that is not on Aladdin yet.
 *
 * The field set is exactly the business information the platform already collects
 * when a business is created — name, legal name, location, primary branch,
 * description — so an approved referral can be materialised through the trusted
 * path with nothing missing, and nothing extra is asked of the salesperson.
 *
 * The city list is rendered for every governorate at once and filtered by the
 * browser only for convenience; the server validates the pair regardless, and a
 * plain <select> keeps the form usable without client JavaScript.
 */
export function ShowroomReferralForm({
  referral,
  error,
  t,
}: {
  referral: ReferralDraft | null;
  error?: string;
  t: TranslateFn;
}) {
  // Already submitted: show the state, do not invite a second submission. The RPC
  // is retry-safe anyway, but a form that looks re-submittable teaches the wrong
  // thing about what is happening.
  if (referral?.status === "submitted") {
    return (
      <div className="flex flex-col gap-xl">
        <HomeHeader
          eyebrow={t("showroom.refer.eyebrow")}
          title={t("showroom.refer.title")}
          name={t("showroom.refer.title")}
        />
        <Card className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <h2 className="text-title text-fg">{referral.displayName}</h2>
            <Badge tone="info">
              <ShieldIcon size={13} />
              {t("personalHome.sales.status.submitted")}
            </Badge>
          </div>
          <p className="text-body text-fg-secondary">{t("showroom.refer.submittedBody")}</p>
          <p className="text-label text-fg-muted">{t("personalHome.sales.stillUsable")}</p>
          <div>
            <a href="/home" className="text-body-lg font-medium text-accent hover:underline">
              {t("showroom.refer.backHome")}
            </a>
          </div>
        </Card>
      </div>
    );
  }

  const gov = (referral?.governorate ?? "") as Governorate | "";

  return (
    <div className="flex flex-col gap-xl">
      <HomeHeader
        eyebrow={t("showroom.refer.eyebrow")}
        title={t("showroom.refer.title")}
        name={t("showroom.refer.title")}
        lead={t("showroom.refer.subtitle")}
      />

      <StatePanel title={t("showroom.refer.noticeTitle")} body={t("showroom.refer.noticeBody")} />

      {/* A single-column form keeps its measure even though the shell around it is
          now fluid — see `readableColumnClass`. Fields stretched to the full width
          of a wide display are harder to fill, not easier. */}
      <Card className={readableColumnClass}>
        <form action={submitShowroomReferral} className="flex flex-col gap-md">
          {referral ? <input type="hidden" name="referralId" value={referral.id} /> : null}

          <LabeledField
            label={t("showroom.refer.nameLabel")}
            htmlFor="displayName"
            hint={t("showroom.refer.nameHint")}
            error={error === "required" ? t("showroom.refer.requiredError") : undefined}
          >
            <Input
              id="displayName"
              name="displayName"
              required
              maxLength={120}
              defaultValue={referral?.displayName ?? ""}
              placeholder={t("showroom.refer.namePlaceholder")}
            />
          </LabeledField>

          <LabeledField
            label={t("showroom.refer.legalNameLabel")}
            htmlFor="legalName"
            optional={t("common.optional")}
          >
            <Input
              id="legalName"
              name="legalName"
              maxLength={120}
              defaultValue={referral?.legalName ?? ""}
            />
          </LabeledField>

          <div className="grid gap-md tablet:grid-cols-2">
            <LabeledField label={t("showroom.refer.governorateLabel")} htmlFor="governorate">
              <Select id="governorate" name="governorate" required defaultValue={gov}>
                <option value="">{t("showroom.refer.choose")}</option>
                {GOVERNORATES.map((g) => (
                  <option key={g} value={g}>
                    {t(`onboarding.consumer.governorates.${g}`)}
                  </option>
                ))}
              </Select>
            </LabeledField>
            <LabeledField label={t("showroom.refer.cityLabel")} htmlFor="city">
              <Select id="city" name="city" required defaultValue={referral?.city ?? ""}>
                <option value="">{t("showroom.refer.choose")}</option>
                {GOVERNORATES.flatMap((g) =>
                  CITIES_BY_GOVERNORATE[g].map((c) => (
                    <option key={c} value={c}>
                      {t(`onboarding.consumer.governorates.${g}`)} · {t(`onboarding.consumer.cities.${c}`)}
                    </option>
                  )),
                )}
              </Select>
            </LabeledField>
          </div>

          <LabeledField
            label={t("showroom.refer.branchLabel")}
            htmlFor="primaryBranchName"
            optional={t("common.optional")}
            hint={t("showroom.refer.branchHint")}
          >
            <Input
              id="primaryBranchName"
              name="primaryBranchName"
              maxLength={120}
              defaultValue={referral?.primaryBranchName ?? ""}
            />
          </LabeledField>

          <LabeledField
            label={t("showroom.refer.descriptionLabel")}
            htmlFor="description"
            optional={t("common.optional")}
          >
            <Textarea
              id="description"
              name="description"
              maxLength={1000}
              defaultValue={referral?.description ?? ""}
            />
          </LabeledField>

          {error && error !== "required" ? (
            <p role="alert" className="text-label text-danger">
              {t("showroom.error")}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-sm">
            <Button type="submit">{t("showroom.refer.submitAction")}</Button>
            <a href="/home/showroom" className="text-body font-medium text-accent hover:underline">
              {t("showroom.refer.backSearch")}
            </a>
          </div>
          <p className="text-label text-fg-muted">{t("showroom.refer.reviewNote")}</p>
        </form>
      </Card>
    </div>
  );
}
