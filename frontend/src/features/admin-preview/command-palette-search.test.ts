import { describe, expect, it } from "vitest";
import { flattenResults, moveActive, normalizeForSearch, scoreItem, searchPalette, type PaletteItem } from "./command-palette-search";

const items: PaletteItem[] = [
  { id: "u1", group: "users", label: "Ahmed Hassan", secondary: "Engineer", href: "/admin/preview/users/u1" },
  { id: "u2", group: "users", label: "Mona Ahmed", secondary: "Consumer", href: "/admin/preview/users/u2" },
  { id: "u3", group: "users", label: "Sara Ali", secondary: "Ahmed's colleague", href: "/admin/preview/users/u3" },
  { id: "o1", group: "organizations", label: "Ahmed Showroom", secondary: "Showroom / Dealer", href: "/admin/preview/organizations/o1" },
  { id: "n1", group: "navigation", label: "Points", href: "/admin/preview/points" },
  { id: "n2", group: "navigation", label: "Audit", href: "/admin/preview/audit" },
  { id: "s1", group: "staff", label: "Admin Person", secondary: "Administrator", href: "/admin/preview/staff" },
];

describe("normalizeForSearch", () => {
  it("is case and diacritic insensitive", () => {
    expect(normalizeForSearch("  Ahméd ")).toBe("ahmed");
    expect(normalizeForSearch("مُحَمَّد")).toBe(normalizeForSearch("محمد"));
  });
});

describe("scoreItem", () => {
  it("ranks prefix > word start > substring > secondary > none", () => {
    const [ahmed, mona, sara] = items;
    expect(scoreItem(ahmed!, "ahm")).toBe(100);
    expect(scoreItem(mona!, "ahm")).toBe(80);
    expect(scoreItem(items[3]!, "showroom")).toBe(80);
    expect(scoreItem(ahmed!, "san")).toBe(60);
    expect(scoreItem(sara!, "ahm")).toBe(30);
    expect(scoreItem(sara!, "zzz")).toBe(0);
  });
});

describe("searchPalette", () => {
  it("returns navigation only for an empty query", () => {
    const groups = searchPalette(items, "  ");
    expect(groups.map((g) => g.group)).toEqual(["navigation"]);
  });
  it("groups in the fixed order and ranks inside a group", () => {
    const groups = searchPalette(items, "ahmed");
    expect(groups.map((g) => g.group)).toEqual(["users", "organizations"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["u1", "u2", "u3"]);
  });
  it("caps each group", () => {
    expect(searchPalette(items, "ahmed", 1)[0]!.items).toHaveLength(1);
  });
  it("finds admin pages by name", () => {
    expect(flattenResults(searchPalette(items, "aud")).map((i) => i.id)).toEqual(["n2"]);
  });
  it("returns nothing when nothing matches", () => {
    expect(searchPalette(items, "qqqq")).toEqual([]);
  });
});

describe("moveActive", () => {
  it("wraps around in both directions", () => {
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(1, 1, 3)).toBe(2);
  });
  it("is safe on an empty list", () => {
    expect(moveActive(0, 1, 0)).toBe(0);
  });
});
