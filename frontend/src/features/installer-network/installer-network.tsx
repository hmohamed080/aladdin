"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/controls";
import { BadgeCheckFilledIcon, BriefcaseIcon, ChevronDownIcon, ClockIcon, MapPinIcon, PlusIcon, SearchIcon, SendIcon, StarIcon, StorefrontIcon } from "@/components/ui/icons";
import { ProgressMeter } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { derivePointsLevel } from "@/lib/network/points-level";
import { whatsappShareUrl } from "@/lib/contact/whatsapp";
import { cancelNetworkReferral } from "@/server/actions/network-referrals";
import { NetworkClockIcon, NetworkStoreIcon, NetworkTrophyIcon } from "@/features/installer-network-preview/network-visuals";

/** One relationship as the page renders it (from `my_network_organizations` and the caller's own referrals). */
export type InstallerNetworkRow =
  | {
      kind: "organization";
      id: string;
      name: string;
      /** Verified relationship: at least one completed job with this business. */
      workedWith: boolean;
      /** The business joined through this installer's referral. */
      joinedViaInvite: boolean;
      completedCount: number;
      reviewCount: number;
      latestJobTitle: string | null;
      place: string | null;
    }
  | { kind: "pending"; id: string; name: string; phone: string | null; place: string | null; createdAt: string };

type Tab = "all" | "joined" | "pending";

/**
 * `/home/network` for an Installer: the APPROVED "My showroom network" design (`/preview/installer-network`) on real data.
 * Rows are the businesses the installer finished work with or referred (joined), plus pending referrals. Points, the
 * level band and the referral counts come from the ledger and `network_referrals`. Actions are real: "Add a showroom"
 * opens the referral form, a pending invitation can be re-sent through WhatsApp (a pre-filled chat - nothing is sent
 * by the platform) or withdrawn, and a business opens its relationship page. Ratings, contact numbers and areas that
 * the platform does not hold for a business are not drawn.
 */
export function InstallerNetwork({
  rows,
  pointsBalance,
  referredOrgsCount,
  showroomsAddedCount,
}: {
  rows: readonly InstallerNetworkRow[];
  pointsBalance: number;
  referredOrgsCount: number;
  showroomsAddedCount: number;
}) {
  const { locale, dir } = useI18n();
  const ar = locale === "ar";
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(6);

  const counts = useMemo(() => ({
    all: rows.length,
    joined: rows.filter((r) => r.kind === "organization" && r.joinedViaInvite).length,
    pending: rows.filter((r) => r.kind === "pending").length,
  }), [rows]);
  const organizations = rows.filter((r) => r.kind === "organization").length;

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    return rows.filter((r) => {
      if (tab === "joined" && !(r.kind === "organization" && r.joinedViaInvite)) return false;
      if (tab === "pending" && r.kind !== "pending") return false;
      if (!q) return true;
      return `${r.name} ${r.place ?? ""} ${r.kind === "organization" ? r.latestJobTitle ?? "" : r.phone ?? ""}`.toLocaleLowerCase(locale).includes(q);
    });
  }, [locale, query, rows, tab]);
  const pending = rows.filter((r): r is Extract<InstallerNetworkRow, { kind: "pending" }> => r.kind === "pending");

  const t = {
    title: ar ? "معارفي من المعارض" : "My showroom network",
    subtitle: ar ? `لديك ${fmt(organizations, locale)} من الشركات في شبكتك` : `You have ${organizations} businesses in your network`,
    bannerTitle: ar ? "أضف معرضًا تعرفه واكسب نقاطًا" : "Add a showroom you know and earn points",
    bannerBody: ar ? "ساعدنا في توسيع شبكة المعارض، وكل معرض ينضم من دعوتك يزيد نقاطك." : "Help expand the showroom network. Every showroom that joins through your invitation grows your points.",
    add: ar ? "أضف معرضًا أعرفه" : "Add a showroom I know",
    search: ar ? "ابحث باسم المعرض أو المنطقة..." : "Search by showroom or area...",
    listTitle: ar ? "قائمة المعارض" : "Showroom list",
    results: ar ? "نتيجة" : "results",
    tabs: { all: ar ? "الكل" : "All", joined: ar ? "انضموا بدعوتي" : "Joined via my invite", pending: ar ? "في انتظار الانضمام" : "Awaiting join" },
    cols: { showroom: ar ? "المعرض" : "Showroom", relationship: ar ? "العلاقة" : "Relationship", action: ar ? "إجراء سريع" : "Quick action" },
    verified: ar ? "علاقة موثقة" : "Verified relationship",
    joined: ar ? "انضم بدعوتك" : "Joined via your invite",
    awaiting: ar ? "في انتظار الانضمام" : "Awaiting join",
    jobs: ar ? "أعمال منجزة" : "completed jobs",
    reviews: ar ? "تقييم" : "reviews",
    details: ar ? "عرض التفاصيل" : "View details",
    resend: ar ? "إعادة الإرسال عبر واتساب" : "Resend via WhatsApp",
    withdraw: ar ? "سحب الدعوة" : "Withdraw",
    more: ar ? "عرض المزيد" : "View more",
    none: ar ? "لا توجد معارض مطابقة" : "No matching showrooms",
    noneBody: ar ? "جرّب اسمًا أو منطقة أخرى، أو أضف معرضًا تعرفه." : "Try another name or area, or add a showroom you know.",
    pointsTitle: ar ? "نقاط المعارف" : "Network points",
    points: ar ? "نقطة" : "points",
    level: ar ? "المستوى" : "Level",
    added: ar ? "معرضًا أضفته" : "showrooms added",
    invited: ar ? "انضموا بدعوتك" : "joined via your invite",
    pointsLink: ar ? "عرض نقاطي" : "View my points",
    earnTitle: ar ? "كيف تكسب النقاط؟" : "How to earn points",
    earnRule: ar ? "انضمام شركة جديدة من دعوتك بعد اعتمادها" : "A new business joins through your invite and is approved",
    pendingTitle: ar ? "دعوات في انتظار الانضمام" : "Invitations awaiting join",
    allPending: ar ? `عرض جميع الدعوات (${fmt(pending.length, locale)})` : `View all invitations (${pending.length})`,
    inviteText: ar
      ? "مرحبًا، أدعوك للانضمام إلى منصة علاء الدين لعرض منتجاتك والتواصل مع الصنايعية والعملاء."
      : "Hi, I'd like to invite you to join Aladdin to showcase your products and connect with installers and clients.",
  };

  const info = derivePointsLevel(pointsBalance);
  const resendHref = (phone: string | null) => whatsappShareUrl({ phone, message: t.inviteText });

  return (
    <div dir={dir} data-installer-network className="flex w-full min-w-0 flex-col gap-md">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md bg-iris-solid/10 text-iris-solid"><NetworkStoreIcon size={24} /></span>
        <div className="min-w-0">
          <h1 className="text-title font-bold tracking-tight text-fg">{t.title}</h1>
          <p className="mt-1 text-body text-fg-secondary">{t.subtitle}</p>
        </div>
      </header>

      <div dir="ltr" className="grid min-w-0 items-start gap-md desktop:items-stretch desktop:grid-cols-[minmax(0,1fr)_20rem]">
        <div dir={dir} className="min-w-0 space-y-md desktop:flex desktop:h-full desktop:min-h-0 desktop:flex-col desktop:gap-md desktop:space-y-0">
          <section className="overflow-hidden rounded-md border border-strong bg-surface" aria-labelledby="invite-banner-title">
            <div className="grid items-center gap-md bg-surface-2/50 p-lg tablet:grid-cols-[minmax(0,1fr)_14rem] tablet:p-xl">
              <div className="min-w-0">
                <h2 id="invite-banner-title" className="text-body-lg font-bold text-fg">{t.bannerTitle}</h2>
                <p className="mt-2 max-w-2xl text-body leading-relaxed text-fg-secondary">{t.bannerBody}</p>
                <Link href="/home/network/refer" data-testid="network-add" className="mt-md inline-flex min-h-10 items-center justify-center gap-2 rounded-sm bg-primary px-md py-2 text-label font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
                  <PlusIcon size={16} />{t.add}
                </Link>
              </div>
              <div className="hidden justify-center tablet:flex" aria-hidden="true">
                <Image src="/assets/installer-network/showroom-invite.png" alt="" width={224} height={144} className="h-36 w-56 scale-125 object-contain" priority />
              </div>
            </div>
          </section>

          <section className="overflow-visible rounded-md border border-strong bg-surface desktop:flex desktop:min-h-0 desktop:flex-1 desktop:flex-col" aria-labelledby="showroom-list-title">
            <div className="flex items-center justify-between gap-md border-b border-strong px-md py-3">
              <h2 id="showroom-list-title" className="text-body-lg font-semibold text-fg">{t.listTitle}</h2>
              <span className="shrink-0 text-label tabular-nums text-fg-muted" aria-live="polite" data-testid="network-count">{fmt(shown.length, locale)} {t.results}</span>
            </div>
            <div className="flex flex-col gap-sm border-b border-strong p-md tablet:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t.search}</span>
                <SearchIcon size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input value={query} onChange={(e) => { setQuery(e.target.value); setVisible(6); }} placeholder={t.search} className="h-10 w-full rounded-sm border border-strong bg-canvas pe-md ps-10 text-label text-fg outline-none placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-focus" />
              </label>
            </div>
            <div role="tablist" aria-label={t.title} className="grid min-w-0 grid-cols-3 border-b border-strong tablet:flex tablet:overflow-x-auto tablet:px-md">
              {(["all", "joined", "pending"] as const).map((key) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setVisible(6); }} className={cn("relative min-w-0 px-1 py-3 text-center text-label font-semibold leading-snug transition-colors tablet:shrink-0 tablet:px-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", tab === key ? "text-fg" : "text-fg-muted hover:text-fg")}>
                  {t.tabs[key]} <span className="block tabular-nums tablet:inline">({fmt(counts[key], locale)})</span>
                  {tab === key ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-pill bg-primary tablet:inset-x-md" /> : null}
                </button>
              ))}
            </div>
            <div className="hidden grid-cols-[minmax(16rem,1fr)_11rem_15rem] items-center gap-sm border-b border-strong bg-surface-2/70 px-md py-2.5 text-label font-semibold text-fg-secondary desktop:grid">
              <span className="text-start">{t.cols.showroom}</span>
              <span className="text-center">{t.cols.relationship}</span>
              <span className="text-center">{t.cols.action}</span>
            </div>
            <div id="network-results-viewport" className="min-h-0 desktop:flex-1 desktop:overflow-y-auto">
              {shown.length ? (
                <ul className="divide-y divide-strong" aria-live="polite">
                  {shown.slice(0, visible).map((row) => row.kind === "organization" ? (
                    <li key={row.id} data-testid="network-showroom-row" className="grid min-h-24 min-w-0 items-center gap-md p-md transition-colors hover:bg-surface-2/60 tablet:grid-cols-[minmax(0,1fr)_auto] desktop:grid-cols-[minmax(16rem,1fr)_11rem_15rem] desktop:gap-sm">
                      <div className="flex min-w-0 items-center gap-md">
                        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-iris-solid/10 text-body-lg font-bold text-iris-solid">{Array.from(row.name.trim())[0] ?? "•"}</span>
                        <div className="min-w-0">
                          <p className="truncate text-body-lg font-bold text-fg" title={row.name}><bdi dir="auto">{row.name}</bdi></p>
                          {row.latestJobTitle ? <p className="mt-1 flex min-w-0 items-center gap-1 text-label text-fg-secondary"><BriefcaseIcon size={14} className="shrink-0 text-fg-muted" /><span className="truncate"><bdi dir="auto">{row.latestJobTitle}</bdi></span></p> : null}
                          {row.place ? <p className="mt-1 flex min-w-0 items-center gap-1 text-label text-fg-secondary"><MapPinIcon size={14} className="shrink-0 text-fg-muted" /><span className="truncate">{row.place}</span></p> : null}
                          {row.workedWith ? <p className="mt-1.5 flex items-center gap-1.5 text-label text-fg-secondary"><StarIcon size={15} className="text-warning" /><strong className="font-semibold tabular-nums text-fg">{fmt(row.completedCount, locale)}</strong><span>{t.jobs}</span>{row.reviewCount > 0 ? <span>· {fmt(row.reviewCount, locale)} {t.reviews}</span> : null}</p> : null}
                        </div>
                      </div>
                      <span className="inline-flex w-fit items-center gap-1.5 justify-self-start rounded-pill bg-success/10 px-3 py-1.5 text-label font-semibold text-success tablet:col-start-2 tablet:row-start-1 tablet:self-center desktop:col-auto desktop:row-auto desktop:justify-self-center">
                        <BadgeCheckFilledIcon size={15} />{row.workedWith ? t.verified : t.joined}
                      </span>
                      <div className="flex flex-wrap items-center justify-center gap-sm tablet:col-span-2 desktop:col-auto">
                        <Link href={`/home/network/${row.id}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-sm border border-strong px-3 py-1 text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><StorefrontIcon size={15} className="text-iris-solid" />{t.details}</Link>
                      </div>
                    </li>
                  ) : (
                    <li key={row.id} data-testid="network-pending-row" className="grid min-h-24 min-w-0 items-center gap-md p-md transition-colors hover:bg-surface-2/60 tablet:grid-cols-[minmax(0,1fr)_auto] desktop:grid-cols-[minmax(16rem,1fr)_11rem_15rem] desktop:gap-sm">
                      <div className="flex min-w-0 items-center gap-md">
                        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-warning/10 text-warning"><ClockIcon size={22} /></span>
                        <div className="min-w-0">
                          <p className="truncate text-body-lg font-bold text-fg"><bdi dir="auto">{row.name}</bdi></p>
                          {row.phone ? <bdi dir="ltr" className="mt-1 block text-label tabular-nums text-fg-secondary">{row.phone}</bdi> : null}
                          {row.place ? <p className="mt-1 text-label text-fg-secondary">{row.place}</p> : null}
                        </div>
                      </div>
                      <span className="inline-flex w-fit items-center gap-1.5 justify-self-start rounded-pill bg-warning/10 px-3 py-1.5 text-label font-semibold text-warning tablet:justify-self-end desktop:justify-self-center"><ClockIcon size={15} />{t.awaiting}</span>
                      <div className="flex flex-wrap items-center justify-center gap-sm tablet:col-span-2 desktop:col-auto">
                        <a href={resendHref(row.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-sm border border-strong px-3 py-1 text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><SendIcon size={15} />{t.resend}</a>
                        <form action={cancelNetworkReferral}>
                          <input type="hidden" name="referralId" value={row.id} />
                          <Button type="submit" variant="ghost" size="sm">{t.withdraw}</Button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid min-h-48 place-items-center p-xl text-center" data-testid="network-empty">
                  <div><StorefrontIcon size={28} className="mx-auto text-fg-muted" /><h3 className="mt-sm text-body-lg font-semibold text-fg">{t.none}</h3><p className="mt-1 text-label text-fg-secondary">{t.noneBody}</p></div>
                </div>
              )}
            </div>
            {visible < shown.length ? (
              <button type="button" aria-controls="network-results-viewport" onClick={() => setVisible((v) => v + 6)} className="flex w-full shrink-0 items-center justify-center gap-2 border-t border-strong px-md py-3 text-label font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">{t.more}<ChevronDownIcon size={15} /></button>
            ) : null}
          </section>
        </div>

        <aside dir={dir} className="grid min-w-0 gap-md desktop:col-start-2 desktop:row-start-1" aria-label={ar ? "ملخص شبكة المعارض" : "Showroom network summary"}>
          <section className="overflow-hidden rounded-md border border-strong bg-surface" aria-labelledby="network-points-title" data-testid="network-points">
            <div className="flex items-center gap-2 border-b border-strong px-md py-3"><NetworkTrophyIcon size={24} className="text-warning" /><h2 id="network-points-title" className="text-body-lg font-bold text-fg">{t.pointsTitle}</h2></div>
            <div className="bg-warning/5 p-md">
              <div dir="ltr" className="flex items-center justify-between gap-md">
                <div dir="auto"><strong className="block text-display font-bold tabular-nums text-warning">{fmt(pointsBalance, locale)}</strong><span className="text-label font-medium text-fg-secondary">{t.points}</span></div>
                <div className="relative grid h-24 w-24 shrink-0 place-items-center">
                  <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
                    <circle cx="20" cy="20" r="17" fill="none" className="stroke-warning/20" strokeWidth="2" />
                    <circle cx="20" cy="20" r="17" fill="none" className="stroke-warning" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(info.progressPct / 100) * 107} 107`} />
                  </svg>
                  <span className="relative text-center"><span className="block text-[11px] text-fg-secondary">{t.level}</span><strong className="block text-title font-bold tabular-nums text-fg">{fmt(info.level, locale)}</strong></span>
                </div>
              </div>
              {info.remainingToNextLevel !== null ? (
                <>
                  <p className="mt-md text-label font-medium text-fg-secondary">{ar ? `باقي ${fmt(info.remainingToNextLevel, locale)} نقطة للوصول للمستوى التالي` : `${info.remainingToNextLevel} points left to reach the next level`}</p>
                  <div className="mt-2"><ProgressMeter value={info.progressPct} label={ar ? "التقدم للمستوى التالي" : "Progress to the next level"} tone="accent" size="sm" /></div>
                </>
              ) : null}
              <div dir="ltr" className="mt-md grid grid-cols-2 gap-sm">
                <Metric value={fmt(showroomsAddedCount, locale)} label={t.added} />
                <Metric value={fmt(referredOrgsCount, locale)} label={t.invited} />
              </div>
            </div>
            <Link href="/home/points" className="block w-full border-t border-strong px-md py-3 text-label font-semibold text-accent transition-colors hover:bg-surface-2">{t.pointsLink}</Link>
          </section>

          <section className="overflow-hidden rounded-md border border-strong bg-surface">
            <div className="flex items-center gap-2 border-b border-strong px-md py-3"><h2 className="text-body-lg font-bold text-fg">{t.earnTitle}</h2></div>
            <ul className="divide-y divide-strong">
              <li className="flex items-center gap-sm px-md py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-success/10 text-success"><NetworkStoreIcon size={20} /></span>
                <span className="min-w-0 flex-1 text-label font-medium text-fg">{t.earnRule}</span>
                <strong className="shrink-0 text-label font-bold tabular-nums text-fg">+100</strong>
              </li>
            </ul>
          </section>

          <section className="overflow-hidden rounded-md border border-strong bg-surface">
            <div className="flex items-center gap-2 border-b border-strong px-md py-3"><NetworkClockIcon size={20} className="text-iris-solid" /><h2 className="text-body-lg font-bold text-fg">{t.pendingTitle}</h2></div>
            {pending.length === 0 ? (
              <p className="px-md py-md text-label text-fg-secondary">{ar ? "لا توجد دعوات معلّقة." : "No pending invitations."}</p>
            ) : (
              <ul className="divide-y divide-strong">
                {pending.slice(0, 3).map((p) => (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-sm px-md py-3">
                    <div className="min-w-0"><p className="truncate text-label font-bold text-fg"><bdi dir="auto">{p.name}</bdi></p>{p.phone ? <bdi dir="ltr" className="mt-0.5 block text-[11px] tabular-nums text-fg-secondary">{p.phone}</bdi> : null}</div>
                    <a href={resendHref(p.phone)} target="_blank" rel="noopener noreferrer" className="self-center rounded-sm border border-strong px-2 py-1 text-label text-fg hover:bg-surface-2">{ar ? "إعادة إرسال" : "Resend"}</a>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 ? <button type="button" onClick={() => setTab("pending")} className="w-full border-t border-strong px-md py-3 text-label font-semibold text-accent transition-colors hover:bg-surface-2">{t.allPending}</button> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-sm border border-strong bg-surface p-sm text-center"><strong className="block text-body-lg font-bold tabular-nums text-fg">{value}</strong><span className="mt-1 block text-[11px] text-fg-secondary">{label}</span></div>;
}

function fmt(value: number, locale: "ar" | "en") {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG").format(value);
}
