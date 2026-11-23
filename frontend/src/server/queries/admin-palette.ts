import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import { listUsers, listOrganizations } from "@/server/queries/admin";
import { previewReviewQueue } from "@/server/queries/admin-preview";
import { listAdminStaff } from "@/server/queries/admin-rbac";
import { can, meets, type AdminAccess } from "@/lib/permissions/admin";
import type { PaletteItem } from "@/features/admin-preview/command-palette-search";
import type { Messages } from "@/lib/i18n/messages/en";

/**
 * The Admin Command Palette index (Phase 0D).
 *
 * Product Owner decision B: NO new global-search backend or server action. The
 * palette filters, in the browser, rows read here through EXISTING queries
 * (`listUsers`, `listOrganizations`, the Review queue, Admin Staff) plus the
 * isolated Organization Request fixtures (BL-023 has no backend). Those queries
 * are RLS-scoped exactly like the pages' own, and the result is capped by their
 * existing limits. Only sources the caller may open are queried.
 */
export async function loadAdminPaletteItems(access: AdminAccess, m: Messages): Promise<PaletteItem[]> {
  const supabase = await getServerSupabase();
  const pal = m.admin.preview.palette;
  const typeLabels = m.accountType as Record<string, string>;
  const orgTypeLabels = m.orgType as Record<string, string>;

  // Only index what the caller may open: a source they lack is never queried.
  const [users, orgs, queue, staff] = await Promise.all([
    can(access, "users.read") ? listUsers(supabase) : Promise.resolve([]),
    can(access, "organizations.read") ? listOrganizations(supabase) : Promise.resolve([]),
    meets(access, ["users.read", "organizations.read", "referrals.read"]) ? previewReviewQueue(supabase) : Promise.resolve([]),
    can(access, "admin_staff.read") ? listAdminStaff(supabase).then((r) => r ?? []) : Promise.resolve([]),
  ]);

  return [
    ...users.map((u): PaletteItem => ({
      id: `user-${u.id}`,
      group: "users",
      label: u.displayName || m.admin.users.unnamed,
      secondary: u.accountType ? (typeLabels[u.accountType] ?? u.accountType) : m.admin.users.businessOnly,
      href: `/admin/users/${u.id}`,
    })),
    ...orgs.map((o): PaletteItem => ({
      id: `org-${o.id}`,
      group: "organizations",
      label: o.name,
      secondary: orgTypeLabels[o.orgType] ?? o.orgType,
      href: `/admin/organizations/${o.id}`,
    })),
    ...queue.flatMap((item): PaletteItem[] => {
      if (item.kind === "verification") {
        return [{
          id: `verification-${item.row.id}`,
          group: "reviews",
          label: item.row.subjectName,
          secondary: pal.verification.replace("{name}", item.row.subjectName),
          href: `/admin/review/verification/${item.row.id}`,
        }];
      }
      if (item.kind === "networkReferral") {
        return [{
          id: `network-${item.row.id}`,
          group: "networkReferrals",
          label: item.row.displayName ?? "",
          secondary: pal.networkReferral.replace("{name}", item.row.referrerName ?? "—"),
          href: `/admin/review/network-referral/${item.row.id}`,
        }];
      }
      // Sales referrals belong to the Review requests group.
      return [{
        id: `sales-${item.row.id}`,
        group: "reviews",
        label: item.row.displayName ?? "",
        secondary: m.admin.preview.review.typeSalesReferral,
        href: `/admin/review/sales-referral/${item.row.id}`,
      }];
    }),
    ...staff.map((s): PaletteItem => ({
      id: `staff-${s.userId}`,
      group: "staff",
      label: s.displayName || m.admin.users.unnamed,
      secondary: s.assignments.filter((a) => a.isActive).map((a) => a.roleName).join(", ") || m.admin.preview.staff.statusDisabled,
      href: `/admin/staff?q=${encodeURIComponent(s.displayName)}`,
    })),
  ].filter((i) => i.label);
}
