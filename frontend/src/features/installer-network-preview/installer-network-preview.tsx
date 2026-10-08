"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/controls";
import {
  BadgeCheckFilledIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  FilterIcon,
  MapPinIcon,
  MessageIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  StarIcon,
  StorefrontIcon,
} from "@/components/ui/icons";
import { ProgressMeter } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import {
  AREA_OPTIONS,
  NETWORK_SHOWROOMS,
  PENDING_INVITATIONS,
  type AreaFilter,
  type LocalizedText,
  type NetworkShowroom,
  type PendingInvitation,
} from "./preview-data";
import { NetworkClockIcon, NetworkPeopleIcon, NetworkStarIcon, NetworkStoreIcon, NetworkTrophyIcon, ShowroomLogo } from "./network-visuals";
import { FloatingMenu } from "@/components/ui/floating-menu";

type NetworkTab = "all" | "joined" | "pending";

const copy = {
  ar: {
    title: "معارفي من المعارض",
    subtitle: "لديك 17 معرضًا في شبكتك",
    bannerTitle: "أضف معرضًا تعرفه واكسب نقاطًا",
    bannerBody: "ساعدنا في توسيع شبكة المعارض، وكل معرض ينضم من دعوتك يزيد نقاطك",
    addShowroom: "أضف معرضًا أعرفه",
    searchPlaceholder: "ابحث باسم المعرض أو المنطقة...",
    filter: "تصفية",
    listTitle: "قائمة المعارض",
    resultUnit: "نتيجة",
    columns: { showroom: "المعرض", relationship: "العلاقة", contact: "التواصل", action: "إجراء سريع" },
    tabs: { all: "الكل", joined: "انضموا بدعوتي", pending: "في انتظار الدعوة" },
    counts: { all: 17, joined: 10, pending: 7 },
    relationship: { verified: "علاقة موثقة", active: "أتعامل معه" },
    pendingRelationship: "في انتظار الانضمام",
    reviews: "تقييم",
    message: "رسالة",
    call: "اتصال",
    moreActions: "المزيد من الإجراءات",
    viewMore: "عرض المزيد",
    noResults: "لا توجد معارض مطابقة",
    noResultsBody: "جرّب اسمًا أو منطقة أخرى.",
    pointsTitle: "نقاط المعارف",
    points: "نقطة مكتسبة",
    level: "المستوى",
    remaining: "باقي 150 نقطة للوصول للمستوى التالي",
    added: "معرضًا أضفته",
    invited: "انضموا بدعوتك",
    details: "عرض التفاصيل",
    earnTitle: "كيف تكسب النقاط؟",
    earnRules: ["إضافة معرض صحيح", "انضمام معرض من دعوتك", "أول تعامل موثق"],
    learnMore: "اعرف المزيد",
    pendingTitle: "المعارض في انتظار الدعوة",
    pendingNote: "+10 نقطة عند التحقق",
    resend: "إعادة إرسال",
    allInvites: "عرض جميع الدعوات (7)",
    areas: {
      all: "كل المناطق",
      "new-cairo": "القاهرة الجديدة",
      "fifth-settlement": "التجمع الخامس",
      "nasr-city": "مدينة نصر",
      "el-shorouk": "الشروق",
    },
  },
  en: {
    title: "My showroom network",
    subtitle: "You have 17 showrooms in your network",
    bannerTitle: "Add a showroom you know and earn points",
    bannerBody: "Help expand the showroom network. Every showroom that joins through your invitation grows your points.",
    addShowroom: "Add a showroom I know",
    searchPlaceholder: "Search by showroom or area...",
    filter: "Filter",
    listTitle: "Showroom list",
    resultUnit: "results",
    columns: { showroom: "Showroom", relationship: "Relationship", contact: "Contact", action: "Quick action" },
    tabs: { all: "All", joined: "Joined via my invite", pending: "Awaiting invitation" },
    counts: { all: 17, joined: 10, pending: 7 },
    relationship: { verified: "Verified relationship", active: "I work with them" },
    pendingRelationship: "Awaiting join",
    reviews: "reviews",
    message: "Message",
    call: "Call",
    moreActions: "More actions",
    viewMore: "View more",
    noResults: "No matching showrooms",
    noResultsBody: "Try another name or area.",
    pointsTitle: "Network points",
    points: "points earned",
    level: "Level",
    remaining: "150 points left to reach the next level",
    added: "showrooms added",
    invited: "joined via your invite",
    details: "View details",
    earnTitle: "How to earn points",
    earnRules: ["Add a valid showroom", "A showroom joins via your invite", "First verified transaction"],
    learnMore: "Learn more",
    pendingTitle: "Showrooms awaiting invitation",
    pendingNote: "+10 points after verification",
    resend: "Resend",
    allInvites: "View all invitations (7)",
    areas: {
      all: "All areas",
      "new-cairo": "New Cairo",
      "fifth-settlement": "Fifth Settlement",
      "nasr-city": "Nasr City",
      "el-shorouk": "El Shorouk",
    },
  },
} as const;

function localized(locale: "ar" | "en", value: LocalizedText) {
  return value[locale];
}

export function InstallerNetworkPreview({
  theme,
  sidebarMode,
}: {
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
}) {
  const { locale, dir } = useI18n();
  const c = copy[locale];
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NetworkTab>("all");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<AreaFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(6);
  const filterButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setVisibleCount(6), [activeTab, area, query]);

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    const active = NETWORK_SHOWROOMS.filter((showroom) => {
      const areaMatches = area === "all" || showroom.area === area;
      const textMatches =
        normalized.length === 0 ||
        `${localized(locale, showroom.name)} ${localized(locale, showroom.location)}`
          .toLocaleLowerCase(locale)
          .includes(normalized);
      return areaMatches && textMatches;
    });
    const pending = PENDING_INVITATIONS.filter((invitation) => {
      const textMatches =
        normalized.length === 0 ||
        `${localized(locale, invitation.name)} ${invitation.phone}`.toLocaleLowerCase(locale).includes(normalized);
      return area === "all" && textMatches;
    });

    if (activeTab === "joined") return active.map((item) => ({ kind: "active" as const, item }));
    if (activeTab === "pending") return pending.map((item) => ({ kind: "pending" as const, item }));
    return [
      ...active.map((item) => ({ kind: "active" as const, item })),
      ...pending.map((item) => ({ kind: "pending" as const, item })),
    ];
  }, [activeTab, area, locale, query]);

  const visibleRows = rows.slice(0, visibleCount);

  return (
    <div dir={dir} className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="my-showrooms"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-6 tablet:pb-10 tablet:pt-6 desktop:pt-8`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />

        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-md py-4 tablet:py-6 desktop:py-7`}>
          <header className="flex items-start gap-3">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md bg-iris-solid/10 text-iris-solid">
              <NetworkStoreIcon size={24} />
            </span>
            <div className="min-w-0">
              <h1 className="text-title font-bold tracking-tight text-fg">{c.title}</h1>
              <p className="mt-1 text-body text-fg-secondary">{c.subtitle}</p>
            </div>
          </header>

          <div dir="ltr" className="grid min-w-0 items-start gap-md desktop:items-stretch desktop:grid-cols-[minmax(0,1fr)_20rem]">
            <div dir={dir} className="min-w-0 space-y-md desktop:flex desktop:h-full desktop:min-h-0 desktop:flex-col desktop:gap-md desktop:space-y-0 desktop:overflow-hidden desktop:[contain:size]">
              <section className="overflow-hidden rounded-md border border-strong bg-surface" aria-labelledby="invite-banner-title">
                <div className="grid items-center gap-md bg-surface-2/50 p-lg tablet:grid-cols-[minmax(0,1fr)_14rem] tablet:p-xl">
                  <div className="min-w-0">
                    <h2 id="invite-banner-title" className="text-body-lg font-bold text-fg">
                      {c.bannerTitle}
                    </h2>
                    <p className="mt-2 max-w-2xl text-body leading-relaxed text-fg-secondary">{c.bannerBody}</p>
                    <Link
                      href="/preview/installer-network/refer"
                      className="mt-md inline-flex min-h-10 items-center justify-center gap-2 rounded-sm bg-primary px-md py-2 text-label font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    >
                      <PlusIcon size={16} />
                      {c.addShowroom}
                    </Link>
                  </div>
                  <div className="hidden justify-center tablet:flex" aria-hidden="true">
                    <Image src="/assets/installer-network/showroom-invite.png" alt="" width={224} height={150} className="h-36 w-56 scale-125 object-contain" priority />
                  </div>
                </div>
              </section>

              <section className="overflow-visible rounded-md border border-strong bg-surface desktop:flex desktop:min-h-0 desktop:flex-1 desktop:flex-col" aria-labelledby="showroom-list-title">
                <div className="flex items-center justify-between gap-md border-b border-strong px-md py-3">
                  <h2 id="showroom-list-title" className="text-body-lg font-semibold text-fg">{c.listTitle}</h2>
                  <span className="shrink-0 text-label tabular-nums text-fg-muted" aria-live="polite">{rows.length} {c.resultUnit}</span>
                </div>
                <div className="flex flex-col gap-sm border-b border-strong p-md tablet:flex-row">
                  <label className="relative min-w-0 flex-1">
                    <span className="sr-only">{c.searchPlaceholder}</span>
                    <SearchIcon size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={c.searchPlaceholder}
                      className="h-10 w-full rounded-sm border border-strong bg-canvas pe-md ps-10 text-label text-fg outline-none placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </label>
                  <div className="relative shrink-0">
                    <Button
                      ref={filterButton}
                      variant="outline"
                      className="w-full tablet:w-auto"
                      onClick={() => setFilterOpen((value) => !value)}
                      aria-haspopup="menu"
                      aria-expanded={filterOpen}
                    >
                      <FilterIcon size={16} className="text-iris-solid" />
                      {area === "all" ? c.filter : c.areas[area]}
                      <ChevronDownIcon size={15} />
                    </Button>
                    <FloatingMenu open={filterOpen} onClose={() => setFilterOpen(false)} anchorRef={filterButton} role="menu" aria-label={c.filter} placement="bottom-end" className="w-48 py-1">
                        {AREA_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="menuitemradio"
                            aria-checked={area === option}
                            onClick={() => {
                              setArea(option);
                              setFilterOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-md py-2 text-label text-fg-secondary hover:bg-surface-2 hover:text-fg"
                          >
                            <span className="flex-1 text-start">{c.areas[option]}</span>
                            {area === option ? <CheckIcon size={14} className="text-accent" /> : null}
                          </button>
                        ))}
                    </FloatingMenu>
                  </div>
                </div>

                <div role="tablist" aria-label={c.title} className="grid min-w-0 grid-cols-3 border-b border-strong tablet:flex tablet:overflow-x-auto tablet:px-md tablet:[scrollbar-width:none] tablet:[&::-webkit-scrollbar]:hidden">
                  {(["all", "joined", "pending"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "relative min-w-0 px-1 py-3 text-center text-label font-semibold leading-snug transition-colors tablet:shrink-0 tablet:px-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
                        activeTab === tab ? "text-fg" : "text-fg-muted hover:text-fg",
                      )}
                    >
                      {c.tabs[tab]} <span className="block tabular-nums tablet:inline">({c.counts[tab]})</span>
                      {activeTab === tab ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-pill bg-primary tablet:inset-x-md" /> : null}
                    </button>
                  ))}
                </div>

                <div className="hidden grid-cols-[minmax(16rem,1fr)_10rem_14rem_5rem] items-center gap-sm border-b border-strong bg-surface-2/70 px-md py-2.5 text-label font-semibold text-fg-secondary desktop:grid">
                  <span className="text-start">{c.columns.showroom}</span>
                  <span className="text-center">{c.columns.relationship}</span>
                  <span className="text-center">{c.columns.contact}</span>
                  <span className="text-center">{c.columns.action}</span>
                </div>

                <div id="network-results-viewport" data-testid="network-results-viewport" className="min-h-0 desktop:flex-1 desktop:overflow-y-auto desktop:overscroll-contain">
                  {visibleRows.length ? (
                    <ul className="divide-y divide-strong" aria-live="polite">
                      {visibleRows.map((row) =>
                        row.kind === "active" ? (
                          <ShowroomRow key={row.item.id} showroom={row.item} locale={locale} copy={c} />
                        ) : (
                          <PendingMainRow key={row.item.id} invitation={row.item} locale={locale} copy={c} />
                        ),
                      )}
                    </ul>
                  ) : (
                    <div className="grid min-h-48 place-items-center p-xl text-center">
                      <div>
                        <StorefrontIcon size={28} className="mx-auto text-fg-muted" />
                        <h3 className="mt-sm text-body-lg font-semibold text-fg">{c.noResults}</h3>
                        <p className="mt-1 text-label text-fg-secondary">{c.noResultsBody}</p>
                      </div>
                    </div>
                  )}
                </div>

                {visibleCount < rows.length ? (
                  <button
                    type="button"
                    aria-controls="network-results-viewport"
                    onClick={() => setVisibleCount((count) => Math.min(count + 6, rows.length))}
                    className="flex w-full shrink-0 items-center justify-center gap-2 border-t border-strong px-md py-3 text-label font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                  >
                    {c.viewMore}
                    <ChevronDownIcon size={15} />
                  </button>
                ) : null}
              </section>
            </div>

            <aside dir={dir} className="grid min-w-0 gap-md desktop:col-start-2 desktop:row-start-1" aria-label={locale === "ar" ? "ملخص شبكة المعارض" : "Showroom network summary"}>
              <PointsCard copy={c} />
              <EarnPointsCard copy={c} />
              <PendingInvitationsCard copy={c} locale={locale} />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function ShowroomRow({ showroom, locale, copy: c }: { showroom: NetworkShowroom; locale: "ar" | "en"; copy: (typeof copy)["ar"] | (typeof copy)["en"] }) {
  return (
    <li data-testid="network-showroom-row" className="grid min-h-24 min-w-0 items-center gap-md p-md transition-colors hover:bg-surface-2/60 tablet:grid-cols-[minmax(0,1fr)_auto] desktop:grid-cols-[minmax(16rem,1fr)_10rem_14rem_5rem] desktop:gap-sm">
      <div className="flex min-w-0 items-center gap-md">
        <ShowroomLogo id={showroom.id} mark={showroom.mark} />
        <div className="min-w-0">
          <p className="truncate text-body-lg font-bold text-fg" title={localized(locale, showroom.name)}>{localized(locale, showroom.name)}</p>
          <p className="mt-1 flex min-w-0 items-center gap-1 text-label text-fg-secondary">
            <MapPinIcon size={14} className="shrink-0 text-fg-muted" />
            <span className="truncate" title={localized(locale, showroom.location)}>{localized(locale, showroom.location)}</span>
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-label text-fg-secondary">
            <StarIcon size={15} className="text-warning" />
            <strong className="font-semibold tabular-nums text-fg">{showroom.rating.toFixed(1)}</strong>
            <span>({showroom.reviews} {c.reviews})</span>
          </p>
        </div>
      </div>

      <span className="inline-flex w-fit items-center gap-1.5 justify-self-start rounded-pill bg-success/10 px-3 py-1.5 text-label font-semibold text-success tablet:col-start-2 tablet:row-start-1 tablet:self-center desktop:col-auto desktop:row-auto desktop:justify-self-center">
        <BadgeCheckFilledIcon size={15} />
        {c.relationship[showroom.relationship]}
      </span>

      <div className="flex flex-wrap items-center justify-center gap-sm tablet:col-span-2 desktop:col-auto">
        <Button variant="outline" size="sm"><MessageIcon size={15} className="text-iris-solid" />{c.message}</Button>
        <Button variant="outline" size="sm"><PhoneIcon size={15} className="text-iris-solid" />{c.call}</Button>
        <button type="button" aria-label={`${c.moreActions}: ${localized(locale, showroom.name)}`} title={c.moreActions} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus desktop:hidden">
          <MoreHorizontalIcon size={17} className="rotate-90" />
        </button>
      </div>

      <button type="button" aria-label={`${c.moreActions}: ${localized(locale, showroom.name)}`} title={c.moreActions} className="hidden h-8 w-8 place-items-center justify-self-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus desktop:grid">
        <MoreHorizontalIcon size={17} className="rotate-90" />
      </button>
    </li>
  );
}

function PendingMainRow({ invitation, locale, copy: c }: { invitation: PendingInvitation; locale: "ar" | "en"; copy: (typeof copy)["ar"] | (typeof copy)["en"] }) {
  return (
    <li data-testid="network-pending-row" className="grid min-h-24 min-w-0 items-center gap-md p-md transition-colors hover:bg-surface-2/60 tablet:grid-cols-[minmax(0,1fr)_auto] desktop:grid-cols-[minmax(16rem,1fr)_10rem_14rem_5rem] desktop:gap-sm">
      <div className="flex min-w-0 items-center gap-md">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-warning/10 text-warning"><ClockIcon size={22} /></span>
        <div className="min-w-0">
          <p className="truncate text-body-lg font-bold text-fg">{localized(locale, invitation.name)}</p>
          <bdi className="mt-1 block text-label tabular-nums text-fg-secondary">{invitation.phone}</bdi>
        </div>
      </div>
      <span className="inline-flex w-fit items-center gap-1.5 justify-self-start rounded-pill bg-warning/10 px-3 py-1.5 text-label font-semibold text-warning tablet:justify-self-end desktop:justify-self-center">
        <ClockIcon size={15} />
        {c.pendingRelationship}
      </span>
      <div className="flex items-center justify-center gap-sm tablet:col-span-2 desktop:col-auto">
        <Button variant="outline" size="sm"><SendIcon size={15} />{c.resend}</Button>
        <button type="button" aria-label={`${c.moreActions}: ${localized(locale, invitation.name)}`} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus desktop:hidden"><MoreHorizontalIcon size={17} className="rotate-90" /></button>
      </div>
      <button type="button" aria-label={`${c.moreActions}: ${localized(locale, invitation.name)}`} className="hidden h-8 w-8 place-items-center justify-self-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus desktop:grid"><MoreHorizontalIcon size={17} className="rotate-90" /></button>
    </li>
  );
}

function CardHeader({ icon: Icon, title, tone = "fg" }: { icon?: ComponentType<{ size?: number; className?: string }>; title: string; tone?: "fg" | "warning" | "iris" }) {
  return (
    <div className="flex items-center gap-2 border-b border-strong px-md py-3">
      {Icon ? <Icon size={20} className={tone === "warning" ? "text-warning" : tone === "iris" ? "text-iris-solid" : "text-fg-secondary"} /> : null}
      <h2 className="text-body-lg font-bold text-fg">{title}</h2>
    </div>
  );
}

function PointsCard({ copy: c }: { copy: (typeof copy)["ar"] | (typeof copy)["en"] }) {
  return (
    <section className="overflow-hidden rounded-md border border-strong bg-surface" aria-labelledby="network-points-title">
      <div className="flex items-center gap-2 border-b border-strong px-md py-3">
        <NetworkTrophyIcon size={24} className="text-warning" />
        <h2 id="network-points-title" className="text-body-lg font-bold text-fg">{c.pointsTitle}</h2>
      </div>
      <div className="bg-warning/5 p-md">
        <div dir="ltr" className="flex items-center justify-between gap-md">
          <div dir="auto">
            <strong className="block text-display font-bold tabular-nums text-warning">350</strong>
            <span className="text-label font-medium text-fg-secondary">{c.points}</span>
          </div>
          <div className="relative grid h-24 w-24 shrink-0 place-items-center">
            <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="20" cy="20" r="17" fill="none" className="stroke-warning/20" strokeWidth="2" />
              <circle cx="20" cy="20" r="17" fill="none" className="stroke-warning" strokeWidth="2" strokeLinecap="round" strokeDasharray="82 107" />
            </svg>
            <span className="relative text-center">
              <span className="block text-[11px] text-fg-secondary">{c.level}</span>
              <strong className="block text-title font-bold tabular-nums text-fg">3</strong>
            </span>
          </div>
        </div>
        <p className="mt-md text-label font-medium text-fg-secondary">{c.remaining}</p>
        <div className="mt-2"><ProgressMeter value={70} label={c.remaining} tone="accent" size="sm" /></div>
        <div dir="ltr" className="mt-md grid grid-cols-2 gap-sm">
          <Metric value="12" label={c.added} />
          <Metric value="7" label={c.invited} />
        </div>
      </div>
      <RailAction label={c.details} />
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-sm border border-strong bg-surface p-sm text-center"><strong className="block text-body-lg font-bold tabular-nums text-fg">{value}</strong><span className="mt-1 block text-[11px] text-fg-secondary">{label}</span></div>;
}

function EarnPointsCard({ copy: c }: { copy: (typeof copy)["ar"] | (typeof copy)["en"] }) {
  const rules = [
    { Icon: NetworkStoreIcon, points: "+10", tone: "bg-success/10 text-success" },
    { Icon: NetworkPeopleIcon, points: "+50", tone: "bg-info/10 text-info" },
    { Icon: NetworkStarIcon, points: "+100", tone: "bg-warning/10 text-warning" },
  ] as const;
  return (
    <section className="overflow-hidden rounded-md border border-strong bg-surface">
      <CardHeader title={c.earnTitle} />
      <ul className="divide-y divide-strong">
        {rules.map(({ Icon, points, tone }, index) => (
          <li key={points} className="flex items-center gap-sm px-md py-3">
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-sm", tone)}><Icon size={20} /></span>
            <span className="min-w-0 flex-1 text-label font-medium text-fg">{c.earnRules[index]}</span>
            <strong className="shrink-0 text-label font-bold tabular-nums text-fg">{points}</strong>
          </li>
        ))}
      </ul>
      <RailAction label={c.learnMore} />
    </section>
  );
}

function PendingInvitationsCard({ copy: c, locale }: { copy: (typeof copy)["ar"] | (typeof copy)["en"]; locale: "ar" | "en" }) {
  return (
    <section className="overflow-hidden rounded-md border border-strong bg-surface">
      <CardHeader icon={NetworkClockIcon} title={c.pendingTitle} tone="iris" />
      <ul className="divide-y divide-strong">
        {PENDING_INVITATIONS.slice(0, 3).map((invitation) => (
          <li key={invitation.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-sm px-md py-3">
            <div className="min-w-0">
              <p className="truncate text-label font-bold text-fg">{localized(locale, invitation.name)}</p>
              <bdi className="mt-0.5 block text-[11px] tabular-nums text-fg-secondary">{invitation.phone}</bdi>
              <p className="mt-1 text-[11px] text-warning">{c.pendingNote}</p>
            </div>
            <div className="flex items-center gap-1 self-center">
              <Button variant="outline" size="sm" className="px-2">{c.resend}</Button>
              <button type="button" aria-label={`${c.moreActions}: ${localized(locale, invitation.name)}`} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><MoreHorizontalIcon size={16} className="rotate-90" /></button>
            </div>
          </li>
        ))}
      </ul>
      <RailAction label={c.allInvites} />
    </section>
  );
}

function RailAction({ label }: { label: string }) {
  return <button type="button" className="w-full border-t border-strong px-md py-3 text-label font-semibold text-accent transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">{label}</button>;
}
