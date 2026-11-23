import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { accountBasicsPath, hasMissingBasics, loadAccountBasics, missingBasics, needsAccountBasics } from "./account-basics";

type Rpc = (name: string) => Promise<{ data: unknown; error: { code?: string } | null }>;
const client = (rpc: Rpc) => ({ rpc }) as unknown as Parameters<typeof loadAccountBasics>[0];
const returning = (data: unknown) => client(async () => ({ data, error: null }));

const COMPLETE = { phone: "+201012345678", governorate: "cairo", city: "new-cairo", cityCustom: null, specialtyKind: "trades", specialties: ["wallpaper_installation"] };

describe("existing-data detection", () => {
  it("an account holding all three owes nothing", async () => {
    const basics = await loadAccountBasics(returning(COMPLETE));
    expect(missingBasics(basics!)).toEqual({ phone: false, location: false, specialties: false });
    expect(await needsAccountBasics(returning(COMPLETE))).toBe(false);
  });

  it("a typed town counts as a town", async () => {
    const basics = await loadAccountBasics(returning({ ...COMPLETE, city: null, cityCustom: "Kafr Testtown" }));
    expect(missingBasics(basics!).location).toBe(false);
  });

  it("asks only for what is missing", async () => {
    const basics = await loadAccountBasics(returning({ ...COMPLETE, phone: null, specialties: [] }));
    expect(missingBasics(basics!)).toEqual({ phone: true, location: false, specialties: true });
  });

  it("an account with no specialty list (business, Sales Team, Personal) is never asked for specialties", async () => {
    for (const kind of ["none", undefined, "categories"]) {
      const basics = await loadAccountBasics(returning({ ...COMPLETE, specialtyKind: kind, specialties: [] }));
      expect(basics!.specialtyKind).toBe("none");
      expect(missingBasics(basics!).specialties).toBe(false);
    }
  });

  it("an Engineer answers the Engineer list", async () => {
    const basics = await loadAccountBasics(returning({ ...COMPLETE, specialtyKind: "engineer", specialties: [] }));
    expect(basics!.specialtyKind).toBe("engineer");
    expect(missingBasics(basics!).specialties).toBe(true);
  });

  it("a governorate without a town is still missing a location", async () => {
    const basics = await loadAccountBasics(returning({ ...COMPLETE, city: null, cityCustom: null }));
    expect(missingBasics(basics!).location).toBe(true);
  });

  it("blank strings and non-string specialties count as missing", async () => {
    const basics = await loadAccountBasics(returning({ phone: "  ", governorate: "", city: "x", cityCustom: null, specialties: [1, null] }));
    expect(hasMissingBasics(missingBasics(basics!))).toBe(true);
    expect(basics!.specialties).toEqual([]);
  });

  it("fails open: a read error or no profile never sends anyone to the screen", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await needsAccountBasics(client(async () => ({ data: null, error: { code: "42501" } })))).toBe(false);
    expect(await needsAccountBasics(returning(null))).toBe(false);
    spy.mockRestore();
  });

  it("carries the destination, but not a bare root", () => {
    expect(accountBasicsPath("/home/jobs")).toBe("/onboarding/basics?next=%2Fhome%2Fjobs");
    expect(accountBasicsPath("/")).toBe("/onboarding/basics");
  });
});
