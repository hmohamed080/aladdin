"use client";

import { useI18n } from "@/lib/i18n/context";
import { PlayIcon, ScrollIcon, VideoIcon } from "@/components/ui/icons";
import { ModuleCard, ModuleFooterLink } from "./module-card";
import { FEATURED_LEARNING, LEARNING_ITEMS, pick, type LearningItem } from "./mock-data";

const ICON = { training: ScrollIcon, video: VideoIcon, workshop: ScrollIcon } as const;

export function LearningSection() {
  const { locale } = useI18n();

  return (
    <ModuleCard
      id="learning"
      icon={VideoIcon}
      iconClassName="bg-lapis/10 text-lapis"
      title={locale === "ar" ? "تعلم وتدرب" : "Learn & train"}
      footer={
        <ModuleFooterLink>{locale === "ar" ? "كل التدريبات والفيديوهات" : "All training & videos"}</ModuleFooterLink>
      }
    >
      <button
        type="button"
        className="group relative flex min-h-36 flex-col justify-end overflow-hidden rounded-md border bg-gradient-to-br from-lapis/25 via-lapis/10 to-transparent p-3 text-start"
      >
        <span className="absolute start-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-sm bg-surface/90 px-2 text-label font-medium text-lapis shadow-sm">
          <VideoIcon size={14} />
          {locale === "ar" ? "فيديو تعليمي" : "Video lesson"}
        </span>
        <span className="absolute end-3 top-3 inline-flex h-7 items-center rounded-sm bg-surface/90 px-2 text-label font-medium text-fg-secondary shadow-sm">
          {FEATURED_LEARNING.duration[locale]}
        </span>
        <span className="absolute start-1/2 top-[46%] grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill bg-surface/95 text-lapis shadow-card transition-transform group-hover:scale-105 rtl:translate-x-1/2">
          <PlayIcon size={22} />
        </span>
        <p className="mt-2 max-w-[80%] text-body-lg font-semibold leading-snug text-fg">
          {pick(locale, FEATURED_LEARNING.title)}
        </p>
        <p className="text-caption text-fg-secondary">{pick(locale, FEATURED_LEARNING.source)}</p>
      </button>

      <ul className="flex flex-col gap-1">
        {LEARNING_ITEMS.map((item) => (
          <LearningRow key={item.id} item={item} />
        ))}
      </ul>
    </ModuleCard>
  );
}

function LearningRow({ item }: { item: LearningItem }) {
  const { locale } = useI18n();
  const Icon = ICON[item.icon];

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-md py-1.5 text-start transition-colors hover:bg-surface-2"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-lapis/10 text-lapis">
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-fg-muted">{pick(locale, item.kindLabel)}</span>
          <span className="block text-body-lg font-medium leading-snug text-fg">{pick(locale, item.title)}</span>
        </span>
      </button>
    </li>
  );
}
