import { MARKETPLACE_SELL_ENTITLEMENT } from "@/lib/nav/modules";
import { SHOWROOM_PENDING_MARKER } from "./navigation";
import { describe, expect, it } from "vitest";
import { activeShowroomItem, canNavigate, showroomNavigation, SHOWROOM_GROUPS, SHOWROOM_ROOT } from "./navigation";
import { eligibleWorkspaces, isShowroomBusinessType, SHOWROOM_BUSINESS_LABELS } from "./workspace-model";
import { BUSINESS_ORG_TYPES, businessOrgTypeFromAccountType, REGISTRATION_CHOICE_ORDER, CHOICE_GROUPS } from "@/lib/onboarding/account-types";
import type { WorkspaceEntry } from "@/lib/workspace/model";
import { FEED_READY_AUDIENCES } from "@/features/offers/offer-model";

describe("showroom phase 1 navigation", () => {
  const items = SHOWROOM_GROUPS.flatMap((group) => group.items);
  it("has the agreed group order, directional commerce and no institutions", () => {
    expect(SHOWROOM_GROUPS.map((group) => group.label.ar)).toEqual(["", "المشتريات", "المبيعات", "المنتجات", "الماركت", "الشبكة", "الفريق", "إدارة النشاط"]);
    expect(items.map((item) => item.id)).toEqual(["home", "purchase-requests", "pricing-requests-sent", "quotes-received", "purchase-orders", "customer-rfqs", "customer-quotes", "customers", "leads", "follow-ups", "catalog", "offers", "saved", "my-products", "my-offers", "marketplace-products", "marketplace-areas", "marketplace-delivery", "suppliers", "craftsmen", "jobs", "sales-team", "projects", "reports", "activity", "points", "verification", "settings"]);
    // Suite pages live under the suite root; finished modules keep their existing routes inside the same shell.
    for (const item of items) expect(item.href.startsWith(`${SHOWROOM_ROOT}/`) || item.href.startsWith("/b2b/") || item.href.startsWith("/b2c/seller/")).toBe(true);
  });
  it("filters nav and direct-page authorization with the same capability rule", () => {
    const visible = showroomNavigation([]).flatMap((group) => group.items);
    expect(visible.map((item) => item.id)).toEqual(["home", "suppliers", "craftsmen", "points", "settings"]);
    for (const item of items) expect(visible.includes(item)).toBe(canNavigate(item, []));
    // org.manage unlocks every visible module except the exact-capability ones (the activity log and the admin-granted
    // Marketplace selling items); hidden placeholders never show.
    expect(showroomNavigation(["org.manage"]).flatMap((group) => group.items)).toEqual(items.filter((item) => !item.hidden && item.id !== "activity" && !item.id.startsWith("marketplace-")));
    expect(showroomNavigation(["job.manage"]).flatMap((group) => group.items).some((item) => item.id === "jobs")).toBe(true);
    expect(showroomNavigation(["sales.manage"]).flatMap((group) => group.items).some((item) => item.id === "sales-team")).toBe(false);
  });
});

describe("no placeholder in primary navigation", () => {
  const all = SHOWROOM_GROUPS.flatMap((g) => g.items);
  it("hides exactly the unfinished Shared Purchase Requests entry", () => {
    expect(all.filter((i) => i.hidden).map((i) => i.id)).toEqual(["purchase-requests"]);
    expect(showroomNavigation(["org.manage"]).flatMap((g) => g.items).some((i) => i.id === "purchase-requests")).toBe(false);
  });
  it("never routes a visible item to the placeholder page", () => {
    const hiddenIds = new Set(all.filter((i) => i.hidden).map((i) => i.id));
    for (const item of showroomNavigation(["org.manage"]).flatMap((g) => g.items)) {
      expect(hiddenIds.has(item.id)).toBe(false);
      expect(item.href).not.toMatch(/showroom-suite-v2\/(purchase-requests|pricing-requests-sent|quotes-received|purchase-orders|customer-rfqs|customer-quotes|customers|suppliers|craftsmen|jobs|sales-team|projects|reports|points)$/);
    }
  });
  it("keeps Direct RFQs (طلبات عروض الأسعار المباشرة) apart from Shared Purchase Requests (طلبات الشراء)", () => {
    const direct = all.find((i) => i.id === "pricing-requests-sent")!;
    expect(direct.label.ar).toBe("طلبات عروض الأسعار المباشرة");
    expect(direct.label.ar).not.toBe(all.find((i) => i.id === "purchase-requests")!.label.ar);
  });
  it("highlights the item that owns the location, including detail pages and view filters", () => {
    const visible = showroomNavigation(["org.manage"]).flatMap((g) => g.items);
    expect(activeShowroomItem("/b2b/rfqs", "", visible)?.id).toBe("pricing-requests-sent");
    expect(activeShowroomItem("/b2b/rfqs/abc", "", visible)?.id).toBe("pricing-requests-sent");
    expect(activeShowroomItem("/b2b/rfqs", "view=received", visible)?.id).toBe("customer-rfqs");
    expect(activeShowroomItem("/b2b/quotations", "", visible)?.id).toBe("quotes-received");
    expect(activeShowroomItem("/b2b/quotations", "view=sent", visible)?.id).toBe("customer-quotes");
    expect(activeShowroomItem("/showroom/my-products/new", "", visible)?.id).toBe("my-products");
    expect(activeShowroomItem("/nowhere", "", visible)).toBeNull();
  });
});

describe("product offers navigation", () => {
  const byId = (id: string) => SHOWROOM_GROUPS.flatMap((g) => g.items).find((i) => i.id === id)!;
  it("keeps the audience feed (العروض) and the owner's management page (إدارة العروض) distinct from RFQs and quotations", () => {
    expect(byId("offers").label).toEqual({ ar: "العروض", en: "Offers" });
    expect(byId("my-offers").label).toEqual({ ar: "إدارة العروض", en: "My offers" });
    for (const id of ["offers", "my-offers"]) {
      expect(byId(id).label.ar).not.toMatch(/طلب|عروض أسعار/);
    }
  });
  it("every business type the showroom suite serves is a feed-ready audience (and so is every persona)", () => {
    for (const type of BUSINESS_ORG_TYPES) expect(FEED_READY_AUDIENCES).toContain(type);
    for (const persona of ["engineer", "installer_technician", "contractor", "end_consumer"]) expect(FEED_READY_AUDIENCES).toContain(persona);
  });
  it("shows the feed with browse rights and the management page with product rights", () => {
    const ids = (caps: string[]) => showroomNavigation(caps).flatMap((g) => g.items).map((i) => i.id);
    expect(ids(["catalog.read"])).toContain("offers");
    expect(ids(["catalog.read"])).not.toContain("my-offers");
    expect(ids(["catalog.write"])).toContain("my-offers");
  });
});

describe("canonical business mappings", () => {
  it("adds design_office without changing registration personas or the four business types", () => {
    expect(BUSINESS_ORG_TYPES).toEqual(["showroom_dealer", "supplier", "manufacturer", "importer", "design_office"]);
    expect(businessOrgTypeFromAccountType("design_office")).toBe("design_office");
    expect(businessOrgTypeFromAccountType("engineer")).toBeNull();
    expect(SHOWROOM_BUSINESS_LABELS.design_office).toEqual({ ar: "المهندس", en: "Engineer" });
    expect(REGISTRATION_CHOICE_ORDER).not.toContain("design_office");
    expect(CHOICE_GROUPS.find((group) => group.group === "business")?.keys).toEqual(["showroom_dealer", "supplier", "manufacturer", "importer"]);
  });
  it("offers only supported actual business memberships, not synthetic types or personal contexts", () => {
    const entries: WorkspaceEntry[] = BUSINESS_ORG_TYPES.map((orgType, i) => ({ kind: "business", organizationId: String(i), name: orgType, orgType, relationship: "member" }));
    expect(eligibleWorkspaces([...entries, { kind: "personal", name: "Person", persona: "engineer" }])).toEqual(entries);
    expect(isShowroomBusinessType("engineer")).toBe(false);
    expect(isShowroomBusinessType("toString")).toBe(false);
    expect(isShowroomBusinessType(null)).toBe(false);
  });
});

describe("a pending application's limited workspace (rc2 product decision)", () => {
  it("shows only Home, My products and Settings - and no commercial entry - even for an owner with every capability", () => {
    const all = ["org.manage", "catalog.read", "catalog.write", "rfq.create", "rfq.respond", "quote.decide"];
    const ids = showroomNavigation([...all, SHOWROOM_PENDING_MARKER]).flatMap((g) => g.items).map((i) => i.id);
    expect(ids.sort()).toEqual(["home", "my-products", "settings"]);
  });
  it("is unchanged for an approved organization", () => {
    const ids = showroomNavigation(["org.manage"]).flatMap((g) => g.items).map((i) => i.id);
    expect(ids).toContain("catalog");
    expect(ids).toContain("customers");
  });
});

describe("Marketplace group in the showroom account", () => {
  const ids = (caps: string[]) => showroomNavigation(caps).flatMap((g) => g.items).map((i) => i.id);
  const MARKETPLACE = ["marketplace-products", "marketplace-areas", "marketplace-delivery"];

  it("lists products, delivery areas and delivery prices, in that order, under الماركت / Marketplace", () => {
    const group = SHOWROOM_GROUPS.find((g) => g.label.en === "Marketplace")!;
    expect(group.label.ar).toBe("الماركت");
    expect(group.items.map((i) => [i.id, i.href, i.label.ar, i.label.en])).toEqual([
      ["marketplace-products", "/b2c/seller/products", "منتجات الماركت", "Marketplace products"],
      ["marketplace-areas", "/b2c/seller/areas", "المناطق", "Delivery areas"],
      ["marketplace-delivery", "/b2c/seller/delivery", "توصيل المناطق", "Delivery prices"],
    ]);
  });

  it("appears only for an organization the admin approved as a seller - owning the showroom (org.manage) is not enough", () => {
    for (const id of MARKETPLACE) expect(ids(["org.manage"])).not.toContain(id);
    for (const id of MARKETPLACE) expect(ids(["org.manage", MARKETPLACE_SELL_ENTITLEMENT])).toContain(id);
    expect(showroomNavigation(["org.manage"]).map((g) => g.label.en)).not.toContain("Marketplace");
    expect(showroomNavigation(["org.manage", MARKETPLACE_SELL_ENTITLEMENT]).map((g) => g.label.en)).toContain("Marketplace");
  });

  it("is never offered to a pending (not yet approved) showroom", () => {
    expect(ids(["org.manage", MARKETPLACE_SELL_ENTITLEMENT, SHOWROOM_PENDING_MARKER]).filter((id) => id.startsWith("marketplace-"))).toEqual([]);
  });

  it("highlights the item that owns each seller page, including its sub-pages", () => {
    const visible = showroomNavigation(["org.manage", MARKETPLACE_SELL_ENTITLEMENT]).flatMap((g) => g.items);
    expect(activeShowroomItem("/b2c/seller/products", "", visible)?.id).toBe("marketplace-products");
    expect(activeShowroomItem("/b2c/seller/products/new", "", visible)?.id).toBe("marketplace-products");
    expect(activeShowroomItem("/b2c/seller/areas", "", visible)?.id).toBe("marketplace-areas");
    expect(activeShowroomItem("/b2c/seller/delivery", "", visible)?.id).toBe("marketplace-delivery");
  });
});
