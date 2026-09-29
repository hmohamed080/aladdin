import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPlatformRole, type PlatformRole } from "@/server/queries/platform";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { Badge, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

/**
 * Phase 0B — Access. "Your role" is real (`loadPlatformRole()`, the same read
 * the real Admin shell uses to gate every route). The capability matrix below
 * is a static rendering of the ALREADY-APPROVED specification
 * (`docs/technical/07_permissions_matrix.md` §4-§5) — not a live permission
 * check and not an editor. No dynamic RBAC management is built here
 * (PD-008, deferred).
 *
 * Rows below expand the original 8-row §5 summary into the more granular
 * per-domain view §4 already documents (identity/org read+verify+suspend
 * split out, referrals, the new Admin Staff capability), so the matrix
 * actually answers what Support/Moderator/Administrator can do on the
 * Users/Organizations/Review surfaces this Preview adds — per PD-004,
 * sensitive actions (suspend, govern, manage reference data, manage
 * platform roles, adjust Points, manage Admin Staff) stay Administrator-only
 * rather than being available at the lowest tier.
 */
const MATRIX: { key: string; support: boolean; moderator: boolean; administrator: boolean }[] = [
  { key: "readUsers", support: true, moderator: true, administrator: true },
  { key: "verifyUsers", support: true, moderator: true, administrator: true },
  { key: "suspendUsers", support: false, moderator: false, administrator: true },
  { key: "readOrgs", support: true, moderator: true, administrator: true },
  { key: "verifyOrgs", support: true, moderator: true, administrator: true },
  { key: "suspendOrgs", support: false, moderator: false, administrator: true },
  { key: "reviewReferrals", support: true, moderator: true, administrator: true },
  { key: "moderateContent", support: false, moderator: true, administrator: true },
  { key: "readAuditLog", support: true, moderator: true, administrator: true },
  { key: "adjustPoints", support: false, moderator: false, administrator: true },
  { key: "manageReferenceData", support: false, moderator: false, administrator: true },
  { key: "managePlatformRoles", support: false, moderator: false, administrator: true },
  { key: "manageAdminStaff", support: false, moderator: false, administrator: true },
];

export default async function PreviewAccessPage() {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const role = await loadPlatformRole(supabase);
  const at = m.admin.preview.access;
  const capLabels = at.capabilities as Record<string, string>;

  const columns: { key: PlatformRole; label: string }[] = [
    { key: "support", label: at.support },
    { key: "moderator", label: at.moderator },
    { key: "administrator", label: at.administrator },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={at.title} subtitle={at.subtitle} />

      <Card className="flex items-center gap-3">
        <span className="text-label text-fg-muted">{at.yourRole}</span>
        <Badge tone="accent">{role ? m.admin.roleLabel[role] : "—"}</Badge>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[32rem] border-collapse text-body">
          <thead>
            <tr className="border-b bg-surface-2/40 text-label text-fg-muted">
              <th className="px-md py-2 text-start font-medium">{at.capability}</th>
              {columns.map((c) => (
                <th key={c.key} className={cn("px-md py-2 text-center font-medium", role === c.key && "text-accent")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((row) => (
              <tr key={row.key} className="border-b last:border-0">
                <td className="px-md py-2.5 text-fg-secondary">{capLabels[row.key] ?? row.key}</td>
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-md py-2.5 text-center", role === c.key && "bg-accent-solid/5")}>
                    {row[c.key] ? <span className="text-success">✓</span> : <span className="text-fg-muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-label text-fg-muted">{at.rbacComparisonNote}</p>
    </div>
  );
}
