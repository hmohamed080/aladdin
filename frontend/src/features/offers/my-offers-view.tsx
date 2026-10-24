"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input, SubmitButton } from "@/components/ui/controls";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatePanel } from "@/components/ui/primitives";
import {
  CalendarIcon,
  ClockIcon,
  InboxIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  EyeIcon,
  TrashIcon,
  AlertIcon,
  FileTextIcon,
} from "@/components/ui/icons";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { offerStatusAction, type OfferFormState } from "@/server/actions/offers";
import { DEFAULT_MY_OFFERS_PARAMS, OFFER_PHASES, type MyOffersParams, type OfferPhase } from "./offer-model";
import { formatOfferDate } from "./offer-datetime";
import { OfferCollage, PhaseBadge } from "./offer-parts";
import type { OwnOffer } from "@/server/queries/offers";
import { OFFER_AUDIENCE_GROUPS, groupsForAudienceCodes } from "./offer-model";
import { IconStat } from "@/components/ui/icon-stat";
import { Pager } from "@/components/ui/pager";
import { appendUniqueById, lessCount } from "@/lib/pagination/batches";
import { loadMyOffersBatchAction } from "@/server/actions/offer-feed";

const MY_OFFERS = `${SHOWROOM_ROOT}/my-offers`;
type StatusAction = "publish" | "pause" | "resume" | "archive" | "restore";

/** What a phase allows, in display order: the first is the card's primary action. The database re-checks every one. */
const PHASE_ACTIONS: Record<OfferPhase, { primary: StatusAction | "edit" | "details"; secondary: Array<StatusAction | "edit"> }> = {
  draft: { primary: "publish", secondary: ["edit", "archive"] },
  scheduled: { primary: "edit", secondary: ["pause"] },
  active: { primary: "pause", secondary: [] },
  paused: { primary: "resume", secondary: ["edit", "archive"] },
  expired: { primary: "archive", secondary: [] },
  archived: { primary: "restore", secondary: [] },
};

const ACTION_ICON: Record<StatusAction | "edit" | "details", ComponentType<{ size?: number }>> = {
  publish: SendIcon,
  pause: PauseIcon,
  resume: PlayIcon,
  archive: TrashIcon,
  restore: RefreshIcon,
  edit: PencilIcon,
  details: EyeIcon,
};

const initial: OfferFormState = { ok: false };

function StatusForm({ offer, action, primary, onDone }: { offer: OwnOffer; action: StatusAction; primary?: boolean; onDone?: () => void }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(offerStatusAction, initial);
  const Icon = ACTION_ICON[action];
  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state.ok, onDone]);
  return (
    <form action={dispatch} className={cn("min-w-0", primary && "flex-1")}>
      <input type="hidden" name="offerId" value={offer.id} />
      <input type="hidden" name="expectedVersion" value={offer.version} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton
        variant={primary && action === "publish" ? "accent" : "outline"}
        pendingLabel={t("common.saving")}
        className={cn("h-10 w-full gap-1.5 whitespace-nowrap px-2 text-label", !primary && "justify-start")}
        data-testid={`offer-action-${action}`}
      >
        <Icon size={14} />
        {t(`showroomOffers.mine.${action}`)}
      </SubmitButton>
      {state.code && !state.ok ? <p role="alert" className="mt-1 text-label text-danger">{t(state.code)}</p> : null}
    </form>
  );
}

/** The "⋯" menu: the secondary actions of a card. Closes on Escape and on any outside press. */
function OverflowMenu({ offer, items, canWrite, canPublish }: { offer: OwnOffer; items: Array<StatusAction | "edit">; canWrite: boolean; canPublish: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const allowed = items.filter((a) => (a === "edit" ? canWrite : canPublish));
  if (allowed.length === 0) return null;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("showroomOffers.mine.more")}
        onClick={() => setOpen((o) => !o)}
        data-testid="offer-more-actions"
        className="grid h-10 w-10 place-items-center rounded-sm border border-strong bg-surface text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <MoreHorizontalIcon size={16} />
      </button>
      {open ? (
        <div role="menu" className="absolute bottom-full start-0 z-popover mb-1 flex w-44 flex-col gap-1 rounded-md border border-strong bg-surface p-1 shadow-card">
          {allowed.map((a) =>
            a === "edit" ? (
              <Link key={a} role="menuitem" href={`${MY_OFFERS}/${offer.id}/edit`} className="inline-flex h-10 items-center gap-1.5 rounded-sm px-2 text-label text-fg hover:bg-surface-2">
                <PencilIcon size={14} />
                {t("showroomOffers.mine.edit")}
              </Link>
            ) : (
              <StatusForm key={a} offer={offer} action={a} onDone={() => setOpen(false)} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function OfferCard({ offer, locale, canWrite, canPublish }: { offer: OwnOffer; locale: "ar" | "en"; canWrite: boolean; canPublish: boolean }) {
  const { t } = useI18n();
  const plan = PHASE_ACTIONS[offer.phase];
  const editable = offer.phase === "draft" || offer.phase === "paused" || offer.phase === "scheduled";
  const primary = plan.primary;
  const primaryAllowed = primary === "edit" ? canWrite : primary === "details" ? true : canPublish;
  const images = offer.items.map((i) => i.imageUrl).filter((u): u is string => Boolean(u)).slice(0, 3);
  const audience = groupsForAudienceCodes(offer.audiences).map((g) => t(`showroomOffers.audienceGroup.${g}`)).join("، ");
  return (
    <article className="flex h-full flex-col gap-2 rounded-md border bg-surface p-sm shadow-card" data-testid="my-offer-card" data-phase={offer.phase}>
      <div className="flex items-center justify-between gap-2">
        <PhaseBadge phase={offer.phase} />
        {offer.invalidItemCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-label text-warning" data-testid="offer-needs-attention">
            <AlertIcon size={13} />
            {t("showroomOffers.mine.needsAttention", { count: String(offer.invalidItemCount) })}
          </span>
        ) : null}
      </div>
      <OfferCollage images={images} count={offer.itemCount} alt={offer.title} />
      <h3 className="line-clamp-2 text-body font-semibold leading-snug text-fg" dir="auto" data-testid="my-offer-title">{offer.title}</h3>
      <p className="text-label text-fg-muted">{t("showroomOffers.mine.updatedAt", { date: formatOfferDate(offer.updatedAt, locale) })}</p>
      <dl className="grid grid-cols-2 gap-2 text-label text-fg-secondary">
        <div className="flex min-w-0 items-center gap-1.5"><CalendarIcon size={13} className="shrink-0 text-accent" /><dd className="truncate">{t("showroomOffers.mine.fromDate", { date: formatOfferDate(offer.startsAt, locale) })}</dd></div>
        <div className="flex min-w-0 items-center gap-1.5"><ClockIcon size={13} className="shrink-0 text-accent" /><dd className="truncate">{t("showroomOffers.mine.toDate", { date: formatOfferDate(offer.endsAt, locale) })}</dd></div>
      </dl>
      {audience ? <p className="line-clamp-1 text-label text-fg-muted" title={audience} dir="auto">{audience}</p> : null}
      <div className="mt-auto flex items-stretch gap-1.5 pt-1">
        <OverflowMenu offer={offer} items={plan.secondary} canWrite={canWrite} canPublish={canPublish} />
        {primaryAllowed && primary !== "details" ? (
          primary === "edit" ? (
            <Link href={`${MY_OFFERS}/${offer.id}/edit`} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-sm border border-strong px-2 text-label font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" data-testid="offer-action-edit">
              <PencilIcon size={14} />
              {t("showroomOffers.mine.edit")}
            </Link>
          ) : (
            <StatusForm offer={offer} action={primary} primary />
          )
        ) : null}
        <Link
          href={`${MY_OFFERS}/${offer.id}/edit`}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-sm bg-accent-solid ring-1 ring-accent-edge px-2 text-label font-semibold text-on-accent hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          data-testid="offer-action-details"
        >
          {editable && canWrite ? <PencilIcon size={14} /> : <EyeIcon size={14} />}
          {editable && canWrite && primary !== "edit" ? t("showroomOffers.mine.edit") : t("showroomOffers.mine.details")}
        </Link>
      </div>
    </article>
  );
}

export function MyOffersView({
  offers: initialOffers,
  total: initialTotal,
  counts: initialCounts,
  locale,
  canWrite,
  canPublish,
  notice,
}: {
  /** The FIRST batch (server-rendered); further batches and every filter change are bounded server reads. */
  offers: OwnOffer[];
  /** Everything the (default) filters match. */
  total: number;
  /** Offers per lifecycle phase over the WHOLE history — never derived from the batch on screen. */
  counts: Record<OfferPhase, number>;
  locale: "ar" | "en";
  canWrite: boolean;
  canPublish: boolean;
  notice?: string | null;
}) {
  const { t } = useI18n();
  const [params, setParams] = useState<MyOffersParams>(DEFAULT_MY_OFFERS_PARAMS);
  const [items, setItems] = useState<OwnOffer[]>(initialOffers);
  const [total, setTotal] = useState(initialTotal);
  const [counts, setCounts] = useState(initialCounts);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const firstRun = useRef(true);
  const lastQuery = useRef("");

  const fetchPage = useCallback(async (p: MyOffersParams, offset: number, mode: "replace" | "append") => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    const res = await loadMyOffersBatchAction(p, offset);
    if (id !== request.current) return; // a newer request superseded this one
    setLoading(false);
    if (!res.ok) return setFailed(true);
    setItems((prev) => (mode === "replace" ? res.offers : appendUniqueById(prev, res.offers)));
    setTotal(res.total);
    setCounts(res.counts);
  }, []);

  // A filter/sort/search change starts over from the first batch (debounced only while typing).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      lastQuery.current = params.q;
      return;
    }
    const typing = params.q !== lastQuery.current;
    lastQuery.current = params.q;
    const timer = setTimeout(() => void fetchPage(params, 0, "replace"), typing ? 300 : 0);
    return () => clearTimeout(timer);
  }, [params, fetchPage]);

  // A lifecycle action (publish, pause, archive…) re-renders the page with fresh rows: restart from the first batch.
  const seenInitial = useRef(initialOffers);
  useEffect(() => {
    if (seenInitial.current === initialOffers) return;
    seenInitial.current = initialOffers;
    void fetchPage(params, 0, "replace");
  }, [initialOffers, params, fetchPage]);

  const update = (patch: Partial<MyOffersParams>) => setParams((p) => ({ ...p, ...patch }));
  const { q, phase, audience, period, sort } = params;
  const filtered = Boolean(q || phase || audience || period !== "all");
  const clear = () => setParams((p) => ({ ...DEFAULT_MY_OFFERS_PARAMS, sort: p.sort }));
  const showMore = () => void fetchPage(params, items.length, "append");
  const showLess = () => {
    request.current++; // drop any in-flight batch so it cannot re-extend the list
    setLoading(false);
    setItems((prev) => prev.slice(0, lessCount(prev.length)));
  };
  const allOffers = OFFER_PHASES.reduce((n, p) => n + counts[p], 0);
  const shown = items;

  const stats = [
    { key: "total", label: t("showroomOffers.mine.statTotal"), value: allOffers, Icon: LayersIcon, phase: "" as const },
    { key: "active", label: t("showroomOffers.mine.statActive"), value: counts.active, Icon: PlayIcon, phase: "active" as const },
    { key: "scheduled", label: t("showroomOffers.mine.statScheduled"), value: counts.scheduled, Icon: ClockIcon, phase: "scheduled" as const },
    { key: "draft", label: t("showroomOffers.mine.statDraft"), value: counts.draft, Icon: FileTextIcon, phase: "draft" as const },
  ];

  return (
    <div className="flex flex-col gap-md" data-testid="my-offers">
      {notice ? <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success" data-testid="offers-notice">{notice}</p> : null}
      {!canWrite ? <p className="text-label text-fg-muted" data-testid="my-offers-readonly">{t("showroomOffers.mine.readOnly")}</p> : null}

      <ul className="grid grid-cols-2 gap-sm desktop:grid-cols-4 desktop:gap-md" data-testid="my-offers-stats">
        {stats.map(({ key, label, value, Icon, phase: target }) => (
          <li key={key} className="min-w-0">
            <button
              type="button"
              onClick={() => update({ phase: target })}
              aria-pressed={phase === target}
              data-testid={`offers-stat-${key}`}
              className={cn(
                "flex h-full w-full items-center rounded-md border bg-surface p-sm text-start shadow-card transition-colors hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:p-md",
                phase === target ? "border-accent" : "border",
              )}
            >
              <IconStat Icon={Icon} label={label} value={String(value)} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-sm" data-testid="my-offers-toolbar">
        <div className="flex flex-wrap items-stretch gap-sm">
          <label className="relative min-w-0 flex-[2] basis-56">
            <span className="sr-only">{t("showroomOffers.mine.searchPlaceholder")}</span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted"><SearchIcon size={16} /></span>
            <Input value={q} onChange={(e) => update({ q: e.target.value })} placeholder={t("showroomOffers.mine.searchPlaceholder")} className="ps-9" data-testid="my-offers-search" />
          </label>
          <div className="min-w-0 flex-1 basis-40">
            <SelectMenu
              value={phase}
              aria-label={t("showroomOffers.mine.statusFilter")}
              onChange={(v) => update({ phase: v as MyOffersParams["phase"] })}
              data-testid="my-offers-status"
              options={[{ value: "", label: t("showroomOffers.mine.allStatuses") }, ...OFFER_PHASES.map((p) => ({ value: p, label: t(`showroomOffers.status.${p}`) }))]}
            />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <SelectMenu
              value={audience}
              aria-label={t("showroomOffers.mine.audienceFilter")}
              onChange={(v) => update({ audience: v as MyOffersParams["audience"] })}
              data-testid="my-offers-audience"
              options={[{ value: "", label: t("showroomOffers.mine.allAudiences") }, ...OFFER_AUDIENCE_GROUPS.map((g) => ({ value: g.id, label: t(`showroomOffers.audienceGroup.${g.id}`) }))]}
            />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <SelectMenu
              value={period}
              aria-label={t("showroomOffers.mine.periodFilter")}
              onChange={(v) => update({ period: v as MyOffersParams["period"] })}
              data-testid="my-offers-period"
              options={[
                { value: "all", label: t("showroomOffers.mine.periodAll") },
                { value: "current", label: t("showroomOffers.mine.periodCurrent") },
                { value: "upcoming", label: t("showroomOffers.mine.periodUpcoming") },
                { value: "past", label: t("showroomOffers.mine.periodPast") },
              ]}
            />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <SelectMenu
              value={sort}
              aria-label={t("showroomOffers.mine.sort")}
              onChange={(v) => update({ sort: v as MyOffersParams["sort"] })}
              data-testid="my-offers-sort"
              options={[
                { value: "updated", label: t("showroomOffers.mine.sortUpdated") },
                { value: "ending", label: t("showroomOffers.mine.sortEnding") },
                { value: "starting", label: t("showroomOffers.mine.sortStarting") },
              ]}
            />
          </div>
        </div>

        <nav aria-label={t("showroomOffers.mine.statusFilter")} className="min-w-0 overflow-x-auto pb-1" data-testid="my-offers-chips">
          <ul className="flex w-max min-w-full gap-2">
            {[{ value: "" as const, label: t("showroomOffers.mine.chipAll"), count: allOffers }, ...OFFER_PHASES.map((p) => ({ value: p, label: t(`showroomOffers.status.${p}`), count: counts[p] }))].map((chip) => (
              <li key={chip.value || "all"} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={phase === chip.value}
                  onClick={() => update({ phase: chip.value })}
                  data-testid={`offers-chip-${chip.value || "all"}`}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    phase === chip.value ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                  )}
                >
                  {chip.label}
                  <span className="text-caption opacity-80" dir="ltr">{chip.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <p className="text-title font-semibold text-fg" data-testid="my-offers-count" dir="auto">{t("showroomOffers.mine.count", { count: String(total) })}</p>

      {shown.length === 0 ? (
        <StatePanel
          icon={<InboxIcon size={22} />}
          title={filtered ? t("showroomOffers.mine.noResultsTitle") : t("showroomOffers.mine.emptyTitle")}
          body={filtered ? t("showroomOffers.mine.noResultsBody") : t("showroomOffers.mine.emptyBody")}
          action={
            filtered ? (
              <Button type="button" variant="ghost" onClick={clear}>{t("showroomOffers.mine.clearFilters")}</Button>
            ) : canWrite ? (
              <Link href={`${MY_OFFERS}/new`} className="text-label font-medium text-accent hover:underline">{t("showroomOffers.mine.create")}</Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-sm tablet:grid-cols-2 tablet:gap-md desktop:grid-cols-3 wide:grid-cols-4" data-testid="my-offers-grid">
          {shown.map((o) => (
            <li key={o.id} className="min-w-0">
              <OfferCard offer={o} locale={locale} canWrite={canWrite} canPublish={canPublish} />
            </li>
          ))}
        </ul>
      )}
      {failed ? <p role="alert" className="text-center text-label text-danger" data-testid="my-offers-load-error">{t("pager.loadError")}</p> : null}
      <Pager shown={items.length} total={total} loading={loading} onMore={showMore} onLess={showLess} testId="my-offers" />
    </div>
  );
}

