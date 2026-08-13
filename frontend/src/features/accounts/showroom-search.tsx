import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField, Select } from "@/components/ui/controls";
import { BadgeCheckIcon, BuildingIcon, SearchIcon } from "@/components/ui/icons";
import { requestShowroomAffiliation } from "@/server/actions/affiliation";
import type { ShowroomBranch, ShowroomResult } from "@/server/queries/affiliation";
import type { TranslateFn } from "@/lib/i18n/translate";
import { HomeHeader } from "@/features/home/parts";

/**
 * Find the showroom you work for, and ask to join it.
 *
 * A GET form drives the search, so results are linkable, survive a refresh, and
 * work without client JavaScript — the whole flow is server-rendered. Choosing a
 * showroom re-renders with its branches (a second GET), and the join request is a
 * POST server action.
 *
 * Two things this screen must never imply. It does not create a business: the
 * "can't find it" path leads to a referral for platform review, not to the owner
 * creation wizard. And it does not grant access: the copy says an Owner or Manager
 * of that showroom decides, because they do.
 */
export function ShowroomSearch({
  query,
  results,
  selected,
  branches,
  error,
  t,
}: {
  query: string;
  results: ShowroomResult[];
  selected?: ShowroomResult;
  branches: ShowroomBranch[];
  error?: string;
  t: TranslateFn;
}) {
  return (
    <div className="flex flex-col gap-xl">
      <HomeHeader
        eyebrow={t("showroom.eyebrow")}
        title={t("showroom.title")}
        name={t("showroom.title")}
        lead={t("showroom.subtitle")}
      />

      <Card className="flex flex-col gap-md">
        {/* GET: the query lives in the URL, so a result list is shareable and a
            refresh does not lose it. */}
        <form method="get" action="/home/showroom" className="flex flex-col gap-md tablet:flex-row tablet:items-end">
          <div className="flex-1">
            <LabeledField label={t("showroom.searchLabel")} htmlFor="q" hint={t("showroom.searchHint")}>
              <Input
                id="q"
                name="q"
                defaultValue={query}
                placeholder={t("showroom.searchPlaceholder")}
                autoComplete="off"
                minLength={2}
              />
            </LabeledField>
          </div>
          <Button type="submit" className="tablet:mb-0">
            <SearchIcon size={16} className="me-1.5" />
            {t("showroom.searchAction")}
          </Button>
        </form>

        {error ? (
          <p role="alert" className="text-label text-danger">
            {t("showroom.error")}
          </p>
        ) : null}
      </Card>

      {/* The confirm step: one showroom, its branches, and the request. */}
      {selected ? (
        <Card className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center gap-sm">
            <BuildingIcon size={20} className="shrink-0 text-fg-secondary" />
            <h2 className="text-title text-fg">{selected.name}</h2>
            {selected.isVerified ? (
              <Badge tone="success">
                <BadgeCheckIcon size={13} />
                {t("showroom.verified")}
              </Badge>
            ) : (
              <Badge tone="neutral">{t("showroom.unverified")}</Badge>
            )}
          </div>

          <form action={requestShowroomAffiliation} className="flex flex-col gap-md">
            <input type="hidden" name="organizationId" value={selected.id} />
            {branches.length > 0 ? (
              <LabeledField
                label={t("showroom.branchLabel")}
                htmlFor="branchId"
                optional={t("common.optional")}
                hint={t("showroom.branchHint")}
              >
                <Select id="branchId" name="branchId" defaultValue="">
                  <option value="">{t("showroom.branchAny")}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </LabeledField>
            ) : null}
            <LabeledField
              label={t("showroom.noteLabel")}
              htmlFor="note"
              optional={t("common.optional")}
              hint={t("showroom.noteHint")}
            >
              <Input id="note" name="note" maxLength={500} placeholder={t("showroom.notePlaceholder")} />
            </LabeledField>
            <div className="flex flex-wrap items-center gap-sm">
              <Button type="submit">{t("showroom.requestAction")}</Button>
              <p className="text-label text-fg-muted">{t("showroom.approvalNote")}</p>
            </div>
          </form>
        </Card>
      ) : null}

      {/* Results. */}
      {query.length >= 2 && !selected ? (
        results.length > 0 ? (
          <section className="flex flex-col gap-md">
            <h2 className="text-title text-fg">{t("showroom.results", { n: results.length })}</h2>
            <ul className="flex flex-col gap-sm">
              {results.map((r) => (
                <li key={r.id}>
                  <a
                    href={`/home/showroom?q=${encodeURIComponent(query)}&org=${r.id}`}
                    className="flex flex-wrap items-center justify-between gap-sm rounded-md border bg-surface p-md shadow-card transition-colors hover:border-strong hover:bg-surface-2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <span className="flex min-w-0 items-center gap-sm">
                      <BuildingIcon size={18} className="shrink-0 text-fg-secondary" />
                      <span className="truncate text-body-lg font-medium text-fg">{r.name}</span>
                      {r.isVerified ? (
                        <Badge tone="success">
                          <BadgeCheckIcon size={13} />
                          {t("showroom.verified")}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-label font-medium text-accent">{t("showroom.choose")}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <StatePanel
            title={t("showroom.empty")}
            body={t("showroom.emptyBody")}
            icon={<SearchIcon size={20} />}
          />
        )
      ) : null}

      {/* The "not found" path. Always available — a salesperson may know before
          searching that their employer is not on Aladdin yet. */}
      <Card className="flex flex-col gap-sm">
        <h2 className="text-title text-fg">{t("showroom.notFound")}</h2>
        <p className="text-body text-fg-secondary">{t("showroom.notFoundBody")}</p>
        <div>
          <a
            href="/home/showroom/refer"
            className="inline-flex items-center gap-1.5 text-body-lg font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("showroom.addShowroom")}
          </a>
        </div>
        <p className="text-label text-fg-muted">{t("showroom.referralNote")}</p>
      </Card>
    </div>
  );
}
