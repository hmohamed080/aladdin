"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { TranslateFn } from "@/lib/i18n/translate";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatDate, formatMoney, formatNumber } from "@/lib/ui/format";
import { Badge, Card, Field, ProgressMeter, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { ACCOUNT_VIEWS, viewAsHref, type ViewAsKind } from "@/lib/admin/view-as/registry";
import type { DashboardData, PointsData, PortfolioData, ProfileData, ReviewsData, WorkData } from "@/lib/admin/view-as/craftsman-data";

/**
 * The six READ-ONLY craftsman sections of Admin View-As. They render plain data for the explicitly authorized subject
 * (see server/view-as/readers.ts) and reuse the product's own primitives, formatters and label catalogs; they import no
 * editor, no form and no server action, and every link is built by `viewAsHref`, so none can leave the view.
 *
 * Private files (avatar, cover, portfolio media, certificate files) are NOT displayed here: this stage shows their
 * metadata and a neutral placeholder. Delivering them is the separately reviewed private-media stage.
 */

/** A catalog label, or the supplied fallback when the key has no translation (never a raw message path). */
function lbl(t: TranslateFn, path: string, fallback: string): string {
  const out = t(path);
  return out === path ? fallback : out;
}
/** A known enum value's label, else the raw value (never a message path). */
const val = (t: TranslateFn, v: string) => lbl(t, `admin.viewAs.vals.${v}`, v);
const dash = (t: TranslateFn) => t("admin.viewAs.f.none");
const yesNo = (t: TranslateFn, v: boolean) => t(v ? "admin.viewAs.f.yes" : "admin.viewAs.f.no");

export function MediaPlaceholder({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="img"
      aria-label={label ?? t("admin.viewAs.mediaPlaceholder")}
      title={t("admin.viewAs.mediaPlaceholderHint")}
      className="grid h-16 w-16 shrink-0 place-items-center rounded-md border border-dashed bg-surface-2 text-center text-label text-fg-muted"
    >
      <span aria-hidden>🔒</span>
    </div>
  );
}

/**
 * A private file of the viewed account. `src` is a short-lived, per-request-authorized link from the media-edge Worker (Stage 4), or
 * null/absent while delivery is off, in which case the neutral placeholder stays. Never a storage key, never a public URL.
 */
export function PrivateImage({ src, label }: { src: string | undefined; label: string }) {
  if (!src) return <MediaPlaceholder label={label} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the link is an authorized, expiring Worker URL; optimisation would re-fetch it unauthenticated
    <img src={src} alt={label} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      className="h-16 w-16 shrink-0 rounded-md border object-cover" />
  );
}

export function ViewAsNav({ userId, kind }: { userId: string; kind: ViewAsKind }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <nav aria-label={t("admin.viewAs.nav")} className="flex flex-wrap gap-2">
      {ACCOUNT_VIEWS[kind].sections.map((s) => {
        const active = pathname === viewAsHref(userId, s.segment);
        return (
          <Link
            key={s.key}
            href={viewAsHref(userId, s.segment)}
            aria-current={active ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-body ${active ? "border-accent bg-accent/10 font-medium text-fg" : "text-fg-muted hover:bg-surface-hover"}`}
          >
            {t(`admin.viewAs.sections.${s.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card pad="sm">
      <div className="text-label text-fg-muted">{label}</div>
      <div className="text-title font-semibold text-fg">{value}</div>
      {hint ? <div className="text-label text-fg-muted">{hint}</div> : null}
    </Card>
  );
}

function CompletionCard({ completion }: { completion: { percent: number; missing: string[] } }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <SectionTitle>{t("admin.viewAs.f.completion")}</SectionTitle>
      <ProgressMeter value={completion.percent} label={t("admin.viewAs.f.completion")} />
      <p className="mt-2 text-label text-fg-muted">{formatNumber(completion.percent, locale)}%</p>
      {completion.missing.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-label text-fg-muted">{t("admin.viewAs.f.completionMissing")}:</span>
          {completion.missing.map((m) => (
            <Badge key={m} tone="warning">
              {lbl(t, `admin.preview.directory.completionItems.${m}`, m)}
            </Badge>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
export function DashboardSection({ data }: { data: DashboardData }) {
  const { t, locale } = useI18n();
  const c = data.workCounts;
  return (
    <div className="flex flex-col gap-lg">
      <div className="grid grid-cols-2 gap-md tablet:grid-cols-4">
        <Stat label={t("admin.viewAs.f.activeWork")} value={formatNumber(c.in_progress ?? 0, locale)} hint={`${t("admin.viewAs.f.scheduled")}: ${formatNumber(c.scheduled ?? 0, locale)}`} />
        <Stat label={t("admin.viewAs.f.completed")} value={formatNumber(c.completed ?? 0, locale)} hint={`${t("admin.viewAs.f.cancelled")}: ${formatNumber(c.cancelled ?? 0, locale)}`} />
        <Stat label={t("admin.viewAs.f.pointsBalance")} value={formatNumber(data.pointsBalance, locale)} hint={`${t("admin.viewAs.f.pointsMonth")}: ${formatNumber(data.pointsMonthEarned, locale)}`} />
        <Stat
          label={t("admin.viewAs.f.reviews")}
          value={data.reviewsAverage === null ? dash(t) : formatNumber(data.reviewsAverage, locale)}
          hint={`${formatNumber(data.reviewsTotal, locale)}`}
        />
      </div>
      <CompletionCard completion={data.completion} />
      <Card>
        <dl className="grid grid-cols-1 gap-md tablet:grid-cols-3">
          <Field label={t("admin.viewAs.f.status")}>{data.accountStatus ? val(t, data.accountStatus) : dash(t)}</Field>
          <Field label={t("admin.viewAs.f.publicProfile")}>{data.publicProfileStatus ? val(t, data.publicProfileStatus) : dash(t)}</Field>
          <Field label={t("admin.viewAs.f.verification")}>
            {data.verification ? `${val(t, data.verification.status)}${data.verification.submittedAt ? ` · ${formatDate(data.verification.submittedAt, locale)}` : ""}` : dash(t)}
          </Field>
        </dl>
      </Card>
    </div>
  );
}

export function ProfileSection({ data }: { data: ProfileData }) {
  const { t, locale } = useI18n();
  const gov = (k: string) => lbl(t, `onboarding.consumer.governorates.${k}`, k);
  const city = (k: string) => lbl(t, `onboarding.consumer.cities.${k}`, k);
  return (
    <div className="flex flex-col gap-lg">
      <Card>
        <div className="flex items-start gap-md">
          <MediaPlaceholder label={t("admin.viewAs.f.avatar")} />
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-fg">{data.displayName ?? dash(t)}</h2>
            <p className="text-label text-fg-muted">{data.headline ?? ""}</p>
            <p className="mt-1 text-label text-fg-muted">{t("admin.viewAs.mediaPlaceholderHint")}</p>
          </div>
        </div>
      </Card>
      <Card>
        <dl className="grid grid-cols-1 gap-md tablet:grid-cols-3">
          <Field label={t("admin.viewAs.f.username")}>{data.username ?? dash(t)}</Field>
          <Field label={t("admin.viewAs.f.phone")}>
            <span dir="ltr">{data.phone ?? dash(t)}</span>
            {data.phone ? <span className="ms-2 text-label text-fg-muted">{yesNo(t, data.phoneVerified)}</span> : null}
          </Field>
          <Field label={t("admin.viewAs.f.secondaryPhone")}>
            {data.secondaryPhoneMasked ? <span dir="ltr">{data.secondaryPhoneMasked}</span> : dash(t)}
            {data.secondaryPhoneMasked ? <span className="ms-2 text-label text-fg-muted">{t("admin.viewAs.masked")}</span> : null}
          </Field>
          <Field label={t("admin.viewAs.f.status")}>{data.accountStatus ? val(t, data.accountStatus) : dash(t)}</Field>
          <Field label={t("admin.viewAs.f.publicProfile")}>{data.publicProfileStatus ? val(t, data.publicProfileStatus) : dash(t)}</Field>
          <Field label={t("admin.viewAs.f.verified")}>{yesNo(t, data.isVerified)}</Field>
          <Field label={t("admin.viewAs.f.years")}>{data.yearsExperience === null ? dash(t) : formatNumber(data.yearsExperience, locale)}</Field>
          <Field label={t("admin.viewAs.f.availability")}>{data.availability ? val(t, data.availability) : dash(t)}</Field>
          <Field label={t("admin.viewAs.f.memberSince")}>{formatDate(data.memberSince, locale)}</Field>
          <Field label={t("admin.viewAs.f.avatar")}>{data.hasAvatar ? t("admin.viewAs.f.present") : t("admin.viewAs.f.absent")}</Field>
          <Field label={t("admin.viewAs.f.cover")}>{data.hasCover ? t("admin.viewAs.f.present") : t("admin.viewAs.f.absent")}</Field>
        </dl>
      </Card>
      <Card>
        <SectionTitle>{t("admin.viewAs.f.bio")}</SectionTitle>
        <p className="whitespace-pre-line text-body text-fg">{data.bio ?? dash(t)}</p>
      </Card>
      <Card>
        <dl className="grid grid-cols-1 gap-md tablet:grid-cols-2">
          <Field label={t("admin.viewAs.f.trades")}>
            {data.trades.length === 0 ? dash(t) : (
              <span className="flex flex-wrap gap-1.5">
                {data.trades.map((x) => (
                  <Badge key={x.key} tone={x.isPrimary ? "accent" : "neutral"}>{tradeLabel(t, x.key)}</Badge>
                ))}
              </span>
            )}
          </Field>
          <Field label={t("admin.viewAs.f.areas")}>
            {data.serviceAreas.length === 0 ? dash(t) : (
              <ul className="flex flex-col gap-0.5">
                {data.serviceAreas.map((a) => (
                  <li key={`${a.governorate}/${a.city ?? ""}`}>
                    {gov(a.governorate)}{a.city ? ` · ${city(a.city)}` : ""}{a.isPrimary ? ` (${t("admin.viewAs.f.primary")})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </dl>
      </Card>
      <CompletionCard completion={data.completion} />
    </div>
  );
}

/** `media` maps a record id (portfolio item / certificate) to its authorized link; empty while private media delivery is off. */
export function PortfolioSection({ data, media = {} }: { data: PortfolioData; media?: Record<string, string> }) {
  const { t, locale } = useI18n();
  const delivering = Object.keys(media).length > 0;
  return (
    <div className="flex flex-col gap-lg">
      <p className="text-label text-fg-muted">{t(delivering ? "admin.viewAs.mediaPrivateHint" : "admin.viewAs.mediaPlaceholderHint")}</p>
      <section className="flex flex-col gap-md">
        <SectionTitle>{t("admin.viewAs.f.projects")}</SectionTitle>
        {data.projects.length === 0 ? <StatePanel title={t("admin.viewAs.empty")} /> : null}
        {data.projects.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-body-lg font-semibold text-fg">{p.title}</h3>
              {p.visibility ? <Badge>{val(t, p.visibility)}</Badge> : null}
            </div>
            {p.location ? <p className="text-label text-fg-muted">{p.location}</p> : null}
            {p.description ? <p className="mt-1 text-body text-fg">{p.description}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2" aria-label={t("admin.viewAs.f.items")}>
              {p.items.map((i) => (
                <div key={i.id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                  {i.kind === "image" ? <PrivateImage src={media[i.id]} label={i.title ?? t("admin.viewAs.f.image")} /> : <MediaPlaceholder />}
                  <span className="text-label text-fg-muted">{i.kind === "video" ? t("admin.viewAs.f.video") : t("admin.viewAs.f.image")}{i.title ? ` · ${i.title}` : ""}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </section>
      <section className="flex flex-col gap-md">
        <SectionTitle>{t("admin.viewAs.f.certificates")}</SectionTitle>
        {data.certificates.length === 0 ? <StatePanel title={t("admin.viewAs.empty")} /> : null}
        {data.certificates.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start gap-md">
              {c.kind === "image" ? <PrivateImage src={media[c.id]} label={c.title} /> : <MediaPlaceholder />}
              <dl className="grid min-w-0 flex-1 grid-cols-1 gap-md tablet:grid-cols-4">
                <Field label={t("admin.viewAs.f.certificates")}>{c.title}</Field>
                <Field label={t("admin.viewAs.f.issuer")}>{c.issuer ?? dash(t)}</Field>
                <Field label={t("admin.viewAs.f.issued")}>{formatDate(c.issuedOn, locale)}</Field>
                <Field label={t("admin.viewAs.f.expires")}>{formatDate(c.expiresOn, locale)}</Field>
                {c.kind === "pdf" && media[c.id] ? (
                  <Field label={t("admin.viewAs.f.certificates")}>
                    <a href={media[c.id]} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-accent underline">{t("admin.viewAs.openDocument")}</a>
                  </Field>
                ) : null}
              </dl>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}

export function WorkSection({ data }: { data: WorkData }) {
  const { t, locale } = useI18n();
  const c = data.counts;
  return (
    <div className="flex flex-col gap-lg">
      <div className="grid grid-cols-2 gap-md tablet:grid-cols-4">
        <Stat label={t("admin.viewAs.f.scheduled")} value={formatNumber(c.scheduled ?? 0, locale)} />
        <Stat label={t("admin.viewAs.f.activeWork")} value={formatNumber(c.in_progress ?? 0, locale)} />
        <Stat label={t("admin.viewAs.f.completed")} value={formatNumber(c.completed ?? 0, locale)} />
        <Stat label={t("admin.viewAs.f.cancelled")} value={formatNumber(c.cancelled ?? 0, locale)} />
      </div>
      {data.items.length === 0 ? <StatePanel title={t("admin.viewAs.empty")} /> : null}
      {data.items.map((a) => (
        <Card key={a.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-body-lg font-semibold text-fg">{a.jobTitle}</h3>
            <Badge tone={a.status === "completed" ? "success" : a.status === "cancelled" ? "neutral" : "accent"}>
              {a.status === "in_progress" ? t("admin.viewAs.f.activeWork") : a.status === "scheduled" ? t("admin.viewAs.f.scheduled") : a.status === "completed" ? t("admin.viewAs.f.completed") : a.status === "cancelled" ? t("admin.viewAs.f.cancelled") : a.status}
            </Badge>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-md tablet:grid-cols-4">
            <Field label={t("admin.viewAs.f.company")}>{a.company ?? dash(t)}</Field>
            <Field label={t("admin.viewAs.f.trades")}>{a.tradeKey ? tradeLabel(t, a.tradeKey) : dash(t)}</Field>
            <Field label={t("admin.viewAs.f.areas")}>
              {[a.governorate ? lbl(t, `onboarding.consumer.governorates.${a.governorate}`, a.governorate) : null, a.city ? lbl(t, `onboarding.consumer.cities.${a.city}`, a.city) : null].filter(Boolean).join(" · ") || dash(t)}
            </Field>
            <Field label={t("admin.viewAs.f.amount")}>{a.agreedAmount === null ? dash(t) : formatMoney(a.agreedAmount, locale)}</Field>
            <Field label={t("admin.viewAs.f.progress")}>{a.progressPercent === null ? dash(t) : `${formatNumber(a.progressPercent, locale)}%`}</Field>
            <Field label={t("admin.viewAs.f.started")}>{formatDate(a.startedAt, locale)}</Field>
            <Field label={t("admin.viewAs.f.finished")}>{formatDate(a.completedAt ?? a.cancelledAt, locale)}</Field>
          </dl>
        </Card>
      ))}
    </div>
  );
}

export function PointsSection({ data }: { data: PointsData }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-col gap-lg">
      <div className="grid grid-cols-2 gap-md tablet:grid-cols-3">
        <Stat label={t("admin.viewAs.f.pointsBalance")} value={formatNumber(data.balance, locale)} />
        <Stat label={t("admin.viewAs.f.earned")} value={formatNumber(data.monthEarned, locale)} hint={t("admin.viewAs.f.pointsMonth")} />
        <Stat label={t("admin.viewAs.f.deducted")} value={formatNumber(data.monthDeducted, locale)} />
      </div>
      <section className="flex flex-col gap-md">
        <SectionTitle>{t("admin.viewAs.f.entries")}</SectionTitle>
        {data.entries.length === 0 ? <StatePanel title={t("admin.viewAs.empty")} /> : null}
        {data.entries.length > 0 ? (
          <Card pad="sm">
            <ul className="divide-y">
              {data.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-body text-fg">{e.eventType}{e.reasonCode ? ` · ${e.reasonCode}` : ""}</span>
                  <span className="text-label text-fg-muted">{formatDate(e.createdAt, locale)}</span>
                  <span className={`font-semibold ${e.delta < 0 ? "text-danger" : "text-success"}`} dir="ltr">{e.delta > 0 ? "+" : ""}{formatNumber(e.delta, locale)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

export function ReviewsSection({ data }: { data: ReviewsData }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-col gap-lg">
      <div className="grid grid-cols-2 gap-md tablet:grid-cols-3">
        <Stat label={t("admin.viewAs.f.average")} value={data.average === null ? dash(t) : formatNumber(data.average, locale)} />
        <Stat label={t("admin.viewAs.f.reviews")} value={formatNumber(data.total, locale)} />
      </div>
      <Card pad="sm">
        <SectionTitle>{t("admin.viewAs.f.trend")}</SectionTitle>
        <ul className="grid grid-cols-3 gap-2 tablet:grid-cols-6">
          {data.monthly.map((m) => (
            <li key={m.month} className="rounded-md border px-2 py-1 text-center">
              <div className="text-label text-fg-muted">{formatDate(m.month, locale)}</div>
              <div className="text-body font-medium text-fg">{m.average === null ? dash(t) : formatNumber(m.average, locale)}</div>
              <div className="text-label text-fg-muted">{formatNumber(m.reviews, locale)}</div>
            </li>
          ))}
        </ul>
      </Card>
      {data.items.length === 0 ? <StatePanel title={t("admin.viewAs.empty")} /> : null}
      {data.items.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold text-fg" aria-label={`${t("admin.viewAs.f.rating")} ${r.rating}`}>{"★".repeat(Math.max(0, Math.min(5, r.rating)))}{"☆".repeat(5 - Math.max(0, Math.min(5, r.rating)))}</span>
            <span className="text-label text-fg-muted">{formatDate(r.createdAt, locale)}</span>
          </div>
          {r.comment ? <p className="mt-1 text-body text-fg">{r.comment}</p> : null}
          <p className="mt-1 text-label text-fg-muted">{[r.company, r.jobTitle, r.tradeKey ? tradeLabel(t, r.tradeKey) : null].filter(Boolean).join(" · ")}</p>
        </Card>
      ))}
    </div>
  );
}
