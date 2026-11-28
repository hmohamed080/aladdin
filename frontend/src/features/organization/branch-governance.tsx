"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/primitives";
import { Input, LabeledField, Select } from "@/components/ui/controls";
import { BadgeCheckIcon, MapPinIcon, PlusIcon } from "@/components/ui/icons";
import { BranchIdentityDialog } from "@/features/organization/branch-identity-dialog";
import { BranchLocationDialog } from "@/features/organization/branch-location-dialog";
import { describeLocation, type BranchLocationValue } from "@/lib/location/describe-location";
import { useI18n } from "@/lib/i18n/context";
import { resolveBilingualText } from "@/lib/i18n/bilingual";
import { TIMEZONE_OPTIONS } from "@/lib/workspace/timezone-options";
import {
  createBranchAction,
  requestBranchVerificationAction,
  setBranchActiveAction,
} from "@/server/actions/organization-governance";
import type { Messages } from "@/lib/i18n/messages/en";

export type BranchGovernanceRow = {
  id: string;
  name: string;
  nameAr: string | null;
  nameEn: string | null;
  addressAr: string | null;
  addressEn: string | null;
  timezone: string | null;
  isActive: boolean;
  locationVerified: boolean;
  reviewStatus: "pending_review" | "needs_changes" | "rejected" | null;
  reviewReason: string | null;
  hasUnreviewedChanges: boolean;
};

/**
 * The branch state shown to the owner. INTERNAL is the default the moment a branch exists; a
 * branch is a verified LOCATION only from an Admin-approved snapshot, so a pending, rejected or
 * edited branch is never presented as verified.
 */
export function branchState(row: Pick<BranchGovernanceRow, "locationVerified" | "reviewStatus">) {
  if (row.reviewStatus) return row.reviewStatus;
  return row.locationVerified ? "verified" : "internal";
}

const TONE = {
  internal: "neutral",
  pending_review: "info",
  needs_changes: "warning",
  rejected: "danger",
  verified: "success",
} as const;

/**
 * Branches of an APPROVED organization, for an owner or manager. Adding a branch needs no review
 * and changes nothing about the organization's audience; asking for a verified public location
 * does. Authority is enforced by the RPCs (approved parent, membership, branch.manage), never by
 * what this component chooses to render.
 */
export function BranchGovernance({
  m,
  orgId,
  rows,
  orgIsApproved,
  locations = {},
}: {
  m: Messages;
  orgId: string;
  rows: BranchGovernanceRow[];
  orgIsApproved: boolean;
  /** Governorate / city per branch id, as given at registration. */
  locations?: Record<string, BranchLocationValue>;
}) {
  const { t, locale } = useI18n();

  return (
    <div className="flex flex-col gap-md" data-testid="branch-governance">
      {orgIsApproved ? (
        <div className="flex justify-end">
          <ConfirmDialog
            trigger={t("governance.branches.add")}
            triggerVariant="outline"
            triggerIcon={<PlusIcon size={15} />}
            title={t("governance.branches.addTitle")}
            confirmLabel={t("governance.branches.confirmAdd")}
            confirmVariant="accent"
            formAction={createBranchAction}
          >
            <input type="hidden" name="orgId" value={orgId} />
            <p className="text-body text-fg-secondary">{t("governance.branches.addHelp")}</p>
            <LabeledField label={t("governance.branches.fieldName")} htmlFor="nb-name">
              <Input id="nb-name" name="name" maxLength={120} required />
            </LabeledField>
            <LabeledField label={t("settings.field.nameAr")} htmlFor="nb-name-ar" optional={t("common.optional")}>
              <Input id="nb-name-ar" name="nameAr" dir="rtl" maxLength={120} />
            </LabeledField>
            <LabeledField label={t("settings.field.nameEn")} htmlFor="nb-name-en" optional={t("common.optional")}>
              <Input id="nb-name-en" name="nameEn" dir="ltr" maxLength={120} />
            </LabeledField>
            <LabeledField label={t("settings.field.addressAr")} htmlFor="nb-addr-ar" optional={t("common.optional")}>
              <Input id="nb-addr-ar" name="addressAr" dir="rtl" maxLength={300} />
            </LabeledField>
            <LabeledField label={t("settings.field.addressEn")} htmlFor="nb-addr-en" optional={t("common.optional")}>
              <Input id="nb-addr-en" name="addressEn" dir="ltr" maxLength={300} />
            </LabeledField>
            <LabeledField label={t("settings.field.timezone")} htmlFor="nb-tz" optional={t("common.optional")}>
              <Select id="nb-tz" name="timezone" defaultValue="">
                <option value="">{t("settings.timezoneUnset")}</option>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </LabeledField>
          </ConfirmDialog>
        </div>
      ) : null}

      <ul className="grid gap-sm tablet:grid-cols-2" data-testid="branch-list">
        {rows.map((b) => {
          const state = branchState(b);
          const displayName = resolveBilingualText(locale, b.name, b.nameAr, b.nameEn);
          const address = locale === "ar" ? (b.addressAr ?? b.addressEn) : (b.addressEn ?? b.addressAr);
          const canRequest =
            orgIsApproved && b.isActive && state !== "pending_review" && (!b.locationVerified || b.hasUnreviewedChanges);
          return (
            <li
              key={b.id}
              data-testid={`branch-${state}`}
              className="flex min-w-0 flex-col gap-1.5 rounded-sm bg-surface-2/50 px-3 py-2 text-body text-fg-secondary"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-fg-muted" aria-hidden="true">
                    <MapPinIcon size={15} />
                  </span>
                  <span className="min-w-0 truncate text-fg">{displayName}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {!b.isActive ? <Badge tone="neutral">{t("governance.branches.inactive")}</Badge> : null}
                  <Badge tone={TONE[state]}>
                    {state === "verified" ? <BadgeCheckIcon size={13} /> : null}
                    {t(`governance.branches.status.${state}`)}
                  </Badge>
                </span>
              </span>
              {describeLocation(locations[b.id], locale) ? <span className="ms-6 text-label text-fg-muted" data-testid="branch-location">{describeLocation(locations[b.id], locale)}</span> : null}
              {address ? <span className="ms-6 text-label text-fg-muted">{address}</span> : null}
              {b.hasUnreviewedChanges && state !== "pending_review" ? (
                <span className="ms-6 text-label text-warning" data-testid="branch-unreviewed">
                  {t("governance.branches.unreviewed")}
                </span>
              ) : null}
              {b.reviewReason && (state === "needs_changes" || state === "rejected") ? (
                <span className="ms-6 text-label text-fg-secondary" data-testid="branch-review-reason">
                  {t("governance.branches.note")}: {b.reviewReason}
                </span>
              ) : null}
              <span className="flex flex-wrap items-center gap-1.5 ps-6">
                <BranchIdentityDialog
                  m={m}
                  branchId={b.id}
                  branchName={displayName}
                  nameAr={b.nameAr}
                  nameEn={b.nameEn}
                  addressAr={b.addressAr}
                  addressEn={b.addressEn}
                  timezone={b.timezone}
                />
                <BranchLocationDialog branchId={b.id} branchName={displayName} location={locations[b.id]} />
                {canRequest ? (
                  <ConfirmDialog
                    trigger={b.locationVerified ? t("governance.branches.requestAmendment") : t("governance.branches.requestVerification")}
                    triggerVariant="outline"
                    title={t("governance.branches.verifyTitle")}
                    body={t("governance.branches.verifyBody")}
                    confirmLabel={t("governance.branches.verifyConfirm")}
                    confirmVariant="accent"
                    formAction={requestBranchVerificationAction}
                  >
                    <input type="hidden" name="branchId" value={b.id} />
                  </ConfirmDialog>
                ) : null}
                <ConfirmDialog
                  trigger={b.isActive ? t("governance.branches.deactivate") : t("governance.branches.reactivate")}
                  triggerVariant="ghost"
                  title={b.isActive ? t("governance.branches.deactivateTitle") : t("governance.branches.reactivate")}
                  body={b.isActive ? t("governance.branches.deactivateBody") : undefined}
                  confirmLabel={b.isActive ? t("governance.branches.deactivate") : t("governance.branches.reactivate")}
                  confirmVariant="primary"
                  formAction={setBranchActiveAction}
                >
                  <input type="hidden" name="branchId" value={b.id} />
                  <input type="hidden" name="active" value={b.isActive ? "false" : "true"} />
                </ConfirmDialog>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
