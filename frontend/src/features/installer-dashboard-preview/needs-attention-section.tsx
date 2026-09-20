"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { ClipboardIcon } from "@/components/ui/icons";
import { ModuleCard, ModuleFooterLink } from "./module-card";
import { ACTION_REQUIRED_ITEMS, pick, type ActionRequiredItem } from "./mock-data";

const ICON_SRC: Record<ActionRequiredItem["icon"], string> = {
  appointment: "/assets/installer-dashboard/actions/appointment.png",
  message: "/assets/installer-dashboard/actions/message.png",
  upload: "/assets/installer-dashboard/actions/upload.png",
};

export function NeedsAttentionSection() {
  const { locale } = useI18n();

  return (
    <ModuleCard
      id="attention"
      icon={ClipboardIcon}
      iconClassName="bg-warning/10 text-warning"
      title={locale === "ar" ? "أعمال تحتاج إجراء" : "Needs your action"}
      footer={<ModuleFooterLink>{locale === "ar" ? "عرض كل الأعمال" : "View all actions"}</ModuleFooterLink>}
    >
      <ul className="flex flex-col gap-1">
        {ACTION_REQUIRED_ITEMS.map((item) => (
          <ActionRow key={item.id} item={item} />
        ))}
      </ul>
    </ModuleCard>
  );
}

function ActionRow({ item }: { item: ActionRequiredItem }) {
  const { locale } = useI18n();

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md py-2">
      <Image src={ICON_SRC[item.icon]} alt="" width={44} height={44} className="h-11 w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body-lg font-medium leading-snug text-fg">{pick(locale, item.title)}</p>
        <p className="text-caption leading-snug text-fg-secondary">{pick(locale, item.subtitle)}</p>
        <p className="mt-0.5 text-caption leading-snug text-fg-muted">{pick(locale, item.meta)}</p>
      </div>
      <button
        type="button"
        className="inline-flex h-8 min-w-12 shrink-0 self-center items-center justify-center rounded-sm border border-strong px-3 text-label font-medium leading-none text-fg transition-colors hover:bg-surface-2"
      >
        {pick(locale, item.ctaLabel)}
      </button>
    </li>
  );
}
