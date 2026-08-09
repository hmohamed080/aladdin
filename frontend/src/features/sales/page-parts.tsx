"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PlusIcon } from "@/components/ui/icons";

/**
 * The client-facing page header for the Sales workspace. A clear title, an optional
 * one-line subtitle for orientation, an optional result-count pill, and an optional
 * primary action (rendered with a leading + so create actions read consistently
 * with the home quick actions). Direction-neutral: logical properties + flex order
 * mirror correctly in RTL without manual flipping.
 */
export function PageHeader({
  title,
  subtitle,
  count,
  action,
}: {
  title: string;
  subtitle?: string;
  /** Result/record count shown as a subtle pill beside the title. */
  count?: number;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-lg flex flex-wrap items-start justify-between gap-md">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-headline text-fg">{title}</h1>
          {typeof count === "number" ? (
            <span className="inline-flex min-w-6 items-center justify-center rounded-pill bg-surface-2 px-2 py-0.5 text-label font-medium text-fg-secondary tabular-nums">
              {count}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="text-body text-fg-secondary">{subtitle}</p> : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm bg-accent-solid px-md py-1.5 text-label font-medium text-brand-basalt shadow-sm transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <PlusIcon size={16} />
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** A dismissible success banner driven by a `?created=1`-style flag. */
export function FlashSuccess({ messageKey }: { messageKey: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      className="mb-md rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success"
    >
      {t(messageKey)}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Link href={href} className="mb-md inline-flex items-center text-label text-fg-secondary hover:text-fg">
      <span aria-hidden="true" className="me-1">
        ↩
      </span>
      {children ?? t("common.back")}
    </Link>
  );
}
