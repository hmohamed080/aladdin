import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import { BadgeCheckIcon, CheckIcon } from "@/components/ui/icons";
import type { Completeness } from "@/lib/profile/completeness";
import type { VerificationState } from "@/server/queries/personal-home";
import type { TranslateFn } from "@/lib/i18n/translate";
import { cn } from "@/lib/ui/cn";

/**
 * Shared building blocks for the ONE personal surface (`/home`), used by both the
 * consumer and the professional variant so the two read as the same product.
 * Server components — no client state is needed on this page.
 *
 * The hierarchy these parts encode is the point of the Sprint 13 pass. Pilot UAT
 * read the previous home as a form still being processed, because the page led
 * with two status panels and the page title was one notch above body text. Here:
 *
 *   1. IDENTITY + PRIMARY ACTIONS lead. Large type, real destinations.
 *   2. The account's own data supports.
 *   3. Completeness and verification are a compact secondary strip — present,
 *      honest, never the headline. They are separate from each other, and neither
 *      is combined into a single "account health" number.
 *
 * Sizes come from the existing token scale (`text-headline` / `text-title` /
 * `text-body-lg` / `text-body` / `text-label`); nothing here invents a size, and
 * hierarchy comes from using the scale properly rather than from enlarging
 * everything.
 */

/** First letter of the name, for the identity monogram. */
function monogram(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "•";
}

/**
 * The page's identity area: who this account is, what it can do, and — quietly,
 * to the side — how the platform currently regards it.
 */
export function HomeHeader({
  eyebrow,
  title,
  lead,
  name,
  meta,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  /** Used for the monogram; falls back to the title. */
  name?: string;
  /** Secondary chips (verification, persona). Deliberately small. */
  meta?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-md">
      <div className="flex flex-wrap items-start gap-md">
        <span
          aria-hidden="true"
          className="grid size-14 shrink-0 place-items-center rounded-md bg-accent-solid/15 text-headline text-accent"
        >
          {monogram(name ?? title)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-label font-semibold uppercase tracking-wide text-fg-muted">{eyebrow}</p>
          <h1 className="text-headline text-fg">{title}</h1>
          {lead ? <p className="max-w-prose text-body-lg text-fg-secondary">{lead}</p> : null}
        </div>
      </div>
      {meta ? <div className="flex flex-wrap items-center gap-sm">{meta}</div> : null}
    </header>
  );
}

/** A titled band of the page. Spacing, not dividers, is the grouping tool. */
export function HomeSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-wrap items-end justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-title text-fg">{title}</h2>
          {description ? <p className="text-body text-fg-secondary">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A product action. Every one of these is a real destination the account can use
 * right now — the grid is not a menu of future features, and a card that cannot be
 * acted on does not belong in it.
 *
 * `min-h` keeps the cards a consistent height whatever the copy length, which is
 * what stops a responsive grid from looking like scattered debris.
 */
export function ActionCard({
  href,
  icon,
  label,
  body,
  emphasis = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  body: string;
  /** The one card that is the obvious next thing to do. */
  emphasis?: boolean;
}) {
  return (
    <a
      href={href}
      className={cn(
        "group flex min-h-[8.5rem] flex-col gap-sm rounded-md border bg-surface p-md shadow-card transition-colors",
        "hover:border-strong hover:bg-surface-2/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
        emphasis && "border-accent-solid/40 bg-accent-solid/5",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-10 place-items-center rounded-md",
          emphasis ? "bg-accent-solid/20 text-accent" : "bg-surface-2 text-fg-secondary",
        )}
      >
        {icon}
      </span>
      <span className="text-body-lg font-semibold text-fg group-hover:text-accent">{label}</span>
      <span className="text-body text-fg-secondary">{body}</span>
    </a>
  );
}

/** The responsive action grid: one column on mobile, two on tablet, three wide. */
export function ActionGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-3">{children}</div>;
}

const verificationTone: Record<VerificationState, "neutral" | "warning" | "success" | "danger" | "info"> = {
  not_verified: "neutral",
  pending: "info",
  needs_more_info: "warning",
  verified: "success",
  rejected: "danger",
};

/**
 * The verification badge. It is a TRUST signal: it changes how discoverable and
 * credible the account is to other businesses, and it never changes what the
 * account can do — which the copy states outright, because the Pilot's first
 * testers read "pending review" as "locked".
 */
export function VerificationBadge({ state, t }: { state: VerificationState; t: TranslateFn }) {
  return (
    <Badge tone={verificationTone[state]}>
      <BadgeCheckIcon size={13} />
      {t(`personalHome.verification.state.${state}`)}
    </Badge>
  );
}

/**
 * The SECONDARY account strip: completeness and verification side by side, small,
 * below the product. Two separate signals — one measures the profile, the other
 * measures platform trust — so they are never averaged into one figure.
 */
export function AccountStrip({
  completeness,
  verification,
  continueHref,
  t,
}: {
  completeness: Completeness;
  verification: { state: VerificationState; reason: string | null };
  /** Where "continue" goes: the onboarding step holding the next missing field. */
  continueHref: string;
  t: TranslateFn;
}) {
  const { percent, completed, total, missing } = completeness;
  const showReason =
    verification.reason && (verification.state === "rejected" || verification.state === "needs_more_info");

  return (
    <div className="grid gap-md tablet:grid-cols-2">
      <Card pad="sm" className="flex flex-col gap-sm">
        <div className="flex items-baseline justify-between gap-sm">
          <h3 className="text-body font-semibold text-fg">{t("personalHome.completeness.title")}</h3>
          <span className="text-body-lg font-semibold tabular-nums text-fg">{percent}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("personalHome.completeness.title")}
        >
          <div className="h-full rounded-pill bg-accent-solid" style={{ width: `${percent}%` }} />
        </div>
        {missing.length > 0 ? (
          <p className="text-label text-fg-secondary">
            {t("personalHome.completeness.count", { done: completed, total })}
            {" · "}
            <a href={continueHref} className="font-medium text-accent hover:underline">
              {t("personalHome.completeness.continue")}
            </a>
          </p>
        ) : (
          <p className="flex items-center gap-1 text-label text-success">
            <CheckIcon size={14} />
            {t("personalHome.completeness.done")}
          </p>
        )}
      </Card>

      <Card pad="sm" className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <h3 className="text-body font-semibold text-fg">{t("personalHome.verification.title")}</h3>
          <VerificationBadge state={verification.state} t={t} />
        </div>
        <p className="text-label text-fg-secondary">{t(`personalHome.verification.body.${verification.state}`)}</p>
        {showReason ? (
          <p className="rounded-sm border border-strong bg-surface-2 px-2.5 py-1.5 text-label text-fg">
            <span className="font-medium">{t("personalHome.verification.reason")}: </span>
            {verification.reason}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

/** A labelled block of facts read back from the caller's own profile. */
export function DetailCard({
  title,
  rows,
  action,
  t,
}: {
  title: string;
  rows: { label: string; value: string | null }[];
  action?: ReactNode;
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h3 className="text-title text-fg">{title}</h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <dl className="grid gap-md tablet:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-label text-fg-muted">{r.label}</dt>
            <dd className="break-words text-body-lg text-fg">{r.value || t("personalHome.notSet")}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Chip list for taxonomy values (services, interests, areas). */
export function ChipList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-body text-fg-muted">{empty}</p>;
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

/** A quiet one-line footnote. Used where a future capability must be mentioned. */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="text-label text-fg-muted">{children}</p>;
}
