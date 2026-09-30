import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listUsers, listOrganizations } from "@/server/queries/admin";
import { previewReviewQueue } from "@/server/queries/admin-preview";
import { listAdminStaff } from "@/server/queries/admin-rbac";
import { requireAdminStaff } from "@/server/authorization/admin";
import { can, meets } from "@/lib/permissions/admin";
import { PREVIEW_ORG_REQUESTS } from "@/features/admin-preview/fixtures";
import type { PaletteItem } from "@/features/admin-preview/command-palette-search";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { PreviewShell } from "@/features/admin-preview/preview-shell";

export const dynamic = "force-dynamic";

/**
 * Phase 0 — Admin Frontend Blueprint / Preview.
 *
 * Nested under `app/admin/layout.tsx` (the Admin Staff door); each page under
 * `/admin/preview/**` additionally guards its own route (requireAdminRoute).
 * This layout only needs the caller's access to decide which palette sources
 * to load and which Preview tabs to draw.
 *
 * Phase 0D — Command Palette index. Product Owner decision B: NO new global-search
 * backend or server action. The palette filters, in the browser, rows this
 * layout already reads through EXISTING queries (`listUsers`, `listOrganizations`,
 * the Review queue, Admin Staff) plus the isolated Organization Request fixtures
 * (BL-023 has no backend). Those queries are RLS-scoped exactly like the pages'
 * own, and the result is capped by their existing limits. Real, server-side global
 * Admin search is a later Admin Core backend-wiring item.
 */
export default async function AdminPreviewLayout({ children }: { children: ReactNode }) {
  const access = await requireAdminStaff();
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
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

  const items: PaletteItem[] = [
    ...users.map((u): PaletteItem => ({
      id: `user-${u.id}`,
      group: "users",
      label: u.displayName || m.admin.users.unnamed,
      secondary: u.accountType ? (typeLabels[u.accountType] ?? u.accountType) : m.admin.users.businessOnly,
      href: `/admin/preview/users/${u.id}`,
    })),
    ...orgs.map((o): PaletteItem => ({
      id: `org-${o.id}`,
      group: "organizations",
      label: o.name,
      secondary: orgTypeLabels[o.orgType] ?? o.orgType,
      href: `/admin/preview/organizations/${o.id}`,
    })),
    ...PREVIEW_ORG_REQUESTS.map((r): PaletteItem => ({
      id: `orgreq-${r.id}`,
      group: "reviews",
      label: r.orgName,
      secondary: pal.orgRequest.replace("{name}", r.requesterName),
      href: `/admin/preview/review/org-request/${r.id}`,
    })),
    ...queue.flatMap((item): PaletteItem[] => {
      if (item.kind === "verification") {
        return [{
          id: `verification-${item.row.id}`,
          group: "reviews",
          label: item.row.subjectName,
          secondary: pal.verification.replace("{name}", item.row.subjectName),
          href: `/admin/preview/review/verification/${item.row.id}`,
        }];
      }
      if (item.kind === "networkReferral") {
        return [{
          id: `network-${item.row.id}`,
          group: "networkReferrals",
          label: item.row.displayName ?? "",
          secondary: pal.networkReferral.replace("{name}", item.row.referrerName ?? "—"),
          href: `/admin/preview/review/network-referral/${item.row.id}`,
        }];
      }
      // Sales referrals belong to the Review requests group.
      return [{
        id: `sales-${item.row.id}`,
        group: "reviews",
        label: item.row.displayName ?? "",
        secondary: m.admin.preview.review.typeSalesReferral,
        href: `/admin/preview/review/sales-referral/${item.row.id}`,
      }];
    }),
    ...staff.map((s): PaletteItem => ({
      id: `staff-${s.userId}`,
      group: "staff",
      label: s.displayName || m.admin.users.unnamed,
      secondary: s.assignments.filter((a) => a.isActive).map((a) => a.roleName).join(", ") || m.admin.preview.staff.statusDisabled,
      href: `/admin/preview/staff?q=${encodeURIComponent(s.displayName)}`,
    })),
  ].filter((i) => i.label);

  return (
    <PreviewShell paletteItems={items} access={access}>
      {children}
    </PreviewShell>
  );
}
