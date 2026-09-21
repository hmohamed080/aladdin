"use client";

import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { ClipboardIcon } from "@/components/ui/icons";
import { ModuleCard, ModuleFooterLink } from "./module-card";
import { pick } from "./mock-data";
import type { InstallerNeedsActionItemVM } from "./view-model";

const ICON_SRC: Record<InstallerNeedsActionItemVM["icon"], string> = {
  appointment: "/assets/installer-dashboard/actions/appointment.png",
  message: "/assets/installer-dashboard/actions/message.png",
  upload: "/assets/installer-dashboard/actions/upload.png",
  work: "/assets/installer-dashboard/actions/upload.png",
};

export function NeedsAttentionSection({
  items,
  footerHref,
}: {
  items: readonly InstallerNeedsActionItemVM[];
  footerHref?: string;
}) {
  const { locale } = useI18n();

  return (
    <ModuleCard
      id="attention"
      icon={ClipboardIcon}
      iconClassName="bg-warning/10 text-warning"
      title={locale === "ar" ? "أعمال تحتاج إجراء" : "Needs your action"}
      footer={
        items.length > 0 ? (
          <ModuleFooterLink href={footerHref}>{locale === "ar" ? "عرض كل الأعمال" : "View all actions"}</ModuleFooterLink>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <Empty
          text={
            locale === "ar"
              ? "لا يوجد حاليًا ما يحتاج إجراء منك."
              : "Nothing needs your action right now."
          }
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <ActionRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}

function ActionRow({ item }: { item: InstallerNeedsActionItemVM }) {
  const { locale } = useI18n();
  const cta = (
    <span className="inline-flex h-8 min-w-12 shrink-0 items-center justify-center rounded-sm border border-strong px-3 text-label font-medium leading-none text-fg transition-colors hover:bg-surface-2">
      {pick(locale, item.ctaLabel)}
    </span>
  );

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md py-2">
      <Image src={ICON_SRC[item.icon]} alt="" width={44} height={44} className="h-11 w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body-lg font-medium leading-snug text-fg">{pick(locale, item.title)}</p>
        <p className="text-caption leading-snug text-fg-secondary">{pick(locale, item.subtitle)}</p>
        <p className="mt-0.5 text-caption leading-snug text-fg-muted">{pick(locale, item.meta)}</p>
      </div>
      {item.href ? (
        <Link href={item.href} className="self-center">
          {cta}
        </Link>
      ) : (
        <button type="button" className="self-center">
          {cta}
        </button>
      )}
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 flex-1 items-center justify-center rounded-md border border-dashed bg-surface-2/30 p-4 text-center text-body text-fg-muted">
      {text}
    </div>
  );
}
