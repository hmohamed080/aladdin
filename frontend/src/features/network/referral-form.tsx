import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField, Textarea } from "@/components/ui/controls";
import { BadgeCheckIcon, BuildingIcon, SearchIcon, UsersIcon } from "@/components/ui/icons";
import { createExistingReferral, createNewReferral } from "@/server/actions/network-referrals";
import type { ReferralOrgResult } from "@/server/queries/network-referrals";
import type { TranslateFn } from "@/lib/i18n/translate";
import { HomeHeader } from "@/features/home/parts";

/**
 * "Add a showroom I know" — §8's hero, followed through to its own route,
 * the same shape `/home/showroom` gives the Sales affiliation search
 * (search → confirm, with a "not found" fallback to a referral form). NOT a
 * modal: no Dialog primitive exists in this Foundation, and a route keeps
 * the flow linkable, back-button-safe and server-rendered like every other
 * form in this codebase.
 */
export function NetworkReferralForm({
  query,
  results,
  error,
  t,
}: {
  query: string;
  results: ReferralOrgResult[];
  error?: string;
  t: TranslateFn;
}) {
  return (
    <div className="flex flex-col gap-xl">
      <HomeHeader
        eyebrow={t("network.hero.title")}
        title={t("network.refer.title")}
        name={t("network.refer.title")}
        lead={t("network.refer.subtitle")}
      />

      {error ? (
        <p role="alert" className="text-label text-danger">
          {t("network.refer.error")}
        </p>
      ) : null}

      {/* Path A — an organization already on Aladdin. */}
      <Card className="flex flex-col gap-md">
        <div className="flex items-center gap-2">
          <BuildingIcon size={18} className="shrink-0 text-fg-secondary" />
          <h2 className="text-title text-fg">{t("network.refer.knownTitle")}</h2>
        </div>
        <p className="text-label text-fg-secondary">{t("network.refer.knownBody")}</p>

        <form method="get" action="/home/network/refer" className="flex flex-col gap-md tablet:flex-row tablet:items-end">
          <div className="flex-1">
            <LabeledField label={t("network.refer.searchLabel")} htmlFor="q" hint={t("network.refer.searchHint")}>
              <Input
                id="q"
                name="q"
                defaultValue={query}
                placeholder={t("network.refer.searchPlaceholder")}
                autoComplete="off"
                minLength={2}
              />
            </LabeledField>
          </div>
          <Button type="submit" className="tablet:mb-0">
            <SearchIcon size={16} className="me-1.5" />
            {t("network.refer.searchAction")}
          </Button>
        </form>

        {query.length >= 2 ? (
          results.length > 0 ? (
            <ul className="flex flex-col gap-sm">
              {results.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-sm rounded-md border bg-surface p-md">
                  <span className="flex min-w-0 items-center gap-sm">
                    <BuildingIcon size={18} className="shrink-0 text-fg-secondary" />
                    <span className="truncate text-body-lg font-medium text-fg">
                      <bdi dir="auto">{r.name}</bdi>
                    </span>
                    {r.isVerified ? (
                      <Badge tone="success">
                        <BadgeCheckIcon size={13} />
                        {t("network.refer.verified")}
                      </Badge>
                    ) : null}
                  </span>
                  <form action={createExistingReferral}>
                    <input type="hidden" name="organizationId" value={r.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {t("network.refer.referThis")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <StatePanel title={t("network.refer.empty")} body={t("network.refer.emptyBody")} icon={<SearchIcon size={20} />} />
          )
        ) : null}
      </Card>

      {/* Path B — a showroom not yet on Aladdin. */}
      <Card className="flex flex-col gap-md">
        <div className="flex items-center gap-2">
          <UsersIcon size={18} className="shrink-0 text-fg-secondary" />
          <h2 className="text-title text-fg">{t("network.refer.newTitle")}</h2>
        </div>
        <p className="text-label text-fg-secondary">{t("network.refer.newBody")}</p>

        <form action={createNewReferral} className="flex flex-col gap-md">
          <LabeledField label={t("network.refer.nameLabel")} htmlFor="displayName">
            <Input id="displayName" name="displayName" required minLength={2} maxLength={120} />
          </LabeledField>
          <div className="grid gap-md tablet:grid-cols-2">
            <LabeledField label={t("network.refer.governorateLabel")} htmlFor="governorate">
              <Input id="governorate" name="governorate" required maxLength={80} />
            </LabeledField>
            <LabeledField label={t("network.refer.cityLabel")} htmlFor="city">
              <Input id="city" name="city" required maxLength={80} />
            </LabeledField>
          </div>
          <LabeledField
            label={t("network.refer.phoneLabel")}
            htmlFor="phone"
            optional={t("common.optional")}
            hint={t("network.refer.phoneHint")}
          >
            <Input id="phone" name="phone" type="tel" maxLength={32} />
          </LabeledField>
          <LabeledField label={t("network.refer.noteLabel")} htmlFor="note" optional={t("common.optional")}>
            <Textarea id="note" name="note" rows={3} maxLength={500} />
          </LabeledField>
          <div className="flex flex-wrap items-center gap-sm">
            <Button type="submit">{t("network.refer.submitAction")}</Button>
            <p className="text-label text-fg-muted">{t("network.refer.reviewNote")}</p>
          </div>
        </form>
      </Card>
    </div>
  );
}
