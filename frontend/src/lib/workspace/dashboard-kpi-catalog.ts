import type { ComponentType } from "react";
import {
  AlertIcon,
  ClockIcon,
  InboxIcon,
  ShoppingBagIcon,
  ClipboardIcon,
  MoneyIcon,
  BookmarkIcon,
  LayersIcon,
} from "@/components/ui/icons";

/**
 * The Showroom Owner dashboard's allowlisted KPI card catalog — the frontend
 * mirror of `public.dashboard_kpi_card_key` (20260915090001). A single
 * source for every surface that needs to enumerate "the eight known cards":
 * the dashboard itself (to build a `Tile` per key from live data), and the
 * customization dialog (to offer every card the caller's own capabilities
 * allow, in the product's canonical order).
 *
 * Deliberately NOT server-only: the customization dialog is a client
 * component and only needs this static metadata (label key, icon,
 * capability gate), never live values — those stay a server-side concern in
 * `showroom-dashboard.tsx`.
 */
export type DashboardKpiCardKey =
  | "overdue_followups"
  | "due_today"
  | "quotations_to_review"
  | "open_purchase_requests"
  | "orders_in_progress"
  | "total_purchases"
  | "projects"
  | "saved_products";

/**
 * `sells` gates the two follow-up cards (backed by `sales.read`/`sales.write`
 * data); `buys` gates everything else, including `saved_products` and
 * `projects` — mirroring exactly which underlying query
 * `showroom-dashboard.tsx` already skips (returning `NO_PURCHASE`/`{}`) when
 * the caller lacks that stance's capabilities. A card whose stance the
 * caller cannot see must never appear in the customization catalog, even as
 * a hidden option to enable.
 */
export type DashboardKpiStance = "buys" | "sells";

export const DASHBOARD_KPI_CATALOG: {
  key: DashboardKpiCardKey;
  Icon: ComponentType<{ size?: number }>;
  /** Dotted path into the message catalog for this card's visible label. */
  labelKey: string;
  stance: DashboardKpiStance;
}[] = [
  { key: "overdue_followups", Icon: AlertIcon, labelKey: "home.overdue", stance: "sells" },
  { key: "due_today", Icon: ClockIcon, labelKey: "home.dueToday", stance: "sells" },
  { key: "quotations_to_review", Icon: InboxIcon, labelKey: "home.tile.quotationsToReview", stance: "buys" },
  { key: "open_purchase_requests", Icon: ShoppingBagIcon, labelKey: "home.tile.openRequests", stance: "buys" },
  { key: "orders_in_progress", Icon: ClipboardIcon, labelKey: "home.tile.ordersInProgress", stance: "buys" },
  { key: "total_purchases", Icon: MoneyIcon, labelKey: "home.tile.totalPurchases", stance: "buys" },
  { key: "projects", Icon: LayersIcon, labelKey: "home.tileProjects", stance: "buys" },
  { key: "saved_products", Icon: BookmarkIcon, labelKey: "home.tile.saved", stance: "buys" },
];

/** The system default — this exact order, unmodified, when an organization has never set its own team default. Never duplicated elsewhere. */
export const SYSTEM_DEFAULT_KPI_ORDER: DashboardKpiCardKey[] = DASHBOARD_KPI_CATALOG.map((c) => c.key);

/** The catalog entries the caller's own buyer/seller stance permits — the capability-aware filter every surface (dashboard, customization dialog) must apply before offering or rendering a card. */
export function availableKpiCards(
  stances: { buys: boolean; sells: boolean },
): typeof DASHBOARD_KPI_CATALOG {
  return DASHBOARD_KPI_CATALOG.filter((c) => (c.stance === "buys" ? stances.buys : stances.sells));
}
