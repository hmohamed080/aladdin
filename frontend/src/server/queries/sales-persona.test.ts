import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const rows: Record<string, unknown> = {};
const asked = { from: [] as string[], select: [] as string[], eq: [] as [string, unknown][] };

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => {
    let table = "";
    const builder: Record<string, unknown> = {
      auth: { getUser },
      from(t: string) {
        table = t;
        asked.from.push(t);
        return builder;
      },
      select(cols: string) {
        asked.select.push(cols);
        return builder;
      },
      eq(col: string, val: unknown) {
        asked.eq.push([col, val]);
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
    };
    return builder;
  }),
}));

import { isSalesPersona, loadIsSalesPersona } from "./sales-persona";

const SIGNED_IN = { data: { user: { id: "u-1" } } };

/** Put the caller's two persona sources in place for one case. */
function given(canonical: string | null, declared: string | null) {
  getUser.mockResolvedValue(SIGNED_IN);
  rows.users = canonical === null ? null : { primary_account_type: canonical };
  rows.individual_onboarding = declared === null ? null : { prof_concrete_type: declared };
  asked.from.length = 0;
  asked.select.length = 0;
  asked.eq.length = 0;
}

/**
 * The frontend mirror of `app.is_sales_persona`
 * (20260831090001_sales_affiliation_persona_hardening.sql). These cases are the
 * same ones 37_sales_affiliation_persona_hardening_test.sql asserts in the
 * database, kept in step deliberately: if the two rules ever disagree, the UI
 * either hides a flow from someone entitled to it or offers a form the server
 * will refuse.
 */
describe("isSalesPersona", () => {
  it("accepts the canonical persona", () => {
    expect(isSalesPersona("sales", null)).toBe(true);
  });

  it("accepts the DECLARED persona while the upgrade is still under review", () => {
    // The case that makes the second branch mandatory rather than generous:
    // users.primary_account_type is written only by the applied upgrade, so a
    // genuine salesperson has null there for the whole review window.
    expect(isSalesPersona(null, "sales")).toBe(true);
  });

  it("rejects an installer_technician", () => {
    expect(isSalesPersona("installer_technician", null)).toBe(false);
    expect(isSalesPersona("installer_technician", "installer_technician")).toBe(false);
  });

  it("rejects every other personal persona", () => {
    for (const persona of ["engineer", "interior_designer", "contractor", "end_consumer", "trainer", "trainee"]) {
      expect(isSalesPersona(persona, null)).toBe(false);
    }
  });

  it("rejects a business-only identity with no personal persona", () => {
    expect(isSalesPersona(null, null)).toBe(false);
    expect(isSalesPersona(undefined, undefined)).toBe(false);
  });

  it("does not treat a declared non-Sales persona as Sales because the canonical one is absent", () => {
    expect(isSalesPersona(null, "engineer")).toBe(false);
  });

  it("accepts when EITHER source says sales, never requiring both", () => {
    expect(isSalesPersona("sales", "engineer")).toBe(true);
    expect(isSalesPersona("engineer", "sales")).toBe(true);
  });
});

/**
 * The loader behind BOTH the /home/showroom gate and the personal layout's
 * "connect your showroom" link. It is tested separately from the predicate above
 * because the bug it exists to prevent is not in the rule — it is in WHERE the
 * rule reads from. `my_workspaces()` reports `users.primary_account_type` alone,
 * so a layout that trusted that column hid the link from people the page and the
 * database both admit.
 */
describe("loadIsSalesPersona", () => {
  it("is false for a signed-out caller, without touching the tables", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    asked.from.length = 0;
    expect(await loadIsSalesPersona()).toBe(false);
    expect(asked.from).toEqual([]);
  });

  it("is true for the canonical Sales persona", async () => {
    given("sales", null);
    expect(await loadIsSalesPersona()).toBe(true);
  });

  it("is true for a DECLARED salesperson whose upgrade is still under review", async () => {
    // The regression this loader exists to prevent, and the exact case the
    // layout used to get wrong: `users.primary_account_type` is still null, so
    // the workspace projection reports no persona at all.
    given(null, "sales");
    expect(await loadIsSalesPersona()).toBe(true);
  });

  it("is false for an installer_technician, canonical or declared", async () => {
    given("installer_technician", "installer_technician");
    expect(await loadIsSalesPersona()).toBe(false);
    given(null, "installer_technician");
    expect(await loadIsSalesPersona()).toBe(false);
  });

  it("is false when neither source claims a personal persona", async () => {
    given(null, null);
    expect(await loadIsSalesPersona()).toBe(false);
  });

  it("asks only about the CALLER, never a supplied id", async () => {
    given("sales", null);
    await loadIsSalesPersona();
    expect(asked.from).toEqual(["users", "individual_onboarding"]);
    expect(asked.select).toEqual(["primary_account_type", "prof_concrete_type"]);
    // Both reads are pinned to auth.getUser()'s id and nothing else.
    expect(asked.eq).toEqual([
      ["id", "u-1"],
      ["user_id", "u-1"],
    ]);
  });
});
