import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import type { Completeness } from "@/lib/profile/completeness";
import type { VerificationState } from "@/server/queries/personal-home";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * Shared building blocks for the ONE personal surface (`/home`), used by both the
 * consumer and the professional variant so the two read as the same product.
 * Server components — no client state is needed on this page.
 */

/** Page header: persona eyebrow, greeting, and a one-line lead. */
export function HomeHeader({
  eyebrow,
  title,
  lead,
  aside,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-md">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-label font-medium uppercase tracking-wide text-fg-muted">{eyebrow}</p>
        <h1 className="text-title text-fg">{title}</h1>
        {lead ? <p className="max-w-prose text-body text-fg-secondary">{lead}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-sm">{aside}</div> : null}
    </header>
  );
}

/**
 * Derived profile completeness. The percentage is recomputed on every render from
 * the profile itself, and it deliberately says nothing about verification — the
 * two are separate signals shown side by side.
 */
export function CompletenessCard({ completeness, t }: { completeness: Completeness; t: TranslateFn }) {
  const { percent, completed, total, missing } = completeness;
  return (
    <Card className="flex flex-col gap-sm">
      <div className="flex items-baseline justify-between gap-md">
        <h2 className="text-body font-semibold text-fg">{t("personalHome.completeness.title")}</h2>
        <span className="text-headline font-semibold tabular-nums text-fg">{percent}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-pill bg-surface-2"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("personalHome.completeness.title")}
      >
        <div className="h-full rounded-pill bg-accent-solid" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-label text-fg-secondary">
        {t("personalHome.completeness.count", { done: completed, total })}
      </p>
      {missing.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {missing.map((key) => (
            <li key={key}>
              <Badge>{t(`personalHome.item.${key}`)}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-label text-success">{t("personalHome.completeness.done")}</p>
      )}
    </Card>
  );
}

const verificationTone: Record<VerificationState, "neutral" | "warning" | "success" | "danger" | "info"> = {
  not_verified: "neutral",
  pending: "info",
  needs_more_info: "warning",
  verified: "success",
  rejected: "danger",
};

/**
 * The independent trust state. It never gates access to this page — the copy says
 * so explicitly, because the Pilot's first testers read a pending review as a
 * locked account.
 */
export function VerificationCard({
  state,
  reason,
  t,
}: {
  state: VerificationState;
  reason: string | null;
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h2 className="text-body font-semibold text-fg">{t("personalHome.verification.title")}</h2>
        <Badge tone={verificationTone[state]}>{t(`personalHome.verification.state.${state}`)}</Badge>
      </div>
      <p className="text-label text-fg-secondary">{t(`personalHome.verification.body.${state}`)}</p>
      {reason && (state === "rejected" || state === "needs_more_info") ? (
        <p className="rounded-sm border border-strong bg-surface-2 px-3 py-2 text-label text-fg">
          <span className="font-medium">{t("personalHome.verification.reason")}: </span>
          {reason}
        </p>
      ) : null}
      <p className="text-label text-fg-muted">{t("personalHome.verification.independent")}</p>
    </Card>
  );
}

/** A labelled block of facts read back from the caller's own profile. */
export function DetailCard({
  title,
  rows,
  t,
}: {
  title: string;
  rows: { label: string; value: string | null }[];
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-sm">
      <h2 className="text-body font-semibold text-fg">{title}</h2>
      <dl className="flex flex-col divide-y divide-strong/60">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
            <dt className="text-label text-fg-muted">{r.label}</dt>
            <dd className="break-words text-body text-fg">{r.value || t("personalHome.notSet")}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Chip list for taxonomy values (services, interests, areas). */
export function ChipList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-label text-fg-muted">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((label) => (
        <li key={label}>
          <Badge tone="neutral">{label}</Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * The "do this next" list. Every entry is an action the account can already take —
 * nothing here is waiting on a platform decision.
 */
export function NextActions({
  actions,
  title,
}: {
  title: string;
  actions: { href: string; label: string; body: string }[];
}) {
  return (
    <Card className="flex flex-col gap-sm">
      <h2 className="text-body font-semibold text-fg">{title}</h2>
      <ul className="flex flex-col divide-y divide-strong/60">
        {actions.map((a) => (
          <li key={a.label} className="py-2 first:pt-0 last:pb-0">
            <a
              href={a.href}
              className="group flex flex-col gap-0.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="text-body font-medium text-accent group-hover:underline">{a.label}</span>
              <span className="text-label text-fg-secondary">{a.body}</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
