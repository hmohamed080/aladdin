import { personalEntry, type WorkspaceEntry } from "@/lib/workspace/model";

// Display labels only. Engineer businesses retain the canonical organization code.
export const SHOWROOM_BUSINESS_LABELS = {
  showroom_dealer: { ar: "المعرض", en: "Showroom" },
  supplier: { ar: "المورد", en: "Supplier" },
  manufacturer: { ar: "المصنع", en: "Manufacturer" },
  importer: { ar: "المستورد", en: "Importer" },
  design_office: { ar: "المهندس", en: "Engineer" },
} as const;
export type ShowroomBusinessType = keyof typeof SHOWROOM_BUSINESS_LABELS;
export function isShowroomBusinessType(value: string | null): value is ShowroomBusinessType {
  return value !== null && Object.hasOwn(SHOWROOM_BUSINESS_LABELS, value);
}
/**
 * The one organization type that is framed by the Showroom shell on BOTH route trees (/showroom and /b2b).
 * The other eligible types see the Showroom shell on /showroom only; see `ShowroomDealerFrame`.
 */
export function isShowroomDealerOrg(orgType: string | null): boolean {
  return orgType === "showroom_dealer";
}
export function eligibleWorkspaces(entries: readonly WorkspaceEntry[]) {
  return entries.filter((entry): entry is Extract<WorkspaceEntry, { kind: "business" }> => entry.kind === "business" && isShowroomBusinessType(entry.orgType));
}
// The Personal context only when my_workspaces() emitted one, i.e. a personal persona was claimed. A business-only identity has none.
export function personalWorkspace(entries: readonly WorkspaceEntry[]) {
  return personalEntry([...entries]);
}
