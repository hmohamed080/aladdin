"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { PlayIcon, ScrollIcon, VideoIcon } from "@/components/ui/icons";
import { ModuleCard, ModuleFooterLink } from "./module-card";
import { pick } from "./mock-data";
import type { InstallerFeaturedLearningVM, InstallerLearningItemVM } from "./view-model";

const ICON = { training: ScrollIcon, video: VideoIcon, workshop: ScrollIcon } as const;

/**
 * "Learn & train" — no training/content domain exists in the backend yet, so
 * production always passes `featured: null, items: []` and this renders the
 * approved empty state rather than inventing course content.
 */
export function LearningSection({
  featured,
  items,
}: {
  featured: InstallerFeaturedLearningVM;
  items: readonly InstallerLearningItemVM[];
}) {
  const { locale } = useI18n();

  return (
    <ModuleCard
      id="learning"
      icon={VideoIcon}
      iconClassName="bg-lapis/10 text-lapis"
      title={locale === "ar" ? "تعلم وتدرب" : "Learn & train"}
      footer={
        featured || items.length > 0 ? (
          <ModuleFooterLink>{locale === "ar" ? "كل التدريبات والفيديوهات" : "All training & videos"}</ModuleFooterLink>
        ) : undefined
      }
    >
      {featured ? (
        <button
          type="button"
          className="group relative isolate aspect-[16/8] min-h-32 overflow-hidden rounded-md border border-strong bg-surface-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Image
            src={featured.image}
            alt=""
            fill
            sizes="(min-width: 1280px) 24vw, (min-width: 768px) 48vw, 100vw"
            className="object-cover transition-transform duration-base ease-out-expo group-hover:scale-[1.025]"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" aria-hidden="true" />

          <span className="absolute start-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-sm border border-white/30 bg-black/60 px-2 text-label font-medium text-white backdrop-blur-sm">
            <VideoIcon size={16} />
            {locale === "ar" ? "فيديو تعليمي" : "Video lesson"}
          </span>

          <span className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3 text-white">
            <span className="min-w-0">
              <span className="block text-body-lg font-semibold leading-snug">{pick(locale, featured.title)}</span>
              <span className="mt-1 flex items-center gap-2 text-caption text-white/80">
                <span>{pick(locale, featured.duration)}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{pick(locale, featured.source)}</span>
              </span>
            </span>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-pill border border-white/40 bg-white text-primary shadow-card transition-transform group-hover:scale-105">
              <PlayIcon size={20} />
            </span>
          </span>
        </button>
      ) : items.length === 0 ? (
        <Empty
          text={
            locale === "ar"
              ? "المحتوى التدريبي هيظهر هنا لما يتم نشره على المنصة."
              : "Training content will appear here once it is published."
          }
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <LearningRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </ModuleCard>
  );
}

function LearningRow({ item }: { item: InstallerLearningItemVM }) {
  const { locale } = useI18n();
  const Icon = ICON[item.icon];

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-md py-1.5 text-start transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-lapis/10 text-lapis">
          <Icon size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-fg-muted">{pick(locale, item.kindLabel)}</span>
          <span className="block text-body-lg font-medium leading-snug text-fg">{pick(locale, item.title)}</span>
        </span>
      </button>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 flex-1 items-center justify-center rounded-md border border-dashed border-strong bg-surface-2/30 p-4 text-center text-body text-fg-muted">
      {text}
    </div>
  );
}
