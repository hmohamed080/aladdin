import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * THE PAGE BAND — the two shapes every Aladdin page opens with, in the
 * foundation rather than in one product's folder.
 *
 * WHY THIS FILE EXISTS
 * The workspace opened its pages with `PageHead`/`PageHeader` (module identity:
 * an icon tile, a count pill, a toolbar) and the personal surface opened its
 * pages with `HomeHeader`/`HomeSection` (personal identity: a monogram, a lead
 * line, meta chips). Two vocabularies is correct — they carry genuinely
 * different information. Two vocabularies with **no shared base**, one of them
 * living inside `features/home`, is how a second visual system starts: every
 * later tweak to spacing, rule weight or type scale has to be made twice, and
 * the second one eventually is not.
 *
 * So the shapes stay two and the base becomes one. `IdentityBand` and `Section`
 * are the foundation; `HomeHeader` and `HomeSection` are adapters over them,
 * exactly as `PageHeader` is an adapter over `PageHead`. That adapter pattern is
 * already proven in this repository — it is what stopped the workspace drawing
 * two different headers — so it is the pattern the personal surface joins rather
 * than a new idea.
 *
 * Everything here is tokens and the shared type scale. Nothing invents a size,
 * a colour or a radius; hierarchy comes from using the scale properly rather
 * than from enlarging things.
 */

/** First letter of the name, for the identity monogram. */
function monogram(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "•";
}

/**
 * A page opened by WHO or WHAT it belongs to, rather than by which module it is.
 *
 * Used by the personal surfaces, where the subject of the page is a person and
 * the reader is usually that person. The workspace's own band (`PageHead`) opens
 * on a module glyph instead, because there the subject is a module and the icon
 * is the fastest "am I in the right place" signal on a twenty-module workspace.
 */
export function IdentityBand({
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
  /** Secondary chips (verification, availability, persona). Deliberately small. */
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

/**
 * A titled band of a page. Spacing, not dividers, is the grouping tool.
 *
 * The canonical section for any surface. `className` is deliberately absent:
 * a section that needs different spacing is a signal the scale is wrong, and a
 * per-page override is how a foundation stops being one.
 */
export function Section({
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
    <section className={cn("flex flex-col gap-md")}>
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
