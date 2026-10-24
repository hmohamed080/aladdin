import { HomeIcon, ClipboardIcon, StorefrontIcon, UserIcon, UsersIcon, BriefcaseIcon, GiftIcon, SettingsIcon, StarIcon, ScrollIcon, TagIcon, BarChartIcon, ActivityIcon, LayersIcon, BadgeCheckIcon, MapPinIcon, TruckIcon } from "@/components/ui/icons";
import type { InstallerNavItem } from "@/features/installer-dashboard-preview/installer-nav";
import { MARKETPLACE_SELL_ENTITLEMENT, NAV_CAPS } from "@/lib/nav/modules";

export const SHOWROOM_ROOT = "/showroom";
/** The completed commerce modules that still live under /b2b; the Showroom shell now frames them (see b2b/layout). */
const LEGACY = "/b2b";

export type ShowroomNavItem = InstallerNavItem & {
  href: string;
  capabilities: readonly string[];
  /**
   * A destination that does not exist yet. Hidden items stay in the model so their URLs keep resolving
   * (the placeholder route still answers) but they never appear in the sidebar or the search, so no
   * primary navigation leads to "This page is not available yet".
   */
  hidden?: boolean;
};

const v2 = (id: string, ar: string, en: string, Icon: InstallerNavItem["Icon"], capabilities: string[] = []): ShowroomNavItem =>
  ({ id, label: { ar, en }, Icon, href: `${SHOWROOM_ROOT}/${id}`, capabilities });
/** A finished module reached through its existing route; same capability gate as the legacy workspace. */
const legacy = (id: string, href: string, ar: string, en: string, Icon: InstallerNavItem["Icon"], capabilities: string[] = []): ShowroomNavItem =>
  ({ id, label: { ar, en }, Icon, href, capabilities });
const pending = (id: string, ar: string, en: string, Icon: InstallerNavItem["Icon"], capabilities: string[] = []): ShowroomNavItem =>
  ({ ...v2(id, ar, en, Icon, capabilities), hidden: true });

export const SHOWROOM_GROUPS = [
  { label: { ar: "", en: "" }, items: [v2("home", "الرئيسية", "Home", HomeIcon)] },
  { label: { ar: "المشتريات", en: "Purchasing" }, items: [
    // طلبات الشراء (Shared Purchase Requests) is Milestone D: no frontend yet, kept apart from Direct RFQs.
    pending("purchase-requests", "طلبات الشراء", "Purchase requests", ClipboardIcon, ["rfq.create"]),
    legacy("pricing-requests-sent", `${LEGACY}/rfqs`, "طلبات عروض الأسعار المباشرة", "Direct RFQs", ScrollIcon, ["rfq.create"]),
    legacy("quotes-received", `${LEGACY}/quotations`, "عروض أسعار واردة", "Supplier quotations received", ScrollIcon, ["quote.decide", "rfq.create"]),
    legacy("purchase-orders", `${LEGACY}/orders`, "أوامر الشراء", "Purchase orders", ClipboardIcon, NAV_CAPS.orders ?? []),
  ] },
  { label: { ar: "المبيعات", en: "Sales" }, items: [
    legacy("customer-rfqs", `${LEGACY}/rfqs?view=received`, "طلبات عروض أسعار مباشرة واردة", "Direct RFQs received", ScrollIcon, ["rfq.respond"]),
    legacy("customer-quotes", `${LEGACY}/quotations?view=sent`, "عروض أسعار صادرة", "Quotations sent to customers", ScrollIcon, ["rfq.respond"]),
    legacy("customers", `${LEGACY}/customers`, "العملاء", "Customers", UserIcon, NAV_CAPS.customers ?? []),
    legacy("leads", `${LEGACY}/leads`, "العملاء المحتملون", "Leads", UsersIcon, NAV_CAPS.leads ?? []),
    legacy("follow-ups", `${LEGACY}/follow-ups`, "المتابعات", "Follow-ups", ActivityIcon, NAV_CAPS.followUps ?? []),
  ] },
  { label: { ar: "المنتجات", en: "Products" }, items: [
    v2("catalog", "تصفح المنتجات", "Browse products", StorefrontIcon, NAV_CAPS.catalog ?? []),
    v2("offers", "العروض", "Offers", TagIcon, NAV_CAPS.catalog ?? []),
    v2("saved", "المنتجات المحفوظة", "Saved products", StarIcon, NAV_CAPS.saved ?? []),
    v2("my-products", "منتجاتي", "My products", StorefrontIcon, NAV_CAPS.products ?? []),
    v2("my-offers", "إدارة العروض", "My offers", TagIcon, NAV_CAPS.products ?? []),
  ] },
  // Selling to consumers on the public Marketplace (B2C). Drawn ONLY for an organization a platform admin approved as a
  // seller - an entitlement the shell adds to the capability list (see ShowroomFrame) - and never unlocked by org.manage.
  { label: { ar: "الماركت", en: "Marketplace" }, items: [
    legacy("marketplace-products", "/b2c/seller/products", "منتجات الماركت", "Marketplace products", StorefrontIcon, [MARKETPLACE_SELL_ENTITLEMENT]),
    legacy("marketplace-areas", "/b2c/seller/areas", "المناطق", "Delivery areas", MapPinIcon, [MARKETPLACE_SELL_ENTITLEMENT]),
    legacy("marketplace-delivery", "/b2c/seller/delivery", "توصيل المناطق", "Delivery prices", TruckIcon, [MARKETPLACE_SELL_ENTITLEMENT]),
  ] },
  { label: { ar: "الشبكة", en: "Network" }, items: [
    legacy("suppliers", `${LEGACY}/suppliers`, "الموردون", "Suppliers", StorefrontIcon),
    legacy("craftsmen", `${LEGACY}/technicians`, "الصنايعية", "Craftsmen", UserIcon),
    legacy("jobs", `${LEGACY}/jobs`, "فرص العمل", "Job opportunities", BriefcaseIcon, NAV_CAPS.jobs ?? []),
  ] },
  { label: { ar: "الفريق", en: "Team" }, items: [legacy("sales-team", `${LEGACY}/organization`, "الفريق والأعضاء", "Team & members", UsersIcon, NAV_CAPS.team ?? [])] },
  { label: { ar: "إدارة النشاط", en: "Business management" }, items: [
    legacy("projects", `${LEGACY}/projects`, "المشاريع", "Projects", LayersIcon, NAV_CAPS.projects ?? []),
    legacy("reports", `${LEGACY}/reports`, "التقارير والتحليلات", "Reports & analytics", BarChartIcon, NAV_CAPS.reports ?? []),
    legacy("activity", `${LEGACY}/activity`, "سجل النشاط", "Activity log", ActivityIcon, NAV_CAPS.activity ?? []),
    legacy("points", `${LEGACY}/points`, "النقاط", "Points", GiftIcon),
    // The Verified badge request; owners only (the RPCs require org.manage on this organization).
    v2("verification", "توثيق النشاط", "Business verification", BadgeCheckIcon, ["org.manage"]),
    v2("settings", "الإعدادات", "Settings", SettingsIcon),
  ] },
];

export function canNavigate(item: ShowroomNavItem, capabilities: readonly string[]) {
  // Marketplace selling is an admin-granted entitlement of the organization: org.manage must not unlock it.
  if (item.id.startsWith("marketplace-")) return capabilities.includes(MARKETPLACE_SELL_ENTITLEMENT);
  // The activity log is an exact-capability module in the legacy workspace: org.manage must not unlock it.
  if (item.id === "activity") return item.capabilities.some((cap) => capabilities.includes(cap));
  return !item.capabilities.length || capabilities.includes("org.manage") || item.capabilities.some((cap) => capabilities.includes(cap));
}
/**
 * A UI-only marker the shell appends to the capability list while the organization is a pending APPLICATION. It confers nothing (the
 * database withholds every commercial authority from a pending organization); it only limits the navigation to the three screens a
 * pending owner may use.
 */
export const SHOWROOM_PENDING_MARKER = "workspace.pending_approval";
const PENDING_ALLOWED_IDS: readonly string[] = ["home", "my-products", "settings"];

export function showroomNavigation(capabilities: readonly string[]) {
  const pending = capabilities.includes(SHOWROOM_PENDING_MARKER);
  return SHOWROOM_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !item.hidden && (!pending || PENDING_ALLOWED_IDS.includes(item.id)) && canNavigate(item, capabilities)) })).filter((group) => group.items.length);
}

/** The path part of an item's href (items may carry a view query). */
const hrefPath = (href: string) => href.split("?")[0];

/**
 * The item that owns a location. The longest matching path wins, so /b2b/rfqs/123 highlights Direct RFQs and
 * a ?view= query on the same path chooses between the sent and received entries.
 */
export function activeShowroomItem(pathname: string, search: string, items: readonly ShowroomNavItem[]): ShowroomNavItem | null {
  const params = new URLSearchParams(search);
  let best: ShowroomNavItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    const [path = "", query] = item.href.split("?");
    if (pathname !== path && !pathname.startsWith(`${path}/`)) continue;
    const wantsView = new URLSearchParams(query ?? "").get("view");
    const view = params.get("view");
    // An item pinned to a view only owns that view; an unpinned item owns the rest.
    if (wantsView ? view !== wantsView : (view !== null && items.some((other) => other !== item && hrefPath(other.href) === path && new URLSearchParams(other.href.split("?")[1] ?? "").get("view") === view))) continue;
    const score = path.length;
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return best;
}
