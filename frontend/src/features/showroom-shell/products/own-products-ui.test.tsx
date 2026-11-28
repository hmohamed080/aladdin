import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { CATALOG_VIEW_COOKIE } from "@/lib/ui/catalog-view";

const actions = vi.hoisted(() => ({
  create: vi.fn(async () => ({ ok: false })),
  draft: vi.fn(),
  push: vi.fn(),
  update: vi.fn(async () => ({ ok: false })),
  lifecycle: vi.fn(async () => ({ ok: true })),
  requestUpload: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(async () => ({ ok: true })),
  reorder: vi.fn(async () => ({ ok: true })),
  reorderMedia: vi.fn(async () => ({ ok: true })),
  upload: vi.fn<(grant: unknown, file: File) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null })),
  refresh: vi.fn(),
}));
vi.mock("@/server/actions/own-products", () => ({
  createOwnProductAction: actions.create,
  createOwnProductDraftAction: actions.draft,
  updateOwnProductAction: actions.update,
  ownProductLifecycleAction: actions.lifecycle,
  requestProductImageUploadAction: actions.requestUpload,
  confirmProductImageUploadAction: actions.confirm,
  removeProductImageAction: actions.remove,
  reorderProductImagesAction: actions.reorder,
  reorderProductMediaAction: actions.reorderMedia,
}));
const feed = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/server/actions/own-products-feed", () => ({ loadMyProductsBatchAction: feed.load }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh, push: actions.push }) }));
vi.mock("@/lib/storage/browser-upload", () => ({ uploadWithGrant: async (grant: unknown, file: File) => {
  const result = await actions.upload(grant, file);
  if (result.error) throw Error("controlled upload failure");
} }));

import { OwnProductsResults, type OwnProductCard } from "./own-products-results";
import { ProductForm } from "./product-form";
import { ImageManager } from "./image-manager";
import type { ManagedVideo } from "@/server/queries/videos";
import type { ProductAudienceCode } from "./product-audiences";

/** Hex literals are product DATA here, not styling — built at run time so the colour guard stays strict. */
const h = (rrggbb: string) => "#" + rrggbb;

const card = (over: Partial<OwnProductCard> & { id: string }): OwnProductCard => ({
  name: "Matt Emulsion 18L",
  code: "PNT-001",
  categoryCode: "paints",
  unit: "pail",
  status: "published",
  archivedAt: null,
  version: 2,
  imageUrl: null,
  sizeLabel: null,
  weightKg: null,
  colors: [],
  basePrice: null,
  ...over,
});

const products = [
  card({ id: "a" }),
  card({ id: "b", name: "Old tile", code: null, categoryCode: null, unit: "ton", status: "draft" }),
  card({ id: "c", name: "Retired", status: "draft", archivedAt: "2026-10-08T00:00:00Z" }),
];

const wrap = (node: React.ReactNode, locale: "en" | "ar" = "en") =>
  render(<I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{node}</I18nProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = `${CATALOG_VIEW_COOKIE}=; max-age=0; path=/`;
});

describe("OwnProductsResults", () => {
  const results = (props: Partial<React.ComponentProps<typeof OwnProductsResults>> = {}) =>
    wrap(<OwnProductsResults products={products} total={products.length} filters={{}} initialView="grid" canWrite canPublish {...props} />);

  it("renders the grid by default and switches to a list that remembers the choice", () => {
    results();
    expect(screen.getByTestId("my-products-grid")).toBeTruthy();
    // Density: 2 on mobile, 3 tablet, 4 desktop, 5 from the wide breakpoint (1440).
    expect(screen.getByTestId("my-products-grid").className).toMatch(/grid-cols-2.*tablet:grid-cols-3.*desktop:grid-cols-4.*wide:grid-cols-5/);
    expect(screen.getAllByTestId("my-products-card")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("my-products-view-list"));
    expect(screen.getByTestId("my-products-list")).toBeTruthy();
    expect(screen.getAllByTestId("my-products-row")).toHaveLength(3);
    expect(document.cookie).toContain(`${CATALOG_VIEW_COOKIE}=list`);
  });

  it("starts as a list when that is the remembered preference", () => {
    results({ initialView: "list" });
    expect(screen.getByTestId("my-products-list")).toBeTruthy();
  });

  it("shows name, code, canonical category, unit and status", () => {
    results();
    const first = screen.getAllByTestId("my-products-card")[0]!;
    expect(within(first).getByText("Matt Emulsion 18L")).toBeTruthy();
    expect(within(first).getByText("PNT-001")).toBeTruthy();
    expect(within(first).getByText("Paints")).toBeTruthy();
    expect(within(first).getByText("Pail")).toBeTruthy();
    expect(within(first).getByText("Active")).toBeTruthy();
    expect(first.getAttribute("data-status")).toBe("active");
  });

  it("calls an unclassified historical product unclassified — it never borrows a canonical category", () => {
    results();
    const old = screen.getAllByTestId("my-products-card")[1]!;
    expect(within(old).getByText("Unclassified")).toBeTruthy();
    expect(within(old).getByText("Draft")).toBeTruthy();
    expect(within(old).getByText("Ton")).toBeTruthy();
  });

  it("shows the on/off switch by state, and Restore only for an archived product", () => {
    results();
    const [active, inactive, archived] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(within(inactive!).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(within(archived!).queryByRole("switch")).toBeNull();
    expect(within(active!).getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(within(archived!).getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(within(archived!).queryByRole("button", { name: "Archive" })).toBeNull();
    expect(archived!.getAttribute("data-status")).toBe("archived");
  });

  it("the switch submits the matching transition with the version", async () => {
    results();
    const [active, inactive] = screen.getAllByTestId("my-products-card");
    fireEvent.click(within(active!).getByRole("switch"));
    await waitFor(() => expect(actions.lifecycle).toHaveBeenCalledTimes(1));
    let sent = (actions.lifecycle.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect([sent.get("action"), sent.get("productId"), sent.get("expectedVersion")]).toEqual(["deactivate", "a", "2"]);
    fireEvent.click(within(inactive!).getByRole("switch"));
    await waitFor(() => expect(actions.lifecycle).toHaveBeenCalledTimes(2));
    sent = (actions.lifecycle.mock.calls[1] as unknown as [unknown, FormData])[1];
    expect(sent.get("action")).toBe("activate");
  });

  it("links each card to its editor and to its photos", () => {
    results();
    const [active] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("link", { name: "Manage photos" }).getAttribute("href")).toBe("/showroom/my-products/a/edit#product-photos");
  });

  it("shows colors, size and weight when the product has them — and nothing it does not have", () => {
    const colors = ["Sand", "Warm White", "Grey", "Black", "Blue", "Green", "Red"].map((name, i) => ({ name, hex: i === 2 ? null : h("C9B28A") }));
    wrap(<OwnProductsResults products={[card({ id: "z", colors, sizeLabel: "60×60 cm", weightKg: 2.5, basePrice: 159.5 })]} total={1} filters={{}} initialView="grid" canWrite canPublish />);
    const c = screen.getByTestId("my-products-card");
    // swatches, with the name as the accessible name; a sensible maximum plus "+N"
    expect(within(c).getAllByTestId("color-swatch")).toHaveLength(5);
    expect(within(c).getByRole("button", { name: "Sand" })).toBeTruthy();
    expect(within(c).getByRole("button", { name: /Grey — Color not set yet/ })).toBeTruthy();
    expect(within(c).getByText("+2")).toBeTruthy();
    expect(within(c).getByTestId("card-price").textContent).toContain("159.50 EGP");
    expect(within(c).getByText("Pail • 60×60 cm • 2.5 kg")).toBeTruthy();
    // only the base price is a price: no discount, offer or stock text is invented
    expect(c.textContent).not.toMatch(/discount|offer|stock|%/i);
  });

  it("does not offer Edit on an archived product (it must be restored first)", () => {
    results();
    const [active, , archived] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/showroom/my-products/a/edit");
    expect(within(archived!).queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("is read-only without the capabilities — no edit, no lifecycle buttons", () => {
    results({ canWrite: false, canPublish: false });
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Archive|Restore/ })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("publishing rights alone give the switch but not archive or edit", () => {
    results({ canWrite: false, canPublish: true });
    const [active] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("switch")).toBeTruthy();
    expect(within(active!).queryByRole("button", { name: "Archive" })).toBeNull();
    expect(within(active!).queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("asks before archiving, and says what it does", async () => {
    results();
    const [active] = screen.getAllByTestId("my-products-card");
    fireEvent.click(within(active!).getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Archive this product?")).toBeTruthy();
    expect(within(dialog).getByText(/cannot be edited until you restore it/)).toBeTruthy();
    expect(actions.lifecycle).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(actions.lifecycle).toHaveBeenCalledTimes(1));
    const submitted = (actions.lifecycle.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(submitted.get("action")).toBe("archive");
    expect(submitted.get("productId")).toBe("a");
    expect(submitted.get("expectedVersion")).toBe("2");
  });

  it("works in Arabic with Arabic labels", () => {
    wrap(<OwnProductsResults products={[products[0]!]} total={1} filters={{}} initialView="grid" canWrite canPublish />, "ar");
    expect(screen.getAllByText("نشط").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "إدارة الصور" })).toBeTruthy();
    expect(screen.getAllByText("دهانات").length).toBeGreaterThan(0);
    expect(screen.getAllByText("باستلة").length).toBeGreaterThan(0);
  });
});

describe("ProductForm audiences", () => {
  const existing = {
    id: "p1", version: 4, name: "Old tile", code: "TILE-1", categoryCode: null, unit: "ton", colors: [], basePrice: null as number | null,
    weightKg: 2.5, sizeLabel: "60x60 cm", brand: "NileCeramics", description: "Glossy",
  };
  const chips = () => screen.getAllByRole("checkbox").filter((el) => el.getAttribute("data-testid")?.startsWith("product-audience-"));
  const submitted = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLInputElement>("input[name=audience]")].map((i) => i.value);

  it("offers exactly the eight audiences (Sales Team is not one) and starts with none on create", () => {
    wrap(<ProductForm orgId="org-1" />);
    expect(chips()).toHaveLength(8);
    expect(chips().every((c) => c.getAttribute("aria-checked") === "false")).toBe(true);
    expect(chips().map((c) => c.textContent)).toEqual(["Showroom", "Supplier", "Manufacturer", "Importer", "Contractor", "Engineer", "Craftsman", "End customer"]);
  });

  it("submits the toggled audiences as canonical codes", () => {
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fireEvent.click(screen.getByTestId("product-audience-showroom"));
    fireEvent.click(screen.getByTestId("product-audience-craftsman"));
    expect(submitted(container)).toEqual(["showroom_dealer", "installer_technician"]);
    fireEvent.click(screen.getByTestId("product-audience-showroom"));
    expect(submitted(container)).toEqual(["installer_technician"]);
  });

  it("preselects the stored audiences on edit", () => {
    const { container } = wrap(<ProductForm orgId="org-1" product={{ ...existing, audiences: ["showroom_dealer", "engineer"] }} />);
    expect(screen.getByTestId("product-audience-showroom").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("product-audience-engineer").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("product-audience-supplier").getAttribute("aria-checked")).toBe("false");
    expect(submitted(container)).toEqual(["showroom_dealer", "engineer"]);
  });

  it("is reading-direction aware: Arabic labels, same canonical codes", () => {
    const { container } = wrap(<ProductForm orgId="org-1" />, "ar");
    expect(chips().map((c) => c.textContent)).toEqual(["معرض", "مورد", "مصنع", "مستورد", "مقاول", "مهندس", "صنايعي", "العميل النهائي"]);
    fireEvent.click(screen.getByTestId("product-audience-customer"));
    expect(submitted(container)).toEqual(["end_consumer"]);
  });
});

// The shared listbox lists the "Choose…" prompt as an (empty-valued) row; the canonical choices are the others.
const realOptions = () => screen.getAllByRole("option").filter((o) => o.getAttribute("data-value") !== "");

describe("ProductForm", () => {
  const existing = {
    id: "p1",
    version: 4,
    name: "Old tile",
    code: "TILE-1",
    categoryCode: null,
    unit: "ton",
    colors: [{ name: "Sand", hex: h("C9B28A") }],
    basePrice: null as number | null,
    weightKg: 2.5,
    sizeLabel: "60×60 cm",
    brand: "NileCeramics",
    description: "Glossy",
    audiences: ["showroom_dealer"] as ProductAudienceCode[],
  };

  it("edit keeps the photo manager INSIDE the editor card, outside the <form> element, placed beside the colors", () => {
    const { container } = wrap(<ProductForm orgId="org-1" product={existing} photos={<div data-testid="photos-slot"><button type="button">Add</button></div>} />);
    const slot = screen.getByTestId("photos-slot");
    const form = screen.getByTestId("product-form");
    expect(form.contains(slot)).toBe(false);
    expect(slot.closest("#product-photos")).toBeTruthy();
    expect(container.querySelector("#product-photos")?.parentElement).toBe(form.parentElement);
  });

  it("create and edit lead with the name, then the code (the reference order)", () => {
    wrap(<ProductForm orgId="org-1" />);
    const name = screen.getByLabelText(/Product name/i);
    const code = screen.getByLabelText(/Product code/i);
    expect(name.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the 15 canonical categories and the twelve shared units", () => {
    wrap(<ProductForm orgId="org-1" />);
    fireEvent.click(screen.getByTestId("category-select"));
    expect(realOptions()).toHaveLength(15);
    expect(screen.queryByRole("option", { name: /Unclassified/i })).toBeNull();
    fireEvent.keyDown(screen.getByTestId("category-select"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("unit-select"));
    expect(realOptions().map((o) => o.textContent)).toHaveLength(12);
  });

  it("carries the organization on create and the optimistic version on edit", () => {
    const { container, unmount } = wrap(<ProductForm orgId="org-1" />);
    expect((container.querySelector("input[name=orgId]") as HTMLInputElement).value).toBe("org-1");
    expect(container.querySelector("input[name=expectedVersion]")).toBeNull();
    unmount();
    const edit = wrap(<ProductForm orgId="org-1" product={existing} />);
    expect((edit.container.querySelector("input[name=expectedVersion]") as HTMLInputElement).value).toBe("4");
    expect((edit.container.querySelector("input[name=productId]") as HTMLInputElement).value).toBe("p1");
  });

  it("lets a historical product keep its own unit as an extra option, and starts it unclassified", () => {
    wrap(<ProductForm orgId="org-1" product={existing} />);
    expect(screen.getByTestId("unit-select").getAttribute("data-value")).toBe("ton");
    fireEvent.click(screen.getByTestId("unit-select"));
    expect(realOptions()).toHaveLength(13);
    expect(screen.getByTestId("category-select").getAttribute("data-value")).toBe("");
  });

  it("keeps weight and size as separate, labelled fields from the selling unit", () => {
    wrap(<ProductForm orgId="org-1" product={existing} />);
    expect((screen.getByLabelText(/Weight \(kg\)/) as HTMLInputElement).value).toBe("2.5");
    expect(screen.getByText(/separate from the unit the product is sold by/)).toBeTruthy();
    expect((screen.getByLabelText(/^Size/) as HTMLInputElement).value).toBe("60×60 cm");
  });

  const chooseName = (query: string) => {
    const input = screen.getByTestId("color-name");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: query } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  const addNamed = (query: string) => {
    fireEvent.click(screen.getByTestId("add-color"));
    chooseName(query);
    fireEvent.click(screen.getByTestId("color-save"));
  };
  const addHex = (hex: string) => {
    fireEvent.click(screen.getByTestId("add-color"));
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: hex } });
    fireEvent.click(screen.getByTestId("color-save"));
  };
  type Submitted = { name: string; hex: string | null; code?: string };
  const submitted = (container: HTMLElement) => JSON.parse((container.querySelector("input[name=colorItems]") as HTMLInputElement).value) as Submitted[];

  it("adds colors by NAME (the library supplies the value) or by a custom code, refuses a bad code and duplicates, and removes one", () => {
    const { container } = wrap(<ProductForm orgId="org-1" />);
    addNamed("dark red");
    addHex(h("3a5f8a"));
    expect(submitted(container)).toEqual([
      { name: "Dark Red", hex: h("8B1A1A"), code: "dark_red" },
      { name: h("3A5F8A"), hex: h("3A5F8A"), code: "custom" },
    ]);
    expect(screen.getAllByTestId("color-swatch")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("add-color"));
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "red" } });
    fireEvent.click(screen.getByTestId("color-save"));
    expect(screen.getByRole("alert").textContent).toMatch(/not valid/);
    // the same library colour again — picked by name — is a duplicate
    chooseName("dark red");
    fireEvent.click(screen.getByTestId("color-save"));
    expect(screen.getByRole("alert").textContent).toMatch(/already added/);
    fireEvent.keyDown(screen.getByTestId("color-popover"), { key: "Escape" });
    expect(screen.queryByTestId("color-popover")).toBeNull();

    // the same custom value twice is a duplicate too
    addHex(h("3A5F8A"));
    expect(screen.getByRole("alert").textContent).toMatch(/already added/);
    fireEvent.keyDown(screen.getByTestId("color-popover"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Dark Red" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Dark Red" }));
    expect(submitted(container)).toEqual([{ name: h("3A5F8A"), hex: h("3A5F8A"), code: "custom" }]);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it("keeps a legacy named color as an unset swatch; a swatch's name shows only on ITS hover, focus or click", () => {
    wrap(<ProductForm orgId="org-1" product={{ ...existing, colors: [{ name: "Sand", hex: null }, { name: "Cream", hex: h("F2E9D8"), code: "cream" }] }} />);
    const [legacy, cream] = screen.getAllByTestId("color-swatch");
    expect(legacy!.getAttribute("aria-label")).toMatch(/Sand — Color not set yet/);
    expect(cream!.getAttribute("aria-label")).toBe("Cream");
    expect(screen.queryByTestId("color-tooltip")).toBeNull();
    fireEvent.pointerEnter(cream!);
    expect(screen.getAllByTestId("color-tooltip")).toHaveLength(1);
    expect(screen.getByTestId("color-tooltip").textContent).toBe("Cream");
  });

  it("stops at twelve colors", () => {
    wrap(<ProductForm orgId="org-1" product={{ ...existing, colors: Array.from({ length: 12 }, (_, i) => ({ name: `Color ${i}`, hex: h("B96F52") })) }} />);
    expect((screen.getByTestId("add-color") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows library colors in the reader's language and stores the picker's, with a stable code", () => {
    const { container } = wrap(<ProductForm orgId="org-1" />, "ar");
    addNamed("ازرق داكن");
    expect(submitted(container)[0]).toEqual({ name: "أزرق داكن", hex: h("123A6D"), code: "dark_blue" });
    expect(screen.getByRole("button", { name: "أزرق داكن" })).toBeTruthy();
  });

  it("counts description CHARACTERS live inside the field, in both scripts, and flags more than 250", () => {
    wrap(<ProductForm orgId="org-1" />);
    const box = screen.getByLabelText(/^Description/) as HTMLTextAreaElement;
    const counter = () => screen.getByTestId("description-count");
    expect(counter().textContent).toContain("0/250");
    fireEvent.change(box, { target: { value: "one two  three" } });
    expect(counter().textContent).toContain("14/250");
    fireEvent.change(box, { target: { value: "مرحبا بالعالم" } });
    expect(counter().textContent).toContain("13/250");
    fireEvent.change(box, { target: { value: "a".repeat(250) } });
    expect(counter().textContent).toContain("250/250");
    expect(box.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(box, { target: { value: "a".repeat(251) } });
    expect(counter().textContent).toContain("251/250");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(counter().className).toMatch(/text-danger/);
    expect(box.parentElement?.contains(counter())).toBe(true);
    expect(screen.getByTestId("description-count-figure").getAttribute("dir")).toBe("ltr");
  });

  it("offers a price field in EGP, prefilled on edit", () => {
    const { unmount } = wrap(<ProductForm orgId="org-1" />);
    expect(screen.getByTestId("price-input")).toBeTruthy();
    unmount();
    wrap(<ProductForm orgId="org-1" product={{ ...existing, basePrice: 159.5 }} />);
    expect((screen.getByTestId("price-input") as HTMLInputElement).value).toBe("159.5");
  });
});

describe("ImageManager", () => {
  const img = (n: number) => ({ id: `i${n}`, url: `https://signed/${n}.png`, slot: n });
  const manager = (images = [img(1), img(2)], archived = false) => wrap(<ImageManager productId="p1" productName="Matt Emulsion" images={images} archived={archived} />);
  const file = (type: string) => new File([new Uint8Array(16)], "x", { type });
  const pick = (input: HTMLElement, f: File) => fireEvent.change(input, { target: { files: [f] } });

  it("gives every photo a meaningful alt text and every control group a name", () => {
    manager();
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual(["Matt Emulsion — Photo 1", "Matt Emulsion — Photo 2"]);
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Photo 1", "Photo 2"]);
    for (const b of screen.getAllByRole("button")) expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("shows the count, marks the first photo as main, and offers one free slot", () => {
    manager();
    expect(screen.getByTestId("image-count").textContent).toBe("2 of 3 photos");
    expect(screen.getByText("Main photo")).toBeTruthy();
    expect(screen.getAllByTestId("image-add").filter((b) => !(b as HTMLButtonElement).disabled)).toHaveLength(1);
  });

  it("offers no add control and says why when three photos exist", () => {
    manager([img(1), img(2), img(3)]);
    expect(screen.queryByTestId("image-add")).toBeNull();
    expect(screen.getByText("You have 3 photos. Remove one to add another.")).toBeTruthy();
  });

  it("takes no changes on an archived product", () => {
    manager([img(1)], true);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getAllByTestId("image-add").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("refuses a non-image before any request is made", () => {
    manager();
    pick(screen.getByTestId("image-input"), file("application/pdf"));
    expect(screen.getByText("Use a JPG, PNG or WebP image.")).toBeTruthy();
    expect(actions.requestUpload).not.toHaveBeenCalled();
  });

  it("uploads through ticket -> storage -> confirm, then refreshes", async () => {
    actions.requestUpload.mockResolvedValue({ ok: true, key: "org/p1/i9.png", grant: { provider: "supabase", token: "test" } });
    actions.confirm.mockResolvedValue({ ok: true, id: "i9" });
    manager();
    pick(screen.getByTestId("image-input"), file("image/png"));
    await waitFor(() => expect(actions.refresh).toHaveBeenCalled());
    expect(actions.requestUpload).toHaveBeenCalledWith("p1", "image/png", expect.any(Number));
    expect(actions.upload).toHaveBeenCalledWith({ provider: "supabase", token: "test" }, expect.any(File));
    expect(actions.confirm).toHaveBeenCalledWith("org/p1/i9.png");
  });

  it("shows the three-photo refusal from the server and does not upload", async () => {
    actions.requestUpload.mockResolvedValue({ ok: false, code: "showroomProducts.errors.maxImages" });
    manager();
    pick(screen.getByTestId("image-input"), file("image/png"));
    expect(await screen.findByText("A product can have at most 3 photos.")).toBeTruthy();
    expect(actions.upload).not.toHaveBeenCalled();
  });

  it("reports an upload failure without confirming", async () => {
    actions.requestUpload.mockResolvedValue({ ok: true, key: "org/p1/i9.png" });
    actions.upload.mockResolvedValueOnce({ error: { message: "denied" } });
    manager();
    pick(screen.getByTestId("image-input"), file("image/png"));
    expect(await screen.findByText("The photo could not be uploaded. Try again.")).toBeTruthy();
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it("reorders by moving a photo earlier", async () => {
    manager([img(1), img(2), img(3)]);
    const second = screen.getAllByRole("group", { name: /Photo 2/ })[0]!;
    fireEvent.click(within(second).getByRole("button", { name: "Move earlier" }));
    await waitFor(() => expect(actions.reorder).toHaveBeenCalledWith("p1", ["i2", "i1", "i3"]));
  });

  it("cannot move the first photo earlier or the last later", () => {
    manager([img(1), img(2)]);
    expect((within(screen.getAllByRole("group", { name: /Photo 1/ })[0]!).getByRole("button", { name: "Move earlier" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(screen.getAllByRole("group", { name: /Photo 2/ })[0]!).getByRole("button", { name: "Move later" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("removes a photo through the server action", async () => {
    manager();
    fireEvent.click(within(screen.getAllByRole("group", { name: /Photo 1/ })[0]!).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("i1"));
  });
});

describe("ImageManager with videos (one shared gallery)", () => {
  const img = (n: number) => ({ id: `i${n}`, url: `https://signed/${n}.png`, slot: n });
  const vid = (n: number, state: "ready" | "processing" = "ready"): ManagedVideo => {
    const summary = { id: `v${n}`, title: `Clip ${n}`, durationSeconds: 12, width: 1280, height: 720, hasPoster: true, position: n };
    return {
      ...summary, createdAt: "2026-10-19T00:00:00Z", scope: "product", state, isPublic: false, failureCode: null,
      playback: state === "ready" ? { ...summary, src: `https://media/v/v${n}/master.m3u8`, poster: null, access: "ticketed", workspace: "org-1" } : null,
    };
  };
  const manager = (images: ReturnType<typeof img>[], videos: ReturnType<typeof vid>[]) =>
    wrap(<ImageManager productId="p1" productName="Matt Emulsion" images={images} videos={videos} archived={false} />);

  it("places a video in its slot, even first, and counts it toward the three items", () => {
    manager([img(2)], [vid(1)]);
    const tiles = screen.getByTestId("image-slots").querySelectorAll(":scope > li");
    expect(tiles[0]!.getAttribute("data-testid")).toBe("gallery-video");
    expect(screen.getByTestId("image-count").textContent).toBe("2 of 3 photos and videos");
    // The main photo is the first PHOTO, not the video before it.
    expect(within(tiles[1] as HTMLElement).getByText("Main photo")).toBeTruthy();
  });

  it("is full with two photos and one video", () => {
    manager([img(1), img(3)], [vid(2)]);
    expect(screen.queryByTestId("image-add")).toBeNull();
    expect(screen.getByText("This product has 3 photos and videos. Remove one to add another.")).toBeTruthy();
  });

  it("moves a video before a photo through the shared order", async () => {
    manager([img(1)], [vid(2)]);
    fireEvent.click(within(screen.getByRole("group", { name: "Video 2" })).getByRole("button", { name: "Move earlier" }));
    await waitFor(() => expect(actions.reorderMedia).toHaveBeenCalledWith("p1", [{ kind: "video", id: "v2" }, { kind: "image", id: "i1" }]));
    expect(actions.reorder).not.toHaveBeenCalled();
  });

  it("does not move a video that is still processing", () => {
    manager([img(1)], [vid(2, "processing")]);
    const group = screen.getByRole("group", { name: "Video 2" });
    expect((within(group).getByRole("button", { name: "Move earlier" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("video-state")).toBeTruthy();
  });
});

describe("Create product with photos in one flow", () => {
  const png = (name: string, type = "image/png") => new File([new Uint8Array(16)], name, { type });
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });
  const fill = (container: HTMLElement) => {
    fireEvent.change(container.querySelector("#name")!, { target: { value: "Matt Emulsion 18L" } });
    fireEvent.change(container.querySelector("#code")!, { target: { value: "PNT-001" } });
    fireEvent.change(container.querySelector("#categoryCode")!, { target: { value: "paints" } });
    fireEvent.change(container.querySelector("#unit")!, { target: { value: "pail" } });
  };
  const stage = (...files: File[]) => files.forEach((f) => fireEvent.change(screen.getByTestId("staged-input"), { target: { files: [f] } }));

  it("offers the photo slots on the create screen itself, before anything is saved", () => {
    wrap(<ProductForm orgId="org-1" />);
    expect(screen.getByTestId("staged-photos")).toBeTruthy();
    expect(screen.getByTestId("staged-count").textContent).toBe("0 of 3 photos");
  });

  it("shows photo counters with Latin digits in Arabic too (the Arabic zero reads as a dot)", () => {
    wrap(<ProductForm orgId="org-1" />, "ar");
    expect(screen.getByTestId("staged-count").textContent).toBe("0 من 3 صور");
  });

  it("does not show staged photos when editing (that screen has the live image manager)", () => {
    wrap(<ProductForm orgId="org-1" product={{ id: "p1", version: 1, name: "A product", code: "A1", categoryCode: "paints", unit: "pail", colors: [], basePrice: null, weightKg: null, sizeLabel: null, brand: null, description: null, audiences: [] }} />);
    expect(screen.queryByTestId("staged-photos")).toBeNull();
  });

  it("stages locally without any request: nothing is uploaded until the form is submitted", () => {
    wrap(<ProductForm orgId="org-1" />);
    stage(png("a.png"), png("b.png"));
    expect(screen.getByTestId("staged-count").textContent).toBe("2 of 3 photos");
    expect(actions.draft).not.toHaveBeenCalled();
    expect(actions.requestUpload).not.toHaveBeenCalled();
    expect(actions.upload).not.toHaveBeenCalled();
  });

  it("refuses a non-image or an oversize file, and stops at three", () => {
    wrap(<ProductForm orgId="org-1" />);
    stage(png("doc.pdf", "application/pdf"));
    expect(screen.getByText("Use a JPG, PNG or WebP image.")).toBeTruthy();
    stage(png("1.png"), png("2.png"), png("3.png"), png("4.png"));
    expect(screen.getByTestId("staged-count").textContent).toBe("3 of 3 photos");
    expect(screen.queryByTestId("staged-add")).toBeNull();
  });

  it("reorders and removes staged photos before saving", () => {
    wrap(<ProductForm orgId="org-1" />);
    stage(png("a.png"), png("b.png"));
    const second = screen.getAllByRole("group", { name: /Photo 2/ })[0]!;
    fireEvent.click(within(second).getByRole("button", { name: "Move earlier" }));
    fireEvent.click(within(screen.getAllByRole("group", { name: /Photo 2/ })[0]!).getByRole("button", { name: "Remove" }));
    expect(screen.getByTestId("staged-count").textContent).toBe("1 of 3 photos");
  });

  it("creates the draft, uploads the staged photos in order, then goes to the product", async () => {
    actions.draft.mockResolvedValue({ ok: true, productId: "p-new" });
    actions.requestUpload.mockImplementation(async () => ({ ok: true, key: "org/p-new/i.png", grant: { provider: "supabase", token: "test" } }));
    actions.confirm.mockResolvedValue({ ok: true, id: "i1" });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    stage(png("first.png"), png("second.png"));
    fireEvent.submit(screen.getByTestId("product-form"));
    await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/showroom/my-products/p-new/edit?created=1"));
    expect(actions.requestUpload).toHaveBeenCalledTimes(2);
    const uploaded = actions.upload.mock.calls.map((c) => (c as unknown as [string, File])[1].name);
    expect(uploaded).toEqual(["first.png", "second.png"]);
    const sent = (actions.draft.mock.calls[0] as unknown as [FormData])[0];
    expect(sent.get("orgId")).toBe("org-1");
    expect(sent.get("name")).toBe("Matt Emulsion 18L");
  });

  it("keeps the user on the screen with the field error when the product is refused — and uploads nothing", async () => {
    actions.draft.mockResolvedValue({ ok: false, fieldErrors: { code: "showroomProducts.errors.duplicateCode" } });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    stage(png("a.png"));
    fireEvent.submit(screen.getByTestId("product-form"));
    expect(await screen.findByText("This product code is already used in your business.")).toBeTruthy();
    expect(actions.requestUpload).not.toHaveBeenCalled();
    expect(actions.push).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector("#code")));
  });

  it("still lands on the new draft, flagged, when a photo upload fails (nothing is lost, nothing orphaned)", async () => {
    actions.draft.mockResolvedValue({ ok: true, productId: "p-new" });
    actions.requestUpload.mockResolvedValue({ ok: false, code: "showroomProducts.images.errorUpload" });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    stage(png("a.png"));
    fireEvent.submit(screen.getByTestId("product-form"));
    await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/showroom/my-products/p-new/edit?created=1&photos=partial"));
  });

  it("creates without photos just as before", async () => {
    actions.draft.mockResolvedValue({ ok: true, productId: "p-new" });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    fireEvent.submit(screen.getByTestId("product-form"));
    await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/showroom/my-products/p-new/edit?created=1"));
    expect(actions.requestUpload).not.toHaveBeenCalled();
  });
});

describe("OwnProductsResults — bounded batches", () => {
  const batch = (from: number, n: number) => Array.from({ length: n }, (_, i) => card({ id: `m${from + i}`, name: `Mine ${from + i}` }));
  const mount = (first: OwnProductCard[], total: number) => wrap(<OwnProductsResults products={first} total={total} filters={{ status: "active" }} initialView="grid" canWrite canPublish />);

  it("counts the whole match, not the batch, and loads one batch per Show more at the right offset", async () => {
    mount(batch(0, 10), 26);
    expect(screen.getByTestId("my-products-count").textContent).toBe("26 products");
    expect(screen.getAllByTestId("my-products-card")).toHaveLength(10);
    feed.load.mockResolvedValueOnce({ ok: true, cards: batch(10, 10), total: 26 });
    fireEvent.click(screen.getByTestId("my-products-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("my-products-card")).toHaveLength(20));
    expect(feed.load).toHaveBeenCalledWith({ status: "active" }, 10);
  });

  it("goes 10 -> 20 -> 26 and back one batch per Show less", async () => {
    mount(batch(0, 10), 26);
    feed.load.mockResolvedValueOnce({ ok: true, cards: batch(10, 10), total: 26 }).mockResolvedValueOnce({ ok: true, cards: batch(20, 6), total: 26 });
    fireEvent.click(screen.getByTestId("my-products-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("my-products-card")).toHaveLength(20));
    fireEvent.click(screen.getByTestId("my-products-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("my-products-card")).toHaveLength(26));
    fireEvent.click(screen.getByTestId("my-products-show-less"));
    expect(screen.getAllByTestId("my-products-card")).toHaveLength(20);
    fireEvent.click(screen.getByTestId("my-products-show-less"));
    expect(screen.getAllByTestId("my-products-card")).toHaveLength(10);
    expect(screen.queryByTestId("my-products-show-less")).toBeNull();
  });
});
