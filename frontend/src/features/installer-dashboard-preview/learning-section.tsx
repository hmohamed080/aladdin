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
      iconClassName="text-lapis"
      title={locale === "ar" ? "تعلم وتدريب" : "Learn & train"}
      headerAction={featured || items.length > 0 ? <HeaderAction label={locale === "ar" ? "عرض الكل" : "View all"} /> : undefined}
      footer={
        featured || items.length > 0 ? (
          <ModuleFooterLink boxed>{locale === "ar" ? "كل التدريبات والفيديوهات" : "All training & videos"}</ModuleFooterLink>
        ) : undefined
      }
      footerClassName="border-t-0 pt-0 desktop:pt-0"
    >
      {featured ? (
        <button
          type="button"
          className="group relative isolate aspect-[16/8] min-h-32 overflow-hidden rounded-md border border-strong bg-surface-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus desktop:h-32 desktop:aspect-auto"
        >
          <Image
            src={featured.image}
            alt=""
            width={640}
            height={320}
            sizes="(min-width: 1280px) 24vw, (min-width: 768px) 48vw, 100vw"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-base ease-out-expo group-hover:scale-[1.025]"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" aria-hidden="true" />

          <span className="absolute start-2 top-2 inline-flex h-6 items-center gap-1.5 rounded-sm border border-white/30 bg-black/60 px-2 text-caption font-medium text-white">
            <VideoIcon size={16} />
            {locale === "ar" ? "فيديو تعليمي" : "Video lesson"}
          </span>

          <span className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2 text-white">
            <span className="min-w-0">
              <span className="block text-body font-semibold leading-snug">{pick(locale, featured.title)}</span>
              <span className="mt-1 flex items-center gap-2 text-caption text-white/80">
                <span>{pick(locale, featured.duration)}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{pick(locale, featured.source)}</span>
              </span>
            </span>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-pill border border-white/40 bg-white text-primary shadow-card transition-transform group-hover:scale-105 desktop:h-8 desktop:w-8">
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
        <ul className="flex flex-col gap-0.5">
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
        className="flex min-h-10 w-full items-center gap-2 rounded-sm border border-strong bg-surface px-1.5 py-1 text-start transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-lapis/10 text-lapis">
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block whitespace-normal text-caption font-medium leading-snug text-fg">{pick(locale, item.title)}</span>
        </span>
        <span className="shrink-0 rounded-pill bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
          {statusLabel(locale, item.icon)}
        </span>
      </button>
    </li>
  );
}

function statusLabel(locale: "ar" | "en", icon: InstallerLearningItemVM["icon"]) {
  if (locale === "ar") return icon === "training" ? "متوسط" : icon === "video" ? "جديد" : "متاح";
  return icon === "training" ? "Intermediate" : icon === "video" ? "New" : "Available";
}

function HeaderAction({ label }: { label: string }) {
  return <button type="button" className="shrink-0 text-label font-medium text-iris hover:underline">{label}</button>;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 flex-1 items-center justify-center rounded-md border border-dashed border-strong bg-surface-2/30 p-4 text-center text-body text-fg-muted">
      {text}
    </div>
  );
}
