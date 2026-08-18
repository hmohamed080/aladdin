"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";

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
