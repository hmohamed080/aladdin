"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { allowedNavSections, navLabelKey, type NavKey } from "@/lib/nav/modules";
import type { CommerceStance } from "@/lib/workspace/supply-side";
import { searchWorkspace } from "@/server/actions/search";
import { MIN_QUERY_LENGTH, SEARCH_GROUP_ORDER, type SearchGroup, type SearchHit } from "@/lib/search/scope";
import {
  HomeIcon,
  UsersIcon,
  TargetIcon,
  CalendarCheckIcon,
  SearchIcon,
  PackageIcon,
  ClipboardIcon,
  LayersIcon,
  ShoppingBagIcon,
  InboxIcon,
  BookmarkIcon,
  TruckIcon,
  WrenchIcon,
  LandmarkIcon,
  BarChartIcon,
  SettingsIcon,
  StorefrontIcon,
  UserIcon,
  DemandIcon,
  FileTextIcon,
  BuildingIcon,
  BadgeCheckIcon,
  ScrollIcon,
  GaugeIcon,
  CommandIcon,
  EnterKeyIcon,
  XIcon,
} from "@/components/ui/icons";

/**
 * GLOBAL SEARCH — one field that answers both "take me somewhere" and
 * "find me this record".
 *
 * TWO FAMILIES, ONE BOX, AND THEY BEHAVE DIFFERENTLY ON PURPOSE
 *   NAVIGATION results are LOCAL. The caller's reachable modules are already
 *   known on the client (the same `allowedNavSections` the sidebar draws from),
 *   so typing "ord" lists Orders instantly with no round trip. A command palette
 *   that waits on a network call to offer its own menu feels broken.
 *
 *   RECORD results are SERVER-SIDE, capability-gated and RLS-scoped (see
 *   `server/actions/search`). They start only after {MIN_QUERY_LENGTH}
 *   characters and are debounced, because the alternative is nine parallel
 *   queries per keystroke.
 *
 * WHY THE CAPABILITY LIST IS SAFE TO HOLD ON THE CLIENT
 * It is the same list the sidebar already renders from, and it decides only
 * which DOORS are drawn. Every route re-checks authority server-side and every
 * record read re-checks RLS, so a tampered list buys a redirect, not data. The
 * one thing deliberately NOT trusted from here is platform staff: `canAdmin` is
 * resolved on the server and passed in.
 *
 * STALE-RESPONSE GUARD
 * Every search carries a monotonic request id and a slower earlier response can
 * never overwrite a newer one — otherwise a fast "ce" landing after a slow "c"
 * repaints the list with results for a query the user has already left behind.
 */

const NAV_ICONS: Record<NavKey, ComponentType<{ size?: number }>> = {
  home: HomeIcon,
  purchaseRequests: ShoppingBagIcon,
  offers: InboxIcon,
  orders: ClipboardIcon,
  catalog: SearchIcon,
  saved: BookmarkIcon,
  suppliers: TruckIcon,
  buyers: StorefrontIcon,
  technicians: WrenchIcon,
  institutions: LandmarkIcon,
  customers: UsersIcon,
  leads: TargetIcon,
  followUps: CalendarCheckIcon,
  products: PackageIcon,
  projects: LayersIcon,
  team: UsersIcon,
  reports: BarChartIcon,
  settings: SettingsIcon,
};

/** The two glyphs whose metaphor reverses on the selling seat (see workspace-nav). */
const SELLER_NAV_ICONS: Partial<Record<NavKey, ComponentType<{ size?: number }>>> = {
  purchaseRequests: DemandIcon,
  offers: FileTextIcon,
};

const NAV_HREFS: Record<NavKey, string> = {
  home: "/b2b",
  purchaseRequests: "/b2b/rfqs",
  offers: "/b2b/quotations",
  orders: "/b2b/orders",
  catalog: "/b2b/catalog",
  saved: "/b2b/saved",
  suppliers: "/b2b/suppliers",
  buyers: "/b2b/buyers",
  technicians: "/b2b/technicians",
  institutions: "/b2b/institutions",
  customers: "/b2b/customers",
  leads: "/b2b/leads",
  followUps: "/b2b/follow-ups",
  products: "/b2b/products",
  projects: "/b2b/projects",
  team: "/b2b/organization",
  reports: "/b2b/reports",
  settings: "/b2b/settings",
};

/**
 * The description key follows the SEAT, not the route: the same module is
 * "prices you asked for" to a showroom and "requests waiting for your price" to
 * a distributor, and a one-line description that contradicts the label it sits
 * under is worse than none.
 */
function descKey(key: NavKey, stance: CommerceStance): string {
  if (stance === "seller" && key === "purchaseRequests") return "search.desc.demand";
  if (stance === "seller" && key === "offers") return "search.desc.quotations";
  return `search.desc.${key}`;
}

const ADMIN_ITEMS: { href: string; labelKey: string; descKey: string; Icon: ComponentType<{ size?: number }> }[] = [
  { href: "/admin", labelKey: "admin.nav.dashboard", descKey: "search.desc.adminHome", Icon: GaugeIcon },
  { href: "/admin/users", labelKey: "admin.nav.users", descKey: "search.desc.adminUsers", Icon: UsersIcon },
  {
    href: "/admin/organizations",
    labelKey: "admin.nav.organizations",
    descKey: "search.desc.adminOrganizations",
    Icon: BuildingIcon,
  },
  {
    href: "/admin/verifications",
    labelKey: "admin.nav.verifications",
    descKey: "search.desc.adminVerifications",
    Icon: BadgeCheckIcon,
  },
  { href: "/admin/audit", labelKey: "admin.nav.audit", descKey: "search.desc.adminAudit", Icon: ScrollIcon },
];

const HIT_ICONS: Record<SearchGroup, ComponentType<{ size?: number }>> = {
  products: PackageIcon,
  catalog: SearchIcon,
  rfqs: DemandIcon,
  quotations: FileTextIcon,
  orders: ClipboardIcon,
  projects: LayersIcon,
  customers: UsersIcon,
  leads: TargetIcon,
  organizations: BuildingIcon,
};

type Entry = {
  id: string;
  title: string;
  description: string | null;
  href: string;
  Icon: ComponentType<{ size?: number }>;
  /** Section heading this entry belongs under. */
  groupLabel: string;
};

function matches(entry: { title: string; description: string | null }, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${entry.title} ${entry.description ?? ""}`.toLowerCase().includes(q);
}

export function GlobalSearch({
  capabilities,
  stance = "buyer",
  hasWorkspace,
  canAdmin = false,
}: {
  /** Membership capabilities — the same list the sidebar renders from. */
  capabilities: readonly string[];
  stance?: CommerceStance;
  /** False on a personal `/home` account: navigation only, no record search. */
  hasWorkspace: boolean;
  /** Server-resolved platform-staff flag. Never inferred on the client. */
  canAdmin?: boolean;
}) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  const navEntries = useMemo<Entry[]>(() => {
    const label = t("search.group.navigation");
    // A personal account has no membership and therefore no capability-derived
    // rail. It still has destinations, and a palette that opens empty for a
    // consumer is worse than no palette — so the two routes a personal account
    // genuinely owns are offered instead. Nothing here is capability-gated
    // because nothing here is a business surface.
    if (!hasWorkspace) {
      return [
        {
          id: "nav-personal-home",
          title: t("nav.home"),
          description: t("search.desc.home"),
          href: "/home",
          Icon: HomeIcon,
          groupLabel: label,
        },
        {
          id: "nav-personal-profile",
          title: t("account.profile"),
          description: t("search.desc.profile"),
          href: "/onboarding/profile",
          Icon: UserIcon,
          groupLabel: label,
        },
      ];
    }
    return allowedNavSections(capabilities, stance)
      .flatMap((s) => s.keys)
      .map((key) => ({
        id: `nav-${key}`,
        title: t(navLabelKey(key, stance, `nav.${key}`)),
        description: t(descKey(key, stance)),
        href: NAV_HREFS[key],
        Icon: (stance === "seller" ? SELLER_NAV_ICONS[key] : undefined) ?? NAV_ICONS[key],
        groupLabel: label,
      }));
  }, [capabilities, stance, hasWorkspace, t]);

  const adminEntries = useMemo<Entry[]>(() => {
    if (!canAdmin) return [];
    const label = t("search.group.admin");
    return ADMIN_ITEMS.map((item) => ({
      id: `admin-${item.href}`,
      title: t(item.labelKey),
      description: t(item.descKey),
      href: item.href,
      Icon: item.Icon,
      groupLabel: label,
    }));
  }, [canAdmin, t]);

  const hitEntries = useMemo<Entry[]>(() => {
    const byGroup = new Map<SearchGroup, SearchHit[]>();
    for (const hit of hits) {
      const bucket = byGroup.get(hit.group);
      if (bucket) bucket.push(hit);
      else byGroup.set(hit.group, [hit]);
    }
    return SEARCH_GROUP_ORDER.flatMap((group) =>
      (byGroup.get(group) ?? []).map((hit) => ({
        id: `${hit.group}-${hit.id}`,
        title: hit.title,
        // The status chip earns the second line when there is no subtitle: for a
        // quotation "Awaiting decision" is more useful than a blank row.
        description: hit.subtitle ?? (hit.statusKey ? t(hit.statusKey) : null),
        href: hit.href,
        Icon: HIT_ICONS[group],
        groupLabel: t(`search.group.${group}`),
      })),
    );
  }, [hits, t]);

  // Navigation is filtered locally and instantly; records arrive already matched.
  const entries = useMemo<Entry[]>(() => {
    const local = [...navEntries, ...adminEntries].filter((e) => matches(e, query));
    return [...hitEntries, ...local];
  }, [navEntries, adminEntries, hitEntries, query]);

  // Grouped for rendering, preserving the flat index so keyboard selection and
  // the painted list can never disagree about which row is active.
  const sections = useMemo(() => {
    const out: { label: string; items: { entry: Entry; index: number }[] }[] = [];
    entries.forEach((entry, index) => {
      const last = out[out.length - 1];
      if (last && last.label === entry.groupLabel) last.items.push({ entry, index });
      else out.push({ label: entry.groupLabel, items: [{ entry, index }] });
    });
    return out;
  }, [entries]);

  const close = useCallback(() => setOpen(false), []);

  const openPalette = useCallback(() => {
    setQuery("");
    setHits([]);
    setActive(0);
    setOpen(true);
  }, []);

  // Ctrl/Cmd+K anywhere in the authenticated product. Escape is handled here too
  // so the palette closes even when focus has left the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((current) => {
          if (current) return false;
          setQuery("");
          setHits([]);
          setActive(0);
          return true;
        });
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  // Debounced record search. Nothing runs until the palette is open AND the
  // query is long enough AND this account has a business workspace to search.
  useEffect(() => {
    if (!open || !hasWorkspace) return;
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setHits([]);
      setSearching(false);
      return;
    }
    const handle = setTimeout(() => {
      const id = ++requestId.current;
      setSearching(true);
      searchWorkspace(q)
        .then((results) => {
          if (requestId.current === id) setHits(results);
        })
        .catch(() => {
          // A failed search must not break the palette — navigation still works.
          if (requestId.current === id) setHits([]);
        })
        .finally(() => {
          if (requestId.current === id) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open, hasWorkspace]);

  // Keep the selection inside the list as it shrinks under a longer query.
  useEffect(() => {
    setActive((i) => (i >= entries.length ? 0 : i));
  }, [entries.length]);

  // Follow the keyboard selection with the scroll position, or arrowing past the
  // fold selects rows the user cannot see.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (entry: Entry) => {
    close();
    router.push(entry.href);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (entries.length === 0 ? 0 : (i + 1) % entries.length));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (entries.length === 0 ? 0 : (i - 1 + entries.length) % entries.length));
    }
    if (e.key === "Enter") {
      const entry = entries[active];
      if (entry) {
        e.preventDefault();
        run(entry);
      }
    }
  };

  const short = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;
  const empty = entries.length === 0 && !searching;

  return (
    <>
      {/* The header trigger. Styled as a field rather than a button because that
          is what it becomes; on narrow screens it collapses to the icon alone so
          the header still fits a 393px phone. */}
      <button
        type="button"
        onClick={openPalette}
        data-testid="global-search-trigger"
        aria-label={t("search.open")}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          "group flex h-9 items-center gap-2 rounded-sm border bg-canvas/60 px-2.5 text-label text-fg-muted",
          "transition-colors hover:border-strong hover:bg-surface-2/60 hover:text-fg-secondary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
          "tablet:w-64 desktop:w-80",
        )}
      >
        <SearchIcon size={16} />
        <span className="hidden truncate tablet:inline">{t("search.open")}</span>
        <kbd className="ms-auto hidden shrink-0 rounded-xs border px-1.5 py-0.5 font-sans text-[0.6875rem] text-fg-muted tablet:inline">
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div className="fixed inset-0" style={{ zIndex: 500 }} role="presentation">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("search.close")}
            onClick={close}
            className="absolute inset-0 bg-brand-basalt/60 backdrop-blur-[2px]"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("search.title")}
            data-testid="global-search-panel"
            className={cn(
              "absolute inset-x-3 top-[8vh] mx-auto flex max-h-[78vh] max-w-2xl flex-col overflow-hidden",
              "rounded-md border border-strong bg-surface shadow-lg",
            )}
          >
            <div className="flex items-center gap-2.5 border-b px-md py-3">
              <span className="shrink-0 text-fg-muted" aria-hidden="true">
                <CommandIcon size={18} />
              </span>
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                dir={dir}
                type="search"
                autoComplete="off"
                spellCheck={false}
                data-testid="global-search-input"
                placeholder={hasWorkspace ? t("search.placeholder") : t("search.placeholderPersonal")}
                aria-label={t("search.title")}
                className="min-w-0 flex-1 bg-transparent text-body-lg text-fg outline-none placeholder:text-fg-muted"
              />
              <button
                type="button"
                onClick={close}
                aria-label={t("search.close")}
                className="shrink-0 rounded-sm p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <XIcon size={18} />
              </button>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
              {sections.map((section) => (
                <div key={section.label} className="mb-1">
                  <h2 className="px-md pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
                    {section.label}
                  </h2>
                  <ul>
                    {section.items.map(({ entry, index }) => {
                      const selected = index === active;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            data-index={index}
                            data-testid="global-search-result"
                            onMouseMove={() => setActive(index)}
                            onClick={() => run(entry)}
                            aria-current={selected ? "true" : undefined}
                            className={cn(
                              "flex w-full items-center gap-3 px-md py-2 text-start transition-colors",
                              selected ? "bg-surface-2" : "hover:bg-surface-2/50",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "grid h-9 w-9 shrink-0 place-items-center rounded-sm border",
                                selected ? "border-accent-solid/40 bg-accent-solid/15 text-accent" : "bg-canvas text-fg-muted",
                              )}
                            >
                              <entry.Icon size={17} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-body font-medium text-fg">{entry.title}</span>
                              {entry.description ? (
                                <span className="block truncate text-label text-fg-muted">{entry.description}</span>
                              ) : null}
                            </span>
                            {selected ? (
                              <span className="hidden shrink-0 items-center gap-1 text-label text-fg-muted tablet:flex">
                                <EnterKeyIcon size={14} />
                                {t("search.enter")}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              {searching ? (
                <p className="px-md py-3 text-label text-fg-muted">{t("search.searching")}</p>
              ) : null}

              {empty ? (
                <div className="px-md py-lg text-center">
                  <p className="text-body text-fg">
                    {short ? t("search.minChars") : t("search.noResults", { q: query.trim() })}
                  </p>
                  {short ? null : (
                    <p className="mt-1 text-label text-fg-muted">{t("search.noResultsHint")}</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-md border-t px-md py-2 text-label text-fg-muted">
              <span className="flex items-center gap-1.5">
                <kbd className="rounded-xs border px-1 py-0.5 font-sans text-[0.6875rem]">↑↓</kbd>
                {t("search.hint.navigate")}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded-xs border px-1 py-0.5 font-sans text-[0.6875rem]">{t("search.enter")}</kbd>
                {t("search.hint.select")}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded-xs border px-1 py-0.5 font-sans text-[0.6875rem]">Esc</kbd>
                {t("search.hint.close")}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
