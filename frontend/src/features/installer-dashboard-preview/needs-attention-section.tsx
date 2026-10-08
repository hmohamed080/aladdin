"use client";

import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { BoltIcon } from "@/components/ui/icons";
import { ModuleCard, ModuleFooterLink } from "./module-card";
import { pick } from "./localized";
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
  actionBelow = false,
}: {
  items: readonly InstallerNeedsActionItemVM[];
  footerHref?: string;
  /**
   * Put each row's action UNDER its text instead of beside it. The approved lower row gives this module the narrowest
   * column, which fits the preview's short sample titles; real work titles and organization names are free text and
   * need the full column width, so production stacks the action.
   */
  actionBelow?: boolean;
}) {
  const { locale } = useI18n();

  return (
    <ModuleCard
      id="attention"
      icon={BoltIcon}
      iconClassName="text-iris"
      title={locale === "ar" ? "أعمال تحتاج إجراء" : "Needs your action"}
      footerClassName="border-t-0 pt-0 desktop:pt-0"
      footer={
        items.length > 0 ? (
          <ModuleFooterLink href={footerHref} boxed>
            {locale === "ar" ? "عرض كل الأعمال" : "View all actions"}
          </ModuleFooterLink>
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
        <ul className="flex flex-1 flex-col justify-between gap-2">
          {items.map((item) => (
            <ActionRow key={item.id} item={item} actionBelow={actionBelow} />
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}

function ActionRow({ item, actionBelow }: { item: InstallerNeedsActionItemVM; actionBelow: boolean }) {
  const { locale } = useI18n();
  const cta = (
    <span className="inline-flex h-8 min-w-12 shrink-0 items-center justify-center rounded-sm border border-strong px-3 text-label font-medium leading-none text-fg transition-colors hover:bg-surface-2">
      {pick(locale, item.ctaLabel)}
    </span>
  );

  return (
    <li className={cn("grid min-h-20 items-center gap-2 rounded-md bg-surface-2/45 p-2", actionBelow ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)_auto]")}>
      {/* Approved visual size: keep these three coloured glyphs large unless the user explicitly asks to resize them. */}
      <span className="grid h-12 w-12 shrink-0 place-items-center">
        <Image src={ICON_SRC[item.icon]} alt="" width={48} height={48} className="h-12 w-12 scale-150 object-contain" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-body font-semibold leading-snug text-fg">{pick(locale, item.title)}</p>
        <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-fg-secondary">{pick(locale, item.subtitle)}</p>
        <p className="mt-0.5 text-caption leading-snug text-fg-muted">{pick(locale, item.meta)}</p>
      </div>
      {item.href ? (
        <Link href={item.href} className={cn("self-center", actionBelow && "col-span-2 justify-self-end")}>
          {cta}
        </Link>
      ) : (
        <button type="button" className={cn("self-center", actionBelow && "col-span-2 justify-self-end")}>
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
