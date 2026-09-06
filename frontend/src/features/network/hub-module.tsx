import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { UsersIcon } from "@/components/ui/icons";
import { Monogram } from "@/components/ui/data-table";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { NetworkOrganization } from "@/server/queries/network";

/**
 * The Network module on the Profile Hub (§10 of the increment brief).
 *
 * Same shape as the Portfolio, Certificates and Reviews cards it joins — icon,
 * title, one line, a real number, one action — because `04-account-overview.jpeg`
 * keeps them at one level and this is not the Account Overview redesign
 * (Increment 14). ZERO ORGANIZATIONS SHOWS NO MONOGRAM ROW, the same reasoning
 * `ReviewsModule` applies to a fresh professional's rating: an empty network is
 * not a number to lead with, it is a state to explain.
 */
export function NetworkModule({
  organizations,
  t,
}: {
  /** Newest-first; only the first few are shown as representative monograms. */
  organizations: readonly NetworkOrganization[];
  t: TranslateFn;
}) {
  const completedTotal = organizations.reduce((sum, o) => sum + o.completedCount, 0);

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-2">
        <UsersIcon size={18} className="shrink-0 text-fg-secondary" />
        <h3 className="text-title text-fg">{t("profile.network.title")}</h3>
      </div>
      <p className="text-label text-fg-secondary">{t("profile.network.body")}</p>

      {organizations.length === 0 ? (
        <p className="text-label text-fg-muted">{t("profile.network.none")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-3">
            <span className="text-headline tabular-nums text-fg">{organizations.length}</span>
            <span className="pb-1 text-label text-fg-secondary">
              {t("network.list.completedCount", { n: completedTotal })}
            </span>
          </div>
          <ul className="flex flex-wrap items-center gap-2" aria-hidden="true">
            {organizations.slice(0, 5).map((o) => (
              <li key={o.orgId} title={o.orgName}>
                <Monogram name={o.orgName} size={28} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href="/home/network" className="mt-auto">
        <Button type="button" variant="outline">
          {t("profile.network.manage")}
        </Button>
      </Link>
    </Card>
  );
}
