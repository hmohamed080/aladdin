"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";

/** A page header with a title and an optional primary action link. */
export function PageHeader({
  title,
  action,
}: {
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-lg flex flex-wrap items-center justify-between gap-md">
      <h1 className="text-headline text-fg">{title}</h1>
      {action ? (
        <Link
          href={action.href}
          className="inline-flex min-h-9 items-center rounded-sm bg-accent-solid px-md py-1.5 text-label font-medium text-brand-basalt transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
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
