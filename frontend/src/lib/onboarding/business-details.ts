import { z } from "zod";
import { toCanonicalPhone } from "@/lib/contact/phone";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
export const SHOWROOM_ACTIVITIES = ["decor_showroom", "paint_showroom", "decor_and_paint_showroom", "building_and_finishing_supplies_retailer"] as const;
/**
 * The business activity list of each business type (public.activities, owner lists 2026-10-29), asked once in business
 * setup. Business types without a list (contractor company, design office) are not asked.
 */
export const BUSINESS_ACTIVITIES = {
  showroom_dealer: SHOWROOM_ACTIVITIES,
  supplier: ["distributor", "wholesaler"],
  manufacturer: ["paint_manufacturer", "decor_manufacturer"],
  importer: ["decor_supplies_importer", "paint_importer"],
} as const;
export type BusinessActivity = (typeof BUSINESS_ACTIVITIES)[keyof typeof BUSINESS_ACTIVITIES][number];
const ALL_BUSINESS_ACTIVITIES = Object.values(BUSINESS_ACTIVITIES).flat() as [BusinessActivity, ...BusinessActivity[]];
/** The activity list of a business type; empty when the type has none. */
export function businessActivitiesOf(orgType: string | null | undefined): readonly BusinessActivity[] {
  return orgType && orgType in BUSINESS_ACTIVITIES ? BUSINESS_ACTIVITIES[orgType as keyof typeof BUSINESS_ACTIVITIES] : [];
}
/** A business type with a list needs one activity from its own list. */
export function businessActivityError(orgType: string | null | undefined, activity: string | null | undefined): string | null {
  const list = businessActivitiesOf(orgType);
  if (list.length === 0) return null;
  return activity && (list as readonly string[]).includes(activity) ? null : "onboarding.error.activityRequired";
}
export const BUSINESS_ADDRESS_MAX_WORDS = 250;
export function businessAddressWords(value: string): number { return value.trim().split(/\s+/u).filter(Boolean).length; }
export const businessAddressSchema = z.string().trim().max(16384).refine(value => businessAddressWords(value) <= BUSINESS_ADDRESS_MAX_WORDS, "addressTooLong");
export const businessDetailsSchema = z.object({
  contactPhone: z.string().max(32).nullish(),
  contactEmail: z.string().trim().max(254).nullish().transform(v => v ? v.toLowerCase() : null).refine(v => !v || z.string().email().safeParse(v).success, "emailInvalid"),
  activityType: z.enum(ALL_BUSINESS_ACTIVITIES).nullish(),
  detailedAddress: businessAddressSchema.nullish(),
});
export function validBusinessPhone(value: string | null | undefined): boolean {
  // libphonenumber retains some nationally valid numbers beyond E.164's
  // 15-digit transport limit. The authoritative storage contract rejects those.
  if (!value || !/^\+[1-9][0-9]{1,14}$/.test(value)) return false;
  const phone = parsePhoneNumberFromString(value);
  return !!phone?.country && toCanonicalPhone(value, phone.country)?.e164 === value;
}
export function showroomIdentityError(input: z.input<typeof businessDetailsSchema>): string | null {
  const parsed = businessDetailsSchema.safeParse(input);
  if (!parsed.success) return "onboarding.error.contactInvalid";
  if (!validBusinessPhone(input.contactPhone)) return "onboarding.error.showroomPhoneRequired";
  if (!input.activityType) return "onboarding.error.activityRequired";
  return null;
}

export type SHOWROOM_ACTIVITIES_TYPE = BusinessActivity | null;
